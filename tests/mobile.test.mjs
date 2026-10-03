import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server/server.mjs';
import {createSalon,passwordHash} from '../server/store.mjs';
import {businessDay} from '../server/finance.mjs';
import {warrantyUntil} from '../server/modules/mobile.mjs';
const dir=mkdtempSync(join(tmpdir(),'pos-mobile-')),app=await start({file:join(dir,'db.sqlite'),port:0}),base='http://127.0.0.1:'+app.server.address().port;
const shop=await createSalon(app.db,{name:'Phone Zone',slug:'phones',owner:'O',email:'o@test.test',password:'test-password-123',type:'mobile'});
app.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('cash-m',shop.salonId,'c@test.test','Cashier',await passwordHash('test-password-123'),'cashier');
async function req(path,method='GET',data,s={}){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie||'','X-CSRF-Token':s.csrf||''},...(data!==undefined?{body:JSON.stringify(data)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
async function login(email){const r=await req('login','POST',{salon:'phones',email,password:'test-password-123'});assert.equal(r.status,200);return{cookie:r.cookie,csrf:r.data.csrf}}
const op=(kind,key,data,base=0)=>({id:randomUUID(),kind,key,data,base,action:'put'});
const owner=await login('o@test.test'),cashier=await login('c@test.test'),now=()=>new Date().toISOString(),today=businessDay();
const put=(kind,key,data,s=cashier,base=0)=>req('sync','POST',op(kind,key,data,base),s);
const sale=(id,items,extra={})=>{const sub=items.reduce((n,i)=>n+i.price*i.qty,0);return{id,date:now(),items,sub,off:0,tax:0,total:sub,received:sub,customerId:'',staff:'Sales 1',method:'Cash',status:'Paid',branch:'main',...extra}};
try{
await test('seed: phones are tracked by IMEI with warranty; services and negotiable prices exist',async()=>{
 const s=(await req('state','GET',undefined,owner)).data.state,ph=s.grocery_items.find(i=>i.id==='ph1');
 assert.equal(ph.serial,true);assert.equal(ph.warrantyMonths,12);assert.equal(s.grocery_items.find(i=>i.id==='us1').openPrice,true);
 assert.deepEqual(s.grocery_items.filter(i=>i.type==='service').map(i=>i.serviceType).sort(),['recharge','repair','sim']);
 assert.equal((await put('grocery_items','bad',{name:'Cable',barcode:'',category:'Accessories',unit:'kg',price:100,cost:0,minStock:0,serial:true},owner)).status,400);
});
await test('IMEI units: format and duplicates checked; only tracked products',async()=>{
 const u={itemId:'ph1',imei:'356789012345671',status:'in',cost:250000,branch:'main',at:now()};
 assert.equal((await put('mobile_units','u1',{...u,imei:'12'})).status,400);
 assert.equal((await put('mobile_units','u1',{...u,itemId:'ac1'})).status,409);
 assert.equal((await put('mobile_units','u1',{...u,branch:'nope'})).status,400);
 assert.equal((await put('mobile_units','u1',u)).status,200);
 assert.equal((await put('mobile_units','u1b',u)).status,409,'same IMEI twice');
 assert.equal((await put('mobile_units','u2',{...u,imei:'356789012345672'})).status,200);
 assert.equal((await put('grocery_stock','st1',{type:'in',itemId:'ph1',qty:2,cost:250000,branch:'main',at:now()})).status,200);
});
await test('selling a tracked phone needs its IMEI, one per line; invoice shows IMEI and warranty; no double sale',async()=>{
 assert.equal((await put('sales','s0',sale('s0',[{id:'ph1',price:299900,qty:1}]))).status,409,'no IMEI');
 assert.equal((await put('sales','s0',sale('s0',[{id:'ph1',price:299900,qty:2,options:[{id:'u1'}]}]))).status,409,'two on one line');
 assert.equal((await put('sales','s0',sale('s0',[{id:'ph1',price:299900,qty:1,options:[{id:'ghost'}]}]))).status,409);
 const r=await put('sales','s1',sale('s1',[{id:'ph1',price:299900,qty:1,options:[{id:'u1',name:'x'}]},{id:'ac3',price:5900,qty:2}]));assert.equal(r.status,200,JSON.stringify(r.data));
 const until=warrantyUntil(12);assert.deepEqual(r.data.data.items[0].options,['IMEI 356789012345671','Warranty until '+until]);
 assert.deepEqual(r.data.data.items[1].options,['Warranty until '+warrantyUntil(6)]);
 const sold=await put('mobile_units','u1',{status:'sold',saleId:'s1'},cashier,1);assert.equal(sold.status,200);assert.equal(sold.data.data.warrantyUntil,until);assert.equal(sold.data.data.status,'sold');
 assert.equal((await put('sales','s2',sale('s2',[{id:'ph1',price:299900,qty:1,options:[{id:'u1'}]}]))).status,409,'already sold');
 assert.equal((await put('mobile_units','u2',{status:'sold',saleId:'missing'},cashier,1)).status,409);
 const st=(await req('state?days=35','GET',undefined,owner)).data;assert.equal(st.summary.stock.ph1,1);assert.equal(st.summary.stockByBranch.ph1.main,1);
});
await test('a refunded phone goes back in stock only by the owner; owner can remove a lost phone with a reason',async()=>{
 assert.equal((await put('mobile_units','u1',{status:'in'},owner,2)).status,409,'not refunded yet');
 const s=JSON.parse(app.db.prepare("SELECT data FROM records WHERE kind='sales' AND id='s1'").get().data);
 assert.equal((await put('sales','s1',{...s,status:'Refunded',refundReason:'Faulty'},owner,1)).status,200);
 assert.equal((await put('mobile_units','u1',{status:'in'},cashier,2)).status,403);
 const back=await put('mobile_units','u1',{status:'in'},owner,2);assert.equal(back.status,200);assert.equal(back.data.data.saleId,undefined);
 assert.equal((await put('mobile_units','u2',{status:'removed'},owner,1)).status,400);assert.equal((await put('mobile_units','u2',{status:'removed',reason:'Returned to supplier'},cashier,1)).status,403);
 assert.equal((await put('mobile_units','u2',{status:'removed',reason:'Returned to supplier'},owner,1)).status,200);
});
await test('used phone bought for cash or as trade-in credit; negotiable price; money shows in finance',async()=>{
 const buy={seller:'Ravi Kumar',phone:'0501112223',idType:'Emirates ID',idNumber:'784-1990-1234567-1',itemId:'us1',imei:'990001112223334',condition:'Good, small scratch',price:60000,method:'Cash',at:now()};
 assert.equal((await put('mobile_buys','b0',{...buy,idNumber:''})).status,400);assert.equal((await put('mobile_buys','b0',{...buy,itemId:'ac1'})).status,409);assert.equal((await put('mobile_buys','b0',{...buy,method:'Trade-in'})).status,400,'trade-in needs a customer');
 const b=await put('mobile_buys','b1',buy);assert.equal(b.status,200);assert.equal(b.data.data.number,1);
 assert.equal((await put('mobile_buys','b1',{...buy,price:1},cashier,1)).status,409);
 assert.equal((await put('mobile_units','uu1',{itemId:'us1',imei:buy.imei,status:'in',cost:60000,source:'used',buyId:'b1',branch:'main',at:now()})).status,200);
 assert.equal((await put('grocery_stock','st2',{type:'in',itemId:'us1',qty:1,cost:60000,branch:'main',at:now()})).status,200);
 // trade-in: credit on the customer's account, then a sale on account uses it
 assert.equal((await put('customers','cu1',{name:'Layla',phone:'0507778889',dob:''})).status,200);
 assert.equal((await put('mobile_buys','b2',{...buy,imei:'990001112223335',price:40000,method:'Trade-in',customerId:'cu1'})).status,200);
 assert.equal((await put('grocery_payments','tp1',{customerId:'cu1',amount:40000,method:'Trade-in',at:now()})).status,200);
 assert.equal((await put('grocery_payments','tp2',{customerId:'cu1',amount:1,method:'Bitcoin',at:now()})).status,400);
 // sell the used phone at a negotiated price
 const r=await put('sales','s3',sale('s3',[{id:'us1',price:85000,qty:1,options:[{id:'uu1'}]}],{customerId:'cu1',method:'Credit (account)',received:0}));assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.data.items[0].listPrice,50000);
 const st=(await req('state?days=35','GET',undefined,owner)).data;assert.equal(st.summary.credit.cu1,85000-40000);
 const f=(await req('finance/report?date='+today,'GET',undefined,owner)).data.totals;assert.equal(f.cashBuys,60000);assert.equal(f.tradeIn,40000);assert.equal(f.creditCollectedCash,0);assert.equal(f.creditCollectedCard,0);
 const bk=(await req('finance/book?from='+today+'&to='+today,'GET',undefined,owner)).data.books;assert.ok(bk.Cash.entries.some(e=>e.type==='Used phone bought'&&e.amount===-60000));assert.equal(bk.Bank.entries.some(e=>e.type==='Account payment'),false);
 assert.equal((await req('finance/pnl?from='+today+'&to='+today,'GET',undefined,owner)).data.costOfSales,100000);
});
await test('repairs: job card, status flow, hand-over needs a bill or no-charge',async()=>{
 const job={status:'Received',customerId:'cu1',device:'iPhone 12',imei:'356111222333444',fault:'Broken screen',accessories:'Case',estimate:35000,due:today,technician:'Ali'};
 assert.equal((await put('mobile_repairs','r0',{...job,customerId:'ghost'})).status,409);assert.equal((await put('mobile_repairs','r0',{...job,fault:''})).status,400);
 const r=await put('mobile_repairs','r1',job);assert.equal(r.status,200);assert.equal(r.data.data.number,1);assert.equal(r.data.data.customer,'Layla');
 assert.equal((await put('mobile_repairs','r1',{status:'Delivered'},cashier,1)).status,409,'cannot skip to delivered');
 assert.equal((await put('mobile_repairs','r1',{status:'Repairing',diagnosis:'Screen and frame',estimate:42000},cashier,1)).status,200);
 assert.equal((await put('mobile_repairs','r1',{status:'Ready'},cashier,2)).status,200);
 assert.equal((await put('mobile_repairs','r1',{status:'Delivered'},cashier,3)).status,409,'needs a bill');
 const bill=await put('sales','s4',sale('s4',[{id:'sv1',price:15000,qty:1},{id:'pt1',price:27000,qty:1}],{customerId:'cu1'}));assert.equal(bill.status,200);
 const done=await put('mobile_repairs','r1',{status:'Delivered',saleId:'s4'},cashier,3);assert.equal(done.status,200);assert.equal(done.data.data.history.length,4);
 assert.equal((await put('mobile_repairs','r1',{status:'Repairing'},cashier,4)).status,409);
 assert.equal((await put('mobile_repairs','r2',{...job,device:'Samsung A55',imei:''})).status,200);
 assert.equal((await put('mobile_repairs','r2',{status:'Cancelled'},cashier,1)).status,400);assert.equal((await put('mobile_repairs','r2',{status:'Cancelled',cancelReason:'Customer declined estimate'},cashier,1)).status,200);
 assert.equal((await put('mobile_repairs','r3',{...job,device:'Warranty job'})).status,200);assert.equal((await put('mobile_repairs','r3',{status:'Ready'},cashier,1)).status,200);
 assert.equal((await put('mobile_repairs','r3',{status:'Delivered',noCharge:true},cashier,2)).status,200);
});
await test('branches: owner adds a branch; a phone can move while in stock',async()=>{
 const cfg=(await req('state','GET',undefined,owner)).data.state.grocery_config[0];
 assert.equal((await put('grocery_config','config',{...cfg,branches:[{id:'main',name:'Main shop'},{id:'mall',name:'Mall kiosk'}]},cashier,1)).status,403);
 assert.equal((await put('grocery_config','config',{...cfg,branches:[{id:'main',name:'Main shop'},{id:'mall',name:'Mall kiosk'}]},owner,1)).status,200);
 assert.equal((await put('mobile_units','u3',{itemId:'ph2',imei:'351112223334445',status:'in',cost:100000,branch:'main',at:now()})).status,200);
 assert.equal((await put('mobile_units','u3',{branch:'mall'},cashier,1)).data.data.branch,'mall');
 assert.equal((await put('sales','s5',sale('s5',[{id:'ac1',price:2500,qty:1}],{branch:''}))).status,409,'branch required');
});
}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
