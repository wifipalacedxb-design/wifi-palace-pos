import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const id=()=>randomUUID();
export const hash=x=>createHash('sha256').update(x).digest('hex');
export async function passwordHash(password){if(typeof password!=='string'||password.length<12||password.length>128)throw Error('Use a password of 12–128 characters.');const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex');}
export async function verify(password,stored){const [salt,key]=stored.split(':');const actual=await scrypt(password,salt,64);return timingSafeEqual(actual,Buffer.from(key,'hex'));}
export function openStore(file){mkdirSync(dirname(file),{recursive:true});const db=new DatabaseSync(file);db.exec(`
PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS salons(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,salon_id TEXT NOT NULL REFERENCES salons(id),email TEXT NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','cashier')),active INTEGER NOT NULL DEFAULT 1,UNIQUE(salon_id,email));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(salon_id TEXT NOT NULL REFERENCES salons(id),kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT,PRIMARY KEY(salon_id,kind,id));
CREATE TABLE IF NOT EXISTS operations(salon_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(salon_id,id));
CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,salon_id TEXT NOT NULL,user_id TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
`);return db;}
export const initial=name=>({version:1,vendor:{logo:''},settings:{name,phone:'',address:'',trn:'',tax:0,logo:''},services:[{id:'s1',name:'Haircut',category:'Hair',price:5000},{id:'s2',name:'Beard trim',category:'Grooming',price:2500},{id:'s3',name:'Hair colour',category:'Hair',price:12000},{id:'s4',name:'Facial',category:'Skin',price:9000}],staff:[{id:'t1',name:'Stylist 1'}],customers:[],appointments:[],sales:[]});
export function seed(db,salon,name){const state=initial(name);for(const [kind,data] of Object.entries(state)){if(kind==='version')continue;for(const item of (Array.isArray(data)?data:[data]))db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').run(salon,kind,item.id||'singleton',1,JSON.stringify(item));}}
export async function createSalon(db,{name,slug,email,owner,password}){if(!/^[a-z0-9-]{3,40}$/.test(slug))throw Error('Salon code must contain 3–40 lowercase letters, numbers or hyphens.');if(!name?.trim()||!owner?.trim()||!/^\S+@\S+\.\S+$/.test(email||''))throw Error('Name, owner and valid email required');const pass=await passwordHash(password),salonId=id(),userId=id();db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO salons VALUES (?,?,?,?,?)').run(salonId,name,slug,1,new Date().toISOString());db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(userId,salonId,email.toLowerCase(),owner,pass,'owner');seed(db,salonId,name);db.exec('COMMIT');return{salonId,userId,slug};}catch(e){db.exec('ROLLBACK');throw e;}}
export function snapshot(db,salon){const state={version:1,services:[],staff:[],customers:[],appointments:[],sales:[]},revisions={};for(const row of db.prepare('SELECT kind,id,version,data FROM records WHERE salon_id=? ORDER BY rowid').all(salon)){revisions[row.kind+':'+row.id]=row.version;if(row.data===null)continue;const data=JSON.parse(row.data);if(Array.isArray(state[row.kind]))state[row.kind].push(data);else state[row.kind]=data;}return {state,revisions,serverTime:new Date().toISOString()};}
export function audit(db,user,action,entity){db.prepare('INSERT INTO audit(salon_id,user_id,action,entity,at) VALUES (?,?,?,?,?)').run(user.salon_id,user.id,action,entity,new Date().toISOString());}
export async function backupTo(db,path){return backup(db,path);}
