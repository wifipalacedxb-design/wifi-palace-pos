import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server/server.mjs';
import {createSalon} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
test('services marked "price can change" accept the checkout price; others stay fixed',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'salon-open-price-'));
 const app=await start({file:join(dir,'db.sqlite'),port:0,mailer:null});
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true})});
 const a=await createSalon(app.db,{name:'Open Price',slug:'open-price',owner:'Owner',email:'o@test.com',password:'test-password-123'});
 const owner={id:a.userId,business_id:a.salonId,business_type:'salon',role:'owner'},cashier={...owner,id:'cashier',role:'cashier'};
 const put=(u,kind,key,data,base=0)=>operation(app.db,u,{id:randomUUID(),kind,key,action:'put',base,data});
 const sale=items=>{const sub=items.reduce((n,i)=>n+i.price*i.qty,0);return{date:new Date().toISOString(),items,sub,off:0,tax:0,total:sub,received:sub,customerId:'',staff:'Stylist 1',method:'Cash',status:'Paid'}};
 assert.equal(put(owner,'services','addon',{name:'Add-on',category:'Extras',price:1000,openPrice:true}).data.openPrice,true);
 assert.equal(put(owner,'services','cut',{name:'Cut',category:'Hair',price:5000,openPrice:'yes'}).data.openPrice,false); // only a real true enables it
 assert.throws(()=>put(cashier,'services','addon2',{name:'X',category:'Y',price:1,openPrice:true}),/Owner/);
 // Two add-ons at different prices on one bill, plus a fixed-price haircut.
 const s=put(cashier,'sales','s1',sale([{id:'addon',price:2500,qty:1},{id:'addon',price:0,qty:1},{id:'cut',price:5000,qty:1}])).data;
 assert.deepEqual(s.items.map(i=>[i.name,i.price,i.listPrice]),[['Add-on',2500,1000],['Add-on',0,1000],['Cut',5000,undefined]]);
 assert.equal(s.total,7500);
 assert.throws(()=>put(cashier,'sales','s2',sale([{id:'cut',price:4000,qty:1}])),/price changed/);
 assert.throws(()=>put(cashier,'sales','s3',sale([{id:'addon',price:-100,qty:1}])),/price changed|Invalid/);
 assert.throws(()=>put(cashier,'sales','s4',sale([{id:'addon',price:10000001,qty:1}])),/price changed|Invalid/);
 assert.throws(()=>put(cashier,'sales','s5',sale([{id:'addon',price:12.5,qty:1}])),/price changed|Invalid/);
});
