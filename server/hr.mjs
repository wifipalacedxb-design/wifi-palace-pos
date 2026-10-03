// HR for every business type (online, owner only except clocking in and out):
// staff files with document expiry reminders, attendance by PIN, leave, a monthly salary sheet with payslips,
// and an end-of-service gratuity estimate. Paying a month's salaries records one expense, so it reaches the
// cash/bank book and profit & loss. Commission earned on sales is shown on the payslip but is not added to that
// expense, because profit & loss already counts earned commissions.
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {ApiError} from './rules.mjs';
import {audit,hash} from './store.mjs';
import {businessDay} from './finance.mjs';
const DAY=86400000,fail=(s,m)=>{throw new ApiError(s,m)};
const key=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v))fail(400,'Invalid request identifier');return v};
const money=(v,label='amount')=>{if(!Number.isSafeInteger(v)||v<0||v>100000000)fail(400,'Enter a valid '+label);return v};
const text=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'Enter '+label);return v.trim()};
const opt=(v,max=200)=>{if(v===undefined||v===null||v==='')return '';if(typeof v!=='string'||v.length>max)fail(400,'Text is too long');return v.trim()};
const date=(v,label='date')=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail(400,'Choose a valid '+label);return v};
const monthKey=v=>{if(typeof v!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(v))fail(400,'Choose a month');return v};
const pinHash=pin=>{const salt=randomBytes(16);return salt.toString('hex')+':'+scryptSync(pin,salt,32).toString('hex')};
const pinVerify=(pin,stored)=>{const [salt,want]=String(stored).split(':');if(!salt||!want)return false;const got=scryptSync(pin,Buffer.from(salt,'hex'),32),exp=Buffer.from(want,'hex');return got.length===exp.length&&timingSafeEqual(got,exp)};
export const DOC_TYPES=['Passport','Visa','Emirates ID','Labour card','Health card','Other'];
export const LEAVE_TYPES=['Annual','Sick','Unpaid','Other'];
export function initHr(db){db.exec(`
CREATE TABLE IF NOT EXISTS employees(business_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,job TEXT NOT NULL,joined TEXT NOT NULL,phone TEXT NOT NULL,basic INTEGER NOT NULL,allowances INTEGER NOT NULL,start_time TEXT NOT NULL DEFAULT '',staff_id TEXT NOT NULL DEFAULT '',pin TEXT NOT NULL DEFAULT '',docs TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,PRIMARY KEY(business_id,id));
CREATE TABLE IF NOT EXISTS attendance(business_id TEXT NOT NULL,id TEXT NOT NULL,employee_id TEXT NOT NULL,date TEXT NOT NULL,time_in TEXT NOT NULL,time_out TEXT NOT NULL DEFAULT '',PRIMARY KEY(business_id,id));
CREATE INDEX IF NOT EXISTS attendance_day ON attendance(business_id,date);
CREATE TABLE IF NOT EXISTS leaves(business_id TEXT NOT NULL,id TEXT NOT NULL,employee_id TEXT NOT NULL,type TEXT NOT NULL,from_date TEXT NOT NULL,to_date TEXT NOT NULL,days INTEGER NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(business_id,id));
CREATE TABLE IF NOT EXISTS payroll(business_id TEXT NOT NULL,month TEXT NOT NULL,employee_id TEXT NOT NULL,basic INTEGER NOT NULL,allowances INTEGER NOT NULL,commission INTEGER NOT NULL,additions INTEGER NOT NULL,deductions INTEGER NOT NULL,note TEXT NOT NULL,paid_at TEXT NOT NULL DEFAULT '',method TEXT NOT NULL DEFAULT '',PRIMARY KEY(business_id,month,employee_id));
`)}
const uaeTime=(d=new Date())=>new Date(d.getTime()+4*3600000).toISOString().slice(11,16);
// UAE end-of-service estimate on basic salary: 21 days per year for the first 5 years, 30 days per year after,
// nothing before 1 full year, capped at two years' basic pay. An estimate for the owner, not legal advice.
export function gratuity(basic,joined,until=businessDay()){
 const years=(Date.parse(until)-Date.parse(joined))/DAY/365;if(!(years>=1))return{years:Math.max(0,Math.round(years*10)/10),amount:0};
 const daily=basic*12/365,days=Math.min(years,5)*21+Math.max(0,years-5)*30;return{years:Math.round(years*10)/10,amount:Math.min(Math.round(daily*days),basic*24)};
}
const employeeView=e=>({id:e.id,name:e.name,job:e.job,joined:e.joined,phone:e.phone,basic:e.basic,allowances:e.allowances,startTime:e.start_time,staffId:e.staff_id,hasPin:!!e.pin,docs:JSON.parse(e.docs),active:!!e.active,gratuity:gratuity(e.basic,e.joined)});
const employees=(db,b)=>db.prepare('SELECT * FROM employees WHERE business_id=? ORDER BY active DESC,name COLLATE NOCASE').all(b);
function commissionFor(db,b,staffId,month){if(!staffId)return 0;let n=0;for(const r of db.prepare("SELECT data FROM records WHERE business_id=? AND kind='sales' AND data IS NOT NULL").all(b)){const s=JSON.parse(r.data);if(s.staffId!==staffId||!Number.isSafeInteger(s.commissionAmount))continue;if(businessDay(s.date).startsWith(month))n+=s.commissionAmount;if(s.status==='Refunded'&&s.refundDate&&businessDay(s.refundDate).startsWith(month))n-=s.commissionAmount}return Math.max(0,n)}
function leaveDays(db,b,employeeId,month,type){let n=0;for(const l of db.prepare('SELECT from_date,to_date FROM leaves WHERE business_id=? AND employee_id=? AND type=?').all(b,employeeId,type))for(let t=Date.parse(l.from_date);t<=Date.parse(l.to_date);t+=DAY)if(new Date(t).toISOString().startsWith(month))n++;return n}
// The month's salary sheet: saved lines when they exist, otherwise a draft from each active employee's file.
export function payrollSheet(db,b,month){
 const saved=new Map(db.prepare('SELECT * FROM payroll WHERE business_id=? AND month=?').all(b,month).map(r=>[r.employee_id,r])),paid=[...saved.values()].some(r=>r.paid_at);
 const lines=employees(db,b).filter(e=>saved.has(e.id)||(!paid&&e.active&&e.joined.slice(0,7)<=month)).map(e=>{
  const s=saved.get(e.id),unpaid=leaveDays(db,b,e.id,month,'Unpaid'),l=s?{basic:s.basic,allowances:s.allowances,commission:s.commission,additions:s.additions,deductions:s.deductions,note:s.note,paidAt:s.paid_at,method:s.method}:{basic:e.basic,allowances:e.allowances,commission:commissionFor(db,b,e.staff_id,month),additions:0,deductions:Math.round(e.basic/30*unpaid),note:unpaid?unpaid+' unpaid leave day'+(unpaid===1?'':'s'):'',paidAt:'',method:''};
  return{employeeId:e.id,name:e.name,job:e.job,...l,net:l.basic+l.allowances+l.commission+l.additions-l.deductions,saved:!!s}});
 const sum=k=>lines.reduce((n,l)=>n+l[k],0);
 return{month,paid,paidAt:lines.find(l=>l.paidAt)?.paidAt||'',lines,totals:{basic:sum('basic'),allowances:sum('allowances'),commission:sum('commission'),additions:sum('additions'),deductions:sum('deductions'),net:sum('net')}};
}
export async function hrRoute({db,u,req,res,path,body,send,limited}){
 if(!path.startsWith('/api/hr/'))return false;
 const b=u.business_id,owner=()=>{if(u.role!=='owner')fail(403,'Owner permission required')},q=()=>new URL(req.url,'http://local').searchParams;
 const txn=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
 const today=businessDay();
 const openShift=id=>db.prepare("SELECT * FROM attendance WHERE business_id=? AND employee_id=? AND time_out='' ORDER BY date DESC,time_in DESC LIMIT 1").get(b,id);
 // Clocking in and out: any signed-in device, with the employee's own PIN.
 if(path==='/api/hr/clock-list'&&req.method==='GET'){send(res,200,db.prepare("SELECT id,name,job FROM employees WHERE business_id=? AND active=1 AND pin<>'' ORDER BY name COLLATE NOCASE").all(b).map(e=>({...e,in:!!openShift(e.id)})));return true}
 if(path==='/api/hr/clock'&&req.method==='POST'){
  const d=await body(req),id=key(d.employeeId);if(typeof d.pin!=='string'||d.pin.length>6)fail(400,'Enter your PIN');limited(hash('hrpin:'+id),5);
  const e=db.prepare("SELECT * FROM employees WHERE business_id=? AND id=? AND active=1 AND pin<>''").get(b,id);if(!e||!pinVerify(d.pin,e.pin))fail(401,'Wrong PIN');
  db.prepare('DELETE FROM login_attempts WHERE key=?').run(hash('hrpin:'+id));
  const open=openShift(id),time=uaeTime();
  if(open){db.prepare('UPDATE attendance SET time_out=? WHERE business_id=? AND id=?').run(open.date===today?time:'23:59',b,open.id);if(open.date===today){send(res,200,{name:e.name,action:'out',time});return true}}
  db.prepare('INSERT INTO attendance(business_id,id,employee_id,date,time_in) VALUES (?,?,?,?,?)').run(b,randomBytes(12).toString('hex'),id,today,time);send(res,200,{name:e.name,action:'in',time});return true;
 }
 owner();
 if(req.method==='GET'){
  if(path==='/api/hr/overview'){
   const list=employees(db,b).map(employeeView),soon=new Date(Date.parse(today)+60*DAY).toISOString().slice(0,10);
   const expiring=list.filter(e=>e.active).flatMap(e=>e.docs.filter(x=>x.expiry&&x.expiry<=soon).map(x=>({employee:e.name,type:x.type,number:x.number,expiry:x.expiry,expired:x.expiry<today}))).sort((x,y)=>x.expiry.localeCompare(y.expiry));
   const todayRows=db.prepare('SELECT employee_id,time_in,time_out FROM attendance WHERE business_id=? AND date=? ORDER BY time_in').all(b,today);
   const staff=db.prepare("SELECT id,data FROM records WHERE business_id=? AND kind='staff' AND data IS NOT NULL").all(b).map(r=>({id:r.id,name:JSON.parse(r.data).name}));
   send(res,200,{today,employees:list,expiring,todayAttendance:todayRows,posStaff:staff,docTypes:DOC_TYPES,leaveTypes:LEAVE_TYPES,
    leaves:db.prepare('SELECT * FROM leaves WHERE business_id=? ORDER BY from_date DESC LIMIT 100').all(b).map(l=>({id:l.id,employeeId:l.employee_id,type:l.type,from:l.from_date,to:l.to_date,days:l.days,note:l.note}))});return true}
  if(path==='/api/hr/attendance'){
   const month=monthKey(q().get('month')||today.slice(0,7)),rows=db.prepare('SELECT * FROM attendance WHERE business_id=? AND date LIKE ? ORDER BY date,time_in').all(b,month+'-%'),by=new Map();
   for(const e of employees(db,b))by.set(e.id,{employeeId:e.id,name:e.name,startTime:e.start_time,days:new Set(),minutes:0,late:0,open:0,entries:[]});
   const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
   for(const r of rows){const x=by.get(r.employee_id);if(!x)continue;const first=!x.days.has(r.date);x.days.add(r.date);if(r.time_out)x.minutes+=Math.max(0,mins(r.time_out)-mins(r.time_in));else x.open++;if(first&&x.startTime&&mins(r.time_in)>mins(x.startTime)+10)x.late++;x.entries.push({date:r.date,in:r.time_in,out:r.time_out})}
   send(res,200,{month,rows:[...by.values()].filter(x=>x.entries.length).map(x=>({...x,days:x.days.size,hours:Math.round(x.minutes/6)/10}))});return true}
  if(path==='/api/hr/payroll'){send(res,200,payrollSheet(db,b,monthKey(q().get('month')||today.slice(0,7))));return true}
  return false;
 }
 if(req.method!=='POST')return false;
 const d=await body(req);
 if(path==='/api/hr/employees'){
  const id=key(d.id),docs=Array.isArray(d.docs)?d.docs:[];if(docs.length>12)fail(400,'Up to 12 documents per employee');
  const e={name:text(d.name,100,'the name'),job:opt(d.job,80),joined:date(d.joined,'joining date'),phone:opt(d.phone,40),basic:money(d.basic,'basic salary'),allowances:money(d.allowances??0,'allowances'),start:d.startTime?(/^([01]\d|2[0-3]):[0-5]\d$/.test(d.startTime)?d.startTime:fail(400,'Enter the start time as HH:MM')):'',staff:d.staffId?key(d.staffId):'',active:d.active===false?0:1,
   docs:JSON.stringify(docs.map(x=>({type:DOC_TYPES.includes(x?.type)?x.type:fail(400,'Choose the document type'),number:opt(x.number,60),expiry:x.expiry?date(x.expiry,'expiry date'):''})))};
  if(e.joined>today)fail(400,'The joining date cannot be in the future');
  if(d.pin!==undefined&&d.pin!==''&&!/^\d{4,6}$/.test(d.pin))fail(400,'A PIN is 4 to 6 digits');
  txn(()=>{const old=db.prepare('SELECT pin FROM employees WHERE business_id=? AND id=?').get(b,id),pin=d.pin===undefined?(old?.pin||''):d.pin===''?'':pinHash(d.pin);
   db.prepare('INSERT INTO employees(business_id,id,name,job,joined,phone,basic,allowances,start_time,staff_id,pin,docs,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(business_id,id) DO UPDATE SET name=excluded.name,job=excluded.job,joined=excluded.joined,phone=excluded.phone,basic=excluded.basic,allowances=excluded.allowances,start_time=excluded.start_time,staff_id=excluded.staff_id,pin=excluded.pin,docs=excluded.docs,active=excluded.active')
    .run(b,id,e.name,e.job,e.joined,e.phone,e.basic,e.allowances,e.start,e.staff,pin,e.docs,e.active,new Date().toISOString());audit(db,u,old?'employee-updated':'employee-added',id)});
  send(res,200,{ok:true,id});return true;
 }
 if(path==='/api/hr/leaves'){
  const id=key(d.id),emp=key(d.employeeId),from=date(d.from,'start date'),to=date(d.to,'end date');if(!LEAVE_TYPES.includes(d.type))fail(400,'Choose the leave type');if(to<from)fail(400,'The end date is before the start date');
  const days=Math.round((Date.parse(to)-Date.parse(from))/DAY)+1;if(days>366)fail(400,'Leave is too long');
  if(!db.prepare('SELECT 1 FROM employees WHERE business_id=? AND id=?').get(b,emp))fail(404,'Employee not found');
  db.prepare('INSERT OR IGNORE INTO leaves VALUES (?,?,?,?,?,?,?,?,?)').run(b,id,emp,d.type,from,to,days,opt(d.note,200),new Date().toISOString());audit(db,u,'leave-recorded',emp);send(res,201,{ok:true,days});return true;
 }
 if(path==='/api/hr/leaves/delete'){db.prepare('DELETE FROM leaves WHERE business_id=? AND id=?').run(b,key(d.id));audit(db,u,'leave-deleted',d.id);send(res,200,{ok:true});return true}
 if(path==='/api/hr/payroll/save'||path==='/api/hr/payroll/pay'){
  const month=monthKey(d.month);if(month>today.slice(0,7))fail(400,'This month has not started yet');
  const out=txn(()=>{
   const sheet=payrollSheet(db,b,month);if(sheet.paid)fail(409,'Salaries for '+month+' are already marked paid');if(!sheet.lines.length)fail(409,'Add employees first');
   const edits=new Map((Array.isArray(d.lines)?d.lines:[]).map(l=>[l.employeeId,l]));
   for(const l of sheet.lines){const e=edits.get(l.employeeId)||{},row={additions:money(e.additions??l.additions,'addition'),deductions:money(e.deductions??l.deductions,'deduction'),note:opt(e.note??l.note,200)};
    if(row.deductions>l.basic+l.allowances+l.commission+row.additions)fail(400,'Deductions for '+l.name+' are more than the pay');
    db.prepare("INSERT INTO payroll(business_id,month,employee_id,basic,allowances,commission,additions,deductions,note) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(business_id,month,employee_id) DO UPDATE SET additions=excluded.additions,deductions=excluded.deductions,note=excluded.note").run(b,month,l.employeeId,l.basic,l.allowances,l.commission,row.additions,row.deductions,row.note)}
   if(path.endsWith('/save')){audit(db,u,'payroll-saved',month);return payrollSheet(db,b,month)}
   if(!['Cash','Bank / card'].includes(d.method))fail(400,'Choose cash or bank');
   const now=new Date().toISOString(),after=payrollSheet(db,b,month),expense=after.totals.net-after.totals.commission; // commission is already in profit & loss
   db.prepare('UPDATE payroll SET paid_at=?,method=? WHERE business_id=? AND month=?').run(now,d.method,b,month);
   if(expense>0)db.prepare('INSERT INTO expenses(business_id,id,date,amount,method,category,note,created_by,created_at,vat) VALUES (?,?,?,?,?,?,?,?,?,0)').run(b,'payroll-'+month,today,expense,d.method,'Salary (excluding commissions)','Salaries '+month+' · '+after.lines.length+' staff',u.id,now);
   audit(db,u,'payroll-paid',month);return payrollSheet(db,b,month)});
  send(res,200,out);return true;
 }
 return false;
}
