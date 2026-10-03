import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server/server.mjs';
import {createSalon,passwordHash} from '../server/store.mjs';
const dir=mkdtempSync(join(tmpdir(),'pos-opt-')),app=await start({file:join(dir,'db.sqlite'),port:0}),base='http://127.0.0.1:'+app.server.address().port;
const shop=await createSalon(app.db,{name:'Clear Vision',slug:'optic',owner:'O',email:'o@test.test',password:'test-password-123',type:'optical'});
app.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('cash-o',shop.salonId,'c@test.test','Cashier',await passwordHash('test-password-123'),'cashier');
async function req(path,method='GET',data,s={}){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie||'','X-CSRF-Token':s.csrf||''},...(data!==undefined?{body:JSON.stringify(data)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
async function login(email){const r=await req('login','POST',{salon:'optic',email,password:'test-password-123'});assert.equal(r.status,200);return{cookie:r.cookie,csrf:r.data.csrf}}
const op=(kind,key,data,base=0)=>({id:randomUUID(),kind,key,data,base,action:'put'});
const owner=await login('o@test.test'),cashier=await login('c@test.test'),now=()=>new Date().toISOString(),due=new Date(Date.now()+5*86400000).toISOString().slice(0,10);
const put=(kind,key,data,s=cashier,base=0)=>req('sync','POST',op(kind,key,data,base),s);
const sale=(id,items,extra={})=>{const sub=items.reduce((n,i)=>n+Math.round(i.price*i.qty),0);return{id,date:now(),items,sub,off:0,tax:0,total:sub,received:sub,customerId:'',staff:'Counter',method:'Cash',status:'Paid',branch:'main',...extra}};
const rx={right:{sph:'-2.5',cyl:'-0.75',axis:'90',add:''},left:{sph:'-2.25',cyl:'',axis:'',add:''},pd:'62'};
try{
await test('catalogue: frames, contact lenses with days of wear, lens and eye-test services',async()=>{
 const s=(await req('state','GET',undefined,owner)).data.state;assert.equal(s.grocery_items.find(i=>i.id==='cl1').supplyDays,90);assert.equal(s.grocery_items.find(i=>i.id==='fr1').size,'52-18-140');
 assert.deepEqual([...new Set(s.grocery_items.filter(i=>i.type==='service').map(i=>i.serviceType))].sort(),['eyetest','lens','other']);
 assert.equal((await put('grocery_items','x1',{name:'Lens',barcode:'',category:'Contact lenses',unit:'piece',price:100,cost:0,minStock:0,supplyDays:900},owner)).status,400);
 assert.equal((await put('grocery_stock','in1',{type:'in',itemId:'fr1',qty:5,cost:12000,branch:'main',at:now()})).status,200);
});
await test('prescriptions: quarter-dioptre powers, axis 0–180, kept per customer',async()=>{
 assert.equal((await put('customers','c1',{name:'Layla Hassan',phone:'0501112233',dob:''})).status,200);
 const base={customerId:'c1',date:due,type:'Distance',optometrist:'Dr Sara',...rx};
 assert.equal((await put('optical_rx','r0',{...base,customerId:'ghost'})).status,409);
 assert.equal((await put('optical_rx','r0',{...base,right:{sph:'-2.3'}})).status,400);
 assert.equal((await put('optical_rx','r0',{...base,right:{sph:'-2.5',axis:'190'}})).status,400);
 assert.equal((await put('optical_rx','r0',{...base,right:{},left:{}})).status,400);
 const r=await put('optical_rx','r1',base);assert.equal(r.status,200,JSON.stringify(r.data));
 assert.deepEqual(r.data.data.right,{sph:'-2.50',cyl:'-0.75',axis:'90',add:''});assert.equal(r.data.data.left.sph,'-2.25');assert.equal(r.data.data.customer,'Layla Hassan');
 assert.equal((await put('optical_rx','r2',{...base,type:'Reading',right:{sph:'pl',add:'1.5'},left:{sph:'0.5',add:'1.5'},pd:'31/31'})).data.data.right.sph,'Plano');
});
await test('spectacle orders: frame + lenses, lab flow, billed before delivery',async()=>{
 const o={status:'Ordered',customerId:'c1',frameItemId:'fr1',lensItemId:'ln2',lensPrice:38000,lensDetails:'1.60 index, anti-glare',due,advance:20000,lab:'Vision Lab',...rx};
 assert.equal((await put('optical_orders','o0',{...o,lensItemId:'fr2'})).status,409);
 assert.equal((await put('optical_orders','o0',{...o,right:{},left:{}})).status,400);
 const r=await put('optical_orders','o1',o);assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.data.number,1);assert.equal(r.data.data.frame,'Classic acetate frame black');assert.equal(r.data.data.framePrice,35000);assert.equal(r.data.data.lensPrice,38000);
 const own=await put('optical_orders','o2',{...o,frameItemId:'',frame:''});assert.equal(own.data.data.frame,'Customer’s own frame');
 const lab=await put('optical_orders','o1',{...r.data.data,status:'At lab',labRef:'VL-88'},cashier,1);assert.equal(lab.data.data.labRef,'VL-88');
 const ready=await put('optical_orders','o1',{...lab.data.data,status:'Ready'},cashier,2);
 assert.equal((await put('optical_orders','o1',{...ready.data.data,status:'Delivered'},cashier,3)).status,409);
 const s=await put('sales','s1',sale('s1',[{id:'fr1',price:35000,qty:1},{id:'ln2',price:38000,qty:1}],{customerId:'c1',method:'Credit (account)',received:0}));assert.equal(s.status,200,JSON.stringify(s.data));
 assert.equal((await put('optical_orders','o1',{...ready.data.data,status:'Delivered',saleId:'s1'},cashier,3)).data.data.status,'Delivered');
});
await test('insurance claims: insurer share tracked until paid as an Insurance account payment',async()=>{
 const c={status:'To submit',saleId:'s1',insurer:'Daman',memberId:'D-1001',approval:'AP-7',amount:50000};
 assert.equal((await put('optical_claims','k0',{...c,amount:99999999})).status,400);assert.equal((await put('optical_claims','k0',{...c,saleId:'nope'})).status,409);
 const r=await put('optical_claims','k1',c);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.data.customer,'Layla Hassan');assert.equal(r.data.data.total,73000);
 const sub=await put('optical_claims','k1',{...r.data.data,status:'Submitted',claimRef:'CLM-1'},cashier,1);assert.equal(sub.data.data.claimRef,'CLM-1');
 assert.equal((await put('optical_claims','k1',{...sub.data.data,status:'Paid',paidAmount:60000},cashier,2)).status,400);
 assert.equal((await put('optical_claims','k1',{...sub.data.data,status:'Paid',paidAmount:48000},cashier,2)).data.data.paidAmount,48000);
 assert.equal((await put('grocery_payments','p1',{customerId:'c1',amount:48000,method:'Insurance',note:'Daman claim 1',at:now()})).status,200);
 assert.equal((await put('grocery_payments','p2',{customerId:'c1',amount:100,method:'Cheque',at:now()})).status,400);
});
await test('eye test bookings and recalls',async()=>{
 const t=await put('optical_tests','t1',{status:'Booked',customerId:'c1',when:new Date(Date.now()+86400000).toISOString(),optometrist:'Dr Sara'});assert.equal(t.status,200,JSON.stringify(t.data));
 assert.equal((await put('optical_tests','t1',{...t.data.data,status:'Done'},cashier,1)).data.data.status,'Done');
 assert.equal((await put('optical_tests','t1',{status:'Booked'},cashier,2)).status,409);
 const r=await put('optical_recalls','x1',{status:'Open',type:'contact',customerId:'c1',due,about:'Monthly contact lenses'});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal((await put('optical_recalls','x0',{status:'Open',type:'birthday',customerId:'c1',due})).status,400);
 assert.equal((await put('optical_recalls','x1',{...r.data.data,status:'Done'},cashier,1)).data.data.status,'Done');
 assert.equal((await put('optical_recalls','x1',{status:'Dismissed'},cashier,2)).status,409);
});
}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
