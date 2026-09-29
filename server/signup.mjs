import {randomBytes} from 'node:crypto';
import {hash,id,passwordHash,seed} from './store.mjs';
import {ApiError} from './rules.mjs';
import {checkBusinessType,BUSINESS_TYPES} from './modules.mjs';
export const TRIAL_DAYS=(n=>Number.isInteger(n)&&n>0&&n<=90?n:30)(Number(process.env.TRIAL_DAYS||30)); // first month free
export function signupMailer(env=process.env,request=fetch){
 if(env.SIGNUP_ENABLED!=='true'||!env.RESEND_API_KEY||!env.MAIL_FROM)return null;
 return async({email,url})=>{const response=await request('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.MAIL_FROM,to:[email],subject:'Verify your Palace POS free trial',text:`Confirm your email and choose a password to start your free month of Palace POS:\n\n${url}\n\nThis link expires in 1 hour. If you did not request this, ignore this email. No account has been activated.`})});if(!response.ok)throw Error('Email delivery failed');};
}
export function initSignup(db){db.exec(`
 CREATE TABLE IF NOT EXISTS signup_requests(token TEXT PRIMARY KEY,email TEXT NOT NULL,name TEXT NOT NULL,owner TEXT NOT NULL,phone TEXT NOT NULL,expires INTEGER NOT NULL,type TEXT NOT NULL DEFAULT 'salon');
 CREATE INDEX IF NOT EXISTS signup_email ON signup_requests(email);
 CREATE TABLE IF NOT EXISTS signup_trials(email TEXT PRIMARY KEY,business_id TEXT NOT NULL REFERENCES businesses(id),verified_at TEXT NOT NULL);
`)}
const fail=(status,message)=>{throw new ApiError(status,message)};
const field=(v,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'Please complete all fields with valid details.');return v.trim()};
export async function signupRoute({db,req,res,path,body,send,limited,origin,mailer}){
 if(!path.startsWith('/api/signup'))return false;
 if(path==='/api/signup/status'&&req.method==='GET'){send(res,200,{enabled:!!mailer,trialDays:TRIAL_DAYS,businessTypes:BUSINESS_TYPES});return true}
 if(!mailer)fail(503,'Online registration is not available yet. Contact WiFi Palace to create your salon.');
 if(req.method!=='POST')fail(404,'Not found');
 limited(hash('signup-ip:'+req.socket.remoteAddress),30);
 const b=await body(req);if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'Invalid registration');
 if(path==='/api/signup/request'){
  const email=field(b.email,200).toLowerCase(),name=field(b.name,100),owner=field(b.owner,100),phone=field(b.phone,40);
  let type;try{type=checkBusinessType(b.type)}catch(e){fail(400,e.message)}
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/[\r\n]/.test(email)||!/^\+?[\d ()-]{7,40}$/.test(phone))fail(400,'Enter a valid email address and phone number.');
  limited(hash('signup-email:'+email),3);limited('signup-global',100);
  db.prepare('DELETE FROM signup_requests WHERE expires<?').run(Date.now());
  const accepted=()=>send(res,202,{message:'If this email is eligible for a trial, a verification link has been sent. Check your inbox and spam folder. Existing owners should sign in or contact WiFi Palace.'});
  if(db.prepare('SELECT 1 FROM signup_trials WHERE email=?').get(email)||db.prepare('SELECT 1 FROM users WHERE lower(email)=?').get(email)){accepted();return true}
  const token=randomBytes(32).toString('hex');
  // Preserve earlier valid links on resend; activation consumes every link for the email.
  db.prepare('INSERT INTO signup_requests(token,email,name,owner,phone,expires,type) VALUES (?,?,?,?,?,?,?)').run(hash(token),email,name,owner,phone,Date.now()+3600000,type);
  try{await mailer({email,url:origin+'/signup#'+token})}catch{db.prepare('DELETE FROM signup_requests WHERE token=?').run(hash(token));fail(503,'We could not send your verification email. Please try again later.');}
  accepted();return true;
 }
 if(path==='/api/signup/verify'){
  if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))fail(400,'Invalid verification link. Request a new link.');
  const token=hash(b.token),pending=db.prepare('SELECT * FROM signup_requests WHERE token=? AND expires>?').get(token,Date.now());
  if(!pending)fail(400,'This link has expired or was already used. Sign in or request a new link.');
  if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)fail(400,'Use a password of 12–128 characters.');
  const password=await passwordHash(b.password);
  db.exec('BEGIN IMMEDIATE');try{
   const p=db.prepare('SELECT * FROM signup_requests WHERE token=? AND expires>?').get(token,Date.now());
   if(!p)fail(400,'This link has expired or was already used.');
   if(db.prepare('SELECT 1 FROM signup_trials WHERE email=?').get(p.email)||db.prepare('SELECT 1 FROM users WHERE lower(email)=?').get(p.email))fail(409,'An account already exists. Sign in or contact WiFi Palace.');
   const salon=id(),user=id(),now=new Date().toISOString(),expires=new Date(Date.now()+TRIAL_DAYS*86400000).toISOString();
   const prefix=p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,25)||'salon';
   let slug;do{slug=prefix+'-'+randomBytes(4).toString('hex')}while(db.prepare('SELECT 1 FROM businesses WHERE slug=?').get(slug));
   db.prepare('INSERT INTO businesses(id,name,slug,active,created,type) VALUES (?,?,?,?,?,?)').run(salon,p.name,slug,1,now,p.type);
   db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(user,salon,p.email,p.owner,password,'owner');
   seed(db,salon,p.name,p.type);
   const settings=db.prepare("SELECT data FROM records WHERE business_id=? AND kind='settings'").get(salon);
   db.prepare("UPDATE records SET data=? WHERE business_id=? AND kind='settings'").run(JSON.stringify({...JSON.parse(settings.data),phone:p.phone}),salon);
   db.prepare('INSERT INTO subscriptions VALUES (?,?,?,?)').run(salon,'Pro','trial',expires);
   db.prepare('INSERT INTO signup_trials VALUES (?,?,?)').run(p.email,salon,now);
   db.prepare('DELETE FROM signup_requests WHERE email=?').run(p.email);
   db.prepare('INSERT INTO provider_audit(admin_id,action,business_id,at) VALUES (?,?,?,?)').run('self-registration','verified-trial-created',salon,now);
   db.exec('COMMIT');send(res,201,{salonCode:slug,businessCode:slug,businessType:p.type,email:p.email,expires});return true;
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 fail(404,'Not found');
}
