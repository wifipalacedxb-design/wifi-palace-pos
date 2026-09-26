import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {businessModule,checkBusinessType,kindsFor} from './modules.mjs';
const scrypt=promisify(scryptCallback);
export const id=()=>randomUUID();
export const hash=x=>createHash('sha256').update(x).digest('hex');
export async function passwordHash(password){if(typeof password!=='string'||password.length<12||password.length>128)throw Error('Use a password of 12–128 characters.');const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex');}
export async function verify(password,stored){const [salt,key]=stored.split(':');const actual=await scrypt(password,salt,64);return timingSafeEqual(actual,Buffer.from(key,'hex'));}
export function openStore(file){mkdirSync(dirname(file),{recursive:true});const db=new DatabaseSync(file);db.exec(`
PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS businesses(id TEXT PRIMARY KEY,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,type TEXT NOT NULL DEFAULT 'salon');
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),email TEXT NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','cashier')),active INTEGER NOT NULL DEFAULT 1,UNIQUE(business_id,email));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(business_id TEXT NOT NULL REFERENCES businesses(id),kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT,PRIMARY KEY(business_id,kind,id));
CREATE TABLE IF NOT EXISTS operations(business_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(business_id,id));
CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,business_id TEXT NOT NULL,user_id TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL);
`);return db;}
export const initial=(name,type='salon')=>({version:1,vendor:{logo:''},settings:{name,phone:'',address:'',trn:'',tax:0,logo:''},staff:[],customers:[],sales:[],...businessModule(type).seed(name)});
export const businessTypeOf=(db,business)=>db.prepare('SELECT type FROM businesses WHERE id=?').get(business)?.type||'salon';
export function seed(db,salon,name,type='salon'){const state=initial(name,type);for(const [kind,data] of Object.entries(state)){if(kind==='version')continue;for(const item of (Array.isArray(data)?data:[data]))db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').run(salon,kind,item.id||'singleton',1,JSON.stringify(item));}}
export async function createBusiness(db,{name,slug,email,owner,password,type}){type=checkBusinessType(type);if(!/^[a-z0-9-]{3,40}$/.test(slug))throw Error('Business code must contain 3–40 lowercase letters, numbers or hyphens.');if(!name?.trim()||!owner?.trim()||!/^\S+@\S+\.\S+$/.test(email||''))throw Error('Name, owner and valid email required');const pass=await passwordHash(password),salonId=id(),userId=id();db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO businesses(id,name,slug,active,created,type) VALUES (?,?,?,?,?,?)').run(salonId,name,slug,1,new Date().toISOString(),type);db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(userId,salonId,email.toLowerCase(),owner,pass,'owner');seed(db,salonId,name,type);db.exec('COMMIT');return{salonId,businessId:salonId,userId,slug,type};}catch(e){db.exec('ROLLBACK');throw e;}}
// Kept for older callers and tests; new code uses createBusiness.
export const createSalon=createBusiness;
export function snapshot(db,salon){const type=businessTypeOf(db,salon),state={version:1,type},revisions={};for(const kind of kindsFor(type))if(!['settings','vendor'].includes(kind))state[kind]=[];for(const row of db.prepare('SELECT kind,id,version,data FROM records WHERE business_id=? ORDER BY rowid').all(salon)){revisions[row.kind+':'+row.id]=row.version;if(row.data===null)continue;const data=JSON.parse(row.data);if(Array.isArray(state[row.kind]))state[row.kind].push(data);else state[row.kind]=data;}return {state,revisions,serverTime:new Date().toISOString()};}
export function audit(db,user,action,entity){db.prepare('INSERT INTO audit(business_id,user_id,action,entity,at) VALUES (?,?,?,?,?)').run(user.business_id,user.id,action,entity,new Date().toISOString());}
export async function backupTo(db,path){return backup(db,path);}
