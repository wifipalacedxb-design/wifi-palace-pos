import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {start} from '../server/server.mjs';
import {createSalon} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
import {financeReport,businessDay} from '../server/finance.mjs';
test('split validation, replay, original-method refunds and cash closing inputs',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'salon-split-'));
 const app=await start({file:join(dir,'db.sqlite'),port:0,mailer:null});
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true})});
 const a=await createSalon(app.db,{name:'Split Salon',slug:'split-salon',owner:'Owner',email:'split@test.com',password:'test-password-123'});
 const u={id:a.userId,salon_id:a.salonId,role:'owner'};
 const sale={date:new Date().toISOString(),items:[{id:'s1',price:5000,qty:1}],sub:5000,off:0,tax:0,total:5000,received:6000,customerId:'',staff:'Stylist 1',method:'Split',cashAmount:2000,cardAmount:3000,status:'Paid'};
 const op=(key,data,base=0)=>({id:randomUUID(),kind:'sales',key,base,action:'put',data});
 for(const bad of [{cashAmount:0,cardAmount:5000},{cashAmount:2000,cardAmount:2000},{cashAmount:-1,cardAmount:5001},{cashAmount:2000.1,cardAmount:2999.9},{received:4999},{cashAmount:undefined}]){
  assert.throws(()=>operation(app.db,u,op(randomUUID(),{...sale,...bad})));
 }
 const request=op('split-one',sale),saved=operation(app.db,u,request);
 assert.equal(saved.data.cashReceived,3000);assert.equal(saved.data.change,1000);
 assert.deepEqual(operation(app.db,u,request),saved);
 let r=financeReport(app.db,a.salonId,businessDay());assert.equal(r.totals.sales,5000);assert.equal(r.totals.cashSales,2000);assert.equal(r.totals.cardSales,3000);
 operation(app.db,u,op('card-one',{...sale,method:'Card (external terminal)',cashAmount:0,cardAmount:5000,received:5000}));
 operation(app.db,u,op('cash-one',{...sale,method:'Cash',cashAmount:5000,cardAmount:0}));
 assert.throws(()=>operation(app.db,u,op('card-invalid',{...sale,method:'Card (external terminal)',received:5000})));
 const refund=operation(app.db,u,op('split-one',{status:'Refunded',refundReason:'Return',cashAmount:5000,cardAmount:0},1));
 assert.equal(refund.data.cashAmount,2000);assert.equal(refund.data.cardAmount,3000);
 r=financeReport(app.db,a.salonId,businessDay());assert.equal(r.totals.cashRefunds,2000);assert.equal(r.totals.cardRefunds,3000);
 assert.equal(r.totals.cashSales-r.totals.cashRefunds,5000);
 assert.equal(r.totals.cardSales-r.totals.cardRefunds,5000);
});
test('cashier split entry calculates remainder, retains change and prints both portions',async()=>{
 const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('function pay()'),html.indexOf('function receipt(id)'));
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false});return nodes.get(id)};
 let saved,confirmed=0;const db={sales:[],customers:[],staff:[],settings:{name:'Salon',tax:0}};
 const c=vm.createContext({$,db,cart:[{id:'s1',name:'Hair',qty:1,price:10000}],customer:'',stylist:'',discount:0,totals:()=>({sub:10000,off:0,tax:0,total:10000}),money:n=>'AED '+(n/100).toFixed(2),cents:v=>Math.round(Number(v)*100),modal(){},alert:m=>{throw Error(m)},confirm:()=>{confirmed++;return true},uid:()=>randomUUID(),change:fn=>{fn();saved=db.sales.at(-1);return true},closeModal(){},render(){},receipt(){},esc:x=>x});
 vm.runInContext(source,c);c.pay();$('method').value='Split';c.paymentFields();assert.equal($('cashPortion').value,'50.00');
 $('cashPortion').value='30';c.paymentFields(false);assert.equal($('cardPortion').textContent,'Card to charge: AED 70.00');$('received').value='50';
 $('payment').onsubmit({preventDefault(){}});
 assert.equal(saved.cashAmount,3000);assert.equal(saved.cardAmount,7000);assert.equal(saved.change,2000);assert.equal(confirmed,1);
 assert.match(c.receiptText(saved),/Cash paid: AED 30.00/);assert.match(c.receiptText(saved),/Card paid: AED 70.00/);
});
