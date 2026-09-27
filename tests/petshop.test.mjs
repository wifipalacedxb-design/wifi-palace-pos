import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,createBusiness,snapshot,passwordHash} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
import {recentState} from '../server/sync.mjs';

const put=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});
const day=(n=0)=>new Date(Date.now()+4*3600000+n*86400000).toISOString().slice(0,10);
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'pet-')),db=openStore(join(dir,'db.sqlite'));
 const r=await createBusiness(db,{name:'Paws',slug:'paws',owner:'Owner',email:'o@t.com',password:'a-long-password',type:'petshop'});
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('c1',r.businessId,'c@t.com','Cashier',await passwordHash('a-long-password'),'cashier');
 const owner={id:r.userId,business_id:r.businessId,business_type:'petshop',role:'owner'},cashier={...owner,id:'c1',role:'cashier'};
 const run=(u,op)=>operation(db,u,op);
 run(cashier,put('customers','cu1',{name:'Sara',phone:'0501112233',dob:''}));
 return{db,r,owner,cashier,run,done:()=>{db.close();rmSync(dir,{recursive:true,force:true})}};
}

test('catalogue: pet categories, services have no stock, products keep grocery rules',async()=>{
 const f=await setup();try{
  const s=snapshot(f.db,f.r.businessId).state;
  assert.equal(s.grocery_items.filter(i=>i.type==='service').length,5);
  assert.throws(()=>f.run(f.owner,put('grocery_items','x',{name:'Milk',category:'Dairy & eggs',unit:'piece',price:500})),/category/);
  const svc=f.run(f.owner,put('grocery_items','s9',{type:'service',serviceType:'grooming',name:'Teeth clean',category:'Grooming',price:4000,duration:30,barcode:'123456'})).data;
  assert.deepEqual([svc.type,svc.barcode,svc.unit,svc.duration],['service','','piece',30]);
  assert.throws(()=>f.run(f.owner,put('grocery_items','s9b',{type:'service',serviceType:'spa',name:'X',category:'Grooming',price:1})),/service type/);
  assert.throws(()=>f.run(f.owner,put('grocery_items','s9',{name:'Teeth clean',category:'Grooming',unit:'piece',price:4000},1)),/cannot become a product/);
  assert.throws(()=>f.run(f.cashier,put('grocery_stock','e1',{type:'in',itemId:'s1',qty:5,at:new Date().toISOString()})),/no stock/);
  assert.equal(f.run(f.cashier,put('grocery_stock','e2',{type:'in',itemId:'p7',qty:20,at:new Date().toISOString()})).data.qty,20);
  // a bill mixing a live animal, a product and a service (open price on full grooming)
  const items=[{id:'p7',price:500,qty:3},{id:'s2',price:18000,qty:1}],sub=19500;
  const sale=f.run(f.cashier,put('sales','b1',{status:'Paid',items,sub,off:0,tax:0,total:sub,method:'Cash',received:sub,date:new Date().toISOString(),customerId:'cu1',staff:'Cashier'})).data;
  assert.deepEqual(sale.items.map(i=>[i.name,i.type||'',i.listPrice||0]),[['Goldfish','',0],['Full grooming','service',15000]]);
  assert.equal(recentState(f.db,f.owner).summary.stock.p7,17);
 }finally{f.done()}
});

test('pets: owner required, vaccinations validated',async()=>{
 const f=await setup();try{
  assert.throws(()=>f.run(f.cashier,put('pets','pt1',{customerId:'ghost',name:'Max',species:'Dog'})),/Owner must sync/);
  assert.throws(()=>f.run(f.cashier,put('pets','pt1',{customerId:'cu1',name:'Max',species:'Dragon'})),/species/);
  assert.throws(()=>f.run(f.cashier,put('pets','pt1',{customerId:'cu1',name:'Max',species:'Dog',vaccinations:[{id:'v1',name:'Rabies',date:day(3)}]})),/future/);
  const p=f.run(f.cashier,put('pets','pt1',{customerId:'cu1',name:'Max',species:'Dog',breed:'Shih Tzu',weight:6.25,dob:'2021-03-01',vaccinations:[{id:'v1',name:'Rabies',date:day(-300),due:day(65)}]})).data;
  assert.deepEqual([p.owner,p.weight,p.vaccinations[0].due],['Sara',6.3,day(65)]);
 }finally{f.done()}
});

test('grooming: groomer double-booking blocked; closed appointments stay closed',async()=>{
 const f=await setup();try{
  f.run(f.cashier,put('pets','pt1',{customerId:'cu1',name:'Max',species:'Dog'}));f.run(f.cashier,put('pets','pt2',{customerId:'cu1',name:'Luna',species:'Cat'}));
  const at=new Date(Date.now()+86400000).toISOString();
  const a=f.run(f.cashier,put('appointments','a1',{when:at,duration:60,petId:'pt1',serviceId:'s1',staffId:'t1',status:'Booked'})).data;
  assert.deepEqual([a.pet,a.customer,a.service,a.staff],['Max','Sara','Bath & dry (small dog)','Groomer 1']);
  assert.throws(()=>f.run(f.cashier,put('appointments','a2',{when:new Date(Date.parse(at)+1800000).toISOString(),duration:30,petId:'pt2',serviceId:'s3',staffId:'t1',status:'Booked'})),/Groomer 1 has Max/);
  assert.throws(()=>f.run(f.cashier,put('appointments','a2',{when:at,duration:30,petId:'pt2',serviceId:'p1',staffId:'t1',status:'Booked'})),/grooming service/);
  f.run(f.cashier,put('appointments','a1',{...a,status:'Completed'},1));
  assert.throws(()=>f.run(f.cashier,put('appointments','a1',{...a,status:'Booked'},2)),/already closed/);
  assert.equal(f.run(f.cashier,put('appointments','a2',{when:new Date(Date.parse(at)+1800000).toISOString(),duration:30,petId:'pt2',serviceId:'s3',staffId:'t1',status:'Booked'})).data.pet,'Luna');
 }finally{f.done()}
});

test('boarding: booked → in → out, dates checked, old stays leave the device',async()=>{
 const f=await setup();try{
  f.run(f.cashier,put('pets','pt1',{customerId:'cu1',name:'Max',species:'Dog'}));
  assert.throws(()=>f.run(f.cashier,put('pet_stays','st1',{petId:'pt1',serviceId:'s1',status:'In',from:day(),until:day(3)})),/boarding or daycare/);
  assert.throws(()=>f.run(f.cashier,put('pet_stays','st1',{petId:'pt1',serviceId:'s4',status:'In',from:day(),until:day(-1)})),/on or after/);
  const s=f.run(f.cashier,put('pet_stays','st1',{petId:'pt1',serviceId:'s4',status:'Booked',from:day(1),until:day(4),kennel:'K2',care:'Feed twice'})).data;
  assert.deepEqual([s.type,s.pet,s.customer],['boarding','Max','Sara']);
  assert.throws(()=>f.run(f.cashier,put('pet_stays','st1',{...s,status:'Out'},1)),/cannot move/);
  const inn=f.run(f.cashier,put('pet_stays','st1',{...s,status:'In'},1)).data;assert.ok(inn.checkIn);
  const out=f.run(f.cashier,put('pet_stays','st1',{...inn,status:'Out'},2)).data;assert.ok(out.checkOut);
  assert.equal(recentState(f.db,f.owner).state.pet_stays.length,1);
  assert.equal(recentState(f.db,f.owner,-1).state.pet_stays.length,0); // history window in the past → closed stay is history
 }finally{f.done()}
});
