import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {openStore,createSalon,snapshot} from '../server/store.mjs';
import {operation} from '../server/rules.mjs';
const source=readFileSync(new URL('../web/whatsapp.js',import.meta.url),'utf8');
test('DOB validates calendar dates and preserves data from older clients',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'birthday-')),db=openStore(join(dir,'db'));
 try{
 const a=await createSalon(db,{name:'A',slug:'salon-a',owner:'A',email:'a@test.com',password:'a-long-password'}),u={id:a.userId,business_id:a.salonId,role:'owner'};
 const put=(data,base=0)=>operation(db,u,{id:randomUUID(),kind:'customers',key:'c',action:'put',base,data:{id:'c',name:'Client',phone:'0501234567',...data}});
 for(const dob of ['2001-02-29','2000-02-30','9999-01-01','1899-12-31','not a date',123])assert.throws(()=>put({dob}));
 put({dob:'2000-02-29'});assert.equal(snapshot(db,a.salonId).state.customers[0].dob,'2000-02-29');
 put({name:'Edited by old client'},1);assert.equal(snapshot(db,a.salonId).state.customers[0].dob,'2000-02-29');
 put({dob:''},2);assert.equal(snapshot(db,a.salonId).state.customers[0].dob,'');
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});
test('birthday matching uses UAE midnight and leap day, not birth year',()=>{
 const c=vm.createContext({});vm.runInContext(source,c);
 assert.equal(c.birthdayToday(new Date('2026-12-31T19:59:59Z')),'2026-12-31');
 assert.equal(c.birthdayToday(new Date('2026-12-31T20:00:00Z')),'2027-01-01');
 c.birthdayToday=()=> '2028-02-29';assert.equal(c.isBirthdayToday({dob:'2000-02-29'}),true);
 c.birthdayToday=()=> '2027-02-28';assert.equal(c.isBirthdayToday({dob:'2000-02-29'}),false);
 assert.equal(c.isBirthdayToday({}),false);assert.equal(c.isBirthdayToday({dob:123}),false);
});
test('birthday preview prepares editable 10% message without sending or changing customer',()=>{
 const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',value:''});return nodes.get(id)};
 const db={customers:[{id:'c',name:'Sam',dob:'2000-09-24',phone:'0501234567'}],settings:{name:'My Salon',phone:'0502222222'}};let html='';
 const c=vm.createContext({db,$,modal:s=>html=s,esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});vm.runInContext(source,c);c.birthdayToday=()=> '2026-09-24';const before=JSON.stringify(db);
 c.birthdayWhatsApp('c');assert.ok(html.includes('0501234567'));assert.ok(html.includes('10%'));assert.ok(html.includes('Happy Birthday, Sam'));assert.ok(!html.includes('2000'));
 $('birthdayMessage').value=c.birthdayMessage(db.customers[0],db.settings);$('birthdayPhone').value='bad';$('birthdayForm').onsubmit({preventDefault(){}});assert.ok($('birthdayError').textContent);assert.equal($('birthdayLink').innerHTML,'');
 $('birthdayPhone').value='0501234567';$('birthdayForm').onsubmit({preventDefault(){}});assert.ok($('birthdayLink').innerHTML.includes('https://wa.me/971501234567'));assert.ok($('birthdayLink').innerHTML.includes(encodeURIComponent('10%')));
 $('birthdayMessage').oninput();assert.equal($('birthdayLink').innerHTML,'');assert.equal(JSON.stringify(db),before);
 c.birthdayToday=()=> '2026-09-25';$('birthdayForm').onsubmit({preventDefault(){}});assert.ok($('birthdayError').textContent.includes('only available'));assert.equal($('birthdayLink').innerHTML,'');
});
