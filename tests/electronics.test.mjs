import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server/server.mjs';
import {createSalon,passwordHash} from '../server/store.mjs';
const dir=mkdtempSync(join(tmpdir(),'pos-elec-')),app=await start({file:join(dir,'db.sqlite'),port:0}),base='http://127.0.0.1:'+app.server.address().port;
const shop=await createSalon(app.db,{name:'Tech Hub',slug:'tech',owner:'O',email:'o@test.test',password:'test-password-123',type:'electronics'});
app.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('cash-e',shop.salonId,'c@test.test','Cashier',await passwordHash('test-password-123'),'cashier');
async function req(path,method='GET',data,s={}){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie||'','X-CSRF-Token':s.csrf||''},...(data!==undefined?{body:JSON.stringify(data)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
async function login(email){const r=await req('login','POST',{salon:'tech',email,password:'test-password-123'});assert.equal(r.status,200);return{cookie:r.cookie,csrf:r.data.csrf}}
const op=(kind,key,data,base=0)=>({id:randomUUID(),kind,key,data,base,action:'put'});
const owner=await login('o@test.test'),cashier=await login('c@test.test'),now=()=>new Date().toISOString(),due=new Date(Date.now()+5*86400000).toISOString().slice(0,10);
const put=(kind,key,data,s=cashier,base=0)=>req('sync','POST',op(kind,key,data,base),s);
const sale=(id,items,extra={})=>{const sub=items.reduce((n,i)=>n+Math.round(i.price*i.qty),0);return{id,date:now(),items,sub,off:0,tax:0,total:sub,received:sub,customerId:'',staff:'Counter',method:'Cash',status:'Paid',branch:'main',...extra}};
try{
await test('serial numbers print as S/N with the warranty; electronics catalogue',async()=>{
 const s=(await req('state','GET',undefined,owner)).data.state;assert.ok(s.grocery_items.find(i=>i.id==='lp1').serial);assert.deepEqual(s.elec_quotes,[]);
 assert.equal((await put('grocery_items','x1',{name:'SIM',barcode:'',category:'SIM & recharge',unit:'piece',price:100,cost:0,minStock:0},owner)).status,400);
 assert.equal((await put('grocery_stock','in1',{type:'in',itemId:'lp1',qty:1,cost:150000,branch:'main',at:now()})).status,200);
 assert.equal((await put('mobile_units','u1',{itemId:'lp1',imei:'5cd1234xyz',status:'in',cost:150000,branch:'main',at:now()})).status,200);
 const bad=await put('sales','s0',sale('s0',[{id:'lp1',price:229900,qty:1}]));assert.equal(bad.status,409);assert.match(bad.data.error,/S\/N/);
 const r=await put('sales','s1',sale('s1',[{id:'lp1',price:229900,qty:1,options:[{id:'u1'}]}]));assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.data.items[0].options[0],'S/N 5CD1234XYZ');assert.match(r.data.data.items[0].options[1],/^Warranty until \d{4}-\d{2}-\d{2}$/);
});
await test('company customers: TRN and address on the invoice, LPO number on the bill',async()=>{
 assert.equal((await put('customers','co1',{name:'Gulf Trading LLC',phone:'043334444',dob:'',trn:'12345'})).status,400);
 const c=await put('customers','co1',{name:'Gulf Trading LLC',phone:'043334444',dob:'',trn:'100 2345 6789 0003',address:'Office 12, Deira, Dubai'});assert.equal(c.status,200);assert.equal(c.data.data.trn,'100234567890003');
 assert.equal((await put('customers','c1',{name:'Walk-in Ali',phone:'',dob:''})).data.data.trn,undefined);
 const r=await put('sales','s2',sale('s2',[{id:'k1',price:2500,qty:4}],{customerId:'co1',lpo:'LPO-7781',method:'Credit (account)',received:0}));assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.data.lpo,'LPO-7781');assert.equal(r.data.data.customerTrn,'100234567890003');assert.equal(r.data.data.customerAddress,'Office 12, Deira, Dubai');
});
await test('quotations: catalogue prices, discount, accepted only with a synced bill',async()=>{
 const q={status:'Open',customerId:'co1',title:'Gaming PC',validUntil:due,discount:5000,lines:[{key:'a',itemId:'c1',qty:1,price:1},{key:'b',itemId:'c3',qty:2},{key:'c',itemId:'sv4',qty:1,price:20000}]};
 assert.equal((await put('elec_quotes','q0',{...q,customerId:'nobody'})).status,409);
 assert.equal((await put('elec_quotes','q0',{...q,discount:99999999})).status,400);
 const r=await put('elec_quotes','q1',q);assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.data.number,1);assert.equal(r.data.data.lines[0].price,79900,'fixed-price items use the catalogue price');assert.equal(r.data.data.lines[2].price,20000);assert.equal(r.data.data.sub,79900+2*21900+20000);
 const e=await put('elec_quotes','q1',{...r.data.data,lines:[...q.lines,{key:'d',itemId:'s1',qty:1}]},cashier,1);assert.equal(e.status,200);assert.equal(e.data.data.lines.length,4);
 assert.equal((await put('elec_quotes','q1',{...e.data.data,status:'Accepted',saleId:'nope'},cashier,2)).status,409);
 const a=await put('elec_quotes','q1',{...e.data.data,status:'Accepted',saleId:'s2'},cashier,2);assert.equal(a.status,200);assert.equal(a.data.data.status,'Accepted');
 assert.equal((await put('elec_quotes','q1',{...a.data.data,note:'x'},cashier,3)).status,409);
 const l=await put('elec_quotes','q2',q);assert.equal((await put('elec_quotes','q2',{...l.data.data,status:'Lost',lostReason:'Too expensive'},cashier,1)).data.data.status,'Lost');
});
await test('warranty claims to the supplier follow Open → Sent → Back → Closed',async()=>{
 const r=await put('elec_rma','r1',{status:'Open',supplier:'Jumbo Distribution',item:'24" IPS monitor',serial:'MN123456',fault:'Dead pixels',customerId:'co1'});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.data.customer,'Gulf Trading LLC');
 assert.equal((await put('elec_rma','r1',{...r.data.data,status:'Back',outcome:'Replaced'},cashier,1)).status,409);
 const s=await put('elec_rma','r1',{...r.data.data,status:'Sent',ref:'RMA-551'},cashier,1);assert.equal(s.data.data.ref,'RMA-551');
 assert.equal((await put('elec_rma','r1',{...s.data.data,status:'Back'},cashier,2)).status,400);
 const b=await put('elec_rma','r1',{...s.data.data,status:'Back',outcome:'Replaced',newSerial:'MN999'},cashier,2);assert.equal(b.data.data.outcome,'Replaced');
 assert.equal((await put('elec_rma','r1',{...b.data.data,status:'Closed'},cashier,3)).data.data.status,'Closed');
 assert.equal((await put('elec_rma','r2',{status:'Open',supplier:'X',item:'Router',fault:'No power'})).data.data.customerId,'');
});
await test('delivery and installation jobs',async()=>{
 const j={status:'Booked',type:'Installation',customerId:'co1',address:'Villa 4, Mirdif',date:due,slot:'4–6 pm',what:'Wall-mount 55" TV',staff:'Arif',charge:15000};
 assert.equal((await put('elec_jobs','j0',{...j,type:'Pickup'})).status,400);
 const r=await put('elec_jobs','j1',j);assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.data.number,1);
 const o=await put('elec_jobs','j1',{...r.data.data,status:'On the way'},cashier,1);assert.equal(o.data.data.status,'On the way');
 const d=await put('elec_jobs','j1',{...o.data.data,status:'Done',saleId:'s2'},cashier,2);assert.equal(d.data.data.status,'Done');
 assert.equal((await put('elec_jobs','j1',{...d.data.data,status:'Booked'},cashier,3)).status,409);
 assert.equal((await put('elec_jobs','j2',{...j,status:'Booked'})).status,200);assert.equal((await put('elec_jobs','j2',{status:'Cancelled'},cashier,1)).status,400);
});
}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
