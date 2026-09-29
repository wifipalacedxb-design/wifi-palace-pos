import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {start} from '../server/server.mjs';
import {createSalon,passwordHash} from '../server/store.mjs';
import {verifySignature} from '../server/billing.mjs';
const DAY=86400000,now=()=>Math.floor(Date.now()/1000);
// A fake Stripe that keeps customers, prices and subscriptions in memory.
const calls=[],subs=new Map(),prices=new Map();let n=0;
async function stripe(method,path,params={}){calls.push({method,path,params});
 if(path==='prices'&&method==='GET'){const p=prices.get(params.lookup_keys[0]);return{data:p?[p]:[]}}
 if(path==='prices'){const p={id:'price_'+(++n),lookup_key:params.lookup_key,unit_amount:params.unit_amount};prices.set(params.lookup_key,p);return p}
 if(path==='customers')return{id:'cus_'+(++n)};
 if(path==='checkout/sessions')return{id:'cs_'+(++n),url:'https://checkout.stripe.test/'+n};
 if(path==='billing_portal/sessions')return{url:'https://billing.stripe.test/portal'};
 if(path.startsWith('subscriptions/')&&method==='GET')return structuredClone(subs.get(path.split('/')[1]));
 if(path.startsWith('subscriptions/')){const s=subs.get(path.split('/')[1]);const price=[...prices.values()].find(p=>p.id===params.items[0].price);s.items.data[0].price=price;s.metadata={...s.metadata,...params.metadata};return structuredClone(s)}
 throw Error('unexpected '+method+' '+path);
}
const cfg={key:'sk_test_x',webhookSecret:'whsec_test',taxRate:'txr_vat5',graceDays:7};
const dir=mkdtempSync(join(tmpdir(),'pos-billing-')),app=await start({file:join(dir,'db.sqlite'),port:0,billing:{cfg,stripe}}),base='http://127.0.0.1:'+app.server.address().port;
const shop=await createSalon(app.db,{name:'Corner Grocery',slug:'corner',owner:'Owner',email:'o@test.test',password:'test-password-123',type:'grocery'});
app.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('cash-b',shop.salonId,'c@test.test','Cashier',await passwordHash('test-password-123'),'cashier');
app.db.prepare('INSERT OR REPLACE INTO subscriptions VALUES (?,?,?,?)').run(shop.salonId,'Pro','trial',new Date(Date.now()+10*DAY).toISOString());
async function req(path,method='GET',data,s={},headers={}){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie||'','X-CSRF-Token':s.csrf||'',...headers},...(data!==undefined?{body:typeof data==='string'?data:JSON.stringify(data)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
async function login(email){const r=await req('login','POST',{salon:'corner',email,password:'test-password-123'});return{status:r.status,user:r.data.user,cookie:r.cookie,csrf:r.data.csrf,error:r.data.error}}
const sign=(raw,t=now(),secret=cfg.webhookSecret)=>`t=${t},v1=${createHmac('sha256',secret).update(t+'.'+raw).digest('hex')}`;
let eventNo=0;
async function hook(type,object,id='evt_'+(++eventNo)){const raw=JSON.stringify({id,type,data:{object}});return req('stripe/webhook','POST',raw,{},{'Stripe-Signature':sign(raw)})}
const sub=(status,{start=now(),end=now()+30*86400,plan='pro',interval='month',...extra}={})=>({id:'sub_1',customer:'cus_known',status,current_period_start:start,current_period_end:end,cancel_at_period_end:false,metadata:{business_id:shop.salonId},items:{data:[{id:'si_1',price:{id:'p',lookup_key:`palace_pos_${plan}_${interval}`}}]},...extra});
const access=()=>app.db.prepare('SELECT * FROM subscriptions WHERE business_id=?').get(shop.salonId);
try{
let owner,cashier;
await test('status for owner and cashier; only the owner can start paying',async()=>{
 owner=await login('o@test.test');cashier=await login('c@test.test');assert.equal(owner.status,200);assert.equal(owner.user.billingLocked,undefined);
 const s=(await req('billing/status','GET',undefined,owner)).data;assert.equal(s.enabled,true);assert.equal(s.status,'trial');assert.equal(s.daysLeft,10);assert.deepEqual(s.prices.Pro,{month:12900,year:129000});
 assert.equal((await req('billing/status','GET',undefined,cashier)).status,200);
 assert.equal((await req('billing/checkout','POST',{plan:'Pro',interval:'month'},cashier)).status,403);
 assert.equal((await req('billing/checkout','POST',{plan:'Gold',interval:'month'},owner)).status,400);
});
await test('checkout: creates the price once, a customer once, keeps the remaining trial and adds VAT',async()=>{
 const r=await req('billing/checkout','POST',{plan:'Pro',interval:'year'},owner);assert.equal(r.status,200);assert.match(r.data.url,/^https:\/\/checkout\.stripe\.test\//);
 const created=calls.filter(c=>c.path==='prices'&&c.method==='POST');assert.equal(created.length,1);assert.equal(created[0].params.unit_amount,129000);assert.equal(created[0].params.currency,'aed');assert.equal(created[0].params.recurring.interval,'year');
 const cs=calls.find(c=>c.path==='checkout/sessions').params;assert.equal(cs.mode,'subscription');assert.equal(cs.client_reference_id,shop.salonId);assert.deepEqual(cs.line_items[0].tax_rates,['txr_vat5']);
 assert.ok(Math.abs(cs.subscription_data.trial_end-(Date.now()/1000+10*86400))<120);assert.equal(cs.subscription_data.metadata.business_id,shop.salonId);
 await req('billing/checkout','POST',{plan:'Pro',interval:'year'},owner);
 assert.equal(calls.filter(c=>c.path==='customers').length,1);assert.equal(calls.filter(c=>c.path==='prices'&&c.method==='POST').length,1);
});
await test('webhook: signature required; subscription events set access; duplicates are ignored',async()=>{
 const raw=JSON.stringify({id:'evt_bad',type:'customer.subscription.updated',data:{object:{id:'sub_1'}}});
 assert.equal((await req('stripe/webhook','POST',raw,{},{'Stripe-Signature':sign(raw,now(),'wrong')})).status,400);
 assert.equal((await req('stripe/webhook','POST',raw,{},{'Stripe-Signature':sign(raw,now()-3600)})).status,400);
 assert.equal(verifySignature(raw,sign(raw),cfg.webhookSecret),true);
 const trialEnd=now()+10*86400;subs.set('sub_1',sub('trialing',{end:trialEnd,interval:'year'}));
 assert.equal((await hook('checkout.session.completed',{mode:'subscription',subscription:'sub_1',customer:'cus_known',client_reference_id:shop.salonId})).status,200);
 assert.equal(access().status,'trial');assert.equal(Date.parse(access().expires),trialEnd*1000);
 const end=now()+365*86400;subs.set('sub_1',sub('active',{end,interval:'year'}));
 assert.equal((await hook('invoice.paid',{subscription:'sub_1'},'evt_paid')).status,200);
 assert.equal(access().status,'active');assert.equal(access().plan,'Pro');assert.equal(Date.parse(access().expires),end*1000+7*DAY);
 subs.set('sub_1',sub('canceled',{end:now()-10,ended_at:now()-10}));
 assert.equal((await hook('invoice.paid',{subscription:'sub_1'},'evt_paid')).data.duplicate,true);assert.equal(access().status,'active');
 const st=(await req('billing/status','GET',undefined,owner)).data;assert.equal(st.subscription.interval,'year');assert.equal(st.subscription.status,'active');
});
await test('failed renewal: grace counts from the unpaid period start, then the shop locks; owner can only pay',async()=>{
 const startedDaysAgo=3;subs.set('sub_1',sub('past_due',{start:now()-startedDaysAgo*86400,end:now()+27*86400}));
 await hook('invoice.payment_failed',{subscription:'sub_1'});
 const left=(Date.parse(access().expires)-Date.now())/DAY;assert.ok(left>3.9&&left<4.1,'4 days of grace left');
 app.db.prepare('UPDATE subscriptions SET expires=? WHERE business_id=?').run(new Date(Date.now()-1000).toISOString(),shop.salonId);
 const o=await login('o@test.test');assert.equal(o.status,200);assert.equal(o.user.billingLocked,true);
 assert.equal((await req('state','GET',undefined,o)).status,402);assert.equal((await req('sync','POST',{},o)).status,402);
 assert.equal((await req('billing/status','GET',undefined,o)).data.locked,true);
 const c=await login('c@test.test');assert.equal(c.status,403);assert.match(c.error,/owner/);
 assert.equal((await req('state','GET',undefined,cashier)).status,402);
 assert.equal((await req('billing/portal','POST',{},o)).data.url,'https://billing.stripe.test/portal');
 // Card updated in the portal, invoice paid → unlocked at once.
 subs.set('sub_1',sub('active',{end:now()+30*86400}));await hook('invoice.paid',{subscription:'sub_1'});
 assert.equal((await req('state','GET',undefined,o)).status,200);assert.equal((await login('c@test.test')).status,200);
});
await test('plan change updates the running subscription; checkout is refused while one runs',async()=>{
 assert.equal((await req('billing/checkout','POST',{plan:'Business',interval:'month'},owner)).status,409);
 const r=await req('billing/change','POST',{plan:'Business',interval:'month'},owner);assert.equal(r.status,200);assert.equal(r.data.plan,'Business');
 const up=calls.filter(c=>c.path==='subscriptions/sub_1'&&c.method==='POST').at(-1).params;assert.equal(up.items[0].id,'si_1');assert.equal(up.proration_behavior,'always_invoice');
});
await test('cancel: access runs to the end of the paid period only; manual suspension is never lifted by payments',async()=>{
 const ended=now()+5*86400;subs.set('sub_1',sub('canceled',{end:ended,ended_at:ended}));await hook('customer.subscription.deleted',{id:'sub_1'});
 assert.equal(Date.parse(access().expires),ended*1000);
 app.db.prepare("UPDATE subscriptions SET status='suspended' WHERE business_id=?").run(shop.salonId);
 subs.set('sub_1',sub('active',{end:now()+30*86400}));await hook('customer.subscription.updated',{id:'sub_1'});assert.equal(access().status,'suspended');
 app.db.prepare("UPDATE subscriptions SET status='active' WHERE business_id=?").run(shop.salonId);
});
await test('without Stripe keys the POS works and payment buttons explain how to renew',async()=>{
 const d2=mkdtempSync(join(tmpdir(),'pos-billing2-')),a2=await start({file:join(d2,'db.sqlite'),port:0,billing:{cfg:{key:'',webhookSecret:'',taxRate:'',graceDays:7}}});
 try{await createSalon(a2.db,{name:'X',slug:'xshop',owner:'O',email:'x@test.test',password:'test-password-123'});const b2='http://127.0.0.1:'+a2.server.address().port;
  const l=await fetch(b2+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({salon:'xshop',email:'x@test.test',password:'test-password-123'})}),j=await l.json(),ck=l.headers.get('set-cookie').split(';')[0];
  const r=await fetch(b2+'/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:ck,'X-CSRF-Token':j.csrf},body:JSON.stringify({plan:'Pro',interval:'month'})});assert.equal(r.status,503);
  assert.equal((await fetch(b2+'/api/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,404);
 }finally{await a2.close();rmSync(d2,{recursive:true,force:true})}
});
}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
