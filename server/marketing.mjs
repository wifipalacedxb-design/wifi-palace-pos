// Marketing for every business type (online; settings and campaigns are owner only):
// * customer groups worked out from sales (top spenders, not seen for 30/60/90 days, birthdays this month, new);
// * loyalty points earned automatically on sales to a saved customer, redeemed at the till as a discount;
// * coupons (percent or amount, minimum spend, expiry, usage limit) redeemed at the till;
// * WhatsApp campaigns: a group + a message; staff tap Send for each customer (no automatic bulk sending).
// Points earned are never stored: they are recomputed from paid, un-refunded sales, so refunds take them back.
// Perfume shops keep their own built-in points (synced with the bill), so loyalty here is off for them.
import {ApiError} from './rules.mjs';
import {audit} from './store.mjs';
import {businessDay} from './finance.mjs';
const DAY=86400000,fail=(s,m)=>{throw new ApiError(s,m)};
const key=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v))fail(400,'Invalid request identifier');return v};
const int=(v,min,max,label)=>{if(!Number.isSafeInteger(v)||v<min||v>max)fail(400,label+' must be '+min+' to '+max);return v};
const text=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'Enter '+label);return v.trim()};
export const LOYALTY_DEFAULT={enabled:false,earnPerAed:1,redeemFils:5,minRedeem:100};
export const GROUPS=[['top','Top spenders (last 12 months)'],['lapsed30','Not seen for 30–59 days'],['lapsed60','Not seen for 60–89 days'],['lapsed90','Not seen for 90+ days'],['birthday','Birthday this month'],['new','New in the last 30 days'],['all','All customers with a phone number']];
export function initMarketing(db){db.exec(`
CREATE TABLE IF NOT EXISTS marketing_config(business_id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS coupons(business_id TEXT NOT NULL,id TEXT NOT NULL,code TEXT NOT NULL,kind TEXT NOT NULL,value INTEGER NOT NULL,min_spend INTEGER NOT NULL,expires TEXT NOT NULL,max_uses INTEGER NOT NULL,uses INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,PRIMARY KEY(business_id,id),UNIQUE(business_id,code));
CREATE TABLE IF NOT EXISTS redemptions(business_id TEXT NOT NULL,id TEXT NOT NULL,type TEXT NOT NULL,coupon_id TEXT NOT NULL DEFAULT '',customer_id TEXT NOT NULL DEFAULT '',points INTEGER NOT NULL DEFAULT 0,amount INTEGER NOT NULL,at TEXT NOT NULL,by_user TEXT NOT NULL,PRIMARY KEY(business_id,id));
CREATE TABLE IF NOT EXISTS campaigns(business_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,grp TEXT NOT NULL,message TEXT NOT NULL,recipients TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(business_id,id));
`)}
const records=(db,b,kind)=>db.prepare('SELECT data FROM records WHERE business_id=? AND kind=? AND data IS NOT NULL').all(b,kind).map(r=>JSON.parse(r.data));
const typeOf=(db,b)=>db.prepare('SELECT type FROM businesses WHERE id=?').get(b)?.type||'salon';
export function loyaltyConfig(db,b){const row=db.prepare('SELECT data FROM marketing_config WHERE business_id=?').get(b),c={...LOYALTY_DEFAULT,...(row?JSON.parse(row.data).loyalty:{})};if(typeOf(db,b)==='perfume')c.enabled=false;return c}
const paid=s=>s.status==='Paid'; // refunded sales earn nothing
function customerStats(db,b){
 const stats=new Map(records(db,b,'customers').map(c=>[c.id,{id:c.id,name:c.name,phone:c.phone||'',dob:c.dob||'',visits:0,spend:0,spendYear:0,first:'',last:''}])),now=Date.now();
 for(const s of records(db,b,'sales')){if(!paid(s)||!s.customerId)continue;const c=stats.get(s.customerId);if(!c)continue;const net=s.sub-s.off;c.visits++;c.spend+=net;if(now-Date.parse(s.date)<365*DAY)c.spendYear+=net;if(!c.first||s.date<c.first)c.first=s.date;if(!c.last||s.date>c.last)c.last=s.date}
 return stats;
}
export function customerGroups(db,b){
 const all=[...customerStats(db,b).values()],now=Date.now(),days=c=>c.last?Math.floor((now-Date.parse(c.last))/DAY):null,month=businessDay().slice(5,7);
 const g={top:all.filter(c=>c.spendYear>0).sort((x,y)=>y.spendYear-x.spendYear).slice(0,20),lapsed30:all.filter(c=>days(c)>=30&&days(c)<60),lapsed60:all.filter(c=>days(c)>=60&&days(c)<90),lapsed90:all.filter(c=>days(c)>=90),
  birthday:all.filter(c=>c.dob&&c.dob.slice(5,7)===month),new:all.filter(c=>c.first&&now-Date.parse(c.first)<30*DAY),all:all.filter(c=>c.phone)};
 for(const k of Object.keys(g))if(k!=='top')g[k].sort((x,y)=>x.name.localeCompare(y.name));
 return g;
}
export function pointsOf(db,b,customerId,cfg=loyaltyConfig(db,b)){
 let earned=0;for(const s of records(db,b,'sales'))if(paid(s)&&s.customerId===customerId)earned+=Math.floor((s.sub-s.off)*cfg.earnPerAed/100);
 const used=db.prepare("SELECT COALESCE(SUM(points),0) n FROM redemptions WHERE business_id=? AND type='points' AND customer_id=?").get(b,customerId).n;
 return{earned,redeemed:used,balance:earned-used,value:Math.max(0,earned-used)*cfg.redeemFils};
}
const couponRow=c=>({id:c.id,code:c.code,kind:c.kind,value:c.value,minSpend:c.min_spend,expires:c.expires,maxUses:c.max_uses,uses:c.uses,active:!!c.active});
function campaignView(db,b,c,sales){
 const rec=JSON.parse(c.recipients),sent=rec.filter(r=>r.sentAt);let returned=0,revenue=0;
 for(const r of sent){const after=sales.filter(s=>paid(s)&&s.customerId===r.id&&s.date>r.sentAt&&Date.parse(s.date)-Date.parse(r.sentAt)<30*DAY);if(after.length){returned++;revenue+=after.reduce((n,s)=>n+s.sub-s.off,0)}}
 return{id:c.id,name:c.name,group:c.grp,message:c.message,createdAt:c.created_at,recipients:rec,sent:sent.length,returned,revenue};
}
export async function marketingRoute({db,u,req,res,path,body,send,limited,waiter}){
 if(!path.startsWith('/api/marketing/'))return false;
 const b=u.business_id,owner=()=>{if(u.role!=='owner')fail(403,'Owner permission required')},cfg=loyaltyConfig(db,b);
 const txn=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
 if(req.method==='GET'){
  if(path==='/api/marketing/overview'){owner();const groups=customerGroups(db,b),sales=records(db,b,'sales');
   const balances=cfg.enabled?[...customerStats(db,b).values()].map(c=>({id:c.id,name:c.name,phone:c.phone,...pointsOf(db,b,c.id,cfg)})).filter(c=>c.earned>0).sort((x,y)=>y.balance-x.balance).slice(0,50):[];
   send(res,200,{loyalty:cfg,builtInLoyalty:typeOf(db,b)==='perfume',groupNames:GROUPS,groups,balances,
    coupons:db.prepare('SELECT * FROM coupons WHERE business_id=? ORDER BY created_at DESC').all(b).map(couponRow),
    campaigns:db.prepare('SELECT * FROM campaigns WHERE business_id=? ORDER BY created_at DESC LIMIT 50').all(b).map(c=>campaignView(db,b,c,sales)),
    redemptions:db.prepare('SELECT type,points,amount,at,customer_id FROM redemptions WHERE business_id=? ORDER BY at DESC LIMIT 30').all(b)});return true}
  // Till: is there anything to redeem, and what does this customer have?
  if(path==='/api/marketing/rewards'){const id=new URL(req.url,'http://local').searchParams.get('customerId')||'',coupons=db.prepare('SELECT COUNT(*) n FROM coupons WHERE business_id=? AND active=1').get(b).n;
   send(res,200,{loyalty:cfg,coupons,points:cfg.enabled&&id?pointsOf(db,b,id,cfg):null});return true}
  return false;
 }
 if(req.method!=='POST')return false;
 const d=await body(req);
 if(path==='/api/marketing/redeem'){
  if(waiter)fail(403,'Waiter logins cannot apply discounts');
  const id=key(d.id),now=new Date().toISOString();
  const result=txn(()=>{
   const old=db.prepare('SELECT amount,points FROM redemptions WHERE business_id=? AND id=?').get(b,id);if(old)return{amount:old.amount,points:old.points,replay:true};
   if(d.type==='points'){
    if(!cfg.enabled)fail(409,'Loyalty points are switched off');
    const customerId=key(d.customerId);if(!db.prepare("SELECT 1 FROM records WHERE business_id=? AND kind='customers' AND id=? AND data IS NOT NULL").get(b,customerId))fail(404,'Customer not found');
    const p=pointsOf(db,b,customerId,cfg),points=int(d.points,1,10000000,'Points');
    if(points<cfg.minRedeem)fail(409,'Redeem at least '+cfg.minRedeem+' points');if(points>p.balance)fail(409,'This customer has '+p.balance+' points');
    const amount=points*cfg.redeemFils;db.prepare("INSERT INTO redemptions(business_id,id,type,customer_id,points,amount,at,by_user) VALUES (?,?,'points',?,?,?,?,?)").run(b,id,customerId,points,amount,now,u.id);
    audit(db,u,'points-redeemed',customerId+':'+points);return{amount,points,balance:p.balance-points};
   }
   if(d.type==='coupon'){
    const code=text(d.code,40,'the coupon code').toUpperCase(),subtotal=int(d.subtotal,1,100000000,'Bill amount');limited('coupon:'+b+':'+u.id,100);
    const c=db.prepare('SELECT * FROM coupons WHERE business_id=? AND code=?').get(b,code);
    if(!c||!c.active)fail(404,'This coupon code is not valid');if(c.expires&&c.expires<businessDay())fail(409,'This coupon expired on '+c.expires);
    if(c.max_uses&&c.uses>=c.max_uses)fail(409,'This coupon has been used the maximum number of times');if(subtotal<c.min_spend)fail(409,'Minimum spend for this coupon is AED '+(c.min_spend/100).toFixed(2));
    const amount=Math.min(subtotal,c.kind==='percent'?Math.round(subtotal*c.value/10000):c.value);
    db.prepare('UPDATE coupons SET uses=uses+1 WHERE business_id=? AND id=?').run(b,c.id);
    db.prepare("INSERT INTO redemptions(business_id,id,type,coupon_id,customer_id,amount,at,by_user) VALUES (?,?,'coupon',?,?,?,?,?)").run(b,id,c.id,typeof d.customerId==='string'?d.customerId.slice(0,100):'',amount,now,u.id);
    audit(db,u,'coupon-redeemed',code);return{amount,code};
   }
   fail(400,'Choose points or a coupon');
  });
  send(res,200,result);return true;
 }
 owner();
 if(path==='/api/marketing/loyalty'){
  if(typeOf(db,b)==='perfume')fail(409,'Perfume shops use the built-in loyalty points in Settings');
  const loyalty={enabled:d.enabled===true,earnPerAed:int(d.earnPerAed,1,100,'Points per AED'),redeemFils:int(d.redeemFils,1,1000,'Fils per point'),minRedeem:int(d.minRedeem,1,100000,'Minimum points')};
  db.prepare('INSERT INTO marketing_config VALUES (?,?) ON CONFLICT(business_id) DO UPDATE SET data=excluded.data').run(b,JSON.stringify({loyalty}));audit(db,u,'loyalty-settings',loyalty.enabled?'on':'off');send(res,200,{loyalty});return true;
 }
 if(path==='/api/marketing/coupons'){
  const c={id:key(d.id),code:text(d.code,40,'a coupon code').toUpperCase(),kind:d.kind,value:0,min:int(d.minSpend??0,0,100000000,'Minimum spend'),expires:d.expires||'',max:int(d.maxUses??0,0,1000000,'Usage limit'),active:d.active===false?0:1};
  if(!/^[A-Z0-9_-]{3,40}$/.test(c.code))fail(400,'Use 3–40 letters or numbers for the code (no spaces)');
  if(c.kind==='percent')c.value=int(d.value,1,10000,'Percent (in hundredths)');else if(c.kind==='amount')c.value=int(d.value,1,100000000,'Amount');else fail(400,'Choose percent or amount');
  if(c.expires&&(!/^\d{4}-\d{2}-\d{2}$/.test(c.expires)||!Number.isFinite(Date.parse(c.expires))))fail(400,'Choose a valid expiry date');
  txn(()=>{if(db.prepare('SELECT 1 FROM coupons WHERE business_id=? AND code=? AND id<>?').get(b,c.code,c.id))fail(409,'This code is already used by another coupon');
   db.prepare('INSERT INTO coupons(business_id,id,code,kind,value,min_spend,expires,max_uses,uses,active,created_at) VALUES (?,?,?,?,?,?,?,?,0,?,?) ON CONFLICT(business_id,id) DO UPDATE SET code=excluded.code,kind=excluded.kind,value=excluded.value,min_spend=excluded.min_spend,expires=excluded.expires,max_uses=excluded.max_uses,active=excluded.active').run(b,c.id,c.code,c.kind,c.value,c.min,c.expires,c.max,c.active,new Date().toISOString());audit(db,u,'coupon-saved',c.code)});
  send(res,200,{ok:true});return true;
 }
 if(path==='/api/marketing/campaigns'){
  const id=key(d.id),name=text(d.name,80,'a campaign name'),message=text(d.message,1000,'the message'),grp=d.group;if(!GROUPS.some(g=>g[0]===grp))fail(400,'Choose a customer group');
  const recipients=customerGroups(db,b)[grp].filter(c=>c.phone).slice(0,500).map(c=>({id:c.id,name:c.name,phone:c.phone,sentAt:''}));if(!recipients.length)fail(409,'No customers with a phone number in this group');
  if(!db.prepare('SELECT 1 FROM campaigns WHERE business_id=? AND id=?').get(b,id)){db.prepare('INSERT INTO campaigns VALUES (?,?,?,?,?,?,?)').run(b,id,name,grp,message,JSON.stringify(recipients),new Date().toISOString());audit(db,u,'campaign-created',name)}
  send(res,201,{ok:true,id,recipients:recipients.length});return true;
 }
 if(path==='/api/marketing/campaigns/sent'){
  const id=key(d.id),customerId=key(d.customerId);
  txn(()=>{const c=db.prepare('SELECT recipients FROM campaigns WHERE business_id=? AND id=?').get(b,id);if(!c)fail(404,'Campaign not found');const rec=JSON.parse(c.recipients),r=rec.find(x=>x.id===customerId);if(!r)fail(404,'Customer is not in this campaign');if(!r.sentAt){r.sentAt=new Date().toISOString();db.prepare('UPDATE campaigns SET recipients=? WHERE business_id=? AND id=?').run(JSON.stringify(rec),b,id)}});
  send(res,200,{ok:true});return true;
 }
 return false;
}
