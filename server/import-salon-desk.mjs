// Copies salons from a Salon Desk database (wifipalace.in) into the WiFi Palace POS database (pos.wifipalace.in)
// as "Salon & spa" businesses. The Salon Desk database is only read, never changed.
//
//   node server/import-salon-desk.mjs --from <salon.sqlite> --to <pos.sqlite>             (dry run: shows what would be copied)
//   node server/import-salon-desk.mjs --from <salon.sqlite> --to <pos.sqlite> --apply     (copies)
//   add --replace to refresh an earlier copy of the same salon (its old copy in POS is deleted first)
//
// Copied: salon, logins (same email + password), services, staff, customers, appointments, sales, settings/logo,
// subscription, expenses, daily closings, audit history and sync operation ids (so a device's old pending
// change is never applied twice). Not copied: sign-in sessions (everyone signs in again), reset/invite links,
// signup requests and the Salon Desk partner-console account.
import {DatabaseSync} from 'node:sqlite';
import {existsSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {openStore} from './store.mjs';
import {initProvider} from './provider.mjs';
import {initFinance} from './finance.mjs';
import {initSignup} from './signup.mjs';
import {initRecovery} from './recovery.mjs';

export function importSalonDesk({from,to,apply=false,replace=false,only=''}){
 if(!from||!existsSync(from))throw Error('Salon Desk database not found: '+from);
 if(!to)throw Error('Give the POS database with --to');
 const src=new DatabaseSync(from,{readOnly:true});
 const report={salons:[],apply,problems:[]};
 try{
  src.exec('BEGIN'); // one consistent snapshot of the live database
  const has=t=>!!src.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  if(!has('salons')||!has('records'))throw Error('This does not look like a Salon Desk database');
  const rows=(table,salon)=>has(table)?src.prepare(`SELECT * FROM ${table} WHERE salon_id=?`).all(salon):[];
  const salons=src.prepare('SELECT * FROM salons ORDER BY created').all().filter(s=>!only||s.slug===only);
  if(only&&!salons.length)throw Error('No salon with code '+only);
  const plan=salons.map(s=>{const users=rows('users',s.id);return{salon:s,users,records:rows('records',s.id),operations:rows('operations',s.id),audit:rows('audit',s.id),subscription:rows('subscriptions',s.id)[0]||null,expenses:rows('salon_expenses',s.id),closings:rows('salon_closings',s.id)}});
  src.exec('COMMIT');
  const dst=openStore(to);initProvider(dst);initFinance(dst);initSignup(dst);initRecovery(dst);
  try{
   for(const p of plan){
    const s=p.salon,kinds={};for(const r of p.records)if(r.data!==null)kinds[r.kind]=(kinds[r.kind]||0)+1;
    const existing=dst.prepare('SELECT id,type FROM businesses WHERE id=? OR slug=?').all(s.id,s.slug);
    const sameCopy=existing.length===1&&existing[0].id===s.id;
    const entry={code:s.slug,name:s.name,logins:p.users.map(u=>u.email+' ('+u.role+(u.active?'':', disabled')+')'),records:kinds,expenses:p.expenses.length,closings:p.closings.length,subscription:p.subscription?p.subscription.status+' until '+p.subscription.expires:'none',action:''};
    if(existing.length&&!(sameCopy&&replace)){entry.action=sameCopy?'SKIP: already copied (use --replace to refresh)':'SKIP: business code "'+s.slug+'" is already used by another business in POS';report.problems.push(s.slug+': '+entry.action);report.salons.push(entry);continue}
    const clash=p.users.filter(u=>dst.prepare('SELECT 1 FROM users WHERE id=? AND business_id<>?').get(u.id,s.id));
    if(clash.length){entry.action='SKIP: login ids already exist in POS';report.problems.push(s.slug+': '+entry.action);report.salons.push(entry);continue}
    entry.action=apply?(sameCopy?'REFRESHED':'COPIED'):(sameCopy?'would refresh':'would copy');
    report.salons.push(entry);
    if(!apply)continue;
    dst.exec('BEGIN IMMEDIATE');try{
     if(sameCopy)for(const t of ['records','operations','audit','subscriptions','expenses','day_closings','business_options','changes','counters','tills','till_invoices']){try{dst.prepare(`DELETE FROM ${t} WHERE business_id=?`).run(s.id)}catch{}}
     if(sameCopy){dst.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE business_id=?)').run(s.id);dst.prepare('DELETE FROM invitations WHERE user_id IN (SELECT id FROM users WHERE business_id=?)').run(s.id);dst.prepare('DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE business_id=?)').run(s.id);dst.prepare('DELETE FROM users WHERE business_id=?').run(s.id);dst.prepare('DELETE FROM businesses WHERE id=?').run(s.id)}
     dst.prepare('INSERT INTO businesses(id,name,slug,active,created,type) VALUES (?,?,?,?,?,?)').run(s.id,s.name,s.slug,s.active,s.created,'salon');
     for(const u of p.users)dst.prepare('INSERT INTO users(id,business_id,email,name,password,role,active) VALUES (?,?,?,?,?,?,?)').run(u.id,s.id,u.email,u.name,u.password,u.role,u.active);
     for(const r of p.records)dst.prepare('INSERT INTO records(business_id,kind,id,version,data) VALUES (?,?,?,?,?)').run(s.id,r.kind,r.id,r.version,r.data);
     for(const o of p.operations)dst.prepare('INSERT OR IGNORE INTO operations(business_id,user_id,id,digest,result) VALUES (?,?,?,?,?)').run(s.id,o.user_id,o.id,o.digest,o.result);
     for(const a of p.audit)dst.prepare('INSERT INTO audit(business_id,user_id,action,entity,at) VALUES (?,?,?,?,?)').run(s.id,a.user_id,a.action,a.entity,a.at);
     if(p.subscription)dst.prepare('INSERT INTO subscriptions(business_id,plan,status,expires) VALUES (?,?,?,?)').run(s.id,p.subscription.plan,p.subscription.status,p.subscription.expires);
     for(const e of p.expenses)dst.prepare('INSERT INTO expenses(business_id,id,date,amount,method,category,note,created_by,created_at,voided_at,void_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(s.id,e.id,e.date,e.amount,e.method,e.category,e.note,e.created_by,e.created_at,e.voided_at??null,e.void_reason??null);
     for(const c of p.closings)dst.prepare('INSERT INTO day_closings(business_id,date,data) VALUES (?,?,?)').run(s.id,c.date,c.data);
     // Check the copy before committing: every row must have arrived.
     const n=(t,col='business_id')=>dst.prepare(`SELECT count(*) n FROM ${t} WHERE ${col}=?`).get(s.id).n;
     const want={users:p.users.length,records:p.records.length,expenses:p.expenses.length,day_closings:p.closings.length},got={users:n('users'),records:n('records'),expenses:n('expenses'),day_closings:n('day_closings')};
     if(JSON.stringify(want)!==JSON.stringify(got))throw Error('Copy check failed for '+s.slug+': expected '+JSON.stringify(want)+', got '+JSON.stringify(got));
     dst.exec('COMMIT');
    }catch(e){dst.exec('ROLLBACK');throw e}
   }
   if(apply){const check=dst.prepare('PRAGMA integrity_check').get();report.integrity=Object.values(check)[0]}
  }finally{dst.close()}
 }finally{try{src.exec('ROLLBACK')}catch{}src.close()}
 return report;
}

// Hostinger runs the app through a symlinked folder, so compare real paths.
const isMain=(()=>{try{return realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))}catch{return false}})();
if(isMain){
 const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:''};
 try{
  const r=importSalonDesk({from:arg('--from'),to:arg('--to'),apply:process.argv.includes('--apply'),replace:process.argv.includes('--replace'),only:arg('--only')});
  console.log(r.apply?'IMPORT DONE':'DRY RUN (nothing changed). Add --apply to copy.');
  for(const s of r.salons){console.log('\n'+s.name+'  [code: '+s.code+']  → '+s.action);console.log('  logins: '+(s.logins.join(', ')||'none'));console.log('  records: '+Object.entries(s.records).map(([k,v])=>k+' '+v).join(', '));console.log('  expenses '+s.expenses+', daily closings '+s.closings+', subscription: '+s.subscription)}
  if(r.integrity)console.log('\nPOS database check: '+r.integrity);
  if(r.problems.length){console.log('\nNot copied:\n  '+r.problems.join('\n  '));process.exitCode=2}
 }catch(e){console.error('Stopped: '+e.message);process.exitCode=1}
}
