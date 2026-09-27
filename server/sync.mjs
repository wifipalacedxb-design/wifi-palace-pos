// Long-offline support: light snapshots, incremental changes, server totals, per-till invoice numbers.
//
// * Devices hold only recent history (HISTORY_DAYS). Older sales, stock movements, account payments,
//   check-ins and closed laundry orders stay on the server (reports and finance are server-side anyway).
// * Every record write is logged in `changes`, so a device asks only for what changed since its cursor
//   instead of downloading the whole business every 30 seconds.
// * Totals that need all history (grocery stock, customer credit) are computed here from every till's
//   synced records; a device adds only its own unsynced changes on top.
// * Each device (till) gets a code, so receipts printed offline carry final invoice numbers
//   INV-T<code>-<nnnnnn> that the server accepts once, instead of provisional numbers.
import {businessTypeOf} from './store.mjs';
import {businessModule,kindsFor} from './modules.mjs';
export const HISTORY_DAYS=35;
export const OFFLINE_HOURS=[12,24,72,168,336,720];
const DAY=86400000;

export function initSync(db){db.exec(`
CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,business_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS changes_business_seq ON changes(business_id,seq);
CREATE TABLE IF NOT EXISTS business_options(business_id TEXT PRIMARY KEY,offline_hours INTEGER NOT NULL DEFAULT 12);
CREATE TABLE IF NOT EXISTS tills(business_id TEXT NOT NULL,device TEXT NOT NULL,code INTEGER NOT NULL,name TEXT NOT NULL,last INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,PRIMARY KEY(business_id,device),UNIQUE(business_id,code));
CREATE TABLE IF NOT EXISTS till_invoices(business_id TEXT NOT NULL,number TEXT NOT NULL,PRIMARY KEY(business_id,number));
`)}
export const recordChange=(db,business,kind,id)=>db.prepare('INSERT INTO changes(business_id,kind,id) VALUES (?,?,?)').run(business,kind,id);
export const offlineHours=(db,business)=>db.prepare('SELECT offline_hours h FROM business_options WHERE business_id=?').get(business)?.h||12;
export function setOfflineHours(db,business,hours){if(!OFFLINE_HOURS.includes(hours))throw Error('Choose a supported offline period');db.prepare('INSERT INTO business_options VALUES (?,?) ON CONFLICT(business_id) DO UPDATE SET offline_hours=excluded.offline_hours').run(business,hours)}

// When a record is "history" a device no longer needs to hold.
function when(kind,d){
 if(kind==='sales'){const t=Math.max(Date.parse(d.date)||0,Date.parse(d.refundDate||'')||0);return t}
 if(['grocery_stock','grocery_payments','gym_checkins'].includes(kind))return Date.parse(d.at)||0;
 if(kind==='laundry_orders')return ['Delivered','Cancelled'].includes(d.status)?Date.parse(d.history?.at(-1)?.at||d.received)||0:Infinity;
 return Infinity;
}
const historic=(kind,d,cutoff)=>d&&when(kind,d)<cutoff;
// Receipts and item lines stay small on devices: the logo lives once in settings, not in every sale.
function slim(kind,d){if(kind!=='sales'||!d)return d;return{...d,shop:d.shop?{...d.shop,logo:''}:d.shop,items:(d.items||[]).map(i=>{const l={id:i.id,name:i.name};for(const k of ['category','unit','type'])if(i[k]!==undefined)l[k]=i[k];l.price=i.price;if(i.listPrice!==undefined)l.listPrice=i.listPrice;l.qty=i.qty;return l})}}
const visibleTo=(u,kind,d)=>!(u.role==='cashier'&&kind==='sales'&&d&&d.createdBy!==u.id);

export function summaryFor(db,business,type){const m=businessModule(type);return typeof m.summary==='function'?m.summary(db,business):null}
const cursor=(db,business)=>db.prepare('SELECT max(seq) s FROM changes WHERE business_id=?').get(business)?.s||0;

export function recentState(db,u,days=HISTORY_DAYS){
 const type=businessTypeOf(db,u.business_id),cutoff=Date.now()-days*DAY,state={version:1,type},revisions={};
 const seq=cursor(db,u.business_id); // read first: anything written after this is picked up by the next changes call
 for(const kind of kindsFor(type))if(!['settings','vendor'].includes(kind))state[kind]=[];
 for(const row of db.prepare('SELECT kind,id,version,data FROM records WHERE business_id=? ORDER BY rowid').all(u.business_id)){
  if(row.data===null){revisions[row.kind+':'+row.id]=row.version;continue}
  const d=JSON.parse(row.data);if(historic(row.kind,d,cutoff)||!visibleTo(u,row.kind,d))continue;
  revisions[row.kind+':'+row.id]=row.version;
  if(Array.isArray(state[row.kind]))state[row.kind].push(slim(row.kind,d));else state[row.kind]=d;
 }
 return{state,revisions,seq,historyDays:days,summary:summaryFor(db,u.business_id,type),offlineHours:offlineHours(db,u.business_id),serverTime:new Date().toISOString()};
}
export function changesSince(db,u,after,days=HISTORY_DAYS){
 if(!Number.isSafeInteger(after)||after<0)throw Object.assign(Error('Invalid cursor'),{status:400});
 const type=businessTypeOf(db,u.business_id),cutoff=Date.now()-days*DAY,seq=cursor(db,u.business_id);
 if(seq-after>5000)return{reload:true,seq};
 const keys=db.prepare('SELECT DISTINCT kind,id FROM changes WHERE business_id=? AND seq>? AND seq<=?').all(u.business_id,after,seq),records=[];let reload=false;
 for(const k of keys){const row=db.prepare('SELECT version,data FROM records WHERE business_id=? AND kind=? AND id=?').get(u.business_id,k.kind,k.id);if(!row)continue;const d=row.data===null?null:JSON.parse(row.data);
  if(!visibleTo(u,k.kind,d))continue;
  if(historic(k.kind,d,cutoff)){reload=true;continue} // an old record changed (e.g. late refund): refresh the whole snapshot
  records.push({kind:k.kind,key:k.id,version:row.version,data:slim(k.kind,d)});}
 return{records,seq,reload,summary:summaryFor(db,u.business_id,type),offlineHours:offlineHours(db,u.business_id),serverTime:new Date().toISOString()};
}

// --- tills ------------------------------------------------------------------------------------------
export function registerTill(db,u,device,name){
 if(typeof device!=='string'||!/^[A-Za-z0-9-]{16,64}$/.test(device))throw Object.assign(Error('Invalid device'),{status:400});
 const label=typeof name==='string'?name.trim().slice(0,60):'';
 db.exec('BEGIN IMMEDIATE');try{
  let t=db.prepare('SELECT * FROM tills WHERE business_id=? AND device=?').get(u.business_id,device);
  if(!t){const code=(db.prepare('SELECT max(code) c FROM tills WHERE business_id=?').get(u.business_id)?.c||0)+1;db.prepare('INSERT INTO tills VALUES (?,?,?,?,0,?)').run(u.business_id,device,code,label||'Till '+code,new Date().toISOString());t=db.prepare('SELECT * FROM tills WHERE business_id=? AND device=?').get(u.business_id,device)}
  db.exec('COMMIT');return{code:t.code,name:t.name,last:t.last};
 }catch(e){db.exec('ROLLBACK');throw e}
}
export const TILL_NUMBER=/^INV-T(\d{1,4})-(\d{6})$/;
// Called inside the sync transaction: accept a till-issued invoice number exactly once.
export function claimTillNumber(db,business,number){
 const m=TILL_NUMBER.exec(number||'');if(!m)return false;
 const till=db.prepare('SELECT * FROM tills WHERE business_id=? AND code=?').get(business,Number(m[1]));if(!till)return false;
 if(db.prepare('SELECT 1 FROM till_invoices WHERE business_id=? AND number=?').get(business,number))return false;
 db.prepare('INSERT INTO till_invoices VALUES (?,?)').run(business,number);
 db.prepare('UPDATE tills SET last=max(last,?) WHERE business_id=? AND code=?').run(Number(m[2]),business,till.code);
 return true;
}
export const listTills=(db,business)=>db.prepare('SELECT code,name,last,created FROM tills WHERE business_id=? ORDER BY code').all(business);
