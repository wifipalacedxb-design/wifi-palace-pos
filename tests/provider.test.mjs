import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../server/server.mjs';
import {bootstrapProvider} from '../server/provider.mjs';
test('provider isolation, onboarding, invitation replay, expiry and suspension',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'provider-test-')),app=await start({file:join(dir,'test.sqlite'),port:0}),base='http://127.0.0.1:'+app.server.address().port;
 const request=async(path,method='GET',data,cookie='',csrf='',origin)=>{const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,...(origin?{Origin:origin}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};};
 try{
 await bootstrapProvider(app.db,{name:'Provider',email:'admin@example.test',password:'provider-test-password'});
 await assert.rejects(()=>bootstrapProvider(app.db,{name:'Other',email:'other@example.test',password:'provider-test-password'}));
 assert.equal((await request('provider/salons')).status,401);
 const admin=await request('provider/login','POST',{email:'admin@example.test',password:'provider-test-password'});assert.equal(admin.status,200);const c=admin.cookie,t=admin.data.csrf;
 const data={name:'Customer One',slug:'customer-one',owner:'Owner',email:'owner@example.test',plan:'Pro',status:'trial',expires:'2099-12-31'};
 assert.equal((await request('provider/salons','POST',data,c)).status,403);
 assert.equal((await request('provider/salons','POST',data,c,t,'https://evil.test')).status,403);
 assert.equal((await request('provider/salons','POST',{...data,expires:'2099-02-31'},c,t)).status,400);
 const created=await request('provider/salons','POST',data,c,t);assert.equal(created.status,201);let token=created.data.activationUrl.split('#')[1];const sid=created.data.id;
 assert.equal((await request('provider/salons','POST',data,c,t)).status,409);
 const replacement=await request('provider/salons/'+sid+'/invite','POST',{},c,t);assert.equal(replacement.status,200);
 assert.equal((await request('activate','POST',{token,password:'customer-test-password'})).status,400);token=replacement.data.activationUrl.split('#')[1];
 const activated=await request('activate','POST',{token,password:'customer-test-password'});assert.equal(activated.status,200);assert.equal(activated.data.salonCode,data.slug);
 assert.equal((await request('activate','POST',{token,password:'changed-test-password'})).status,400);
 const salon=await request('login','POST',{salon:data.slug,email:data.email,password:'customer-test-password'});assert.equal(salon.status,200);
 assert.equal((await request('provider/salons','GET',null,salon.cookie)).status,401);
 assert.equal((await request('state','GET',null,c)).status,401);
 assert.equal((await request('provider/salons/'+sid+'/invite','POST',{},c,t)).status,409);
 const list=await request('provider/salons','GET',null,c);assert.equal(list.data[0].ownerActive,1);assert.equal('password' in list.data[0],false);
 assert.equal((await request('provider/salons/'+sid,'PATCH',{plan:'Pro',status:'suspended',expires:'2099-12-31'},c,t)).status,200);
 assert.equal((await request('state','GET',null,salon.cookie)).status,401);
 assert.equal((await request('login','POST',{salon:data.slug,email:data.email,password:'customer-test-password'})).status,401);
 await request('provider/salons/'+sid,'PATCH',{plan:'Pro',status:'active',expires:'2000-01-01'},c,t);
 // Ended subscription: the owner can still sign in, but only to renew; everything else answers 402.
 const locked=await request('login','POST',{salon:data.slug,email:data.email,password:'customer-test-password'});assert.equal(locked.status,200);assert.equal(locked.data.user.billingLocked,true);
 assert.equal((await request('state','GET',null,locked.cookie)).status,402);assert.equal((await request('billing/status','GET',null,locked.cookie)).data.locked,true);
 await request('provider/salons/'+sid,'PATCH',{plan:'Pro',status:'suspended',expires:'2000-01-01'},c,t);
 assert.equal((await request('login','POST',{salon:data.slug,email:data.email,password:'customer-test-password'})).status,401);
 await request('provider/salons/'+sid,'PATCH',{plan:'Pro',status:'active',expires:'2099-12-31'},c,t);
 assert.equal((await request('login','POST',{salon:data.slug,email:data.email,password:'customer-test-password'})).status,200);
 assert.ok((await request('provider/audit','GET',null,c)).data.some(x=>x.action==='create-salon'));
 await request('provider/logout','POST',{},c,t);assert.equal((await request('provider/me','GET',null,c)).status,401);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
