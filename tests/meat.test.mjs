import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,createBusiness,snapshot,passwordHash} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
import {recentState} from '../server/sync.mjs';

const put=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});
const now=()=>new Date().toISOString(),later=h=>new Date(Date.now()+h*3600000).toISOString();
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'meat-')),db=openStore(join(dir,'db.sqlite'));
 const r=await createBusiness(db,{name:'Al Noor Butchery',slug:'noor',owner:'Owner',email:'o@t.com',password:'a-long-password',type:'meat'});
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('c1',r.businessId,'c@t.com','Cashier',await passwordHash('a-long-password'),'cashier');
 const owner={id:r.userId,business_id:r.businessId,business_type:'meat',role:'owner'},staff={...owner,id:'c1',role:'cashier'},run=(u,op)=>operation(db,u,op);
 run(staff,put('customers','cu1',{name:'Hotel Rimal',phone:'0501112233',dob:''}));
 const sale=(key,items,extra={})=>{const sub=items.reduce((n,i)=>n+Math.round(i.price*i.qty),0);return run(staff,put('sales',key,{status:'Paid',items,sub,off:0,tax:0,total:sub,method:'Cash',received:sub,date:now(),customerId:'',staff:'Cashier',...extra}))};
 return{db,r,owner,staff,run,sale,sum:()=>recentState(db,owner).summary,done:()=>{db.close();rmSync(dir,{recursive:true,force:true})}};
}

test('cutting options: priced per kg on the bill, only on kg products, checked against the product',async()=>{
 const f=await setup();try{
  const s=snapshot(f.db,f.r.businessId).state;assert.ok(s.grocery_items.find(i=>i.id==='m1').cuts.length>=3);
  assert.throws(()=>f.run(f.owner,put('grocery_items','w2',{name:'Whole lamb',category:'Whole animals',unit:'piece',price:80000,cuts:[{id:'a',name:'Cut',charge:0}]})),/by kg/);
  const bill=f.sale('s1',[{id:'m1',price:5600,qty:1.25,options:['c2']},{id:'m1',price:5200,qty:0.5,options:['c1']},{id:'m8',price:3600,qty:1}]).data;
  assert.deepEqual(bill.items.map(i=>[i.price,i.options||[]]),[[5600,['Boneless +4.00/kg']],[5200,['Curry cut']],[3600,[]]]);
  assert.equal(bill.total,7000+2600+3600);
  assert.throws(()=>f.sale('s2',[{id:'m1',price:5200,qty:1,options:['c2']}]),/price changed/);
  assert.throws(()=>f.sale('s2',[{id:'m1',price:5200,qty:1,options:['nope']}]),/cutting option/);
  assert.equal(f.sum().stock.m1,-1.75);
 }finally{f.done()}
});

test('carcass breakdown: yield and cost per usable kg; cut stock arrives as goods in',async()=>{
 const f=await setup();try{
  assert.throws(()=>f.run(f.staff,put('meat_breakdowns','b0',{animal:'Goat',weight:18,cost:54000,outputs:[{itemId:'m1',qty:20}],at:now()})),/more than the carcass/);
  assert.throws(()=>f.run(f.staff,put('meat_breakdowns','b0',{animal:'Goat',weight:18,cost:54000,outputs:[{itemId:'w1',qty:1}],at:now()})),/sold by kg/);
  const b=f.run(f.staff,put('meat_breakdowns','b1',{animal:'Goat',description:'Local goat',supplier:'Al Mawashi',weight:18.5,cost:55500,outputs:[{itemId:'m1',qty:13.2},{itemId:'m9',qty:0.6},{itemId:'m10',qty:2.1}],at:now()})).data;
  assert.deepEqual([b.usable,b.waste,b.yieldPct,b.costPerKg],[15.9,2.6,85.9,3491]);
  for(const o of b.outputs)f.run(f.staff,put('grocery_stock','in-'+o.itemId,{type:'in',itemId:o.itemId,qty:o.qty,cost:b.costPerKg,supplier:'Al Mawashi',note:'Breakdown',at:now()}));
  assert.equal(f.sum().stock.m1,13.2);
 }finally{f.done()}
});

test('pre-orders: numbered, flow enforced, closing needs the bill; advance is an account payment',async()=>{
 const f=await setup();try{
  assert.throws(()=>f.run(f.staff,put('meat_orders','o0',{status:'New',type:'delivery',occasion:'Regular',customerId:'cu1',due:later(20),items:[{itemId:'m1',qty:3,cut:'c1'}]})),/address/);
  const o=f.run(f.staff,put('meat_orders','o1',{status:'New',type:'delivery',occasion:'Eid / Qurbani',customerId:'cu1',due:later(20),address:'Rimal Hotel, JBR',advance:20000,items:[{itemId:'m1',qty:3,cut:'c2',note:'fat off'},{itemId:'w1',qty:1}]})).data;
  assert.deepEqual([o.number,o.customer,o.items[0].price,o.items[0].cutName],[1,'Hotel Rimal',5600,'Boneless']);
  assert.equal(f.run(f.staff,put('meat_orders','o2',{status:'New',type:'pickup',occasion:'Regular',customerId:'cu1',due:later(3),items:[{itemId:'m7',qty:2}]})).data.number,2);
  f.run(f.staff,put('grocery_payments','adv1',{customerId:'cu1',amount:20000,method:'Cash',note:'Advance · order #1',at:now()}));
  let cur=f.run(f.staff,put('meat_orders','o1',{...o,status:'Preparing'},1)).data;
  assert.throws(()=>f.run(f.staff,put('meat_orders','o1',{...cur,status:'Done'},2)),/cannot move/);
  cur=f.run(f.staff,put('meat_orders','o1',{...cur,status:'Ready'},2)).data;
  assert.throws(()=>f.run(f.staff,put('meat_orders','o1',{...cur,status:'Done'},3)),/Bill the order/);
  const bill=f.sale('s1',[{id:'m1',price:5600,qty:3.1,options:['c2']},{id:'w1',price:95000,qty:1},{id:'d1',price:1500,qty:1}],{method:'Credit (account)',received:0,customerId:'cu1'}).data;
  cur=f.run(f.staff,put('meat_orders','o1',{...cur,status:'Out for delivery',saleId:bill.id},3)).data;
  assert.equal(f.run(f.staff,put('meat_orders','o1',{...cur,status:'Done'},4)).data.status,'Done');
  assert.equal(f.sum().credit.cu1,bill.total-20000);
  const o2=f.db.prepare("SELECT data FROM records WHERE kind='meat_orders' AND id='o2'").get();const d2=JSON.parse(o2.data);
  assert.throws(()=>f.run(f.staff,put('meat_orders','o2',{...d2,status:'Cancelled'},1)),/Required/);
  assert.equal(f.run(f.staff,put('meat_orders','o2',{...d2,status:'Cancelled',cancelReason:'Customer called'},1)).data.status,'Cancelled');
 }finally{f.done()}
});
