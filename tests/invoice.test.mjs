import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,createBusiness} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';

const sale=(extra={})=>({status:'Paid',items:[{id:'s1',qty:1,price:5000}],sub:5000,off:0,tax:0,total:5000,received:5000,method:'Cash',date:new Date().toISOString(),customerId:'',staff:'Stylist 1',...extra});
const put=(kind,key,data,base=0)=>({id:crypto.randomUUID(),kind,key,action:'put',base,data});

test('tax invoices are numbered in sequence per business, with no gaps and stable on replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'inv-')),db=openStore(join(dir,'db.sqlite'));
 try{
  const a=await createBusiness(db,{name:'A',slug:'biz-a',owner:'A',email:'a@test.com',password:'a-long-password'});
  const b=await createBusiness(db,{name:'B',slug:'biz-b',owner:'B',email:'b@test.com',password:'a-long-password'});
  const ua={id:a.userId,business_id:a.businessId,business_type:'salon',role:'owner'},ub={id:b.userId,business_id:b.businessId,business_type:'salon',role:'owner'};
  // Without a TRN the document is a plain receipt; with a TRN it is a tax invoice.
  const first=operation(db,ua,put('sales','x1',sale()));
  assert.equal(first.data.number,'INV-000001');assert.equal(first.data.documentType,'Receipt');assert.match(first.data.receiptRef,/^SD-/);
  operation(db,ua,put('settings','singleton',{name:'A',phone:'',address:'Dubai',trn:'100000000000003',tax:5,logo:''},1));
  // A rejected bill (wrong totals) must not use up a number.
  assert.throws(()=>operation(db,ua,put('sales','bad',sale({tax:0,total:5000}))),{status:409});
  const second=operation(db,ua,put('sales','x2',sale({tax:250,total:5250,received:5250})));
  assert.equal(second.data.number,'INV-000002');assert.equal(second.data.documentType,'Tax invoice');assert.equal(second.data.shop.trn,'100000000000003');
  // Replaying the same upload returns the same number.
  const op=put('sales','x3',sale({tax:250,total:5250,received:5250}));
  assert.equal(operation(db,ua,op).data.number,'INV-000003');assert.equal(operation(db,ua,op).data.number,'INV-000003');
  // Each business has its own sequence.
  assert.equal(operation(db,ub,put('sales','y1',sale())).data.number,'INV-000001');
  // Refunds get their own credit note sequence and keep the invoice number.
  const refund=operation(db,ua,{...put('sales','x2',{...second.data,status:'Refunded',refundReason:'Customer request'},1)});
  assert.equal(refund.data.creditNote,'CN-000001');assert.equal(refund.data.number,'INV-000002');
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
