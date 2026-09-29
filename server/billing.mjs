// Subscriptions paid by card through Stripe, fully automatic:
// trial → owner picks a plan → Stripe Checkout → Stripe tells us (webhook) → access runs to the end of the paid
// period plus a grace period. Renewals, failed-payment retries, card updates, invoices and cancelling happen in
// Stripe; every change comes back through the webhook. A shop whose access ends is locked, never deleted: the
// owner can still sign in, sees only the payment screen, and is unlocked the moment Stripe confirms payment.
// Config (environment): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, optional STRIPE_TAX_RATE (a 5% VAT tax-rate id),
// BILLING_GRACE_DAYS (default 7). Without a key the POS works as before and the payment buttons say so.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {ApiError} from './rules.mjs';
import {audit} from './store.mjs';
export const PLANS={Starter:4900,Pro:12900,Business:24900}; // fils per month, before VAT
export const YEAR_MONTHS=10; // pay yearly: 2 months free
const LEGACY={Professional:'Pro',Enterprise:'Business'};
export const planName=p=>LEGACY[p]||p;
const DAY=86400000;
export function billingConfig(env=process.env){
 const grace=Number(env.BILLING_GRACE_DAYS??7);
 return{key:env.STRIPE_SECRET_KEY||'',webhookSecret:env.STRIPE_WEBHOOK_SECRET||'',taxRate:env.STRIPE_TAX_RATE||'',graceDays:Number.isInteger(grace)&&grace>=0&&grace<=60?grace:7};
}
// Minimal Stripe REST client (form-encoded requests, JSON answers).
export function stripeClient(key,request=fetch){
 const form=(obj,prefix='',out=new URLSearchParams())=>{for(const [k,v] of Object.entries(obj)){if(v===undefined||v===null)continue;const name=prefix?`${prefix}[${k}]`:k;if(typeof v==='object')form(v,name,out);else out.append(name,String(v))}return out};
 return async(method,path,params)=>{
  const url='https://api.stripe.com/v1/'+path+(method==='GET'&&params?'?'+form(params):'');
  const r=await request(url,{method,signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+key,...(method==='GET'?{}:{'Content-Type':'application/x-www-form-urlencoded'})},...(method==='GET'||!params?{}:{body:form(params).toString()})});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw new ApiError(502,'Payment service: '+(data.error?.message||'request failed'));return data;
 };
}
export function initBilling(db){db.exec(`
CREATE TABLE IF NOT EXISTS billing(business_id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,subscription_id TEXT NOT NULL DEFAULT '',plan TEXT NOT NULL DEFAULT '',interval TEXT NOT NULL DEFAULT '',stripe_status TEXT NOT NULL DEFAULT '',period_end TEXT NOT NULL DEFAULT '',cancel_at_period_end INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS billing_events(id TEXT PRIMARY KEY,type TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS billing_prices(lookup TEXT PRIMARY KEY,price_id TEXT NOT NULL);
`)}
const subscriptionRow=(db,b)=>db.prepare('SELECT * FROM subscriptions WHERE business_id=?').get(b);
// Locked = access ended (trial or paid period plus grace). A shop suspended by WiFi Palace is not "locked", it is blocked.
export function billingLocked(db,b){const s=subscriptionRow(db,b);return !!s&&s.status!=='suspended'&&Date.parse(s.expires)<=Date.now()}
export function billingStatus(db,b,cfg){
 const s=subscriptionRow(db,b),x=db.prepare('SELECT * FROM billing WHERE business_id=?').get(b);
 const left=s?Math.ceil((Date.parse(s.expires)-Date.now())/DAY):null;
 return{enabled:!!cfg.key,plan:planName(s?.plan||''),status:s?.status||'active',expires:s?.expires||null,daysLeft:left,locked:billingLocked(db,b),graceDays:cfg.graceDays,
  subscription:x?.subscription_id?{plan:x.plan,interval:x.interval,status:x.stripe_status,periodEnd:x.period_end,cancelAtPeriodEnd:!!x.cancel_at_period_end}:null,
  prices:Object.fromEntries(Object.entries(PLANS).map(([k,v])=>[k,{month:v,year:v*YEAR_MONTHS}]))};
}
async function priceId(db,stripe,plan,interval){
 const lookup='palace_pos_'+plan.toLowerCase()+'_'+interval,cached=db.prepare('SELECT price_id FROM billing_prices WHERE lookup=?').get(lookup);if(cached)return cached.price_id;
 const found=(await stripe('GET','prices',{lookup_keys:[lookup],active:true,limit:1})).data?.[0];let id=found?.id;
 if(!id){const amount=PLANS[plan]*(interval==='year'?YEAR_MONTHS:1);id=(await stripe('POST','prices',{currency:'aed',unit_amount:amount,lookup_key:lookup,nickname:`Palace POS ${plan} (${interval==='year'?'yearly':'monthly'})`,recurring:{interval},product_data:{name:'Palace POS '+plan,statement_descriptor:'PALACE POS'},tax_behavior:'exclusive'})).id}
 db.prepare('INSERT OR REPLACE INTO billing_prices VALUES (?,?)').run(lookup,id);return id;
}
const periodEnd=sub=>sub.current_period_end??sub.items?.data?.[0]?.current_period_end??null;
const planOf=sub=>{const lk=sub.items?.data?.[0]?.price?.lookup_key||'';const m=/^palace_pos_(starter|pro|business)_(month|year)$/.exec(lk);return m?{plan:m[1][0].toUpperCase()+m[1].slice(1),interval:m[2]}:{plan:sub.metadata?.plan||'',interval:sub.metadata?.interval||''}};
// Applies a Stripe subscription to the shop's access. Safe to run any number of times, in any order.
export function applySubscription(db,sub,cfg){
 const b=sub.metadata?.business_id||db.prepare('SELECT business_id FROM billing WHERE customer_id=?').get(sub.customer)?.business_id;if(!b||!db.prepare('SELECT 1 FROM businesses WHERE id=?').get(b))return null;
 const {plan,interval}=planOf(sub),end=periodEnd(sub),now=new Date().toISOString(),s=subscriptionRow(db,b);
 db.prepare(`INSERT INTO billing(business_id,customer_id,subscription_id,plan,interval,stripe_status,period_end,cancel_at_period_end,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
  ON CONFLICT(business_id) DO UPDATE SET customer_id=excluded.customer_id,subscription_id=excluded.subscription_id,plan=excluded.plan,interval=excluded.interval,stripe_status=excluded.stripe_status,period_end=excluded.period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=excluded.updated_at`)
  .run(b,sub.customer,sub.id,plan,interval,sub.status,end?new Date(end*1000).toISOString():'',sub.cancel_at_period_end?1:0,now);
 if(s?.status==='suspended')return b; // blocked by WiFi Palace: payments never lift a manual suspension
 let expires=null,status='active';
 const start=sub.current_period_start??sub.items?.data?.[0]?.current_period_start??null;
 if(['active','trialing'].includes(sub.status)&&end)expires=end*1000+(sub.status==='trialing'?0:cfg.graceDays*DAY),status=sub.status==='trialing'?'trial':'active';
 else if(sub.status==='past_due'&&(start||end))expires=(start||end)*1000+cfg.graceDays*DAY; // renewal failed: grace counts from the unpaid period's start
 else if(['canceled','unpaid','incomplete_expired'].includes(sub.status))expires=Math.min(Date.parse(s?.expires||now),Math.max(Date.now(),(sub.ended_at||end||0)*1000));
 if(expires===null)return b; // incomplete: first payment still in progress
 const iso=new Date(expires).toISOString(),p=PLANS[plan]?plan:planName(s?.plan||'Starter');
 db.prepare('INSERT INTO subscriptions VALUES (?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET plan=excluded.plan,status=excluded.status,expires=excluded.expires').run(b,p,status,iso);
 return b;
}
export function verifySignature(raw,header,secret,tolerance=300){
 const parts=Object.fromEntries(String(header||'').split(',').map(x=>x.split('=')).filter(x=>x.length===2).map(([k,v])=>[k,v])),t=Number(parts.t);
 const sigs=String(header||'').split(',').filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));
 if(!secret||!t||!sigs.length||Math.abs(Date.now()/1000-t)>tolerance)return false;
 const expected=createHmac('sha256',secret).update(t+'.'+raw).digest();
 return sigs.some(s=>{const got=Buffer.from(s,'hex');return got.length===expected.length&&timingSafeEqual(got,expected)});
}
async function readRaw(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>1000000)throw new ApiError(413,'Too large');chunks.push(c)}return Buffer.concat(chunks).toString('utf8')}
// Stripe → us. Always re-reads the subscription from Stripe so events arriving late or twice do no harm.
export async function billingWebhook({db,req,res,send,cfg,stripe}){
 const raw=await readRaw(req);if(!verifySignature(raw,req.headers['stripe-signature'],cfg.webhookSecret))throw new ApiError(400,'Invalid signature');
 const event=JSON.parse(raw),o=event.data?.object||{};
 if(db.prepare('SELECT 1 FROM billing_events WHERE id=?').get(event.id)){send(res,200,{received:true,duplicate:true});return}
 let subId=null;
 if(event.type==='checkout.session.completed'&&o.mode==='subscription'){subId=o.subscription;const b=o.client_reference_id||o.metadata?.business_id;if(b&&o.customer&&db.prepare('SELECT 1 FROM businesses WHERE id=?').get(b))db.prepare("INSERT INTO billing(business_id,customer_id,updated_at) VALUES (?,?,?) ON CONFLICT(business_id) DO UPDATE SET customer_id=excluded.customer_id,updated_at=excluded.updated_at").run(b,o.customer,new Date().toISOString())}
 else if(event.type.startsWith('customer.subscription.'))subId=o.id;
 else if(event.type.startsWith('invoice.'))subId=o.subscription||o.parent?.subscription_details?.subscription||o.lines?.data?.[0]?.parent?.subscription_item_details?.subscription||null;
 if(subId){const sub=await stripe('GET','subscriptions/'+encodeURIComponent(subId));const b=applySubscription(db,sub,cfg);if(b)audit(db,{business_id:b,id:'stripe'},'billing-'+event.type,sub.status)}
 db.prepare('INSERT OR IGNORE INTO billing_events VALUES (?,?,?)').run(event.id,event.type,new Date().toISOString());
 send(res,200,{received:true});
}
// Owner actions: status, checkout (new subscription), change plan, and Stripe's own page for card/invoices/cancel.
export async function billingRoute({db,u,req,res,path,body,send,origin,cfg,stripe}){
 if(!path.startsWith('/api/billing/'))return false;
 if(path==='/api/billing/status'&&req.method==='GET'){send(res,200,billingStatus(db,u.business_id,cfg));return true}
 if(u.role!=='owner')throw new ApiError(403,'Only the owner can manage the subscription');
 if(req.method!=='POST')throw new ApiError(404,'Not found');
 if(!cfg.key)throw new ApiError(503,'Online payment is not switched on yet. Contact WiFi Palace on WhatsApp to renew.');
 const b=await body(req),row=db.prepare('SELECT * FROM billing WHERE business_id=?').get(u.business_id),live=row?.subscription_id&&['active','trialing','past_due'].includes(row.stripe_status);
 if(path==='/api/billing/portal'){if(!row?.customer_id)throw new ApiError(409,'Choose a plan first');const s=await stripe('POST','billing_portal/sessions',{customer:row.customer_id,return_url:origin+'/#billing'});send(res,200,{url:s.url});return true}
 const plan=b.plan,interval=b.interval;if(!PLANS[plan]||!['month','year'].includes(interval))throw new ApiError(400,'Choose a plan and monthly or yearly');
 const price=await priceId(db,stripe,plan,interval);
 if(path==='/api/billing/change'){
  if(!live)throw new ApiError(409,'There is no running subscription to change');
  const sub=await stripe('GET','subscriptions/'+encodeURIComponent(row.subscription_id)),item=sub.items?.data?.[0];if(!item)throw new ApiError(409,'Subscription has no plan');
  const updated=await stripe('POST','subscriptions/'+encodeURIComponent(sub.id),{items:[{id:item.id,price}],proration_behavior:'always_invoice',payment_behavior:'error_if_incomplete',metadata:{business_id:u.business_id,plan,interval},cancel_at_period_end:false});
  applySubscription(db,updated,cfg);audit(db,u,'billing-plan-changed',plan+'/'+interval);send(res,200,billingStatus(db,u.business_id,cfg));return true;
 }
 if(path==='/api/billing/checkout'){
  if(live)throw new ApiError(409,'You already have a subscription. Use Change plan or Manage billing.');
  let customer=row?.customer_id;
  if(!customer){const biz=db.prepare('SELECT name,slug FROM businesses WHERE id=?').get(u.business_id);customer=(await stripe('POST','customers',{email:u.email,name:biz.name.replace(/ \(Demo\)$/,''),metadata:{business_id:u.business_id,business_code:biz.slug}})).id;db.prepare("INSERT INTO billing(business_id,customer_id,updated_at) VALUES (?,?,?) ON CONFLICT(business_id) DO UPDATE SET customer_id=excluded.customer_id,updated_at=excluded.updated_at").run(u.business_id,customer,new Date().toISOString())}
  const s=subscriptionRow(db,u.business_id),trialEnd=s?.status==='trial'?Math.floor(Date.parse(s.expires)/1000):0;
  const session=await stripe('POST','checkout/sessions',{mode:'subscription',customer,client_reference_id:u.business_id,line_items:[{price,quantity:1,...(cfg.taxRate?{tax_rates:[cfg.taxRate]}:{})}],
   subscription_data:{metadata:{business_id:u.business_id,plan,interval},...(trialEnd>Date.now()/1000+2*86400?{trial_end:trialEnd}:{})},
   customer_update:{name:'auto',address:'auto'},billing_address_collection:'required',allow_promotion_codes:true,
   success_url:origin+'/?billing=done#billing',cancel_url:origin+'/?billing=cancelled#billing'});
  audit(db,u,'billing-checkout',plan+'/'+interval);send(res,200,{url:session.url});return true;
 }
 throw new ApiError(404,'Not found');
}
