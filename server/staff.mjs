// Team logins: owner / cashier / waiter, and PIN switching on a device that is already signed in.
// * Waiter (captain): a restaurant login that can only take orders and send them to the kitchen. No payments,
//   no voids, no sales figures. Stored as a cashier with a "waiter" flag (the users table only knows two roles).
// * PIN: a 4–6 digit code for staff (never owners). It only works from a device that already has a valid session
//   for the same business, so a PIN is not a way to sign in from outside the shop. Five wrong tries lock it for 15 minutes.
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {ApiError} from './rules.mjs';
import {hash,id,passwordHash,audit} from './store.mjs';
export function initStaff(db){db.exec("CREATE TABLE IF NOT EXISTS user_options(user_id TEXT PRIMARY KEY,business_id TEXT NOT NULL,waiter INTEGER NOT NULL DEFAULT 0,pin TEXT NOT NULL DEFAULT '')")}
const options=(db,userId)=>db.prepare('SELECT waiter,pin FROM user_options WHERE user_id=?').get(userId);
export const isWaiter=(db,u)=>!!options(db,u.id)?.waiter;
// PINs are short, so they get their own salted hash (the password hasher insists on 12+ characters).
const pinHash=pin=>{const salt=randomBytes(16);return salt.toString('hex')+':'+scryptSync(pin,salt,32).toString('hex')};
const pinVerify=(pin,stored)=>{const [salt,want]=String(stored).split(':');if(!salt||!want)return false;const got=scryptSync(pin,Buffer.from(salt,'hex'),32),exp=Buffer.from(want,'hex');return got.length===exp.length&&timingSafeEqual(got,exp)};
const pinOk=p=>typeof p==='string'&&/^\d{4,6}$/.test(p);
export async function setStaffOptions(db,business,userId,{waiter,pin}){
 const cur=options(db,userId)||{waiter:0,pin:''},w=waiter===undefined?cur.waiter:waiter?1:0,p=pin===undefined?cur.pin:pin===''?'':pinHash(pin);
 db.prepare('INSERT INTO user_options(user_id,business_id,waiter,pin) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET waiter=excluded.waiter,pin=excluded.pin').run(userId,business,w,p);
}
// What a waiter may sync: orders and kitchen tickets (and customers for delivery details). Nothing that touches money.
export function waiterGuard(op){
 const k=op?.kind,d=op?.data||{};
 if(k==='sales')throw new ApiError(403,'Waiters cannot take payment. Ask the counter to bill this order.');
 if(k==='restaurant_kots'){if(d.type==='void')throw new ApiError(403,'Ask the counter or the manager to void sent items.');return}
 if(k==='restaurant_orders'){if(d.status&&!['open','merged'].includes(d.status))throw new ApiError(403,'Only the counter can close or cancel an order.');return}
 if(k==='customers')return;
 throw new ApiError(403,'Waiter logins can only take orders.');
}
export async function staffRoute({db,u,req,res,path,body,send,limited,secure,publicUser,token}){
 const owner=()=>{if(u.role!=='owner')throw new ApiError(403,'Owner permission required')};
 if(path==='/api/users'&&req.method==='GET'){owner();send(res,200,db.prepare("SELECT u.id,u.name,u.email,u.role,u.active,COALESCE(o.waiter,0) waiter,CASE WHEN COALESCE(o.pin,'')<>'' THEN 1 ELSE 0 END hasPin FROM users u LEFT JOIN user_options o ON o.user_id=u.id WHERE u.business_id=?").all(u.business_id).map(x=>({...x,role:x.waiter?'waiter':x.role,waiter:!!x.waiter,hasPin:!!x.hasPin})));return true}
 if(path==='/api/users'&&req.method==='POST'){
  owner();const b=await body(req),waiter=b.role==='waiter';
  if(!['owner','cashier','waiter'].includes(b.role)||!b.name?.trim()||b.name.length>100)throw new ApiError(400,'Name and role required');
  if(waiter&&u.business_type!=='restaurant')throw new ApiError(400,'Waiter logins are for restaurants');
  if(b.pin!==undefined&&b.pin!==''&&(!pinOk(b.pin)||b.role==='owner'))throw new ApiError(400,b.role==='owner'?'Owners sign in with their password, not a PIN':'A PIN is 4 to 6 digits');
  // A waiter can be created with only a name and a PIN: they switch in on a device that is already signed in.
  const pinOnly=waiter&&pinOk(b.pin)&&!b.email&&!b.password,email=pinOnly?'waiter-'+randomBytes(6).toString('hex')+'@pin.invalid':String(b.email||'').toLowerCase(),pw=pinOnly?randomBytes(24).toString('hex'):b.password;
  if(!/^\S+@\S+\.\S+$/.test(email)||email.length>200)throw new ApiError(400,waiter?'Enter a PIN, or an email and password':'Name, email and role required');
  if(typeof pw!=='string'||pw.length<12||pw.length>128)throw new ApiError(400,'Use a password of 12–128 characters');
  const password=await passwordHash(pw),user=id();
  try{db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(user,u.business_id,email,b.name.trim(),password,waiter?'cashier':b.role)}catch{throw new ApiError(409,'This email already has an account in this business')}
  if(waiter||pinOk(b.pin))await setStaffOptions(db,u.business_id,user,{waiter,pin:pinOk(b.pin)?b.pin:undefined});
  audit(db,u,'create-user',b.name.trim()+' ('+b.role+')');send(res,201,{ok:true,id:user});return true;
 }
 if(path.startsWith('/api/users/')&&req.method==='PATCH'){
  owner();const target=path.split('/').at(-1),b=await body(req),user=db.prepare('SELECT * FROM users WHERE business_id=? AND id=?').get(u.business_id,target);if(!user)throw new ApiError(404,'User not found');
  if(b.pin!==undefined){if(user.role==='owner')throw new ApiError(400,'Owners sign in with their password, not a PIN');if(b.pin!==''&&!pinOk(b.pin))throw new ApiError(400,'A PIN is 4 to 6 digits');await setStaffOptions(db,u.business_id,target,{pin:b.pin});db.prepare('DELETE FROM login_attempts WHERE key=?').run(hash('pin:'+target));audit(db,u,b.pin?'user-pin-set':'user-pin-removed',target);if(b.active===undefined){send(res,200,{ok:true});return true}}
  if(target===u.id)throw new ApiError(400,'Use your account password form; you cannot disable yourself');if(typeof b.active!=='boolean')throw new ApiError(400,'Active status required');
  db.prepare('UPDATE users SET active=? WHERE business_id=? AND id=?').run(b.active?1:0,u.business_id,target);db.prepare('DELETE FROM sessions WHERE user_id=?').run(target);audit(db,u,'user-active:'+b.active,target);send(res,200,{ok:true});return true;
 }
 // Staff who can be switched to with a PIN on this (already signed-in) device.
 if(path==='/api/pin-users'&&req.method==='GET'){send(res,200,db.prepare("SELECT u.id,u.name,o.waiter FROM users u JOIN user_options o ON o.user_id=u.id WHERE u.business_id=? AND u.active=1 AND u.role<>'owner' AND o.pin<>'' ORDER BY u.name COLLATE NOCASE").all(u.business_id).map(x=>({id:x.id,name:x.name,role:x.waiter?'waiter':'cashier'})));return true}
 if(path==='/api/pin-login'&&req.method==='POST'){
  const b=await body(req);if(typeof b.userId!=='string'||b.userId.length>100||typeof b.pin!=='string'||b.pin.length>6)throw new ApiError(400,'Choose your name and enter your PIN');
  limited(hash('pin:'+b.userId),5);
  const user=db.prepare("SELECT u.*,s.type business_type FROM users u JOIN businesses s ON s.id=u.business_id WHERE u.id=? AND u.business_id=? AND u.active=1 AND u.role<>'owner'").get(b.userId,u.business_id),stored=user&&options(db,user.id)?.pin;
  if(!stored||!pinVerify(b.pin,stored))throw new ApiError(401,'Wrong PIN');
  db.prepare('DELETE FROM login_attempts WHERE key=?').run(hash('pin:'+b.userId));
  const next=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
  db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(next),user.id,csrf,Date.now()+12*3600000);audit(db,user,'pin-login','from '+u.name);
  send(res,200,{user:publicUser(user),csrf},{'Set-Cookie':`salon_session=${next}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure?'; Secure':''}`});return true;
 }
 return false;
}
