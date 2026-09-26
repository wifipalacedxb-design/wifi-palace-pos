import {createHash} from 'node:crypto';
import {audit} from './store.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
export const businessDay=(date=new Date())=>new Date(new Date(date).getTime()+4*3600000).toISOString().slice(0,10);
const dateKey=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail(400,'Choose a valid date');return v};
const amount=v=>{if(!Number.isSafeInteger(v)||v<0||v>100000000)fail(400,'Enter a valid non-negative amount');return v};
const text=(v,max=300)=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'A valid description is required');return v.trim()};
const key=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v))fail(400,'Invalid request identifier');return v};
export function initFinance(db){db.exec(`
CREATE TABLE IF NOT EXISTS salon_expenses(salon_id TEXT NOT NULL,id TEXT NOT NULL,date TEXT NOT NULL,amount INTEGER NOT NULL,method TEXT NOT NULL,category TEXT NOT NULL,note TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,voided_at TEXT,void_reason TEXT,PRIMARY KEY(salon_id,id));
CREATE TABLE IF NOT EXISTS salon_closings(salon_id TEXT NOT NULL,date TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(salon_id,date));
`)}
export function financeReport(db,salon,date){
 dateKey(date);
 const sales=db.prepare("SELECT data FROM records WHERE salon_id=? AND kind='sales' AND data IS NOT NULL ORDER BY id").all(salon).map(r=>JSON.parse(r.data));
 const expenses=db.prepare('SELECT id,date,amount,method,category,note,created_at,voided_at,void_reason FROM salon_expenses WHERE salon_id=? AND date=? ORDER BY created_at,id').all(salon,date);
 const totals={sales:0,refunds:0,netSalesBeforeTax:0,cashSales:0,cashRefunds:0,cardSales:0,cardRefunds:0,expenses:0,cashExpenses:0,commission:0,legacySales:0};
 const commissions=new Map(),events=[];
 for(const s of sales){const sold=businessDay(s.date)===date,refunded=s.status==='Refunded'&&businessDay(s.refundDate)===date;if(!sold&&!refunded)continue;
  events.push([s.id,sold?s.total:0,refunded?s.total:0,s.method,s.commissionAmount??null,s.staffId||'',s.staff,...(s.method==='Split'?[s.cashAmount,s.cardAmount]:[])]);
  if(sold){totals.sales+=s.total;totals.netSalesBeforeTax+=s.sub-s.off;totals.cashSales+=s.method==='Split'?s.cashAmount:s.method==='Cash'?s.total:0;totals.cardSales+=s.method==='Split'?s.cardAmount:s.method==='Card (external terminal)'?s.total:0;if(!Number.isSafeInteger(s.commissionAmount))totals.legacySales++}
  if(refunded){totals.refunds+=s.total;totals.netSalesBeforeTax-=s.sub-s.off;totals.cashRefunds+=s.method==='Split'?s.cashAmount:s.method==='Cash'?s.total:0;totals.cardRefunds+=s.method==='Split'?s.cardAmount:s.method==='Card (external terminal)'?s.total:0}
  if(Number.isSafeInteger(s.commissionAmount)){const row=commissions.get(s.staffId)||{id:s.staffId,name:s.staff,earned:0,reversed:0};if(sold)row.earned+=s.commissionAmount;if(refunded)row.reversed+=s.commissionAmount;commissions.set(s.staffId,row);totals.commission+=(sold?s.commissionAmount:0)-(refunded?s.commissionAmount:0)}
 }
 for(const e of expenses){if(e.voided_at)continue;totals.expenses+=e.amount;if(e.method==='Cash')totals.cashExpenses+=e.amount}
 const fingerprint=createHash('sha256').update(JSON.stringify({events,expenses})).digest('hex');
 const row=db.prepare('SELECT data FROM salon_closings WHERE salon_id=? AND date=?').get(salon,date),closing=row?JSON.parse(row.data):null;
 return{date,timeZone:'Asia/Dubai',totals,expenses,commissions:[...commissions.values()],fingerprint,closing,changedSinceClose:!!closing&&closing.fingerprint!==fingerprint};
}
export async function financeRoute({db,u,req,res,path,body,send}){
 if(!path.startsWith('/api/finance/'))return false;
 if(u.role!=='owner')fail(403,'Owner permission required');
 if(path==='/api/finance/report'&&req.method==='GET'){send(res,200,financeReport(db,u.salon_id,new URL(req.url,'http://local').searchParams.get('date')||businessDay()));return true}
 if(path==='/api/finance/expenses'&&req.method==='POST'){
  const b=await body(req),expense={id:key(b.id),date:dateKey(b.date),amount:amount(b.amount),method:b.method,category:text(b.category,60),note:text(b.note)};
  if(!['Cash','Bank / card'].includes(expense.method)||expense.amount===0||expense.date>businessDay())fail(400,'Choose a payment method, positive amount and a date no later than today');
  db.exec('BEGIN IMMEDIATE');try{
   const old=db.prepare('SELECT * FROM salon_expenses WHERE salon_id=? AND id=?').get(u.salon_id,expense.id);
   if(old){if(Object.keys(expense).some(k=>old[k]!==expense[k]))fail(409,'Expense identifier already used');db.exec('COMMIT');send(res,200,{ok:true,id:expense.id});return true}
   db.prepare('INSERT INTO salon_expenses VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL)').run(u.salon_id,expense.id,expense.date,expense.amount,expense.method,expense.category,expense.note,u.id,new Date().toISOString());audit(db,u,'expense-created',expense.id);db.exec('COMMIT');send(res,201,{ok:true,id:expense.id});return true;
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 if(path==='/api/finance/void-expense'&&req.method==='POST'){const b=await body(req),id=key(b.id),reason=text(b.reason);db.exec('BEGIN IMMEDIATE');try{const old=db.prepare('SELECT id FROM salon_expenses WHERE salon_id=? AND id=?').get(u.salon_id,id);if(!old)fail(404,'Expense not found');const result=db.prepare('UPDATE salon_expenses SET voided_at=?,void_reason=? WHERE salon_id=? AND id=? AND voided_at IS NULL').run(new Date().toISOString(),reason,u.salon_id,id);if(result.changes)audit(db,u,'expense-voided',id+':'+reason);db.exec('COMMIT');send(res,200,{ok:true});return true}catch(e){db.exec('ROLLBACK');throw e}}
 if(path==='/api/finance/close'&&req.method==='POST'){
  const b=await body(req),date=dateKey(b.date),opening=amount(b.opening),cashIn=amount(b.cashIn),cashOut=amount(b.cashOut),counted=amount(b.counted),note=text(b.note),requestId=key(b.id);
  if(date>businessDay())fail(400,'Cannot close a future day');
  db.exec('BEGIN IMMEDIATE');try{
   const r=financeReport(db,u.salon_id,date);
   if(r.closing){if(r.closing.id===requestId&&['opening','cashIn','cashOut','counted','note'].every(k=>r.closing[k]===({opening,cashIn,cashOut,counted,note})[k])){db.exec('COMMIT');send(res,200,r.closing);return true}fail(409,'This day already has a closing. Later activity is shown as an adjustment; the original closing stays unchanged.')}
   if(b.fingerprint!==r.fingerprint)fail(409,'Sales or expenses changed. Refresh the report and recount before closing.');
   const expected=opening+r.totals.cashSales-r.totals.cashRefunds-r.totals.cashExpenses+cashIn-cashOut;
   const closing={id:requestId,date,opening,cashIn,cashOut,counted,note,expected,variance:counted-expected,fingerprint:r.fingerprint,totals:r.totals,closedBy:u.name,closedAt:new Date().toISOString()};
   db.prepare('INSERT INTO salon_closings VALUES (?,?,?)').run(u.salon_id,date,JSON.stringify(closing));audit(db,u,'cash-day-closed',date);db.exec('COMMIT');send(res,201,closing);return true;
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 fail(404,'Finance action not found');
}
