import {hash,audit,nextNumber,documentNumber} from './store.mjs';
import {ApiError,fail,text,required,amount,image,get} from './check.mjs';
import {businessModule,kindsFor,CORE_OWNER_KINDS} from './modules.mjs';
import {recordChange,claimTillNumber} from './sync.mjs';
export {ApiError};
function validate(db,u,kind,key,data,old){
 const salon=u.business_id,mod=businessModule(u.business_type||'salon');
 if(mod.kinds.includes(kind))return mod.validate({db,u,business:salon,kind,key,data,old});
 if(kind==='settings'){if(!Number.isFinite(data.tax)||data.tax<0||data.tax>100)fail('Invalid tax rate');return{name:required(data.name,100),phone:text(data.phone,40),address:text(data.address,500),trn:text(data.trn,40),tax:data.tax,logo:image(data.logo),...(data.footer?{footer:text(data.footer,300)}:{})}}
 if(kind==='vendor')return {logo:image(data.logo)};
 if(kind==='staff'){const commissionBps=data.commissionBps??old?.commissionBps??0;if(!Number.isInteger(commissionBps)||commissionBps<0||commissionBps>10000)fail('Commission must be 0–100%');return{id:key,name:required(data.name,100),commissionBps};}
 if(kind==='customers'){
  const dob=data.dob??old?.dob??'';
  const today=new Date(Date.now()+4*3600000).toISOString().slice(0,10);
  if(typeof dob!=='string'||(dob&&(!/^\d{4}-\d{2}-\d{2}$/.test(dob)||!Number.isFinite(Date.parse(dob))||new Date(dob).toISOString().slice(0,10)!==dob||dob<'1900-01-01'||dob>today)))fail('Enter a valid date of birth, from 1900 through today');
  return{id:key,name:required(data.name,100),phone:text(data.phone,40),dob};
 }
 if(kind==='sales'){
  if(old){if(u.role!=='owner')fail('Only the salon owner can refund a sale',403);if(old.status!=='Paid'||data.status!=='Refunded')fail('Saved sales cannot be edited',409);return{...old,status:'Refunded',refundReason:required(data.refundReason,500),refundDate:new Date().toISOString(),refundedBy:u.id,creditNote:documentNumber('CN',nextNumber(db,salon,'credit-note'))};}
  if(data.status!=='Paid'||!Array.isArray(data.items)||data.items.length<1||data.items.length>100)fail('Invalid sale');
  const settingsRow=get(db,salon,'settings','singleton'),shop={...settingsRow,logo:''}; // the logo is printed from current settings, not stored per sale
  const items=data.items.map(i=>{const service=get(db,salon,mod.catalogKind,i.id);if(!service)fail('A service was removed. Review this pending bill.',409);// Catalogue items marked "price can change" accept the price typed at checkout; all others must match the list price.
  // Modules with item options (restaurant) price the line as item + chosen options, all checked against the menu.
  const opt=typeof mod.lineOptions==='function'?mod.lineOptions(service,i):null,expected=opt?opt.price:service.price;
  const custom=service.openPrice===true&&Number.isSafeInteger(i.price)&&i.price>=0&&i.price<=10000000;if(i.price!==expected&&!custom)fail('A service price changed. Review this pending bill.',409);const q=i.qty,kg=!!service.unit&&service.unit!=='piece';if(typeof q!=='number'||!Number.isFinite(q)||q<=0||q>(kg?(service.unit==='kg'?1000:100000):(mod.maxPieces||100))||(kg?Math.abs(Math.round(q*1000)-q*1000)>1e-6:!Number.isInteger(q)))fail('Invalid quantity');const line={id:service.id,name:service.name};for(const k of ['category','unit','type'])if(service[k]!==undefined)line[k]=service[k];if(opt&&opt.options.length)line.options=opt.options;if(opt&&opt.note)line.note=opt.note;line.price=i.price;if(i.price!==expected)line.listPrice=expected;line.qty=q;return line});
  const sub=amount(items.reduce((n,i)=>n+Math.round(i.price*i.qty),0)),off=amount(data.off);if(off>sub)fail('Discount exceeds subtotal');const tax=Math.round((sub-off)*settingsRow.tax/100),total=sub-off+tax;
  if(data.total!==total||data.tax!==tax||data.sub!==sub)fail('Bill totals differ from the cloud catalogue or tax settings. Review before syncing.',409);
  // Credit (account) sales: only business types that keep customer accounts (grocery khata); nothing is collected now.
  const credit=data.method==='Credit (account)';
  if(credit&&!mod.creditSales)fail('Invalid payment method');
  if(!credit&&!['Cash','Card (external terminal)','Split'].includes(data.method))fail('Invalid payment method');
  const received=amount(data.received);if(!credit&&received<total)fail('Insufficient payment');
  if(credit&&(received!==0||(data.cashAmount??0)!==0||(data.cardAmount??0)!==0))fail('A credit sale collects no money now');
  if(credit&&!data.customerId)fail('Choose the customer account for a credit sale');
  let cashAmount=data.method==='Cash'?total:0,cardAmount=data.method==='Card (external terminal)'?total:0;
  if(credit){}
  else if(data.method==='Split'){cashAmount=amount(data.cashAmount);cardAmount=amount(data.cardAmount);if(cashAmount<=0||cardAmount<=0||cashAmount+cardAmount!==total)fail('Cash and card portions must both be positive and equal the bill total');}
  else {if(data.cashAmount!==undefined&&data.cashAmount!==cashAmount||data.cardAmount!==undefined&&data.cardAmount!==cardAmount)fail('Payment portions do not match the payment method');if(data.method==='Card (external terminal)'&&received!==total)fail('Card payment must equal the bill total');}
  const cashReceived=received-cardAmount;if(!credit&&cashReceived<cashAmount)fail('Insufficient cash payment');
  if(!Number.isFinite(Date.parse(data.date))||Date.parse(data.date)>Date.now()+300000)fail('Invalid sale date');
  const customerId=text(data.customerId,100),customer=customerId?get(db,salon,'customers',customerId):null;if(customerId&&!customer)fail('Customer must sync before their sale',409);
  let commission={};
  if(data.staffId){const stylist=get(db,salon,'staff',data.staffId);if(!stylist)fail('Stylist no longer exists',409);const rate=stylist.commissionBps||0;if(data.commissionBps!==rate)fail('Stylist commission changed. Review this pending sale.',409);commission={staffId:stylist.id,commissionBps:rate,commissionAmount:Math.round((sub-off)*rate/10000)};}
  // The tax invoice number is issued here, in upload order, so numbers are sequential with no gaps even when bills were made offline.
  const ref=text(data.ref??'',100);
  // Business types with several branches (perfume): each sale belongs to the branch of the till that made it (stock per branch).
  let branch='';if(typeof mod.branches==='function'){const ids=mod.branches(db,salon);if(ids.length){if(!ids.includes(data.branch))fail('Choose this till\'s branch before selling',409);branch=data.branch}}
  return {...commission,...(ref?{ref}:{}),...(branch?{branch}:{}),id:key,number:claimTillNumber(db,salon,data.number)?data.number:documentNumber('INV',nextNumber(db,salon,'invoice')),receiptRef:'SD-'+key.replace(/[^a-zA-Z0-9]/g,'').toUpperCase(),documentType:settingsRow.trn?'Tax invoice':'Receipt',date:data.date,items,sub,off,tax,total,customerId,customer:customer?.name||'Walk-in customer',staff:commission.staffId?get(db,salon,'staff',commission.staffId).name:required(data.staff,100),method:data.method,cashAmount,cardAmount,cashReceived,received,change:credit?0:received-total,shop,status:'Paid',createdBy:u.id,syncedAt:new Date().toISOString()};
 }
 fail('Unknown record type');
}
export function operation(db,u,op){
 const type=u.business_type||'salon',mod=businessModule(type);
 if(!op||typeof op!=='object'||!kindsFor(type).includes(op.kind)||!['put','delete'].includes(op.action)||!Number.isInteger(op.base)||op.base<0)fail('Invalid sync operation');
 for(const key of ['id','key'])if(typeof op[key]!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(op[key]))fail('Invalid operation identifier');
 if(['settings','vendor'].includes(op.kind)&&op.key!=='singleton')fail('Invalid singleton key');
 if(op.action==='put'&&(!op.data||typeof op.data!=='object'))fail('Missing record');
 const digest=hash(JSON.stringify(op));
 db.exec('BEGIN IMMEDIATE');try{
  const previous=db.prepare('SELECT * FROM operations WHERE business_id=? AND id=?').get(u.business_id,op.id);
  if(previous){if(previous.user_id!==u.id||previous.digest!==digest)fail('Operation identifier already used',409);db.exec('COMMIT');return JSON.parse(previous.result)}
  if([...CORE_OWNER_KINDS,...mod.ownerKinds].includes(op.kind)&&u.role!=='owner')fail('Owner permission required',403);
  const row=db.prepare('SELECT * FROM records WHERE business_id=? AND kind=? AND id=?').get(u.business_id,op.kind,op.key),version=row?.version||0,old=row?.data?JSON.parse(row.data):null;
  if(version!==op.base)fail('This record changed on another device. Review the pending change.',409);
  if(op.action==='delete'){if(!mod.deletable.includes(op.kind)||u.role!=='owner')fail('Deleting this record is not permitted',403);if(!old)fail('Record no longer exists',409)}
  const data=op.action==='delete'?null:validate(db,u,op.kind,op.key,op.data,old);
  db.prepare('INSERT INTO records VALUES (?,?,?,?,?) ON CONFLICT(business_id,kind,id) DO UPDATE SET version=excluded.version,data=excluded.data').run(u.business_id,op.kind,op.key,version+1,data===null?null:JSON.stringify(data));
  recordChange(db,u.business_id,op.kind,op.key);
  const result={id:op.id,kind:op.kind,key:op.key,version:version+1,data};
  db.prepare('INSERT INTO operations VALUES (?,?,?,?,?)').run(u.business_id,u.id,op.id,digest,JSON.stringify(result));audit(db,u,op.action+':'+op.kind,op.key);db.exec('COMMIT');return result;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
