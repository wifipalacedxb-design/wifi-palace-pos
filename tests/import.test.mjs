import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';import {importSalonDesk} from '../server/import-salon-desk.mjs';import {openStore,createBusiness} from '../server/store.mjs';
// A minimal Salon Desk database (same table layout as wifipalace.in).
function salonDesk(file){const db=new DatabaseSync(file);db.exec(`CREATE TABLE salons(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
CREATE TABLE users(id TEXT PRIMARY KEY,salon_id TEXT NOT NULL,email TEXT NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE records(salon_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT,PRIMARY KEY(salon_id,kind,id));
CREATE TABLE operations(salon_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(salon_id,id));
CREATE TABLE audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,salon_id TEXT NOT NULL,user_id TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE subscriptions(salon_id TEXT PRIMARY KEY,plan TEXT NOT NULL,status TEXT NOT NULL,expires TEXT NOT NULL);
CREATE TABLE salon_expenses(salon_id TEXT NOT NULL,id TEXT NOT NULL,date TEXT NOT NULL,amount INTEGER NOT NULL,method TEXT NOT NULL,category TEXT NOT NULL,note TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,voided_at TEXT,void_reason TEXT,PRIMARY KEY(salon_id,id));
CREATE TABLE salon_closings(salon_id TEXT NOT NULL,date TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(salon_id,date));
CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
INSERT INTO salons VALUES ('sal-1','Lavender','lavender',1,'2026-09-01T00:00:00Z');
INSERT INTO users VALUES ('u-1','sal-1','o@lav.ae','Owner','salt:hash',  'owner',1),('u-2','sal-1','c@lav.ae','Cashier','salt:hash2','cashier',0);
INSERT INTO records VALUES ('sal-1','sales','s1',1,'{"id":"s1","total":5000}'),('sal-1','customers','c1',2,'{"id":"c1","name":"M"}'),('sal-1','services','x',3,NULL);
INSERT INTO operations VALUES ('sal-1','u-1','op-1','d','{}');INSERT INTO audit(salon_id,user_id,action,entity,at) VALUES ('sal-1','u-1','put:sales','s1','2026-09-02');
INSERT INTO subscriptions VALUES ('sal-1','Professional','active','2027-01-01');
INSERT INTO salon_expenses VALUES ('sal-1','e1','2026-09-02',1000,'Cash','Supplies','Towels','u-1','2026-09-02',NULL,NULL);
INSERT INTO salon_closings VALUES ('sal-1','2026-09-02','{"counted":1}');
INSERT INTO sessions VALUES ('t','u-1','x',9999999999999);`);db.close()}
test('Salon Desk import: dry run, copy with logins and history, skip repeats and code clashes, source untouched',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'import-')),from=join(dir,'salon.sqlite'),to=join(dir,'pos.sqlite');try{
  salonDesk(from);const hash=()=>createHash('sha256').update(readFileSync(from)).digest('hex'),before=hash();
  const pos=openStore(to);await createBusiness(pos,{name:'Gym',slug:'gym',owner:'G',email:'g@t.com',password:'long-password-123',type:'gym'});pos.close();
  const dry=importSalonDesk({from,to});assert.equal(dry.salons[0].action,'would copy');assert.deepEqual(dry.salons[0].records,{sales:1,customers:1});
  const done=importSalonDesk({from,to,apply:true});assert.equal(done.salons[0].action,'COPIED');assert.equal(done.integrity,'ok');
  const db=new DatabaseSync(to);
  assert.deepEqual({...db.prepare("SELECT slug,type FROM businesses WHERE id='sal-1'").get()},{slug:'lavender',type:'salon'});
  assert.deepEqual(db.prepare("SELECT email,password,role,active FROM users WHERE business_id='sal-1' ORDER BY email").all().map(u=>({...u})),[{email:'c@lav.ae',password:'salt:hash2',role:'cashier',active:0},{email:'o@lav.ae',password:'salt:hash',role:'owner',active:1}]);
  assert.equal(db.prepare("SELECT count(*) n FROM records WHERE business_id='sal-1'").get().n,3);
  assert.equal(db.prepare("SELECT count(*) n FROM sessions").get().n,0); // everyone signs in again
  assert.deepEqual({...db.prepare("SELECT status,expires FROM subscriptions WHERE business_id='sal-1'").get()},{status:'active',expires:'2027-01-01'});
  assert.equal(db.prepare("SELECT count(*) n FROM expenses WHERE business_id='sal-1'").get().n,1);assert.equal(db.prepare("SELECT count(*) n FROM day_closings WHERE business_id='sal-1'").get().n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM operations WHERE business_id='sal-1'").get().n,1);assert.equal(db.prepare("SELECT count(*) n FROM businesses WHERE slug='gym'").get().n,1);db.close();
  assert.match(importSalonDesk({from,to,apply:true}).problems[0],/already copied/);
  assert.equal(importSalonDesk({from,to,apply:true,replace:true}).salons[0].action,'REFRESHED');
  const other=join(dir,'other.sqlite'),o=openStore(other);await createBusiness(o,{name:'X',slug:'lavender',owner:'X',email:'x@t.com',password:'long-password-123'});o.close();
  assert.match(importSalonDesk({from,to:other,apply:true,replace:true}).problems[0],/already used by another business/);
  assert.equal(hash(),before);
  assert.throws(()=>importSalonDesk({from:join(dir,'missing.sqlite'),to}),/not found/);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
