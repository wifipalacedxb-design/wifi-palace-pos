import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server/server.mjs';
import {createSalon,passwordHash,snapshot} from '../server/store.mjs';
import {businessDay} from '../server/finance.mjs';
const dir=mkdtempSync(join(tmpdir(),'pos-accounts-')),app=await start({file:join(dir,'db.sqlite'),port:0}),base='http://127.0.0.1:'+app.server.address().port;
const a=await createSalon(app.db,{name:'A',slug:'shop-a',owner:'A',email:'a@test.test',password:'test-password-123'});
await createSalon(app.db,{name:'B',slug:'shop-b',owner:'B',email:'b@test.test',password:'test-password-123'});
app.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('cashier-acc',a.salonId,'c@test.test','Cashier',await passwordHash('test-password-123'),'cashier');
async function req(path,method='GET',data,session={}){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:session.cookie||'','X-CSRF-Token':session.csrf||''},...(data?{body:JSON.stringify(data)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
async function login(slug,email){const r=await req('login','POST',{salon:slug,email,password:'test-password-123'});assert.equal(r.status,200);return{cookie:r.cookie,csrf:r.data.csrf}}
const sa=await login('shop-a','a@test.test'),sb=await login('shop-b','b@test.test'),sc=await login('shop-a','c@test.test');
const op=(kind,key,data,base=0)=>({id:randomUUID(),kind,key,data,base,action:'put'});
const today=businessDay(),month=today.slice(0,8)+'01',q='?from='+month+'&to='+today;
// 50.00 bill, 10.00 discount, 5% VAT = 2.00 → 42.00
const sale=(id,extra={})=>({id,date:new Date().toISOString(),items:[{id:'s1',price:5000,qty:1}],sub:5000,off:1000,tax:200,total:4200,received:4200,customerId:'',staff:'Stylist 1',method:'Cash',status:'Paid',...extra});
try{
await test('accounting is owner only and private to each business',async()=>{
 assert.equal((await req('finance/payables')).status,401);
 assert.equal((await req('finance/payables','GET',null,sc)).status,403);
 assert.equal((await req('finance/suppliers','POST',{id:'x',name:'X'},sc)).status,403);
 assert.equal((await req('finance/vat'+q,'GET',null,sc)).status,403);
 assert.equal((await req('finance/vat?from=2026-02-30&to='+today,'GET',null,sa)).status,400);
 assert.equal((await req('finance/pnl?from='+today+'&to='+month,'GET',null,sa)).status,today===month?200:400);
});
await test('suppliers: TRN checked, names unique, edits keep the id',async()=>{
 assert.equal((await req('finance/suppliers','POST',{id:'sup1',name:'Gulf Traders',trn:'123'},sa)).status,400);
 assert.equal((await req('finance/suppliers','POST',{id:'sup1',name:'Gulf Traders',trn:'100 2003 0040 0050',phone:'050'},sa)).status,200);
 assert.equal((await req('finance/suppliers','POST',{id:'sup2',name:'gulf traders'},sa)).status,409);
 assert.equal((await req('finance/suppliers','POST',{id:'sup2',name:'Dubai Rent LLC'},sa)).status,200);
 assert.equal((await req('finance/suppliers','POST',{id:'sup1',name:'Gulf Traders FZE',trn:'100200300400500'},sa)).status,200);
 const p=(await req('finance/payables','GET',null,sa)).data;assert.deepEqual(p.suppliers.map(s=>s.name),['Dubai Rent LLC','Gulf Traders FZE']);assert.equal(p.suppliers[1].trn,'100200300400500');
 assert.equal((await req('finance/payables','GET',null,sb)).data.suppliers.length,0);
});
await test('purchase bills: validated, replay-safe, duplicate invoice numbers refused, paid-now creates the payment',async()=>{
 const bill={id:'bill1',supplierId:'sup1',number:'GT-100',date:today,category:'Stock for resale',net:100000,vat:5000,note:'Stock'};
 assert.equal((await req('finance/bills','POST',{...bill,vat:9000},sa)).status,400);
 assert.equal((await req('finance/bills','POST',{...bill,category:'Nope'},sa)).status,400);
 assert.equal((await req('finance/bills','POST',{...bill,supplierId:'ghost'},sa)).status,404);
 assert.equal((await req('finance/bills','POST',bill,sa)).status,201);
 assert.equal((await req('finance/bills','POST',bill,sa)).status,200);
 assert.equal((await req('finance/bills','POST',{...bill,net:100001},sa)).status,409);
 assert.equal((await req('finance/bills','POST',{...bill,id:'bill1b',number:'gt-100'},sa)).status,409);
 assert.equal((await req('finance/bills','POST',{id:'bill2',supplierId:'sup1',number:'GT-101',date:today,category:'Supplies',net:20000,vat:1000},sa)).status,201);
 assert.equal((await req('finance/bills','POST',{id:'rent',supplierId:'sup2',number:'R-9',date:today,category:'Rent',net:300000,vat:0,paid:{id:'rent-pay',method:'Bank / card'}},sa)).status,201);
 const p=(await req('finance/payables','GET',null,sa)).data;
 assert.equal(p.suppliers.find(s=>s.id==='sup1').balance,126000);assert.equal(p.suppliers.find(s=>s.id==='sup2').balance,0);
 assert.equal(p.bills.find(b=>b.id==='rent').status,'Paid');assert.equal(p.totals.owed,126000);
});
await test('supplier payments settle the chosen bill, then the oldest; overpaying is refused; voids are guarded',async()=>{
 assert.equal((await req('finance/supplier-payments','POST',{id:'pay1',supplierId:'sup1',billId:'bill2',date:today,amount:30000,method:'Cash'},sa)).status,409);
 assert.equal((await req('finance/supplier-payments','POST',{id:'pay1',supplierId:'sup1',billId:'bill2',date:today,amount:21000,method:'Cash'},sa)).status,201);
 assert.equal((await req('finance/supplier-payments','POST',{id:'pay2',supplierId:'sup1',date:today,amount:200000,method:'Bank / card'},sa)).status,409);
 assert.equal((await req('finance/supplier-payments','POST',{id:'pay2',supplierId:'sup1',date:today,amount:5000,method:'Bank / card'},sa)).status,201);
 let p=(await req('finance/payables','GET',null,sa)).data,bills=Object.fromEntries(p.bills.map(b=>[b.id,b]));
 assert.equal(bills.bill2.status,'Paid');assert.equal(bills.bill1.status,'Part paid');assert.equal(bills.bill1.outstanding,100000);
 assert.equal((await req('finance/void-bill','POST',{id:'bill2',reason:'Wrong'},sa)).status,409);
 assert.equal((await req('finance/void-supplier-payment','POST',{id:'pay1',reason:'Entered twice'},sa)).status,200);
 assert.equal((await req('finance/void-bill','POST',{id:'bill2',reason:'Wrong supplier'},sa)).status,200);
 p=(await req('finance/payables','GET',null,sa)).data;assert.equal(p.suppliers.find(s=>s.id==='sup1').balance,100000);assert.equal(p.bills.find(b=>b.id==='bill2').status,'Voided');
 // Invoice number can be reused once the old bill is voided.
 assert.equal((await req('finance/bills','POST',{id:'bill3',supplierId:'sup1',number:'GT-101',date:today,category:'Supplies',net:20000,vat:1000},sa)).status,201);
 assert.equal((await req('finance/void-bill','POST',{id:'nope',reason:'x'},sb)).status,404);
});
await test('VAT return, profit & loss and cash book use worked numbers',async()=>{
 assert.equal((await req('sync','POST',op('settings','singleton',{name:'A',phone:'',address:'Dubai',trn:'100000000000003',tax:5,logo:''},1),sa)).status,200);
 for(const id of ['s-a','s-b'])assert.equal((await req('sync','POST',op('sales',id,sale(id)),sc)).status,200);
 assert.equal((await req('sync','POST',op('sales','s-card',sale('s-card',{method:'Card (external terminal)'})),sc)).status,200);
 const s=snapshot(app.db,a.salonId).state.sales.find(x=>x.id==='s-b');
 assert.equal((await req('sync','POST',op('sales','s-b',{...s,status:'Refunded',refundReason:'Returned'},1),sa)).status,200);
 assert.equal((await req('finance/expenses','POST',{id:'exp1',date:today,amount:10500,vat:500,method:'Cash',category:'Utilities',note:'DEWA'},sa)).status,201);
 assert.equal((await req('finance/expenses','POST',{id:'exp2',date:today,amount:10500,vat:5000,method:'Cash',category:'Utilities',note:'x'},sa)).status,400);
 const v=(await req('finance/vat'+q,'GET',null,sa)).data;
 // Output: 3 invoices × 40.00 net / 2.00 VAT, less one refund → 80.00 / 4.00
 assert.equal(v.output.standardNet,8000);assert.equal(v.output.standardVat,400);assert.equal(v.output.refunds,1);
 // Input: bill1 50.00 + bill3 10.00 VAT (bill2 voided; rent no VAT) + expense 5.00 → 65.00 on 1300.00
 assert.equal(v.input.vat,6500);assert.equal(v.input.net,100000+20000+10000);assert.equal(v.input.noVatCosts,300000);
 assert.equal(v.netVat,400-6500);assert.equal(v.refundable,6100);assert.equal(v.payable,0);
 assert.equal(v.boxes.find(b=>b.box==='11').vat,6500);
 assert.equal(v.outputLines.reduce((n,x)=>n+x.vat,0),v.output.standardVat);assert.equal(v.outputLines.filter(x=>x.vat<0).length,1);assert.match(v.outputLines.find(x=>x.vat<0).number,/^CN/);
 assert.equal(v.inputLines.reduce((n,x)=>n+x.vat,0),v.input.vat);assert.equal(v.inputLines.find(x=>x.number==='GT-100').trn,'100200300400500');assert.equal(v.trn,'100000000000003');
 const pl=(await req('finance/pnl'+q,'GET',null,sa)).data;
 assert.equal(pl.sales.net,8000);assert.equal(pl.costOfSales,100000);assert.equal(pl.grossProfit,-92000);
 assert.deepEqual(Object.fromEntries(pl.expenses.map(e=>[e.label,e.amount])),{Rent:300000,Supplies:20000,Utilities:10000});
 assert.equal(pl.netProfit,8000-100000-330000);
 const bk=(await req('finance/book'+q,'GET',null,sa)).data;
 // Cash: 2 cash sales 84.00 − refund 42.00 − DEWA 105.00 − void pay1 excluded; Bank: card sale 42.00 − rent 3000.00 − pay2 50.00
 assert.equal(bk.books.Cash.closing-bk.books.Cash.opening,8400-4200-10500);
 assert.equal(bk.books.Bank.closing-bk.books.Bank.opening,4200-300000-5000);
 assert.equal(bk.books.Bank.entries.at(-1).balance,bk.books.Bank.closing);
 assert.equal((await req('finance/vat'+q,'GET',null,sb)).data.input.vat,0);
});
await test('expenses without VAT keep working and the daily report still matches',async()=>{
 assert.equal((await req('finance/expenses','POST',{id:'exp3',date:today,amount:2000,method:'Bank / card',category:'Other',note:'Parking'},sa)).status,201);
 assert.equal((await req('finance/expenses','POST',{id:'exp3',date:today,amount:2000,method:'Bank / card',category:'Other',note:'Parking'},sa)).status,200);
 const r=(await req('finance/report?date='+today,'GET',null,sa)).data;assert.equal(r.totals.expenses,12500);assert.equal(r.expenses.find(e=>e.id==='exp1').vat,500);
});
}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
