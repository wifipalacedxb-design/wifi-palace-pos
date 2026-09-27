import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,createBusiness,snapshot} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
import {MODULES,BUSINESS_TYPES,checkBusinessType,kindsFor} from '../server/modules.mjs';
import {fail,required} from '../server/check.mjs';

const fresh=()=>{const dir=mkdtempSync(join(tmpdir(),'mod-'));return{dir,db:openStore(join(dir,'db.sqlite'))}};
const op=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});

test('salon is the default business type and keeps its seed data',async()=>{
 const {dir,db}=fresh();
 try{
  const b=await createBusiness(db,{name:'A',slug:'biz-a',owner:'A',email:'a@test.com',password:'a-long-password'});
  assert.equal(b.type,'salon');
  assert.equal(db.prepare('SELECT type FROM businesses WHERE id=?').get(b.businessId).type,'salon');
  const s=snapshot(db,b.businessId).state;
  assert.equal(s.type,'salon');
  assert.equal(s.services.length,4);
  assert.deepEqual(s.appointments,[]);
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});

test('unknown business types are refused',async()=>{
 assert.deepEqual(BUSINESS_TYPES,['salon','laundry','gym','grocery']);
 assert.equal(checkBusinessType(undefined),'salon');
 for(const t of ['restaurant-x','','__proto__','constructor',42])if(t!=='')assert.throws(()=>checkBusinessType(t));
 const {dir,db}=fresh();
 try{await assert.rejects(createBusiness(db,{name:'A',slug:'biz-a',owner:'A',email:'a@test.com',password:'a-long-password',type:'spaceship'}))}
 finally{db.close();rmSync(dir,{recursive:true,force:true})}
});

test('a business only accepts record kinds from the core and its own module',async()=>{
 // Register a throwaway module to prove salon records are rejected for other types.
 MODULES.testshop={type:'testshop',label:'Test shop',catalogKind:'widgets',kinds:['widgets'],ownerKinds:['widgets'],deletable:['widgets'],
  seed:()=>({widgets:[{id:'w1',name:'Widget',price:1000}]}),
  validate({kind,key,data}){if(kind==='widgets')return{id:key,name:required(data.name,100),price:data.price};fail('Unknown record type')}};
 const {dir,db}=fresh();
 try{
  assert.deepEqual(kindsFor('testshop'),['settings','vendor','staff','customers','sales','widgets']);
  const t=await createBusiness(db,{name:'T',slug:'test-shop',owner:'T',email:'t@test.com',password:'a-long-password',type:'testshop'});
  const owner={id:t.userId,business_id:t.businessId,business_type:'testshop',role:'owner'};
  const s=snapshot(db,t.businessId).state;
  assert.equal(s.type,'testshop');assert.equal(s.widgets.length,1);assert.equal(s.services,undefined);
  assert.throws(()=>operation(db,owner,op('services','x1',{name:'Haircut',category:'Hair',price:5000})),{status:400});
  assert.throws(()=>operation(db,owner,op('appointments','x2',{})),{status:400});
  assert.equal(operation(db,owner,op('widgets','w2',{name:'Gadget',price:500})).version,1);
  assert.equal(operation(db,owner,op('customers','c1',{name:'Customer',phone:''})).version,1);
  // A salon in the same database still works and cannot write the other module's kinds.
  const a=await createBusiness(db,{name:'A',slug:'biz-a',owner:'A',email:'a@test.com',password:'a-long-password'});
  const salonOwner={id:a.userId,business_id:a.businessId,business_type:'salon',role:'owner'};
  assert.throws(()=>operation(db,salonOwner,op('widgets','w3',{name:'Gadget',price:500})),{status:400});
  assert.equal(operation(db,salonOwner,op('services','s9',{name:'Manicure',category:'Nails',price:4000})).version,1);
  // Data stays separated per business.
  assert.equal(snapshot(db,a.businessId).state.widgets,undefined);
 }finally{delete MODULES.testshop;db.close();rmSync(dir,{recursive:true,force:true})}
});
