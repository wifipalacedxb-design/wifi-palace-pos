import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../server/server.mjs';
import {createBusiness,passwordHash} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
import {recentState,changesSince,registerTill,setOfflineHours} from '../server/sync.mjs';

const put=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});
const DAY=86400000;
const sale=(items,extra={})=>{const sub=items.reduce((n,i)=>n+Math.round(i.price*i.qty),0);return{status:'Paid',items,sub,off:0,tax:0,total:sub,method:'Cash',received:sub,date:new Date().toISOString(),customerId:'',staff:'Cashier',...extra}};
async function setup(t){
 const dir=await mkdtemp(join(tmpdir(),'sync-')),app=await start({file:join(dir,'db'),port:0});t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true})});
 const g=await createBusiness(app.db,{name:'Baqala',slug:'baq',owner:'Owner',email:'o@t.com',password:'long-password-123',type:'grocery'});
 for(const [id,email] of [['c1','c1@t.com'],['c2','c2@t.com']])app.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(id,g.businessId,email,id,await passwordHash('long-password-123'),'cashier');
 const owner={id:g.userId,business_id:g.businessId,business_type:'grocery',role:'owner'},c1={...owner,id:'c1',role:'cashier'},c2={...owner,id:'c2',role:'cashier'};
 return{app,g,owner,c1,c2,run:(u,op)=>operation(app.db,u,op)};
}

test('light snapshot keeps recent history, strips logos, and server totals cover every till',async t=>{
 const f=await setup(t);
 f.run(f.owner,put('settings','singleton',{name:'Baqala',phone:'',address:'',trn:'',tax:0,logo:'data:image/png;base64,AAAA'},1));
 f.run(f.c1,put('grocery_stock','in1',{type:'in',itemId:'p1',qty:50,at:new Date(Date.now()-20*DAY).toISOString()}));
 f.run(f.c1,put('sales','old',sale([{id:'p1',price:650,qty:5}],{date:new Date(Date.now()-40*DAY).toISOString()})));
 f.run(f.c1,put('sales','mine',sale([{id:'p1',price:650,qty:2}])));
 f.run(f.c2,put('sales','theirs',sale([{id:'p1',price:650,qty:3}])));
 f.run(f.c2,put('customers','k1',{name:'Rashid',phone:''}));
 f.run(f.c2,put('sales','credit',sale([{id:'p3',price:300,qty:4}],{method:'Credit (account)',received:0,customerId:'k1'})));
 const s=recentState(f.app.db,f.c1,35);
 assert.deepEqual(s.state.sales.map(x=>x.id),['mine']); // cashier sees own recent sales only; 40-day-old sale stays on the server
 assert.equal(s.state.sales[0].shop.logo,'');assert.ok(!('cost' in s.state.sales[0].items[0]));
 assert.equal(s.summary.stock.p1,50-5-2-3); // but stock counts every till and all history
 assert.equal(s.summary.credit.k1,1200);
 assert.ok(s.seq>0);assert.equal(s.offlineHours,12);
 assert.equal(recentState(f.app.db,f.owner,35).state.sales.length,3);
});

test('incremental changes: only new records, cashier filtering, reload for old-record edits',async t=>{
 const f=await setup(t);
 const s=recentState(f.app.db,f.c1,35);
 f.run(f.c2,put('sales','x',sale([{id:'p1',price:650,qty:1}])));
 f.run(f.c1,put('sales','y',sale([{id:'p1',price:650,qty:1}])));
 f.run(f.owner,put('grocery_items','p1',{name:'Milk 1L',barcode:'',category:'Dairy & eggs',unit:'piece',price:700,cost:0,minStock:10},1));
 const c=changesSince(f.app.db,f.c1,s.seq,35);
 assert.equal(c.reload,false);assert.deepEqual(c.records.map(r=>r.kind+':'+r.key).sort(),['grocery_items:p1','sales:y']);
 assert.equal(c.summary.stock.p1,-2);
 assert.deepEqual(changesSince(f.app.db,f.c1,c.seq,35).records,[]);
 // a refund of a sale older than the device window asks the device to reload its snapshot
 f.run(f.c1,put('sales','old',sale([{id:'p1',price:700,qty:1}],{date:new Date(Date.now()-40*DAY).toISOString()})));
 const before=changesSince(f.app.db,f.owner,0,35).seq;
 f.run(f.owner,put('sales','old',{status:'Refunded',refundReason:'Late return'},1));
 assert.equal(changesSince(f.app.db,f.owner,before,35).reload,false); // refund date is today, so it is recent again
 const mark=changesSince(f.app.db,f.owner,0,35).seq;f.app.db.prepare("INSERT INTO changes(business_id,kind,id) VALUES (?,'sales','ancient')").run(f.g.businessId);f.app.db.prepare("INSERT INTO records VALUES (?,'sales','ancient',2,?)").run(f.g.businessId,JSON.stringify({...sale([{id:'p1',price:1,qty:1}]),id:'ancient',date:new Date(Date.now()-90*DAY).toISOString()}));
 assert.equal(changesSince(f.app.db,f.owner,mark,35).reload,true);
 assert.throws(()=>changesSince(f.app.db,f.c1,-1,35),/cursor/);
});

test('tills issue final invoice numbers offline; server accepts each once and keeps the count',async t=>{
 const f=await setup(t);
 const t1=registerTill(f.app.db,f.c1,'device-aaaaaaaaaaaaaaaa',''),t2=registerTill(f.app.db,f.c2,'device-bbbbbbbbbbbbbbbb','Counter 2');
 assert.deepEqual([t1.code,t2.code,t2.name],[1,2,'Counter 2']);
 assert.equal(registerTill(f.app.db,f.c1,'device-aaaaaaaaaaaaaaaa','').code,1);
 assert.throws(()=>registerTill(f.app.db,f.c1,'bad',''),/Invalid device/);
 const a=f.run(f.c1,put('sales','a',sale([{id:'p1',price:650,qty:1}],{number:'INV-T1-000001'}))).data;assert.equal(a.number,'INV-T1-000001');
 const b=f.run(f.c1,put('sales','b',sale([{id:'p1',price:650,qty:1}],{number:'INV-T1-000001'}))).data;assert.match(b.number,/^INV-\d{6}$/); // duplicate → safe server number
 const c=f.run(f.c1,put('sales','c',sale([{id:'p1',price:650,qty:1}],{number:'INV-T9-000001'}))).data;assert.match(c.number,/^INV-\d{6}$/); // unknown till
 const d=f.run(f.c2,put('sales','d',sale([{id:'p1',price:650,qty:1}],{number:'INV-T2-000007'}))).data;assert.equal(d.number,'INV-T2-000007');
 assert.equal(registerTill(f.app.db,f.c2,'device-bbbbbbbbbbbbbbbb','').last,7);
});

test('offline period is set per business and returned to devices; sales dated weeks ago still sync',async t=>{
 const f=await setup(t);
 assert.throws(()=>setOfflineHours(f.app.db,f.g.businessId,99),/supported/);
 setOfflineHours(f.app.db,f.g.businessId,720);assert.equal(recentState(f.app.db,f.c1).offlineHours,720);
 const tenDays=new Date(Date.now()-10*DAY).toISOString();
 assert.equal(f.run(f.c1,put('grocery_stock','s10',{type:'in',itemId:'p1',qty:5,at:tenDays})).data.at,tenDays);
 assert.equal(f.run(f.c1,put('sales','s10',sale([{id:'p1',price:650,qty:1}],{date:tenDays}))).data.date,tenDays);
 f.run(f.c1,put('customers','k',{name:'K',phone:''}));
 assert.equal(f.run(f.c1,put('grocery_payments','p10',{customerId:'k',amount:100,method:'Cash',at:tenDays})).data.amount,100);
 assert.throws(()=>f.run(f.c1,put('grocery_stock','s40',{type:'in',itemId:'p1',qty:5,at:new Date(Date.now()-40*DAY).toISOString()})),/Invalid stock time/);
});
