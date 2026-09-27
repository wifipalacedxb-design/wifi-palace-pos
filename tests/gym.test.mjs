import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,createBusiness,snapshot,passwordHash} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
import {staffReport} from '../server/finance.mjs';
import {addDays} from '../server/modules/gym.mjs';

const put=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});
const uae=(t=Date.now())=>new Date(t+4*3600000).toISOString().slice(0,10);
const sale=(id,items,extra={})=>{const sub=items.reduce((n,i)=>n+i.price*i.qty,0);return{status:'Paid',items,sub,off:0,tax:0,total:sub,method:'Cash',received:sub,date:new Date().toISOString(),customerId:'m1',staff:'Desk',...extra}};
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'gym-')),db=openStore(join(dir,'db.sqlite'));
 const g=await createBusiness(db,{name:'Iron House Gym',slug:'iron-house',owner:'Owner',email:'o@test.com',password:'a-long-password',type:'gym'});
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('desk',g.businessId,'d@test.com','Front Desk',await passwordHash('a-long-password'),'cashier');
 const owner={id:g.userId,business_id:g.businessId,business_type:'gym',role:'owner',name:'Owner'},desk={...owner,id:'desk',role:'cashier',name:'Front Desk'};
 const run=(u,op)=>operation(db,u,op);
 run(desk,put('customers','m1',{name:'Sara',phone:'0501234567'}));
 run(desk,put('customers','m2',{name:'Omar',phone:'0507654321'}));
 return{db,g,owner,desk,run,done:()=>{db.close();rmSync(dir,{recursive:true,force:true})}};
}

test('gym seed, price list rules and owner-only catalogue',async()=>{
 const f=await setup();try{
  const s=snapshot(f.db,f.g.businessId).state;
  assert.equal(s.type,'gym');assert.equal(s.gym_items.length,10);assert.deepEqual([s.gym_memberships,s.gym_checkins,s.gym_pt],[[],[],[]]);
  assert.throws(()=>f.run(f.desk,put('gym_items','x',{name:'Promo',type:'plan',days:30,price:100})),/Owner permission/);
  assert.throws(()=>f.run(f.owner,put('gym_items','x',{name:'Bad',type:'plan',days:0,price:100})),/Days/);
  assert.throws(()=>f.run(f.owner,put('gym_items','x',{name:'Bad',type:'class',price:100})),/plan, personal training or product/);
  const r=f.run(f.owner,put('gym_items','x',{name:'Student monthly',type:'plan',days:30,price:18000,sessions:99}));assert.deepEqual(r.data,{id:'x',name:'Student monthly',type:'plan',price:18000,days:30});
  assert.throws(()=>f.run(f.owner,put('gym_items','x',{name:'Student monthly',type:'product',price:18000},1)),/cannot change type/);
 }finally{f.done()}
});

test('memberships come from a paid sale, one per sale line, and freeze extends the end date',async()=>{
 const f=await setup();try{
  const today=uae();
  // Membership before payment is refused for staff; the sale must sync first.
  assert.throws(()=>f.run(f.desk,put('gym_memberships','ms1',{customerId:'m1',planId:'g2',start:today,status:'Active',saleId:''})),/Take payment/);
  assert.throws(()=>f.run(f.desk,put('gym_memberships','ms1',{customerId:'m1',planId:'g2',start:today,status:'Active',saleId:'s1'})),/must sync first/);
  f.run(f.desk,put('sales','s1',sale('s1',[{id:'g2',price:25000,qty:1},{id:'g8',price:300,qty:2}])));
  assert.throws(()=>f.run(f.desk,put('gym_memberships','ms1',{customerId:'m2',planId:'g2',start:today,status:'Active',saleId:'s1'})),/different member/);
  assert.throws(()=>f.run(f.desk,put('gym_memberships','ms1',{customerId:'m1',planId:'g3',start:today,status:'Active',saleId:'s1'})),/does not include/);
  const m=f.run(f.desk,put('gym_memberships','ms1',{customerId:'m1',planId:'g2',start:addDays(today,-5),status:'Active',saleId:'s1',end:'2099-01-01'})).data;
  assert.equal(m.end,addDays(today,24));assert.equal(m.plan,'Monthly membership');assert.equal(m.customer,'Sara');assert.equal(m.complimentary,false);
  assert.throws(()=>f.run(f.desk,put('gym_memberships','ms2',{customerId:'m1',planId:'g2',start:today,status:'Active',saleId:'s1'})),/already been used/);
  assert.throws(()=>f.run(f.desk,put('gym_memberships','ms2',{customerId:'m1',planId:'g2',start:addDays(today,-40),status:'Active',saleId:'s1'})),/Start date/);
  // Owner can give a complimentary membership.
  assert.equal(f.run(f.owner,put('gym_memberships','comp',{customerId:'m2',planId:'g1',start:today,status:'Active'})).data.complimentary,true);
  // Freezing before the membership started is refused. Freeze from 2 days ago, unfreeze today → +2 days.
  assert.throws(()=>f.run(f.owner,put('gym_memberships','comp',{status:'Frozen',frozenFrom:addDays(today,-1),freezeReason:'x'},1)),/running membership/);
  const frozen=f.run(f.desk,put('gym_memberships','ms1',{...m,status:'Frozen',frozenFrom:addDays(today,-2),freezeReason:'Travel'},1)).data;
  assert.equal(frozen.status,'Frozen');assert.equal(frozen.end,m.end);
  assert.throws(()=>f.run(f.desk,put('gym_memberships','ms1',{...frozen,status:'Active',unfrozenOn:addDays(today,1)},2)),/unfreeze date/);
  const back=f.run(f.desk,put('gym_memberships','ms1',{...frozen,status:'Active',unfrozenOn:today,end:'2099-01-01'},2)).data;
  assert.equal(back.end,addDays(m.end,2));assert.equal(back.freezes.length,1);assert.equal(back.freezes[0].days,2);assert.equal(back.frozenFrom,undefined);
  assert.throws(()=>f.run(f.desk,put('gym_memberships','ms1',{...back,status:'Cancelled',cancelReason:'x'},3)),/Only the owner/);
  assert.equal(f.run(f.owner,put('gym_memberships','ms1',{...back,status:'Cancelled',cancelReason:'Refunded'},3)).data.status,'Cancelled');
  // A refunded sale cannot create memberships.
  f.run(f.desk,put('sales','s2',sale('s2',[{id:'g2',price:25000,qty:2}])));
  f.run(f.owner,put('sales','s2',{status:'Refunded',refundReason:'Mistake'},1));
  assert.throws(()=>f.run(f.desk,put('gym_memberships','ms3',{customerId:'m1',planId:'g2',start:today,status:'Active',saleId:'s2'})),/refunded/);
 }finally{f.done()}
});

test('check-ins and PT sessions: append-only, limited, credited to trainers in reports',async()=>{
 const f=await setup();try{
  f.run(f.desk,put('sales','s1',sale('s1',[{id:'g7',price:150000,qty:1}],{staffId:'t1',commissionBps:0})));
  assert.throws(()=>f.run(f.desk,put('gym_pt','p1',{customerId:'m1',itemId:'g7',trainerId:'nobody',status:'Active',saleId:'s1'})),/Trainer/);
  const p=f.run(f.desk,put('gym_pt','p1',{customerId:'m1',itemId:'g7',trainerId:'t1',status:'Active',saleId:'s1'})).data;
  assert.equal(p.sessions,10);assert.equal(p.expires,addDays(uae(),89));assert.deepEqual(p.used,[]);
  const s1={at:new Date().toISOString(),trainerId:'t1',note:'Legs'};
  const p2=f.run(f.desk,put('gym_pt','p1',{...p,used:[s1]},1)).data;assert.equal(p2.used.length,1);assert.equal(p2.used[0].trainer,'Trainer 1');assert.equal(p2.used[0].by,'desk');
  assert.throws(()=>f.run(f.desk,put('gym_pt','p1',{...p2,used:[s1,s1,s1]},2)),/one session at a time/);
  assert.throws(()=>f.run(f.desk,put('gym_pt','p1',{...p2,used:[{...p2.used[0],note:'changed'},s1]},2)),/one session at a time/);
  assert.throws(()=>f.run(f.desk,put('gym_pt','p1',{...p2,used:[...p2.used,{at:'2020-01-01T00:00:00Z'}]},2)),/session time/);
  // Check-ins
  const c=f.run(f.desk,put('gym_checkins','c1',{customerId:'m1',ptId:'p1',at:new Date().toISOString()})).data;assert.equal(c.customer,'Sara');assert.equal(c.by,'desk');
  assert.throws(()=>f.run(f.desk,put('gym_checkins','c1',{customerId:'m1',at:new Date().toISOString()},1)),/cannot be changed/);
  assert.throws(()=>f.run(f.desk,put('gym_checkins','c2',{customerId:'ghost',at:new Date().toISOString()})),/must sync/);
  assert.throws(()=>f.run(f.desk,put('gym_checkins','c2',{customerId:'m2',ptId:'p1',at:new Date().toISOString()})),/not found for this member/);
  // Reports: the PT sale is credited to Trainer 1 and the session counted.
  const r=staffReport(f.db,f.g.businessId,uae(),uae());const t=r.staff.find(x=>x.id==='id:t1');
  assert.equal(t.bills,1);assert.equal(t.sessions,1);assert.equal(r.totals.sessions,1);assert.equal(t.net,150000);
 }finally{f.done()}
});
