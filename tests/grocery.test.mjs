import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,createBusiness,snapshot,passwordHash} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
import {financeReport,businessDay,initFinance} from '../server/finance.mjs';
import {creditBalance} from '../server/modules/grocery.mjs';

const put=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});
const now=()=>new Date().toISOString();
const sale=(items,extra={})=>{const sub=items.reduce((n,i)=>n+Math.round(i.price*i.qty),0);return{status:'Paid',items,sub,off:0,tax:0,total:sub,method:'Cash',received:sub,date:now(),customerId:'',staff:'Cashier',...extra}};
async function setup(type='grocery'){
 const dir=mkdtempSync(join(tmpdir(),'grocery-')),db=openStore(join(dir,'db.sqlite'));initFinance(db);
 const g=await createBusiness(db,{name:'Al Madina Baqala',slug:'al-madina',owner:'Owner',email:'o@test.com',password:'a-long-password',type});
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('cash1',g.businessId,'c@test.com','Cashier',await passwordHash('a-long-password'),'cashier');
 const owner={id:g.userId,business_id:g.businessId,business_type:type,role:'owner',name:'Owner'},cashier={...owner,id:'cash1',role:'cashier',name:'Cashier'};
 return{db,g,owner,cashier,run:(u,op)=>operation(db,u,op),done:()=>{db.close();rmSync(dir,{recursive:true,force:true})}};
}

test('grocery products: barcodes unique, units fixed, owner-only, big quantities and weights sell',async()=>{
 const f=await setup();try{
  const s=snapshot(f.db,f.g.businessId).state;assert.equal(s.type,'grocery');assert.equal(s.grocery_items.length,8);assert.deepEqual([s.grocery_stock,s.grocery_payments],[[],[]]);
  assert.throws(()=>f.run(f.cashier,put('grocery_items','x',{name:'Pepsi',barcode:'6281',category:'Drinks',unit:'piece',price:250})),/Owner permission/);
  f.run(f.owner,put('grocery_items','x',{name:'Pepsi 330ml',barcode:' 6281 0001 ',category:'Drinks',unit:'piece',price:250,cost:180,minStock:24}));
  assert.equal(snapshot(f.db,f.g.businessId).state.grocery_items.find(i=>i.id==='x').barcode,'62810001');
  assert.throws(()=>f.run(f.owner,put('grocery_items','y',{name:'Copy',barcode:'62810001',category:'Drinks',unit:'piece',price:1})),/already used by Pepsi/);
  assert.throws(()=>f.run(f.owner,put('grocery_items','x',{name:'Pepsi',barcode:'62810001',category:'Drinks',unit:'kg',price:250},1)),/cannot change between piece and kg/);
  assert.throws(()=>f.run(f.owner,put('grocery_items','y',{name:'Bad',barcode:'a b!',category:'Drinks',unit:'piece',price:1})),/Barcode/);
  // 240 cans (above the 100-piece limit other types keep) and 1.25 kg tomatoes on one bill
  const r=f.run(f.cashier,put('sales','s1',sale([{id:'x',price:250,qty:240},{id:'p5',price:450,qty:1.25}]))).data;
  assert.equal(r.total,60000+563);assert.match(r.number,/^INV-/);
 }finally{f.done()}
});

test('stock movements are append-only; only the owner adjusts counts',async()=>{
 const f=await setup();try{
  const e=f.run(f.cashier,put('grocery_stock','m1',{type:'in',itemId:'p1',qty:48,cost:500,supplier:'Al Rawabi',invoice:'A-77',at:now()})).data;
  assert.deepEqual([e.item,e.qty,e.cost,e.supplier,e.by],['Milk 1L',48,500,'Al Rawabi','cash1']);
  assert.throws(()=>f.run(f.cashier,put('grocery_stock','m1',{type:'in',itemId:'p1',qty:50,at:now()},1)),/cannot be changed/);
  assert.throws(()=>f.run(f.cashier,put('grocery_stock','m2',{type:'adjust',itemId:'p1',qty:-2,reason:'Expired',at:now()})),/Only the owner/);
  assert.equal(f.run(f.owner,put('grocery_stock','m2',{type:'adjust',itemId:'p1',qty:-2,reason:'Expired',at:now()})).data.qty,-2);
  assert.throws(()=>f.run(f.owner,put('grocery_stock','m3',{type:'adjust',itemId:'p1',qty:-2,at:now()})),/Required/);
  assert.throws(()=>f.run(f.cashier,put('grocery_stock','m3',{type:'in',itemId:'p1',qty:1.5,at:now()})),/whole pieces/);
  assert.equal(f.run(f.cashier,put('grocery_stock','m3',{type:'in',itemId:'p5',qty:12.375,at:now()})).data.qty,12.375);
  assert.throws(()=>f.run(f.cashier,put('grocery_stock','m4',{type:'in',itemId:'p1',qty:-5,at:now()})),/non-zero/);
  assert.throws(()=>f.run(f.cashier,put('grocery_stock','m4',{type:'in',itemId:'p1',qty:5,at:'2020-01-01T00:00:00Z'})),/Invalid stock time/);
 }finally{f.done()}
});

test('customer credit: sale on account, part payments, refunds, finance and closing',async()=>{
 const f=await setup();try{
  f.run(f.cashier,put('customers','c1',{name:'Rashid',phone:'0501112233'}));
  const bill=sale([{id:'p4',price:3500,qty:2}],{method:'Credit (account)',received:0,customerId:'c1'});
  assert.throws(()=>f.run(f.cashier,put('sales','s0',{...bill,customerId:''})),/customer account/);
  assert.throws(()=>f.run(f.cashier,put('sales','s0',{...bill,received:7000})),/collects no money/);
  const s1=f.run(f.cashier,put('sales','s1',bill)).data;assert.equal(s1.change,0);assert.equal(s1.cashAmount,0);
  f.run(f.cashier,put('sales','s2',sale([{id:'p1',price:650,qty:2}],{method:'Credit (account)',received:0,customerId:'c1'})));
  assert.equal(creditBalance(f.db,f.g.businessId,'c1'),8300);
  const p=f.run(f.cashier,put('grocery_payments','pay1',{customerId:'c1',amount:5000,method:'Cash',at:now()})).data;assert.equal(p.balanceBefore,8300);
  f.run(f.cashier,put('grocery_payments','pay2',{customerId:'c1',amount:1000,method:'Card (external terminal)',at:now()}));
  assert.throws(()=>f.run(f.cashier,put('grocery_payments','pay1',{customerId:'c1',amount:1,method:'Cash',at:now()},1)),/cannot be changed/);
  assert.throws(()=>f.run(f.cashier,put('grocery_payments','pay3',{customerId:'c1',amount:0,method:'Cash',at:now()})),/amount/);
  assert.equal(creditBalance(f.db,f.g.businessId,'c1'),2300);
  f.run(f.owner,put('sales','s2',{status:'Refunded',refundReason:'Returned milk'},1));
  assert.equal(creditBalance(f.db,f.g.businessId,'c1'),1000);
  f.run(f.cashier,put('sales','s3',sale([{id:'p7',price:150,qty:4}])));
  const t=financeReport(f.db,f.g.businessId,businessDay()).totals;
  assert.deepEqual([t.creditSales,t.creditRefunds,t.creditCollectedCash,t.creditCollectedCard,t.cashSales],[8300,1300,5000,1000,600]);
  // Expected cash counts money collected on accounts, not credit sales.
  const r=financeReport(f.db,f.g.businessId,businessDay());
  const {financeRoute}=await import('../server/finance.mjs');
  let sent;await financeRoute({db:f.db,u:f.owner,req:{method:'POST',url:'/api/finance/close'},res:{},path:'/api/finance/close',body:async()=>({id:'close1',date:businessDay(),opening:10000,cashIn:0,cashOut:0,counted:15600,note:'Counted',fingerprint:r.fingerprint}),send:(res,code,data)=>{sent=data}});
  assert.equal(sent.expected,10000+600+5000);assert.equal(sent.variance,0);
 }finally{f.done()}
});

test('other business types cannot sell on credit',async()=>{
 const f=await setup('salon');try{
  f.run(f.owner,put('customers','c1',{name:'A',phone:''}));
  assert.throws(()=>f.run(f.owner,put('sales','s1',sale([{id:'s1',price:5000,qty:1}],{method:'Credit (account)',received:0,customerId:'c1'}))),/Invalid payment method/);
 }finally{f.done()}
});
