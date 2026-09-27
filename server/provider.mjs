import {OFFLINE_HOURS,setOfflineHours} from './sync.mjs';
import {randomBytes} from 'node:crypto';
import {hash,id,passwordHash,verify,seed} from './store.mjs';
import {ApiError} from './rules.mjs';
import {checkBusinessType} from './modules.mjs';
const businessTypeOrFail=t=>{try{return checkBusinessType(t)}catch(e){throw new ApiError(400,e.message)}};
export function initProvider(db){db.exec(`
CREATE TABLE IF NOT EXISTS provider_admins(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provider_sessions(token TEXT PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES provider_admins(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions(business_id TEXT PRIMARY KEY REFERENCES businesses(id),plan TEXT NOT NULL,status TEXT NOT NULL,expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invitations(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS provider_audit(id INTEGER PRIMARY KEY,admin_id TEXT NOT NULL,action TEXT NOT NULL,business_id TEXT,at TEXT NOT NULL);
`);}
export function subscriptionAllowed(db,salon){const s=db.prepare('SELECT * FROM subscriptions WHERE business_id=?').get(salon);return !s||(['trial','active'].includes(s.status)&&Date.parse(s.expires)>Date.now());}
export async function bootstrapProvider(db,{email,name,password}){
 if(!/^\S+@\S+\.\S+$/.test(email||'')||!name?.trim())throw Error('Valid email and name required');const pass=await passwordHash(password);
 db.exec('BEGIN IMMEDIATE');try{if(db.prepare('SELECT 1 FROM provider_admins').get())throw Error('Provider administrator already exists');db.prepare('INSERT INTO provider_admins VALUES (?,?,?,?)').run(id(),email.toLowerCase().trim(),name.trim(),pass);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
function planFields(b){
 if(!['Starter','Professional','Enterprise'].includes(b.plan)||!['trial','active','suspended'].includes(b.status))throw new ApiError(400,'Choose a valid plan and status');
 if(typeof b.expires!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.expires)||!Number.isFinite(Date.parse(b.expires)))throw new ApiError(400,'Choose an expiry date');
 const expires=b.expires+'T23:59:59.999Z';if(new Date(expires).toISOString()!==expires)throw new ApiError(400,'Invalid expiry date');return {plan:b.plan,status:b.status,expires};
}
export async function providerRoute({db,req,res,path,body,send,limited,origin,secure,dummy}){
 const log=(admin,action,salon=null)=>db.prepare('INSERT INTO provider_audit(admin_id,action,business_id,at) VALUES (?,?,?,?)').run(admin,action,salon,new Date().toISOString());
 const newInvite=(user)=>{const token=randomBytes(32).toString('hex');db.prepare('UPDATE invitations SET used=1 WHERE user_id=?').run(user);db.prepare('INSERT INTO invitations VALUES (?,?,?,0)').run(hash(token),user,Date.now()+48*3600000);return origin+'/activate#'+token;};
 if(path==='/api/activate'&&req.method==='POST'){
  limited(hash('activation-ip:'+req.socket.remoteAddress),100);const b=await body(req);
  if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token)||typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new ApiError(400,'Use a valid invitation and a password of 12–128 characters');
  const pass=await passwordHash(b.password);db.exec('BEGIN IMMEDIATE');try{
   const inv=db.prepare('SELECT i.*,u.business_id,s.slug,s.active FROM invitations i JOIN users u ON u.id=i.user_id JOIN businesses s ON s.id=u.business_id WHERE i.token=? AND i.used=0 AND i.expires>?').get(hash(b.token),Date.now());
   if(!inv||!inv.active||!subscriptionAllowed(db,inv.business_id))throw new ApiError(400,'Invitation expired, already used, or salon access unavailable. Contact WiFi Palace.');
   db.prepare('UPDATE users SET password=?,active=1 WHERE id=?').run(pass,inv.user_id);db.prepare('UPDATE invitations SET used=1 WHERE token=?').run(hash(b.token));db.prepare('DELETE FROM sessions WHERE user_id=?').run(inv.user_id);log('activation','owner-activated',inv.business_id);db.exec('COMMIT');send(res,200,{ok:true,salonCode:inv.slug});return true;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 if(!path.startsWith('/api/provider/'))return false;
 if(path==='/api/provider/login'&&req.method==='POST'){
  const b=await body(req);if(typeof b.email!=='string'||b.email.length>200||typeof b.password!=='string'||b.password.length>128)throw new ApiError(400,'Email and password required');
  const email=b.email.toLowerCase().trim();limited(hash('provider:'+email));limited(hash('provider-ip:'+req.socket.remoteAddress),100);
  const a=db.prepare('SELECT * FROM provider_admins WHERE email=?').get(email);if(!await verify(b.password,a?.password||dummy)||!a)throw new ApiError(401,'Email or password is incorrect');
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');db.prepare('DELETE FROM provider_sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO provider_sessions VALUES (?,?,?,?)').run(hash(token),a.id,csrf,Date.now()+8*3600000);log(a.id,'login');send(res,200,{name:a.name,csrf},{'Set-Cookie':`provider_session=${token}; HttpOnly; SameSite=Strict; Path=/api/provider; Max-Age=28800${secure?'; Secure':''}`});return true;
 }
 const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('provider_session='))?.slice(17)||'';
 const token=hash(cookie),a=db.prepare('SELECT a.id,a.name,s.csrf FROM provider_sessions s JOIN provider_admins a ON a.id=s.admin_id WHERE s.token=? AND s.expires>?').get(token,Date.now());
 if(!a)throw new ApiError(401,'WiFi Palace administrator sign-in required');
 if(req.method!=='GET'&&req.headers['x-csrf-token']!==a.csrf)throw new ApiError(403,'Session security check failed');
 if(path==='/api/provider/me'&&req.method==='GET'){send(res,200,a);return true;}
 if(path==='/api/provider/logout'&&req.method==='POST'){db.prepare('DELETE FROM provider_sessions WHERE token=?').run(token);send(res,200,{ok:true},{'Set-Cookie':`provider_session=; HttpOnly; SameSite=Strict; Path=/api/provider; Max-Age=0${secure?'; Secure':''}`});return true;}
 if(path==='/api/provider/audit'&&req.method==='GET'){send(res,200,db.prepare('SELECT * FROM provider_audit ORDER BY id DESC LIMIT 100').all());return true;}
 if(path==='/api/provider/salons'&&req.method==='GET'){
  send(res,200,db.prepare(`SELECT s.id,s.name,s.slug,s.type,s.active,s.created,p.plan,p.status,p.expires,(SELECT email FROM users WHERE business_id=s.id AND role='owner' ORDER BY rowid LIMIT 1) ownerEmail,(SELECT active FROM users WHERE business_id=s.id AND role='owner' ORDER BY rowid LIMIT 1) ownerActive,COALESCE((SELECT offline_hours FROM business_options WHERE business_id=s.id),12) offlineHours FROM businesses s LEFT JOIN subscriptions p ON p.business_id=s.id ORDER BY s.created DESC`).all());return true;
 }
 if(path==='/api/provider/salons'&&req.method==='POST'){
  const b=await body(req),p=planFields(b);
  if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100||typeof b.owner!=='string'||!b.owner.trim()||b.owner.length>100||typeof b.email!=='string'||b.email.length>200||!/^\S+@\S+\.\S+$/.test(b.email)||typeof b.slug!=='string'||!/^[a-z0-9-]{3,40}$/.test(b.slug))throw new ApiError(400,'Enter salon name, unique lowercase code, owner name and valid email');
  const pass=await passwordHash(randomBytes(32).toString('hex')),salon=id(),user=id();db.exec('BEGIN IMMEDIATE');try{
   if(db.prepare('SELECT 1 FROM businesses WHERE slug=?').get(b.slug))throw new ApiError(409,'Salon code already exists');
   const type=businessTypeOrFail(b.type);db.prepare('INSERT INTO businesses(id,name,slug,active,created,type) VALUES (?,?,?,?,?,?)').run(salon,b.name.trim(),b.slug,1,new Date().toISOString(),type);db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,0)').run(user,salon,b.email.toLowerCase(),b.owner.trim(),pass,'owner');seed(db,salon,b.name.trim(),type);db.prepare('INSERT INTO subscriptions VALUES (?,?,?,?)').run(salon,p.plan,p.status,p.expires);const activationUrl=newInvite(user);log(a.id,'create-salon',salon);db.exec('COMMIT');send(res,201,{id:salon,activationUrl});return true;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 const codeMatch=path.match(/^\/api\/provider\/salons\/([a-f0-9-]+)\/code$/);
 if(codeMatch&&req.method==='POST'){
  const b=await body(req),slug=typeof b.slug==='string'?b.slug.trim().toLowerCase():'';
  if(!/^[a-z0-9-]{3,40}$/.test(slug))throw new ApiError(400,'Use 3–40 lowercase letters, numbers or hyphens.');
  const business=db.prepare('SELECT * FROM businesses WHERE id=?').get(codeMatch[1]);if(!business)throw new ApiError(404,'Business not found');
  db.exec('BEGIN IMMEDIATE');try{
   if(db.prepare('SELECT 1 FROM businesses WHERE slug=? AND id<>?').get(slug,business.id))throw new ApiError(409,'Business code already exists. Choose another code.');
   if(slug!==business.slug){db.prepare('UPDATE businesses SET slug=? WHERE id=?').run(slug,business.id);db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE business_id=?)').run(business.id);log(a.id,'business-code:'+business.slug+'->'+slug,business.id);}
   db.exec('COMMIT');send(res,200,{ok:true,salonCode:slug,businessCode:slug});return true;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 const match=path.match(/^\/api\/provider\/salons\/([a-f0-9-]+)(\/invite)?$/);
 if(match){const salon=db.prepare('SELECT * FROM businesses WHERE id=?').get(match[1]);if(!salon)throw new ApiError(404,'Salon not found');
  if(match[2]&&req.method==='POST'){
   const user=db.prepare("SELECT id,active FROM users WHERE business_id=? AND role='owner' ORDER BY rowid LIMIT 1").get(salon.id);if(!user||user.active)throw new ApiError(409,'Only pending owner invitations can be reissued');
   if(!salon.active||!subscriptionAllowed(db,salon.id))throw new ApiError(409,'Activate or renew salon access first');
   const activationUrl=newInvite(user.id);log(a.id,'reissue-invitation',salon.id);send(res,200,{activationUrl});return true;
  }
  if(!match[2]&&req.method==='PATCH'){const b=await body(req),p=planFields(b);if(b.offlineHours!==undefined){const h=Number(b.offlineHours);if(!OFFLINE_HOURS.includes(h))throw new ApiError(400,'Choose a supported offline period');setOfflineHours(db,salon.id,h);log(a.id,'offline-hours:'+h,salon.id)}db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO subscriptions VALUES (?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET plan=excluded.plan,status=excluded.status,expires=excluded.expires').run(salon.id,p.plan,p.status,p.expires);db.prepare('UPDATE businesses SET active=? WHERE id=?').run(p.status==='suspended'?0:1,salon.id);db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE business_id=?)').run(salon.id);log(a.id,'subscription:'+p.status,salon.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}send(res,200,{ok:true});return true;}
 }
 throw new ApiError(404,'Not found');
}
