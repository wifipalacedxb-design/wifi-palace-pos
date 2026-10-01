// Accounting inside the POS (owner only, online): suppliers, purchase bills with input VAT, supplier
// payments and what is owed, plus period reports built from the same cloud records as the daily report:
// a VAT return summary laid out like the FTA VAT 201 form, profit & loss, and a cash & bank book.
// Money is in fils (1/100 AED). Sales count on their UAE business day; refunds on their refund day.
import {audit} from './store.mjs';
import {businessDay} from './finance.mjs';
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
const dateKey=(v,label='date')=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail(400,'Choose a valid '+label);return v};
const money=(v,label='amount')=>{if(!Number.isSafeInteger(v)||v<0||v>100000000)fail(400,'Enter a valid '+label);return v};
const text=(v,max=300,label='description')=>{if(typeof v!=='string'||!v.trim()||v.length>max)fail(400,'Enter the '+label);return v.trim()};
const optional=(v,max=300)=>{if(v===undefined||v===null||v==='')return '';if(typeof v!=='string'||v.length>max)fail(400,'Text is too long');return v.trim()};
const key=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(v))fail(400,'Invalid request identifier');return v};
export const BILL_CATEGORIES=['Stock for resale','Supplies','Rent','Utilities','Salaries','Marketing','Repairs & maintenance','Professional fees','Equipment (asset)','Other'];
export const PAY_METHODS=['Cash','Bank / card'];
const COST_OF_SALES='Stock for resale',ASSET='Equipment (asset)';
const range=(from,to)=>{dateKey(from,'start date');dateKey(to,'end date');if(from>to)fail(400,'Start date must be on or before end date');if(Date.parse(to)-Date.parse(from)>800*86400000)fail(400,'Choose a period of up to 2 years');return{from,to}};

export function initAccounts(db){
 db.exec(`
CREATE TABLE IF NOT EXISTS suppliers(business_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,trn TEXT NOT NULL,phone TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(business_id,id));
CREATE TABLE IF NOT EXISTS purchase_bills(business_id TEXT NOT NULL,id TEXT NOT NULL,supplier_id TEXT NOT NULL,number TEXT NOT NULL,date TEXT NOT NULL,due TEXT NOT NULL,category TEXT NOT NULL,net INTEGER NOT NULL,vat INTEGER NOT NULL,total INTEGER NOT NULL,note TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,voided_at TEXT,void_reason TEXT,PRIMARY KEY(business_id,id));
CREATE TABLE IF NOT EXISTS supplier_payments(business_id TEXT NOT NULL,id TEXT NOT NULL,supplier_id TEXT NOT NULL,bill_id TEXT NOT NULL,date TEXT NOT NULL,amount INTEGER NOT NULL,method TEXT NOT NULL,note TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,voided_at TEXT,void_reason TEXT,PRIMARY KEY(business_id,id));
CREATE INDEX IF NOT EXISTS purchase_bills_date ON purchase_bills(business_id,date);
CREATE INDEX IF NOT EXISTS supplier_payments_date ON supplier_payments(business_id,date);
`);
 // Expenses can carry the VAT on the receipt so it is claimed as input tax (older rows have none).
 if(!db.prepare('PRAGMA table_info(expenses)').all().some(c=>c.name==='vat'))db.exec('ALTER TABLE expenses ADD COLUMN vat INTEGER NOT NULL DEFAULT 0');
}

const suppliersOf=(db,b)=>db.prepare('SELECT id,name,trn,phone,note FROM suppliers WHERE business_id=? ORDER BY name COLLATE NOCASE,id').all(b);
const billsOf=(db,b)=>db.prepare('SELECT id,supplier_id,number,date,due,category,net,vat,total,note,created_at,voided_at,void_reason FROM purchase_bills WHERE business_id=? ORDER BY date,created_at,id').all(b);
const paymentsOf=(db,b)=>db.prepare('SELECT id,supplier_id,bill_id,date,amount,method,note,created_at,voided_at,void_reason FROM supplier_payments WHERE business_id=? ORDER BY date,created_at,id').all(b);

// What each supplier is owed. A payment made against a bill settles that bill first; anything else
// (or any excess) settles the oldest open bills. Voided bills and payments are ignored.
export function payables(db,business){
 const suppliers=suppliersOf(db,business),bills=billsOf(db,business),payments=paymentsOf(db,business);
 const live=bills.filter(b=>!b.voided_at).map(b=>({...b,paid:0})),byId=new Map(live.map(b=>[b.id,b]));
 const rows=new Map(suppliers.map(s=>[s.id,{...s,billed:0,paid:0,balance:0,advance:0,overdue:0,openBills:0}]));
 for(const b of live){const r=rows.get(b.supplier_id);if(r)r.billed+=b.total}
 const loose=new Map();
 for(const p of payments){if(p.voided_at)continue;const r=rows.get(p.supplier_id);if(r)r.paid+=p.amount;let left=p.amount;const b=p.bill_id&&byId.get(p.bill_id);if(b&&b.supplier_id===p.supplier_id){const use=Math.min(left,b.total-b.paid);b.paid+=use;left-=use}if(left)loose.set(p.supplier_id,(loose.get(p.supplier_id)||0)+left)}
 for(const b of live){let left=loose.get(b.supplier_id)||0;if(!left)continue;const use=Math.min(left,b.total-b.paid);b.paid+=use;loose.set(b.supplier_id,left-use)}
 const today=businessDay();
 for(const b of live){b.outstanding=b.total-b.paid;b.status=b.outstanding===0?'Paid':b.paid?'Part paid':'Unpaid';const r=rows.get(b.supplier_id);if(r&&b.outstanding){r.openBills++;if(b.due&&b.due<today)r.overdue+=b.outstanding}}
 for(const r of rows.values()){r.balance=r.billed-r.paid;r.advance=loose.get(r.id)||0}
 const status=new Map(live.map(b=>[b.id,b]));
 const list=bills.map(b=>b.voided_at?{...b,paid:0,outstanding:0,status:'Voided'}:status.get(b.id));
 const out=[...rows.values()];
 return{suppliers:out,bills:list,payments,totals:{owed:out.reduce((n,r)=>n+Math.max(0,r.balance),0),overdue:out.reduce((n,r)=>n+r.overdue,0),advances:out.reduce((n,r)=>n+Math.max(0,-r.balance),0)},categories:BILL_CATEGORIES,methods:PAY_METHODS};
}

const allSales=(db,b)=>db.prepare("SELECT data FROM records WHERE business_id=? AND kind='sales' AND data IS NOT NULL ORDER BY id").all(b).map(r=>JSON.parse(r.data));
const expensesIn=(db,b,from,to)=>db.prepare('SELECT id,date,amount,vat,method,category,note FROM expenses WHERE business_id=? AND voided_at IS NULL AND date>=? AND date<=? ORDER BY date,created_at,id').all(b,from,to);
const billsIn=(db,b,from,to)=>db.prepare('SELECT * FROM purchase_bills WHERE business_id=? AND voided_at IS NULL AND date>=? AND date<=? ORDER BY date,created_at,id').all(b,from,to);
const inside=(d,from,to)=>{const day=businessDay(d);return day>=from&&day<=to};

// VAT return summary. Output tax is the VAT on invoices issued in the period less VAT on refunds issued
// in the period (credit notes). Input tax is the VAT on supplier bills and expense receipts dated in the
// period. Box numbers follow the FTA VAT 201 form; the owner / accountant chooses the emirate row.
export function vatReturn(db,business,from,to){
 range(from,to);
 const settings=JSON.parse(db.prepare("SELECT data FROM records WHERE business_id=? AND kind='settings' AND id='singleton'").get(business)?.data||'{}');
 const out={standardNet:0,standardVat:0,noVatNet:0,invoices:0,refunds:0,refundNet:0,refundVat:0},outputLines=[],inputLines=[];
 for(const s of allSales(db,business)){
  const net=s.sub-s.off,vat=s.tax||0;
  if(inside(s.date,from,to))outputLines.push({date:businessDay(s.date),type:s.documentType||'Invoice',number:s.number||'',party:s.customer||'Walk-in customer',net,vat,total:s.total});
  if(s.status==='Refunded'&&s.refundDate&&inside(s.refundDate,from,to))outputLines.push({date:businessDay(s.refundDate),type:'Refund (credit note)',number:s.creditNote||s.number||'',party:s.customer||'Walk-in customer',net:-net,vat:-vat,total:-s.total});
  if(inside(s.date,from,to)){out.invoices++;if(vat>0){out.standardNet+=net;out.standardVat+=vat}else out.noVatNet+=net}
  if(s.status==='Refunded'&&s.refundDate&&inside(s.refundDate,from,to)){out.refunds++;out.refundNet+=net;out.refundVat+=vat;if(vat>0){out.standardNet-=net;out.standardVat-=vat}else out.noVatNet-=net}
 }
 const bills=billsIn(db,business,from,to),expenses=expensesIn(db,business,from,to);
 const inp={net:0,vat:0,billNet:0,billVat:0,expenseNet:0,expenseVat:0,noVatCosts:0,bills:bills.length,expenses:expenses.length};
 const names=new Map(suppliersOf(db,business).map(x=>[x.id,x]));
 for(const b of bills){const sp=names.get(b.supplier_id);inputLines.push({date:b.date,type:'Purchase bill · '+b.category,number:b.number,party:sp?.name||'',trn:sp?.trn||'',net:b.net,vat:b.vat,total:b.total})}
 for(const e of expenses)inputLines.push({date:e.date,type:'Expense · '+e.category,number:'',party:e.note,trn:'',net:e.amount-(e.vat||0),vat:e.vat||0,total:e.amount});
 outputLines.sort((a,b)=>a.date.localeCompare(b.date)||String(a.number).localeCompare(String(b.number)));inputLines.sort((a,b)=>a.date.localeCompare(b.date));
 for(const b of bills){if(b.vat>0){inp.billNet+=b.net;inp.billVat+=b.vat}else inp.noVatCosts+=b.net}
 for(const e of expenses){const vat=e.vat||0;if(vat>0){inp.expenseNet+=e.amount-vat;inp.expenseVat+=vat}else inp.noVatCosts+=e.amount}
 inp.net=inp.billNet+inp.expenseNet;inp.vat=inp.billVat+inp.expenseVat;
 const boxes=[
  {box:'1',label:'Standard rated supplies (enter under your emirate: 1a Abu Dhabi … 1g Fujairah)',amount:out.standardNet,vat:out.standardVat},
  {box:'2',label:'Tax refunds provided to tourists',amount:0,vat:0},
  {box:'3',label:'Supplies subject to the reverse charge',amount:0,vat:0},
  {box:'4',label:'Zero rated supplies',amount:0,vat:null},
  {box:'5',label:'Exempt supplies',amount:0,vat:null},
  {box:'6',label:'Goods imported into the UAE',amount:0,vat:0},
  {box:'7',label:'Adjustments to goods imported',amount:0,vat:0},
  {box:'8',label:'Totals (output)',amount:out.standardNet,vat:out.standardVat},
  {box:'9',label:'Standard rated expenses',amount:inp.net,vat:inp.vat},
  {box:'10',label:'Supplies subject to the reverse charge',amount:0,vat:0},
  {box:'11',label:'Totals (input)',amount:inp.net,vat:inp.vat}
 ];
 const due=out.standardVat-inp.vat;
 return{from,to,outputLines,inputLines,trn:settings.trn||'',rate:settings.tax??0,business:settings.name||'',boxes,output:out,input:inp,netVat:due,payable:due>0?due:0,refundable:due<0?-due:0,
  notes:['Check with your accountant before filing on EmaraTax. This summary only covers what was recorded in the POS.',
   ...(out.noVatNet?['Sales without VAT charged ('+(out.noVatNet/100).toFixed(2)+' AED) are not placed in a box: your accountant decides whether they are zero-rated (box 4), exempt (box 5) or outside scope.']:[]),
   ...(inp.noVatCosts?['Costs recorded without VAT ('+(inp.noVatCosts/100).toFixed(2)+' AED) are not claimed. Enter the VAT on a bill or expense only when you hold a valid tax invoice.']:[]),
   'Imports, reverse charge and tourist refunds are not tracked by the POS; add them by hand if they apply.']};
}

// Profit & loss (accrual, before tax). Stock purchases are treated as cost of sales in the period they are
// billed; stock on hand is not valued, so a month with a big stock-up looks worse than it is.
export function profitLoss(db,business,from,to){
 range(from,to);
 const sales={gross:0,discounts:0,refunds:0,net:0,commission:0,bills:0};
 for(const s of allSales(db,business)){
  if(inside(s.date,from,to)){sales.bills++;sales.gross+=s.sub;sales.discounts+=s.off;if(Number.isSafeInteger(s.commissionAmount))sales.commission+=s.commissionAmount}
  if(s.status==='Refunded'&&s.refundDate&&inside(s.refundDate,from,to)){sales.refunds+=s.sub-s.off;if(Number.isSafeInteger(s.commissionAmount))sales.commission-=s.commissionAmount}
 }
 sales.net=sales.gross-sales.discounts-sales.refunds;
 const lines=new Map(),add=(group,label,v)=>{const k=group+'|'+label;const r=lines.get(k)||{group,label,amount:0};r.amount+=v;lines.set(k,r)};
 let costOfSales=0,assets=0;
 for(const b of billsIn(db,business,from,to)){if(b.category===COST_OF_SALES){costOfSales+=b.net;continue}if(b.category===ASSET){assets+=b.net;continue}add('Expenses',b.category,b.net)}
 for(const e of expensesIn(db,business,from,to))add('Expenses',e.category,e.amount-(e.vat||0));
 if(sales.commission)add('Expenses','Staff commissions (earned)',sales.commission);
 const expenses=[...lines.values()].sort((a,b)=>b.amount-a.amount||a.label.localeCompare(b.label)),totalExpenses=expenses.reduce((n,r)=>n+r.amount,0);
 const grossProfit=sales.net-costOfSales,netProfit=grossProfit-totalExpenses;
 return{from,to,sales,costOfSales,grossProfit,expenses,totalExpenses,netProfit,assets,margin:sales.net?Math.round(netProfit/sales.net*1000)/10:0,
  notes:['Amounts exclude VAT. Sales count on the bill date; refunds on the refund date.','Stock purchases ("'+COST_OF_SALES+'" bills) count as cost of sales when billed; stock on hand is not valued.',...(assets?['Equipment bought ('+(assets/100).toFixed(2)+' AED) is an asset and is not in the profit figure.']:[]),'Commissions are earned amounts; record salary payments as expenses without the commission part.']};
}

// Cash & bank book: every money movement the POS knows about, with running balances. Card terminal
// takings, card payments and "Bank / card" spending go to the bank book. The opening balance is the sum
// of everything recorded before the period (the POS does not know the balance before it was used).
export function cashBook(db,business,from,to){
 range(from,to);
 const moves=[],push=(date,book,type,ref,detail,amount)=>{if(amount)moves.push({date,book,type,ref,detail,amount})};
 const daily=new Map(),day=(date,book,type,v)=>{const k=date+'|'+book+'|'+type;daily.set(k,(daily.get(k)||0)+v)};
 for(const s of allSales(db,business)){
  const cash=s.method==='Split'?s.cashAmount:s.method==='Cash'?s.total:0,card=s.method==='Split'?s.cardAmount:s.method==='Card (external terminal)'?s.total:0;
  const d=businessDay(s.date);day(d,'Cash','Sales',cash);day(d,'Bank','Card sales',card);
  if(s.status==='Refunded'&&s.refundDate){const r=businessDay(s.refundDate);day(r,'Cash','Refunds',-cash);day(r,'Bank','Card refunds',-card)}
 }
 for(const [k,v] of daily){const [date,book,type]=k.split('|');push(date,book,type,'','Daily total',v)}
 for(const r of db.prepare("SELECT data FROM records WHERE business_id=? AND kind='grocery_payments' AND data IS NOT NULL").all(business)){const p=JSON.parse(r.data);push(businessDay(p.at),p.method==='Cash'?'Cash':'Bank','Account payment','',p.customer,p.amount)}
 for(const e of db.prepare('SELECT date,amount,method,category,note FROM expenses WHERE business_id=? AND voided_at IS NULL').all(business))push(e.date,e.method==='Cash'?'Cash':'Bank','Expense','',e.category+' · '+e.note,-e.amount);
 const names=new Map(suppliersOf(db,business).map(s=>[s.id,s.name]));
 for(const p of paymentsOf(db,business))if(!p.voided_at)push(p.date,p.method==='Cash'?'Cash':'Bank','Supplier payment','',(names.get(p.supplier_id)||'Supplier')+(p.note?' · '+p.note:''),-p.amount);
 for(const c of db.prepare('SELECT data FROM day_closings WHERE business_id=?').all(business).map(r=>JSON.parse(r.data))){push(c.date,'Cash','Other cash in','',c.note||'Daily closing',c.cashIn);push(c.date,'Cash','Other cash out','',c.note||'Daily closing',-c.cashOut)}
 const order={'Sales':0,'Card sales':0,'Account payment':1,'Refunds':2,'Card refunds':2,'Expense':3,'Supplier payment':4,'Other cash in':5,'Other cash out':6};
 moves.sort((a,b)=>a.date.localeCompare(b.date)||order[a.type]-order[b.type]||a.detail.localeCompare(b.detail));
 const books={};
 for(const name of ['Cash','Bank']){
  const all=moves.filter(m=>m.book===name),opening=all.filter(m=>m.date<from).reduce((n,m)=>n+m.amount,0);let bal=opening,inflow=0,outflow=0;
  const entries=all.filter(m=>m.date>=from&&m.date<=to).map(m=>{bal+=m.amount;if(m.amount>0)inflow+=m.amount;else outflow-=m.amount;return{...m,balance:bal}});
  books[name]={opening,inflow,outflow,closing:bal,entries};
 }
 return{from,to,books,notes:['Opening balances are the total of everything recorded in the POS before this period, not your real bank balance.','Cash: drawer sales, cash refunds, cash account payments, cash expenses, cash supplier payments and other cash in/out from daily closings. The opening float is not included.','Bank: card terminal takings (before bank fees), card account payments, and anything paid by bank / card.']};
}

export async function accountsRoute({db,u,req,res,path,body,send}){
 const b=u.business_id,q=()=>new URL(req.url,'http://local').searchParams;
 const txn=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
 if(req.method==='GET'){
  if(path==='/api/finance/payables'){send(res,200,payables(db,b));return true}
  const p=q(),from=p.get('from')||businessDay().slice(0,8)+'01',to=p.get('to')||businessDay();
  if(path==='/api/finance/vat'){send(res,200,vatReturn(db,b,from,to));return true}
  if(path==='/api/finance/pnl'){send(res,200,profitLoss(db,b,from,to));return true}
  if(path==='/api/finance/book'){send(res,200,cashBook(db,b,from,to));return true}
  return false;
 }
 if(req.method!=='POST')return false;
 if(path==='/api/finance/suppliers'){
  const d=await body(req),s={id:key(d.id),name:text(d.name,100,'supplier name'),trn:optional(d.trn,20).replace(/\s/g,''),phone:optional(d.phone,40),note:optional(d.note,200)};
  if(s.trn&&!/^\d{15}$/.test(s.trn))fail(400,'A UAE TRN has 15 digits');
  txn(()=>{const now=new Date().toISOString(),old=db.prepare('SELECT id FROM suppliers WHERE business_id=? AND id=?').get(b,s.id);
   if(db.prepare('SELECT id FROM suppliers WHERE business_id=? AND lower(name)=lower(?) AND id<>?').get(b,s.name,s.id))fail(409,'A supplier with this name already exists');
   if(old)db.prepare('UPDATE suppliers SET name=?,trn=?,phone=?,note=?,updated_at=? WHERE business_id=? AND id=?').run(s.name,s.trn,s.phone,s.note,now,b,s.id);
   else db.prepare('INSERT INTO suppliers VALUES (?,?,?,?,?,?,?,?)').run(b,s.id,s.name,s.trn,s.phone,s.note,now,now);
   audit(db,u,old?'supplier-updated':'supplier-created',s.id)});
  send(res,200,{ok:true,id:s.id});return true;
 }
 if(path==='/api/finance/bills'){
  const d=await body(req),bill={id:key(d.id),supplier_id:key(d.supplierId),number:text(d.number,60,'supplier invoice number'),date:dateKey(d.date,'bill date'),due:d.due?dateKey(d.due,'due date'):'',category:d.category,net:money(d.net,'amount before VAT'),vat:money(d.vat??0,'VAT amount'),note:optional(d.note,300)};
  if(!BILL_CATEGORIES.includes(bill.category))fail(400,'Choose a category');
  if(!bill.net)fail(400,'Enter the amount before VAT');if(bill.date>businessDay())fail(400,'The bill date cannot be in the future');if(bill.due&&bill.due<bill.date)fail(400,'The due date is before the bill date');
  if(bill.vat>Math.ceil(bill.net*0.05)+100)fail(400,'VAT is more than 5% of the amount. Check the figures.');
  bill.total=bill.net+bill.vat;
  const pay=d.paid?{id:key(d.paid.id),method:d.paid.method}:null;if(pay&&!PAY_METHODS.includes(pay.method))fail(400,'Choose how the bill was paid');
  const status=txn(()=>{
   const old=db.prepare('SELECT * FROM purchase_bills WHERE business_id=? AND id=?').get(b,bill.id);
   if(old){if(Object.keys(bill).some(k=>old[k]!==bill[k]))fail(409,'Bill identifier already used');return 200}
   if(!db.prepare('SELECT id FROM suppliers WHERE business_id=? AND id=?').get(b,bill.supplier_id))fail(404,'Supplier not found');
   if(db.prepare('SELECT id FROM purchase_bills WHERE business_id=? AND supplier_id=? AND lower(number)=lower(?) AND voided_at IS NULL').get(b,bill.supplier_id,bill.number))fail(409,'This supplier invoice number is already recorded');
   const now=new Date().toISOString();
   db.prepare('INSERT INTO purchase_bills VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(b,bill.id,bill.supplier_id,bill.number,bill.date,bill.due,bill.category,bill.net,bill.vat,bill.total,bill.note,u.id,now);
   audit(db,u,'bill-created',bill.id);
   if(pay){db.prepare('INSERT INTO supplier_payments VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(b,pay.id,bill.supplier_id,bill.id,bill.date,bill.total,pay.method,'Paid on bill '+bill.number,u.id,now);audit(db,u,'supplier-paid',pay.id)}
   return 201});
  send(res,status,{ok:true,id:bill.id});return true;
 }
 if(path==='/api/finance/supplier-payments'){
  const d=await body(req),p={id:key(d.id),supplier_id:key(d.supplierId),bill_id:d.billId?key(d.billId):'',date:dateKey(d.date,'payment date'),amount:money(d.amount),method:d.method,note:optional(d.note,200)};
  if(!p.amount)fail(400,'Enter the amount paid');if(!PAY_METHODS.includes(p.method))fail(400,'Choose cash or bank / card');if(p.date>businessDay())fail(400,'The payment date cannot be in the future');
  const status=txn(()=>{
   const old=db.prepare('SELECT * FROM supplier_payments WHERE business_id=? AND id=?').get(b,p.id);
   if(old){if(Object.keys(p).some(k=>old[k]!==p[k]))fail(409,'Payment identifier already used');return 200}
   const pb=payables(db,b),s=pb.suppliers.find(x=>x.id===p.supplier_id);if(!s)fail(404,'Supplier not found');
   if(p.bill_id){const bill=pb.bills.find(x=>x.id===p.bill_id);if(!bill||bill.supplier_id!==p.supplier_id||bill.status==='Voided')fail(404,'Bill not found');if(p.amount>bill.outstanding)fail(409,'This is more than the bill still owes ('+(bill.outstanding/100).toFixed(2)+' AED)')}
   else if(p.amount>s.balance)fail(409,'This is more than you owe '+s.name+' ('+(Math.max(0,s.balance)/100).toFixed(2)+' AED). Record the bill first.');
   db.prepare('INSERT INTO supplier_payments VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL)').run(b,p.id,p.supplier_id,p.bill_id,p.date,p.amount,p.method,p.note,u.id,new Date().toISOString());
   audit(db,u,'supplier-paid',p.id);return 201});
  send(res,status,{ok:true,id:p.id});return true;
 }
 if(path==='/api/finance/void-bill'||path==='/api/finance/void-supplier-payment'){
  const d=await body(req),id=key(d.id),reason=text(d.reason,200,'reason'),bill=path.endsWith('bill'),table=bill?'purchase_bills':'supplier_payments';
  txn(()=>{
   const row=db.prepare(`SELECT * FROM ${table} WHERE business_id=? AND id=?`).get(b,id);if(!row)fail(404,bill?'Bill not found':'Payment not found');if(row.voided_at)return;
   if(bill&&db.prepare('SELECT id FROM supplier_payments WHERE business_id=? AND bill_id=? AND voided_at IS NULL').get(b,id))fail(409,'Void the payment recorded against this bill first');
   db.prepare(`UPDATE ${table} SET voided_at=?,void_reason=? WHERE business_id=? AND id=?`).run(new Date().toISOString(),reason,b,id);
   if(bill){const s=payables(db,b).suppliers.find(x=>x.id===row.supplier_id);if(s&&s.balance<0)fail(409,'Payments already made would exceed the remaining bills. Void a payment first.')}
   audit(db,u,bill?'bill-voided':'supplier-payment-voided',id+':'+reason)});
  send(res,200,{ok:true});return true;
 }
 return false;
}
