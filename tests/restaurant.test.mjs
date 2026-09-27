import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,createBusiness,snapshot,passwordHash} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';

const put=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});
const now=()=>new Date().toISOString();
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'rest-')),db=openStore(join(dir,'db.sqlite'));
 const r=await createBusiness(db,{name:'Spice Route',slug:'spice',owner:'Owner',email:'o@t.com',password:'a-long-password',type:'restaurant'});
 for(const id of ['w1','w2'])db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(id,r.businessId,id+'@t.com',id,await passwordHash('a-long-password'),'cashier');
 const owner={id:r.userId,business_id:r.businessId,business_type:'restaurant',role:'owner'},w1={...owner,id:'w1',role:'cashier'},w2={...owner,id:'w2',role:'cashier'};
 return{db,r,owner,w1,w2,run:(u,op)=>operation(db,u,op),done:()=>{db.close();rmSync(dir,{recursive:true,force:true})}};
}
const kot=(orderId,items,extra={})=>({orderId,items,at:now(),...extra});

test('menu, tables and service-charge settings: owner only, validated',async()=>{
 const f=await setup();try{
  const s=snapshot(f.db,f.r.businessId).state;
  assert.equal(s.restaurant_items.length,10);assert.equal(s.restaurant_tables.length,8);assert.equal(s.restaurant_config[0].serviceBps,0);
  assert.throws(()=>f.run(f.w1,put('restaurant_items','x',{name:'Tea',category:'Drinks',price:300,route:'bar'})),/Owner permission/);
  assert.throws(()=>f.run(f.owner,put('restaurant_items','x',{name:'Tea',category:'Drinks',price:300,route:'oven'})),/Kitchen, Bar/);
  assert.throws(()=>f.run(f.owner,put('restaurant_items','x',{name:'Tea',category:'Drinks',price:300,route:'bar',options:[{id:'a',name:'A',price:0},{id:'a',name:'B',price:0}]})),/unique/);
  assert.equal(f.run(f.owner,put('restaurant_config','config',{serviceBps:1000,serviceTypes:['dine-in','spaceship']},1)).data.serviceTypes.length,1);
  assert.throws(()=>f.run(f.owner,put('restaurant_config','config',{serviceBps:5000},2)),/Service charge/);
  const svc=f.run(f.owner,put('restaurant_items','service',{name:'Service',category:'Charges',price:0,route:'kitchen',options:[{id:'x',name:'x',price:1}]},1)).data;
  assert.deepEqual([svc.system,svc.openPrice,svc.route,svc.options.length],[true,true,'none',0]);
 }finally{f.done()}
});

test('two waiters add to one table at once; kitchen moves tickets forward; voids need a reason',async()=>{
 const f=await setup();try{
  const o=f.run(f.w1,put('restaurant_orders','o1',{type:'dine-in',tableId:'t3',guests:4,status:'open',opened:now()})).data;
  assert.deepEqual([o.table,o.number,o.status],['Table 3',1,'open']);
  assert.equal(f.run(f.w2,put('restaurant_orders','o2',{type:'takeaway',status:'open'})).data.number,2);
  // Both waiters send tickets to the same order: separate records, no conflict.
  const k1=f.run(f.w1,put('restaurant_kots','k1',kot('o1',[{key:'a',itemId:'m3',qty:2,options:['o1','o2'],note:'less oil'},{key:'b',itemId:'m6',qty:1}]))).data;
  const k2=f.run(f.w2,put('restaurant_kots','k2',kot('o1',[{key:'c',itemId:'m5',qty:1,options:['o5']}]))).data;
  assert.deepEqual(k1.items.map(i=>[i.name,i.route,i.price,i.qty]),[['Chicken biryani','kitchen',3500,2],['Fresh orange juice','bar',1400,1]]);
  assert.deepEqual([k1.table,k1.orderNumber,k1.status,k2.items[0].price],['Table 3',1,'new',3800]);
  assert.throws(()=>f.run(f.w1,put('restaurant_kots','k3',kot('o1',[{key:'d',itemId:'m3',qty:1,options:['o5']}]))),/option/);
  assert.throws(()=>f.run(f.w1,put('restaurant_kots','k3',kot('o1',[{key:'d',itemId:'service',qty:1}]))),/removed/);
  assert.throws(()=>f.run(f.w1,put('restaurant_kots','k3',kot('ghost',[{key:'d',itemId:'m1',qty:1}]))),/must sync/);
  // Kitchen: new → preparing → ready; never backwards; items can't be edited.
  assert.equal(f.run(f.owner,put('restaurant_kots','k1',{...k1,status:'preparing'},1)).data.status,'preparing');
  assert.throws(()=>f.run(f.owner,put('restaurant_kots','k1',{...k1,status:'new'},2)),/forward/);
  const ready=f.run(f.owner,put('restaurant_kots','k1',{...k1,status:'ready',items:[]},2)).data;assert.equal(ready.items.length,2);assert.ok(ready.readyAt);
  // Void one biryani: needs a reason and a negative quantity.
  assert.throws(()=>f.run(f.w1,put('restaurant_kots','v1',kot('o1',[{key:'a',itemId:'m3',qty:-1,options:['o1','o2']}],{type:'void'}))),/Required/);
  assert.throws(()=>f.run(f.w1,put('restaurant_kots','v1',kot('o1',[{key:'a',itemId:'m3',qty:1}],{type:'void',reason:'x'}))),/Void quantity/);
  assert.equal(f.run(f.w1,put('restaurant_kots','v1',kot('o1',[{key:'a',itemId:'m3',qty:-1,options:['o1','o2']}],{type:'void',reason:'Customer changed mind'}))).data.type,'void');
 }finally{f.done()}
});

test('move, merge, cancel, close and reopen follow the rules',async()=>{
 const f=await setup();try{
  const a=f.run(f.w1,put('restaurant_orders','a',{type:'dine-in',tableId:'t1',status:'open'})).data;
  const b=f.run(f.w1,put('restaurant_orders','b',{type:'dine-in',tableId:'t2',status:'open'})).data;
  const moved=f.run(f.w1,put('restaurant_orders','a',{...a,tableId:'t5'},1)).data;assert.deepEqual([moved.table,moved.moves.length],['Table 5',1]);
  assert.throws(()=>f.run(f.w1,put('restaurant_orders','a',{...moved,number:99},2)),/cannot be changed/);
  f.run(f.w1,put('restaurant_kots','ka',kot('a',[{key:'x',itemId:'m1',qty:1}])));
  // merge a into b; a later ticket for a lands on b
  const merged=f.run(f.w1,put('restaurant_orders','a',{...moved,status:'merged',mergedInto:'b'},2)).data;assert.deepEqual([merged.status,merged.mergedInto],['merged','b']);
  assert.equal(f.run(f.w2,put('restaurant_kots','late',kot('a',[{key:'y',itemId:'m2',qty:1}]))).data.orderId,'b');
  // staff can't cancel an order with items; owner can, with a reason
  assert.throws(()=>f.run(f.w1,put('restaurant_orders','b',{...b,status:'cancelled',cancelReason:'left'},1)),/Only the owner/);
  const c=f.run(f.w1,put('restaurant_orders','c',{type:'takeaway',status:'open'})).data;
  assert.equal(f.run(f.w1,put('restaurant_orders','c',{...c,status:'cancelled',cancelReason:'Mistake'},1)).data.status,'cancelled');
  assert.throws(()=>f.run(f.w1,put('restaurant_kots','kc',kot('c',[{key:'z',itemId:'m1',qty:1}]))),/cancelled/);
  const closed=f.run(f.w1,put('restaurant_orders','b',{...b,status:'closed'},1)).data;assert.equal(closed.status,'closed');
  assert.throws(()=>f.run(f.w1,put('restaurant_orders','b',{...closed,status:'open'},2)),/Only the owner/);
  assert.equal(f.run(f.owner,put('restaurant_orders','b',{...closed,status:'open'},2)).data.status,'open');
  // delivery needs customer, phone and address
  assert.throws(()=>f.run(f.w1,put('restaurant_orders','d',{type:'delivery',status:'open',customer:'Ali',phone:'050'})),/Required/);
  const d=f.run(f.w1,put('restaurant_orders','d',{type:'delivery',status:'open',customer:'Ali',phone:'0501234567',address:'Villa 4, Al Barsha'})).data;
  assert.equal(f.run(f.w1,put('restaurant_orders','d',{...d,stage:'out',driver:'Rafiq'},1)).data.stage,'out');
 }finally{f.done()}
});

test('bills: options priced from the menu, service charge line, split into several invoices',async()=>{
 const f=await setup();try{
  f.run(f.w1,put('restaurant_orders','o',{type:'dine-in',tableId:'t1',status:'open'}));
  const sale=(items,extra={})=>{const sub=items.reduce((n,i)=>n+i.price*i.qty,0);return{status:'Paid',items,sub,off:0,tax:0,total:sub,method:'Cash',received:sub,date:now(),customerId:'',staff:'w1',ref:'o',...extra}};
  const s1=f.run(f.w1,put('sales','s1',sale([{id:'m3',price:3500,qty:1,options:['o1','o2'],note:'less oil'},{id:'service',price:350,qty:1}]))).data;
  assert.deepEqual(s1.items.map(i=>[i.name,i.price,i.options||[]]),[['Chicken biryani',3500,['Extra raita +3.00','Spicy']],['Service charge',350,[]]]);
  assert.equal(s1.ref,'o');
  assert.throws(()=>f.run(f.w1,put('sales','s2',sale([{id:'m3',price:3200,qty:1,options:['o1']}]))),/price changed/); // option not paid for
  assert.throws(()=>f.run(f.w1,put('sales','s2',sale([{id:'m3',price:3500,qty:1,options:['nope']}]))),/option/);
  assert.equal(f.run(f.w1,put('sales','s2',sale([{id:'m3',price:3200,qty:1}]))).data.total,3200); // second guest's part of a split bill
 }finally{f.done()}
});
