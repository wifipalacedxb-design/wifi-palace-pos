import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,createBusiness,snapshot,passwordHash} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
import {recentState} from '../server/sync.mjs';

const put=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});
const now=()=>new Date().toISOString();
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'perf-')),db=openStore(join(dir,'db.sqlite'));
 const r=await createBusiness(db,{name:'Oud House',slug:'oud',owner:'Owner',email:'o@t.com',password:'a-long-password',type:'perfume'});
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('c1',r.businessId,'c@t.com','Sales',await passwordHash('a-long-password'),'cashier');
 const owner={id:r.userId,business_id:r.businessId,business_type:'perfume',role:'owner'},staff={...owner,id:'c1',role:'cashier'},run=(u,op)=>operation(db,u,op);
 run(staff,put('customers','cu1',{name:'Fatima',phone:'0501112233',dob:''}));
 const sale=(key,items,extra={})=>{const sub=items.reduce((n,i)=>n+Math.round(i.price*i.qty),0),off=extra.off||0,total=sub-off;return run(staff,put('sales',key,{status:'Paid',items,sub,off,tax:0,total,method:'Cash',received:total,date:now(),customerId:'cu1',staff:'Sales',branch:'main',...extra}))};
 return{db,r,owner,staff,run,sale,sum:()=>recentState(db,owner).summary,done:()=>{db.close();rmSync(dir,{recursive:true,force:true})}};
}

test('units ml / g / tola sell with decimals; blend lines keep a note; branch required on sales',async()=>{
 const f=await setup();try{
  const s=snapshot(f.db,f.r.businessId).state;assert.deepEqual(s.grocery_config[0].branches,[{id:'main',name:'Main shop'}]);
  assert.throws(()=>f.run(f.owner,put('grocery_items','x',{name:'Oil',category:'Oils & attar',unit:'kg',price:100})),/Unit must be/);
  f.run(f.staff,put('grocery_stock','e1',{type:'in',itemId:'o2',qty:250,branch:'main',at:now()}));
  assert.throws(()=>f.run(f.staff,put('grocery_stock','e2',{type:'in',itemId:'o2',qty:5,at:now()})),/branch/);
  assert.throws(()=>f.sale('s0',[{id:'o2',price:1500,qty:6}],{branch:''}),/branch/);
  const sale=f.sale('s1',[{id:'o2',price:1500,qty:6.5,note:'Blend: Rose Night'},{id:'o1',price:25000,qty:0.25,note:'Blend: Rose Night'},{id:'k1',price:1500,qty:1,note:'Blend: Rose Night'}]).data;
  assert.deepEqual(sale.items.map(i=>[i.name,i.unit,i.qty,i.note]),[['Taifi Rose (oil)','ml',6.5,'Blend: Rose Night'],['Dehn al Oud (oil)','tola',0.25,'Blend: Rose Night'],['Crystal bottle 12ml','piece',1,'Blend: Rose Night']]);
  assert.equal(sale.branch,'main');assert.equal(sale.total,9750+6250+1500);
  assert.equal(f.sum().stock.o2,243.5);assert.equal(f.sum().stockByBranch.o2.main,243.5);
 }finally{f.done()}
});

test('branches: owner sets them, stock per branch, transfers move stock without changing the total',async()=>{
 const f=await setup();try{
  const cfg=snapshot(f.db,f.r.businessId).state.grocery_config[0];
  assert.throws(()=>f.run(f.staff,put('grocery_config','config',{...cfg,branches:[{id:'main',name:'Main'},{id:'mall',name:'Mall kiosk'}]},1)),/Owner/);
  f.run(f.owner,put('grocery_config','config',{...cfg,branches:[{id:'main',name:'Main shop'},{id:'mall',name:'Dubai Mall kiosk'}]},1));
  f.run(f.staff,put('grocery_stock','e1',{type:'in',itemId:'p1',qty:10,branch:'main',at:now()}));
  assert.throws(()=>f.run(f.staff,put('grocery_stock','t0',{type:'transfer',itemId:'p1',qty:3,branch:'main',toBranch:'main',at:now()})),/another branch/);
  f.run(f.staff,put('grocery_stock','t1',{type:'transfer',itemId:'p1',qty:3,branch:'main',toBranch:'mall',at:now()}));
  f.sale('s1',[{id:'p1',price:35000,qty:1}],{branch:'mall'});
  const sum=f.sum();assert.equal(sum.stock.p1,9);assert.deepEqual(sum.stockByBranch.p1,{main:7,mall:2});
 }finally{f.done()}
});

test('gift sets list their items; assembling takes parts out of stock',async()=>{
 const f=await setup();try{
  assert.throws(()=>f.run(f.owner,put('grocery_items','g1',{name:'Eid set',category:'Gift sets',unit:'piece',price:50000,components:[]})),/needs its items/);
  const set=f.run(f.owner,put('grocery_items','g1',{name:'Eid set',category:'Gift sets',unit:'piece',price:50000,components:[{itemId:'p2',qty:1},{itemId:'b2',qty:2}]})).data;
  assert.deepEqual(set.components.map(c=>[c.name,c.qty]),[['White Musk 50ml',1],['Bakhoor box',2]]);
  for(const [k,id,q] of [['a1','g1',2],['a2','p2',-2],['a3','b2',-4]])f.run(f.staff,put('grocery_stock',k,{type:'assemble',itemId:id,qty:q,branch:'main',reason:'Gift set: Eid set',at:now()}));
  const sum=f.sum();assert.deepEqual([sum.stock.g1,sum.stock.p2,sum.stock.b2],[2,-2,-4]);
 }finally{f.done()}
});

test('loyalty: earn matches the bill, redeem needs balance and a matching discount, refunds cancel points',async()=>{
 const f=await setup();try{
  const s1=f.sale('s1',[{id:'p1',price:35000,qty:1}]).data;
  assert.throws(()=>f.run(f.staff,put('perfume_points','earn-s1',{customerId:'cu1',type:'earn',points:999,saleId:'s1',at:now()})),/do not match/);
  f.run(f.staff,put('perfume_points','earn-s1',{customerId:'cu1',type:'earn',points:350,saleId:'s1',at:now()}));
  assert.throws(()=>f.run(f.staff,put('perfume_points','earn-s1b',{customerId:'cu1',type:'earn',points:350,saleId:'s1',at:now()})),/Invalid points/);
  // redeem 200 points = AED 10 on the next bill
  f.sale('s2',[{id:'p2',price:12000,qty:1}],{off:1000});
  assert.throws(()=>f.run(f.staff,put('perfume_points','redeem-s2',{customerId:'cu1',type:'redeem',points:-50,saleId:'s2',at:now()})),/at least 100/);
  assert.throws(()=>f.run(f.staff,put('perfume_points','redeem-s2',{customerId:'cu1',type:'redeem',points:-400,saleId:'s2',at:now()})),/more than the bill discount|only 350/);
  f.run(f.staff,put('perfume_points','redeem-s2',{customerId:'cu1',type:'redeem',points:-200,saleId:'s2',at:now()}));
  f.run(f.staff,put('perfume_points','earn-s2',{customerId:'cu1',type:'earn',points:110,saleId:'s2',at:now()}));
  assert.equal(f.sum().points.cu1,260);
  f.run(f.owner,put('sales','s1',{...s1,status:'Refunded',refundReason:'Returned'},1));
  assert.equal(f.sum().points.cu1,-90);
  assert.throws(()=>f.run(f.staff,put('perfume_points','adj1',{customerId:'cu1',type:'adjust',points:90,reason:'fix',at:now()})),/owner/);
 }finally{f.done()}
});

test('blends and scent profiles',async()=>{
 const f=await setup();try{
  assert.throws(()=>f.run(f.staff,put('perfume_blends','bl1',{name:'X',customerId:'cu1',components:[{itemId:'p1',qty:1}]})),/oils sold by ml/);
  const b=f.run(f.staff,put('perfume_blends','bl1',{name:'Rose Night',customerId:'cu1',components:[{itemId:'o2',qty:6},{itemId:'o1',qty:0.25}],bottleId:'k1'})).data;
  assert.deepEqual([b.customer,b.bottle,b.components.length],['Fatima','Crystal bottle 12ml',2]);
  assert.throws(()=>f.run(f.staff,put('perfume_profiles','cu1',{families:['Oud','Plastic']})),/Unknown scent/);
  assert.deepEqual(f.run(f.staff,put('perfume_profiles','cu1',{families:['Oud','Rose','Oud'],favourites:'Oud Royal'})).data.families,['Oud','Rose']);
 }finally{f.done()}
});
