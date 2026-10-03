import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server/server.mjs';
import {createSalon} from '../server/store.mjs';
const dir=mkdtempSync(join(tmpdir(),'pos-staff-')),app=await start({file:join(dir,'db.sqlite'),port:0}),base='http://127.0.0.1:'+app.server.address().port;
await createSalon(app.db,{name:'Bistro',slug:'bistro',owner:'Owner',email:'o@test.test',password:'test-password-123',type:'restaurant'});
await createSalon(app.db,{name:'Other',slug:'other',owner:'Owner',email:'x@test.test',password:'test-password-123',type:'restaurant'});
await createSalon(app.db,{name:'Salon',slug:'salon',owner:'Owner',email:'s@test.test',password:'test-password-123'});
async function req(path,method='GET',data,s={}){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie||'','X-CSRF-Token':s.csrf||''},...(data!==undefined?{body:JSON.stringify(data)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
async function login(slug,email){const r=await req('login','POST',{salon:slug,email,password:'test-password-123'});assert.equal(r.status,200);return{cookie:r.cookie,csrf:r.data.csrf,user:r.data.user}}
const op=(kind,key,data,base=0)=>({id:randomUUID(),kind,key,data,base,action:'put'});
const owner=await login('bistro','o@test.test'),other=await login('other','x@test.test'),salon=await login('salon','s@test.test');
try{
let waiterId,cashierId;
await test('owner creates a PIN-only waiter and a cashier with a PIN; rules are checked',async()=>{
 assert.equal((await req('users','POST',{name:'Ali',role:'waiter',pin:'12'},owner)).status,400);
 assert.equal((await req('users','POST',{name:'Ali',role:'waiter'},owner)).status,400);
 assert.equal((await req('users','POST',{name:'W',role:'waiter',pin:'1234'},salon)).status,400);
 assert.equal((await req('users','POST',{name:'Boss',role:'owner',email:'b@test.test',password:'test-password-123',pin:'1234'},owner)).status,400);
 const w=await req('users','POST',{name:'Ali',role:'waiter',pin:'4321'},owner);assert.equal(w.status,201);waiterId=w.data.id;
 const c=await req('users','POST',{name:'Sara',role:'cashier',email:'sara@test.test',password:'test-password-123',pin:'1111'},owner);assert.equal(c.status,201);cashierId=c.data.id;
 const list=(await req('users','GET',undefined,owner)).data;assert.equal(list.find(x=>x.id===waiterId).role,'waiter');assert.equal(list.find(x=>x.id===waiterId).hasPin,true);assert.equal(JSON.stringify(list).includes('4321'),false);
 assert.deepEqual((await req('pin-users','GET',undefined,owner)).data.map(x=>x.name+':'+x.role),['Ali:waiter','Sara:cashier']);
 assert.equal((await req('pin-users')).status,401);
});
let waiter;
await test('PIN switch needs a signed-in device of the same business, the right PIN, and locks after 5 wrong tries',async()=>{
 assert.equal((await req('pin-login','POST',{userId:waiterId,pin:'4321'})).status,401);
 assert.equal((await req('pin-login','POST',{userId:waiterId,pin:'4321'},other)).status,401);
 assert.equal((await req('pin-login','POST',{userId:waiterId,pin:'0000'},owner)).status,401);
 const r=await req('pin-login','POST',{userId:waiterId,pin:'4321'},owner);assert.equal(r.status,200);assert.equal(r.data.user.waiter,true);assert.equal(r.data.user.role,'cashier');
 waiter={cookie:r.cookie,csrf:r.data.csrf};
 assert.equal((await req('me','GET',undefined,owner)).status,401,'the previous session on that device ended');
 assert.equal((await req('me','GET',undefined,waiter)).data.user.name,'Ali');
 const o2=await login('bistro','o@test.test');Object.assign(owner,o2);
 for(let i=0;i<5;i++)assert.equal((await req('pin-login','POST',{userId:cashierId,pin:'9999'},owner)).status,401);
 assert.equal((await req('pin-login','POST',{userId:cashierId,pin:'1111'},owner)).status,429);
 assert.equal((await req('users/'+cashierId,'PATCH',{pin:'2222'},owner)).status,200); // owner resets the PIN and the lock
 assert.equal((await req('pin-login','POST',{userId:cashierId,pin:'2222'},owner)).status,200);
 Object.assign(owner,await login('bistro','o@test.test'));
});
await test('a waiter takes orders and sends tickets, but cannot bill, void, close or reach owner screens',async()=>{
 const state=(await req('state','GET',undefined,waiter)).data.state,table=state.restaurant_tables[0],item=state.restaurant_items.find(i=>!i.system);
 assert.equal((await req('sync','POST',op('restaurant_orders','ord1',{type:'dine-in',status:'open',tableId:table.id,guests:2}),waiter)).status,200);
 const kot={orderId:'ord1',items:[{key:'l1',itemId:item.id,qty:2,options:[]}],at:new Date().toISOString(),byName:'Ali'};
 assert.equal((await req('sync','POST',op('restaurant_kots','kot1',kot),waiter)).status,200);
 assert.equal((await req('sync','POST',op('restaurant_kots','kot2',{...kot,type:'void',reason:'x',items:[{key:'l2',itemId:item.id,qty:-1,options:[]}]}),waiter)).status,403);
 assert.equal((await req('sync','POST',op('restaurant_orders','ord1',{status:'closed'},1),waiter)).status,403);
 assert.equal((await req('sync','POST',op('restaurant_orders','ord1',{status:'cancelled',cancelReason:'x'},1),waiter)).status,403);
 assert.equal((await req('sync','POST',op('sales','sale1',{status:'Paid',items:[],sub:0,off:0,tax:0,total:0,method:'Cash'}),waiter)).status,403);
 assert.equal((await req('sync','POST',op('restaurant_items','hack',{name:'Free'}),waiter)).status,403);
 assert.equal((await req('users','GET',undefined,waiter)).status,403);assert.equal((await req('finance/report','GET',undefined,waiter)).status,403);
 assert.equal((await req('users','POST',{name:'Z',role:'waiter',pin:'5555'},waiter)).status,403);
 // The owner still can void.
 assert.equal((await req('sync','POST',op('restaurant_kots','kot3',{...kot,type:'void',reason:'Wrong dish',items:[{key:'l3',itemId:item.id,qty:-1,options:[]}]}),owner)).status,200);
});
await test('removing the PIN or disabling the login stops PIN switching',async()=>{
 assert.equal((await req('users/'+waiterId,'PATCH',{pin:''},owner)).status,200);
 assert.equal((await req('pin-login','POST',{userId:waiterId,pin:'4321'},owner)).status,401);
 assert.equal((await req('users/'+waiterId,'PATCH',{pin:'4321',active:false},owner)).status,200);
 assert.equal((await req('me','GET',undefined,waiter)).status,401);
 assert.equal((await req('pin-login','POST',{userId:waiterId,pin:'4321'},owner)).status,401);
});
}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
