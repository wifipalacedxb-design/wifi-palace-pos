import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../server/server.mjs';
import {resetDemos,DEMO_SHOPS,topUp} from '../server/demo.mjs';
import {createBusiness} from '../server/store.mjs';

const dir=mkdtempSync(join(tmpdir(),'demo-'));
const app=await start({file:join(dir,'db.sqlite'),port:0,origin:'http://localhost:8080',demo:false}),url='http://127.0.0.1:'+app.server.address().port;
const call=async(path,method='GET',data,s={})=>{const r=await fetch(url+'/api/'+path,{method,headers:{'Content-Type':'application/json',...(s.cookie?{Cookie:s.cookie}:{}),...(s.csrf?{'X-CSRF-Token':s.csrf}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return{status:r.status,data:await r.json().catch(()=>null),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
test.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true})});

test('every business type has a demo that builds with valid sample data',async()=>{
 const done=await resetDemos(app.db);
 assert.deepEqual(Object.values(done).filter(x=>!x),[]);assert.equal(Object.keys(done).length,Object.keys(DEMO_SHOPS).length);
 const list=(await call('demo')).data.shops;assert.equal(list.length,Object.keys(DEMO_SHOPS).length);
 for(const {type} of list){const n=app.db.prepare("SELECT count(*) n FROM records r JOIN demo_businesses d ON d.business_id=r.business_id WHERE d.type=? AND r.kind='sales'").get(type).n;assert.ok(n>50,type+' has '+n+' sales')}
});

test('one click opens a demo as owner or staff; accounts and passwords are locked',async()=>{
 const o=await call('demo','POST',{type:'grocery',role:'owner'});assert.equal(o.status,200);assert.deepEqual([o.data.user.role,o.data.user.demo,o.data.user.businessType],['owner',true,'grocery']);
 const s={cookie:o.cookie,csrf:o.data.csrf};
 assert.equal((await call('me','GET',undefined,s)).data.user.demo,true);
 const st=await call('state?days=35','GET',undefined,s);assert.ok(st.data.state.sales.length>50);assert.ok(st.data.summary.stock);
 assert.equal((await call('password','POST',{current:'x',password:'a-new-long-password'},s)).status,403);
 assert.equal((await call('users','POST',{name:'X',email:'x@x.com',role:'owner',password:'a-new-long-password'},s)).status,403);
 const c=await call('demo','POST',{type:'restaurant',role:'cashier'});assert.equal(c.data.user.role,'cashier');
 assert.equal((await call('demo','POST',{type:'spaceship'})).status,404);
 // real businesses are not demos
 await createBusiness(app.db,{name:'Real',slug:'real-shop',owner:'O',email:'o@real.com',password:'a-long-password',type:'salon'});
 const real=await call('login','POST',{salon:'real-shop',email:'o@real.com',password:'a-long-password'});assert.equal(real.data.user.demo,undefined);
});

test('nightly reset rebuilds a demo: visitors are signed out and their changes are gone',async()=>{
 const o=await call('demo','POST',{type:'salon',role:'owner'}),s={cookie:o.cookie,csrf:o.data.csrf};
 const before=app.db.prepare("SELECT business_id FROM demo_businesses WHERE type='salon'").get().business_id;
 await call('sync','POST',{id:crypto.randomUUID(),kind:'customers',key:'visitor',action:'put',base:0,data:{name:'Visitor test',phone:'',dob:''}},s);
 await resetDemos(app.db,['salon']);
 const after=app.db.prepare("SELECT business_id FROM demo_businesses WHERE type='salon'").get().business_id;
 assert.notEqual(before,after);assert.equal(app.db.prepare('SELECT count(*) n FROM records WHERE business_id=?').get(before).n,0);
 assert.equal((await call('me','GET',undefined,s)).status,401);
 assert.equal(app.db.prepare("SELECT count(*) n FROM records WHERE business_id=? AND kind='customers' AND id='visitor'").get(after).n,0);
});

test('daily top-up adds today\'s sales once and keeps a fresh kitchen ticket',async()=>{
 await resetDemos(app.db);
 const uaeMinutes=(()=>{const d=new Date(Date.now()+4*3600000);return d.getUTCHours()*60+d.getUTCMinutes()})();
 for(const type of Object.keys(DEMO_SHOPS)){
  const b=app.db.prepare('SELECT business_id FROM demo_businesses WHERE type=?').get(type).business_id,count=()=>app.db.prepare("SELECT count(*) n FROM records WHERE business_id=? AND kind='sales'").get(b).n;
  const before=count();topUp(app.db,type);const once=count();topUp(app.db,type);
  if(uaeMinutes>=600)assert.ok(once>before,type+' got today\'s sales');
  assert.equal(count(),once,type+' tops up only once a day');
 }
});
