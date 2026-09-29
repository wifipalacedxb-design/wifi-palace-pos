import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {openStore,snapshot,verify,passwordHash,hash,id,audit} from './store.mjs';
import {ApiError,operation} from './rules.mjs';
import {initProvider,providerRoute,subscriptionAllowed} from './provider.mjs';
import {initFinance,financeRoute} from './finance.mjs';
import {initSignup,signupRoute,signupMailer} from './signup.mjs';
import {initRecovery,recoveryRoute,recoveryMailer} from './recovery.mjs';
import {initDemo,isDemo,demoRoute,scheduleDemos} from './demo.mjs';
import {recentState,changesSince,registerTill,offlineHours,HISTORY_DAYS} from './sync.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
export async function start({recoveryMail=recoveryMailer(),mailer=signupMailer(),file=process.env.DATABASE_FILE||join(root,'data','salon.sqlite'),port=Number(process.env.PORT||8080),host=process.env.HOST||'127.0.0.1',origin=process.env.PUBLIC_ORIGIN||'http://localhost:8080',demo}={}){
 const db=openStore(file),secure=origin.startsWith('https://'),dummy=await passwordHash('dummy-not-a-real-password-123');
 initProvider(db);
 initFinance(db);
 initSignup(db);
 initRecovery(db);
 initDemo(db);
 // Demo shops are built on the live (https) server unless DEMO_SHOPS=off; tests turn them on explicitly.
 const demos=(demo??(origin.startsWith('https://')&&process.env.DEMO_SHOPS!=='off'))?scheduleDemos(db):null;
 if(!secure&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))throw Error('PUBLIC_ORIGIN must use HTTPS except for local development.');
 function send(res,status,data,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(data))}
 const owner=u=>{if(u.role!=='owner')throw new ApiError(403,'Owner permission required')};
 const publicUser=u=>({id:u.id,salonId:u.business_id,businessId:u.business_id,businessType:u.business_type||'salon',offlineHours:offlineHours(db,u.business_id),...(isDemo(db,u.business_id)?{demo:true}:{}),name:u.name,email:u.email,role:u.role});
 async function body(req){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>2000000)throw new ApiError(413,'Request exceeds 2 MB');chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw new ApiError(400,'Invalid JSON')}}
 function limited(key,max=10){const now=Date.now(),r=db.prepare('SELECT * FROM login_attempts WHERE key=?').get(key);if(r&&r.until>now&&r.count>=max)throw new ApiError(429,'Too many attempts. Try again in 15 minutes.');db.prepare('INSERT INTO login_attempts VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,until=excluded.until').run(key,r&&r.until>now?r.count+1:1,r&&r.until>now?r.until:now+900000)}
 const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   const path=new URL(req.url,'http://local').pathname;
   if(path==='/health'){send(res,200,{ok:true});return}
   const providerFiles={'/pos':'pos.html','/pos.js':'pos.js','/demo':'demo.html','/demo.js':'demo.js','/recover':'recovery.html','/recovery.js':'recovery.js','/signup':'signup.html','/signup.js':'signup.js','/admin':'provider.html','/activate':'provider.html','/provider.js':'provider.js'};
   if(providerFiles[path]&&req.method==='GET'){const data=await readFile(join(root,'web',providerFiles[path]));res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(data);return}
   if(!path.startsWith('/api/')){const files={'/':'index.html','/index.html':'index.html','/whatsapp.js':'whatsapp.js','/finance.js':'finance.js','/accounts.js':'accounts.js','/cloud.js':'cloud.js','/i18n.js':'i18n.js','/laundry.js':'laundry.js','/gym.js':'gym.js','/charts.js':'charts.js','/grocery.js':'grocery.js','/petshop.js':'petshop.js','/perfume.js':'perfume.js','/meat.js':'meat.js','/restaurant.js':'restaurant.js','/sync-core.js':'sync-core.js','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest','/icon.svg':'icon.svg','/apple-touch-icon.png':'apple-touch-icon.png','/favicon.ico':'icon.svg'};if(!files[path]||req.method!=='GET')throw new ApiError(404,'Not found');const data=await readFile(join(root,'web',files[path]));res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.png')?'image/png':path.endsWith('.svg')||path==='/favicon.ico'?'image/svg+xml':path.endsWith('.webmanifest')?'application/manifest+json':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(data);return}
   if(req.method!=='GET'){
    if(req.headers.origin&&req.headers.origin!==origin)throw new ApiError(403,'Origin not allowed');
    if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new ApiError(415,'JSON request required');
   }
   if(await recoveryRoute({db,req,res,path,body,send,limited,origin,mailer:recoveryMail}))return;
   if(await signupRoute({db,req,res,path,body,send,limited,origin,mailer}))return;
   if(await providerRoute({db,req,res,path,body,send,limited,origin,secure,dummy}))return;
   if(await demoRoute({db,req,res,path,body,send,limited,secure,publicUser}))return;
   if(path==='/api/login'&&req.method==='POST'){
    const b=await body(req),slug=String(b.salon||'').trim().toLowerCase(),email=String(b.email||'').trim().toLowerCase();if(slug.length>100||email.length>200||typeof b.password!=='string'||b.password.length>128)throw new ApiError(400,'Invalid login');
    const attemptKey=hash(slug+':'+email);limited(attemptKey);limited(hash('ip:'+req.socket.remoteAddress),200);
    const user=db.prepare('SELECT u.*,s.type business_type FROM users u JOIN businesses s ON s.id=u.business_id WHERE s.slug=? AND u.email=? AND u.active=1 AND s.active=1').get(slug,email);
    const ok=await verify(b.password,user?.password||dummy);if(!user||!ok)throw new ApiError(401,'Salon code, email or password is incorrect');
    if(!subscriptionAllowed(db,user.business_id))throw new ApiError(403,'Salon subscription expired or suspended. Contact WiFi Palace.');
    db.prepare('DELETE FROM login_attempts WHERE key=? OR until<?').run(attemptKey,Date.now());db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token),user.id,csrf,Date.now()+12*3600000);audit(db,user,'login','session');
    send(res,200,{user:publicUser(user),csrf},{'Set-Cookie':`salon_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure?'; Secure':''}`});return;
   }
   const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('salon_session='))?.slice(14)||'';
   const u=db.prepare('SELECT u.*,s.csrf,t.type business_type FROM sessions s JOIN users u ON u.id=s.user_id JOIN businesses t ON t.id=u.business_id WHERE s.token=? AND s.expires>? AND u.active=1 AND t.active=1').get(hash(token),Date.now());
   if(!u)throw new ApiError(401,'Please sign in again. Pending changes stay on this device.');
   if(!subscriptionAllowed(db,u.business_id))throw new ApiError(403,'Salon subscription expired or suspended. Contact WiFi Palace.');
   if(req.method!=='GET'&&req.headers['x-csrf-token']!==u.csrf)throw new ApiError(403,'Session security check failed. Sign in again.');
   // Demo shops: visitors share them, so sign-in accounts and passwords stay fixed.
   if(isDemo(db,u.business_id)&&(path==='/api/password'||path.startsWith('/api/users')&&req.method!=='GET'))throw new ApiError(403,'Not available in the demo shop');
   if(await financeRoute({db,u,req,res,path,body,send}))return;
   if(path==='/api/me'&&req.method==='GET'){send(res,200,{user:publicUser(u),csrf:u.csrf});return}
   if(path==='/api/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));send(res,200,{ok:true},{'Set-Cookie':`salon_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`});return}
   if((path==='/api/state'||path==='/api/changes')&&req.method==='GET'){const q=new URL(req.url,'http://local').searchParams;if(path==='/api/changes'||q.has('days')){const days=Math.min(400,Math.max(1,Number(q.get('days'))||HISTORY_DAYS));send(res,200,path==='/api/changes'?changesSince(db,u,Number(q.get('after')),days):recentState(db,u,days));return}}
   if(path==='/api/till'&&req.method==='POST'){const b=await body(req);send(res,200,registerTill(db,u,b.device,b.name));return}
   if(path==='/api/state'&&req.method==='GET'){const s=snapshot(db,u.business_id);if(u.role==='cashier'){s.state.sales=s.state.sales.filter(x=>x.createdBy===u.id);for(const key of Object.keys(s.revisions))if(key.startsWith('sales:')&&!s.state.sales.some(x=>'sales:'+x.id===key))delete s.revisions[key];}send(res,200,s);return}
   if(path==='/api/sync'&&req.method==='POST'){send(res,200,operation(db,u,await body(req)));return}
   if(path==='/api/users'&&req.method==='GET'){owner(u);send(res,200,db.prepare('SELECT id,name,email,role,active FROM users WHERE business_id=?').all(u.business_id));return}
   if(path==='/api/users'&&req.method==='POST'){owner(u);const b=await body(req);if(!['owner','cashier'].includes(b.role)||!/^\S+@\S+\.\S+$/.test(b.email||'')||!b.name?.trim()||b.name.length>100||b.email.length>200)throw new ApiError(400,'Name, email and role required');if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new ApiError(400,'Use a password of 12–128 characters');const password=await passwordHash(b.password);try{db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(id(),u.business_id,b.email.toLowerCase(),b.name.trim(),password,b.role)}catch{throw new ApiError(409,'This email already has an account in the salon')};audit(db,u,'create-user',b.email);send(res,201,{ok:true});return}
   if(path.startsWith('/api/users/')&&req.method==='PATCH'){owner(u);const target=path.split('/').at(-1),b=await body(req),user=db.prepare('SELECT * FROM users WHERE business_id=? AND id=?').get(u.business_id,target);if(!user)throw new ApiError(404,'User not found');if(target===u.id)throw new ApiError(400,'Use your account password form; you cannot disable yourself');if(typeof b.active!=='boolean')throw new ApiError(400,'Active status required');db.prepare('UPDATE users SET active=? WHERE business_id=? AND id=?').run(b.active?1:0,u.business_id,target);db.prepare('DELETE FROM sessions WHERE user_id=?').run(target);audit(db,u,'user-active:'+b.active,target);send(res,200,{ok:true});return}
   if(path==='/api/password'&&req.method==='POST'){const b=await body(req);if(typeof b.current!=='string'||b.current.length>128)throw new ApiError(400,'Current password required');limited(hash('password:'+u.id));if(!await verify(b.current,u.password))throw new ApiError(403,'Current password is incorrect');if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)throw new ApiError(400,'Use a password of 12–128 characters');const password=await passwordHash(b.password);db.prepare('UPDATE users SET password=? WHERE id=?').run(password,u.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);audit(db,u,'password-change',u.id);send(res,200,{ok:true});return}
   if(path==='/api/approve-discard'&&req.method==='POST'){
    const b=await body(req);if(!Array.isArray(b.operations)||b.operations.length<1||b.operations.length>500||b.operations.some(x=>typeof x.id!=='string'||x.id.length>100))throw new ApiError(400,'Invalid pending change list');
    let approver=u;
    if(u.role!=='owner'){
     limited(hash('discard:'+u.id));if(typeof b.password!=='string'||b.password.length>128||typeof b.email!=='string')throw new ApiError(400,'Owner credentials required');
     approver=db.prepare("SELECT * FROM users WHERE business_id=? AND email=? AND role='owner' AND active=1").get(u.business_id,b.email.toLowerCase());
     const ok=await verify(b.password,approver?.password||dummy);if(!approver||!ok)throw new ApiError(403,'Owner approval failed');
    }
    audit(db,approver,'approve-discard-for:'+u.id,JSON.stringify(b.operations.map(x=>x.id)));send(res,200,{approved:true});return;
   }
   if(path==='/api/audit'&&req.method==='GET'){owner(u);send(res,200,db.prepare('SELECT a.*,u.name actor FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.business_id=? ORDER BY seq DESC LIMIT 200').all(u.business_id));return}
   throw new ApiError(404,'Not found');
  }catch(e){if(!res.headersSent)send(res,e.status||500,{error:e.status?e.message:'Server error. Your pending changes have not been removed.'});if(!e.status)console.error(e.message)}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;
 await new Promise(resolve=>server.listen(port,host,resolve));return{server,db,demos,close:()=>new Promise(resolve=>{demos?.stop();server.close(()=>{db.close();resolve()})})};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const app=await start();console.log('WiFi Palace POS listening on port '+app.server.address().port);}
