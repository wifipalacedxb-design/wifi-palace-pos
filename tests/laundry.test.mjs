import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,createBusiness,snapshot} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';

const put=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});
const today=()=>new Date().toISOString().slice(0,10);
const order=(extra={})=>({tag:'0926-A01',customer:'Ahmed',phone:'0501234567',items:[{id:'l1',qty:3,price:800},{id:'l7',qty:2.5,price:800}],due:today(),status:'Received',...extra});

test('laundry business: price list, orders with tags, status flow and payment',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'laundry-')),db=openStore(join(dir,'db.sqlite'));
 try{
  const l=await createBusiness(db,{name:'Al Noor Laundry',slug:'al-noor',owner:'O',email:'o@test.com',password:'a-long-password',type:'laundry'});
  const owner={id:l.userId,business_id:l.businessId,business_type:'laundry',role:'owner'},cashier={...owner,id:'cashier-1',role:'cashier'};
  const s=snapshot(db,l.businessId).state;
  assert.equal(s.type,'laundry');assert.equal(s.laundry_items.length,9);assert.deepEqual(s.laundry_orders,[]);assert.equal(s.services,undefined);
  // Price list is owner-only and needs a valid unit and category.
  assert.throws(()=>operation(db,cashier,put('laundry_items','l10',{name:'Curtain',category:'Household',unit:'piece',price:2500})),{status:403});
  assert.throws(()=>operation(db,owner,put('laundry_items','l10',{name:'Curtain',category:'Household',unit:'metre',price:2500})),{status:400});
  assert.equal(operation(db,owner,put('laundry_items','l10',{name:'Curtain',category:'Household',unit:'piece',price:2500})).version,1);
  // Salon records are not accepted by a laundry.
  assert.throws(()=>operation(db,owner,put('services','s9',{name:'Haircut',category:'Hair',price:5000})),{status:400});
  // New order: 3 shirts at 8.00 + 2.5 kg wash & fold at 8.00/kg = 44.00
  const created=operation(db,cashier,put('laundry_orders','o1',order()));
  assert.equal(created.data.total,4400);assert.equal(created.data.status,'Received');assert.equal(created.data.items[1].unit,'kg');
  assert.throws(()=>operation(db,cashier,put('laundry_orders','o2',order())),{status:409}); // tag already used
  assert.throws(()=>operation(db,cashier,put('laundry_orders','o3',order({tag:'0926-A02',items:[{id:'l1',qty:1.5,price:800}]}))),{status:400}); // pieces must be whole
  assert.throws(()=>operation(db,cashier,put('laundry_orders','o4',order({tag:'0926-A03',items:[{id:'l1',qty:1,price:700}]}))),{status:409}); // stale price
  assert.throws(()=>operation(db,cashier,put('laundry_orders','o5',order({tag:'0926-A04',status:'Ready'}))),{status:400});
  // Status flow: Received -> Ready is allowed, going back is not, delivery needs payment.
  let o=operation(db,cashier,put('laundry_orders','o1',{...created.data,status:'Ready',items:[]},1));
  assert.equal(o.data.status,'Ready');assert.equal(o.data.items.length,2,'items cannot be changed after drop-off');assert.equal(o.data.history.length,2);
  assert.throws(()=>operation(db,cashier,put('laundry_orders','o1',{...o.data,status:'Washing'},2)),{status:409});
  assert.throws(()=>operation(db,cashier,put('laundry_orders','o1',{...o.data,status:'Delivered'},2)),{status:409});
  // Payment is a normal tax invoice sale (decimal kg allowed) linked to the order.
  const sale=operation(db,cashier,put('sales','p1',{status:'Paid',items:[{id:'l1',qty:3,price:800},{id:'l7',qty:2.5,price:800}],sub:4400,off:0,tax:0,total:4400,received:5000,method:'Cash',date:new Date().toISOString(),customerId:'',staff:'Staff 1',ref:'o1'}));
  assert.equal(sale.data.number,'INV-000001');assert.equal(sale.data.ref,'o1');assert.equal(sale.data.change,600);
  o=operation(db,cashier,put('laundry_orders','o1',{...o.data,status:'Delivered',saleId:'p1'},2));
  assert.equal(o.data.status,'Delivered');
  assert.throws(()=>operation(db,cashier,put('laundry_orders','o1',{...o.data,status:'Delivered',saleId:'other'},3)),{status:409});
  // A salon in the same database cannot create laundry orders.
  const a=await createBusiness(db,{name:'Salon',slug:'salon-x',owner:'S',email:'s@test.com',password:'a-long-password'});
  assert.throws(()=>operation(db,{id:a.userId,business_id:a.businessId,business_type:'salon',role:'owner'},put('laundry_orders','o9',order())),{status:400});
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
