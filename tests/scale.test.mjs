import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,createBusiness,snapshot} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
const put=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});
async function setup(){const dir=mkdtempSync(join(tmpdir(),'scale-')),db=openStore(join(dir,'db.sqlite'));const r=await createBusiness(db,{name:'Baqala',slug:'baq',owner:'O',email:'o@t.com',password:'a-long-password',type:'grocery'});
 const u={id:r.userId,business_id:r.businessId,business_type:'grocery',role:'owner'};return{db,r,u,run:op=>operation(db,u,op),done:()=>{db.close();rmSync(dir,{recursive:true,force:true})}}}
test('scale settings and product scale codes are validated',async()=>{const f=await setup();try{
 assert.deepEqual(snapshot(f.db,f.r.businessId).state.grocery_config[0].scale,{prefix:'21',codeDigits:5,value:'weight'});
 assert.throws(()=>f.run(put('grocery_config','config',{scale:{prefix:'12',codeDigits:5,value:'weight'}},1)),/prefix/);
 assert.throws(()=>f.run(put('grocery_config','config',{scale:{prefix:'22',codeDigits:7,value:'weight'}},1)),/length/);
 assert.equal(f.run(put('grocery_config','config',{scale:{prefix:'2',codeDigits:6,value:'price'}},1)).data.scale.prefix,'2');
 const base={name:'Tomatoes',barcode:'',category:'Fruits & vegetables',unit:'kg',price:450,cost:0,minStock:0};
 assert.equal(f.run(put('grocery_items','p5',{...base,plu:'00012'},1)).data.plu,'12');
 assert.throws(()=>f.run(put('grocery_items','x',{...base,name:'Onion',plu:'12'})),/already used by Tomatoes/);
 assert.throws(()=>f.run(put('grocery_items','y',{...base,name:'Milk',unit:'piece',plu:'13'})),/sold by weight/);
 assert.throws(()=>f.run(put('grocery_items','z',{...base,name:'Onion',plu:'12a'})),/1 to 6 digits/);
}finally{f.done()}});
test('weighed sales accept gram weights from labels',async()=>{const f=await setup();try{
 const sale=(qty)=>{const sub=Math.round(450*qty);return put('sales',crypto.randomUUID(),{status:'Paid',items:[{id:'p5',price:450,qty}],sub,off:0,tax:0,total:sub,method:'Cash',received:sub,date:new Date().toISOString(),customerId:'',staff:'O'})};
 for(const q of [1.005,0.285,0.013,2.347])assert.equal(f.run(sale(q)).data.items[0].qty,q);
 assert.throws(()=>f.run(sale(1.0005)),/Invalid quantity/);
}finally{f.done()}});
