import {randomBytes} from 'node:crypto';
import {hash,passwordHash,audit} from './store.mjs';
import {ApiError} from './rules.mjs';
// Email password recovery and business-code reminders (ported from Salon Desk 2.x).
// Tokens are stored hashed, expire after 30 minutes, work once and die if the password changes first.
export function initRecovery(db){db.exec(`CREATE TABLE IF NOT EXISTS password_resets(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),password_version TEXT NOT NULL,expires INTEGER NOT NULL);`)}
export function recoveryMailer(env=process.env,request=fetch){
 if(!env.RESEND_API_KEY||!env.MAIL_FROM)return null;
 return async({email,subject,text})=>{const r=await request('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.MAIL_FROM,to:[email],subject,text})});if(!r.ok)throw Error('Recovery email delivery failed');};
}
export async function recoveryRoute({db,req,res,path,body,send,limited,origin,mailer}){
 if(!path.startsWith('/api/recovery/'))return false;
 if(req.method!=='POST')throw new ApiError(404,'Not found');
 limited(hash('recovery-ip:'+req.socket.remoteAddress),30);
 const b=await body(req);if(!b||typeof b!=='object'||Array.isArray(b))throw new ApiError(400,'Invalid request');
 if(path==='/api/recovery/reset'){
  if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))throw new ApiError(400,'Invalid or expired link. Request a new one.');
  if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new ApiError(400,'Use a password of 12–128 characters.');
  const key=hash(b.token);
  const lookup=()=>db.prepare('SELECT r.*,u.password,u.business_id,u.active,s.slug FROM password_resets r JOIN users u ON u.id=r.user_id JOIN businesses s ON s.id=u.business_id WHERE r.token=? AND r.expires>?').get(key,Date.now());
  const valid=r=>r&&r.active&&r.password_version===hash(r.password);
  if(!valid(lookup()))throw new ApiError(400,'Invalid or expired link. Request a new one.');
  const password=await passwordHash(b.password);
  db.exec('BEGIN IMMEDIATE');try{
   const r=lookup();if(!valid(r))throw new ApiError(400,'Invalid or expired link. Request a new one.');
   db.prepare('UPDATE users SET password=? WHERE id=?').run(password,r.user_id);
   db.prepare('DELETE FROM password_resets WHERE user_id=?').run(r.user_id);
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(r.user_id);
   audit(db,{id:r.user_id,business_id:r.business_id},'password-recovery',r.user_id);
   db.exec('COMMIT');send(res,200,{ok:true,salonCode:r.slug,businessCode:r.slug});return true;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 if(!['/api/recovery/password','/api/recovery/codes'].includes(path))throw new ApiError(404,'Not found');
 if(!mailer)throw new ApiError(503,'Email recovery is unavailable. Contact WiFi Palace.');
 const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(email.length>200||!/^\S+@\S+\.\S+$/.test(email)||/[\r\n]/.test(email))throw new ApiError(400,'Enter a valid email address.');
 const code=typeof(b.business??b.salon)==='string'?(b.business??b.salon).trim().toLowerCase():'';
 if(path.endsWith('/password')&&!/^[a-z0-9-]{3,40}$/.test(code))throw new ApiError(400,'Enter your business code, or use Forgot business code.');
 limited(hash('recovery-email:'+email),3);limited('recovery-global',100);
 db.prepare('DELETE FROM password_resets WHERE expires<?').run(Date.now());
 const users=db.prepare('SELECT u.id,u.password,s.name,s.slug FROM users u JOIN businesses s ON s.id=u.business_id WHERE lower(u.email)=? AND u.active=1 ORDER BY s.slug').all(email);
 const accepted=()=>send(res,202,{message:'If the details match an account, check your email and spam folder. If no email arrives, contact WiFi Palace.'});
 if(path.endsWith('/codes')){
  if(users.length)try{await mailer({email,subject:'Your Palace POS business codes',text:'Your Palace POS sign-in codes:\n\n'+users.map(u=>u.name+': '+u.slug).join('\n')+'\n\nSign in: '+origin+'/\nIf you did not request this, ignore this email.'})}catch{console.error('Business code recovery email failed');}
 }else{
  const u=users.find(u=>u.slug===code);
  if(u){const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO password_resets VALUES (?,?,?,?)').run(hash(token),u.id,hash(u.password),Date.now()+30*60000);
   try{await mailer({email,subject:'Reset your Palace POS password',text:'Reset the password for '+u.name+' (business code: '+u.slug+'):\n\n'+origin+'/recover#'+token+'\n\nThis private link expires in 30 minutes and works once. If you did not request it, ignore this email. Your password has not changed.'})}catch{db.prepare('DELETE FROM password_resets WHERE token=?').run(hash(token));console.error('Password recovery email failed');}
  }
 }
 accepted();return true;
}
