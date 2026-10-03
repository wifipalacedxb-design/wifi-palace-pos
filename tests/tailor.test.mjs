import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server/server.mjs';
import {createSalon,passwordHash} from '../server/store.mjs';
const dir=mkdtempSync(join(tmpdir(),'pos-tailor-')),app=await start({file:join(dir,'db.sqlite'),port:0}),base='http://127.0.0.1:'+app.server.address().port;
const shop=await createSalon(app.db,{name:'Noor Abayas',slug:'abaya',owner:'O',email:'o@test.test',password:'test-password-123',type:'tailor'});
app.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('cash-t',shop.salonId,'c@test.test','Cashier',await passwordHash('test-password-123'),'cashier');
async function req(path,method='GET',data,s={}){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie||'','X-CSRF-Token':s.csrf||''},...(data!==undefined?{body:JSON.stringify(data)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
async function login(email){const r=await req('login','POST',{salon:'abaya',email,password:'test-password-123'});assert.equal(r.status,200);return{cookie:r.cookie,csrf:r.data.csrf}}
const op=(kind,key,data,base=0)=>({id:randomUUID(),kind,key,data,base,action:'put'});
const owner=await login('o@test.test'),cashier=await login('c@test.test'),now=()=>new Date().toISOString(),due=new Date(Date.now()+5*86400000).toISOString().slice(0,10);
const put=(kind,key,data,s=cashier,base=0)=>req('sync','POST',op(kind,key,data,base),s);
const sale=(id,items,extra={})=>{const sub=items.reduce((n,i)=>n+Math.round(i.price*i.qty),0);return{id,date:now(),items,sub,off:0,tax:0,total:sub,received:sub,customerId:'',staff:'Counter',method:'Cash',status:'Paid',branch:'main',...extra}};
try{
await test('seed and products: ready-made by size and colour, fabric by the metre, stitching and alteration services',async()=>{
 const s=(await req('state','GET',undefined,owner)).data.state;assert.equal(s.grocery_items.find(i=>i.id==='ab1').size,'54');assert.equal(s.grocery_items.find(i=>i.id==='fb1').unit,'m');
 assert.deepEqual(s.grocery_items.filter(i=>i.type==='service').map(i=>i.serviceType).sort(),['alteration','stitching']);
 assert.equal((await put('grocery_items','x1',{name:'Linen',barcode:'',category:'Fabric',unit:'kg',price:100,cost:0,minStock:0},owner)).status,400);
 assert.equal((await put('grocery_stock','in1',{type:'in',itemId:'fb1',qty:50,cost:2000,branch:'main',at:now()})).status,200);
 const r=await put('sales','s1',sale('s1',[{id:'fb1',price:4500,qty:2.5},{id:'ab1',price:25000,qty:1}]));assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.data.sub,11250+25000);
 assert.equal((await req('state?days=35','GET',undefined,owner)).data.summary.stock.fb1,47.5);
});
await test('measurements are saved per customer and garment type',async()=>{
 assert.equal((await put('customers','c1',{name:'Mariam',phone:'0501112233',dob:''})).status,200);
 assert.equal((await put('tailor_measurements','ghost',{garments:[]})).status,409);
 const m={garments:[{type:'Abaya',fields:[{label:'Length',value:'56'},{label:'Shoulder',value:'15.5'},{label:'Sleeve',value:''}],note:'Loose fit'}]};
 const r=await put('tailor_measurements','c1',m);assert.equal(r.status,200);assert.deepEqual(r.data.data.garments[0].fields,[{label:'Length',value:'56'},{label:'Shoulder',value:'15.5'}]);
 assert.equal((await put('tailor_measurements','c1',{garments:[m.garments[0],m.garments[0]]},cashier,1)).status,400);
});
const g=(extra={})=>({key:'g1',garment:'Abaya',qty:2,price:15000,design:'Open front, lace on sleeves',measurements:[{label:'Length',value:'56'}],fabric:'shop',fabricItemId:'fb1',fabricQty:3.5,...extra});
await test('stitching order: garments, own or shop fabric, tailor and piece rate are validated',async()=>{
 const o={status:'New',type:'stitching',customerId:'c1',items:[g()],due,advance:10000,tailorId:'t1',rate:4000};
 assert.equal((await put('tailor_orders','o0',{...o,customerId:'ghost'})).status,409);assert.equal((await put('tailor_orders','o0',{...o,items:[]})).status,400);
 assert.equal((await put('tailor_orders','o0',{...o,items:[g({fabricItemId:'ab1'})]})).status,409,'fabric must be sold by the metre');
 assert.equal((await put('tailor_orders','o0',{...o,tailorId:'nobody'})).status,409);assert.equal((await put('tailor_orders','o0',{...o,due:'soon'})).status,400);
 const r=await put('tailor_orders','o1',o);assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.data.number,1);assert.equal(r.data.data.tailor,'Tailor 1');assert.equal(r.data.data.items[0].fabricName,'Nida fabric');assert.equal(r.data.data.customer,'Mariam');
 assert.equal((await put('tailor_orders','o2',{...o,type:'alteration',items:[{key:'a1',garment:'Shorten abaya',qty:1,price:3000,fabric:'customer'}],tailorId:''})).data.data.number,2);
});
await test('production flow moves forward, rework goes back from Ready, hand-over needs a bill',async()=>{
 assert.equal((await put('tailor_orders','o1',{status:'Stitching'},cashier,1)).status,200);
 assert.equal((await put('tailor_orders','o1',{status:'Cutting'},cashier,2)).status,409,'not backwards');
 const ready=await put('tailor_orders','o1',{status:'Ready'},cashier,2);assert.equal(ready.status,200);assert.ok(ready.data.data.readyAt);
 assert.equal((await put('tailor_orders','o1',{status:'Finishing'},cashier,3)).status,200,'rework from Ready');
 assert.equal((await put('tailor_orders','o1',{status:'Ready'},cashier,4)).status,200);
 assert.equal((await put('tailor_orders','o1',{status:'Delivered'},cashier,5)).status,409);
 // advance on account, then the bill on account: 2 × 150 stitching + 7 m × 45 fabric = 615, less 100 advance
 assert.equal((await put('grocery_payments','ad1',{customerId:'c1',amount:10000,method:'Cash',at:now(),note:'Advance order 1'})).status,200);
 const bill=await put('sales','s2',sale('s2',[{id:'st1',price:15000,qty:2},{id:'fb1',price:4500,qty:7}],{customerId:'c1',method:'Credit (account)',received:0}));assert.equal(bill.status,200,JSON.stringify(bill.data));
 assert.equal((await put('tailor_orders','o1',{status:'Delivered',saleId:'s2'},cashier,5)).status,200);
 assert.equal((await put('tailor_orders','o1',{status:'Ready'},cashier,6)).status,409);
 const st=(await req('state?days=35','GET',undefined,owner)).data;assert.equal(st.summary.credit.c1,61500-10000);assert.equal(st.summary.stock.fb1,40.5);
 assert.equal((await put('tailor_orders','o2',{status:'Cancelled'},cashier,1)).status,400);assert.equal((await put('tailor_orders','o2',{status:'Cancelled',cancelReason:'Customer changed mind'},cashier,1)).status,200);
});
await test('branches work as in other retail shops',async()=>{
 assert.equal((await put('sales','s3',sale('s3',[{id:'sh1',price:6000,qty:1}],{branch:''}))).status,409);
});
}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
