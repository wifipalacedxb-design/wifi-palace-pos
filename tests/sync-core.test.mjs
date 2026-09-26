import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const c=vm.createContext({});vm.runInContext(readFileSync(new URL('../web/sync-core.js',import.meta.url),'utf8'),c);const S=c.SyncCore;
const base=()=>({settings:{name:'A'},vendor:{logo:''},staff:[],customers:[],sales:[],services:[],appointments:[]});
test('sync uploads people and catalogue before appointments and sales, for any module',()=>{
 const before=base(),after=base();after.sales.push({id:'x'});after.appointments.push({id:'a'});after.customers.push({id:'c'});after.services.push({id:'s'});after.widgets=[{id:'w'}];after.settings.name='B';
 let n=0;const ops=S.diff(before,after,{revisions:{},pending:[]},()=>'op'+n++);
 assert.deepEqual(JSON.parse(JSON.stringify(ops.map(o=>o.kind+':'+o.key+':'+o.action))),['settings:singleton:put','customers:c:put','services:s:put','appointments:a:put','widgets:w:put','sales:x:put']);
});
test('a record type missing on one side is a list, not a singleton',()=>{
 const before=base(),after=base();before.widgets=[{id:'w1'}];delete after.widgets;
 const ops=S.diff(before,after,{revisions:{'widgets:w1':3},pending:[]},()=>'op');
 assert.deepEqual(JSON.parse(JSON.stringify(ops.map(o=>[o.kind,o.key,o.action,o.base]))),[['widgets','w1','delete',3]]);
});
