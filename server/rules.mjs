import {hash,audit} from './store.mjs';
export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(message,status=400)=>{throw new ApiError(status,message)};
const text=(v,max=150)=>{if(typeof v!=='string'||v.length>max)fail('Invalid text field');return v.trim()};
const required=(v,max)=>{const r=text(v,max);if(!r)fail('Required field is empty');return r};
const amount=v=>{if(!Number.isSafeInteger(v)||v<0||v>100000000)fail('Invalid amount');return v};
const image=v=>{if(!v)return '';if(typeof v!=='string'||v.length>1500000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v))fail('Invalid logo');return v};
const get=(db,salon,kind,id)=>{const r=db.prepare('SELECT * FROM records WHERE salon_id=? AND kind=? AND id=?').get(salon,kind,id);return r?.data?JSON.parse(r.data):null;};
function validate(db,u,kind,key,data,old){
 const salon=u.salon_id;
 if(kind==='settings'){if(!Number.isFinite(data.tax)||data.tax<0||data.tax>100)fail('Invalid tax rate');return{name:required(data.name,100),phone:text(data.phone,40),address:text(data.address,500),trn:text(data.trn,40),tax:data.tax,logo:image(data.logo)}}
 if(kind==='vendor')return {logo:image(data.logo)};
 if(kind==='services')return{id:key,name:required(data.name,100),category:required(data.category,50),price:amount(data.price)};
 if(kind==='staff'){const commissionBps=data.commissionBps??old?.commissionBps??0;if(!Number.isInteger(commissionBps)||commissionBps<0||commissionBps>10000)fail('Commission must be 0–100%');return{id:key,name:required(data.name,100),commissionBps};}
 if(kind==='customers'){
  const dob=data.dob??old?.dob??'';
  const today=new Date(Date.now()+4*3600000).toISOString().slice(0,10);
  if(typeof dob!=='string'||(dob&&(!/^\d{4}-\d{2}-\d{2}$/.test(dob)||!Number.isFinite(Date.parse(dob))||new Date(dob).toISOString().slice(0,10)!==dob||dob<'1900-01-01'||dob>today)))fail('Enter a valid date of birth, from 1900 through today');
  return{id:key,name:required(data.name,100),phone:text(data.phone,40),dob};
 }
 if(kind==='appointments'){
  if(!Number.isFinite(Date.parse(data.when))||!Number.isInteger(data.duration)||data.duration<5||data.duration>480||!['Booked','Completed','Cancelled'].includes(data.status))fail('Invalid appointment');
  const staff=get(db,salon,'staff',data.staffId);if(!staff)fail('Stylist no longer exists',409);
  const a={id:key,when:text(data.when,50),duration:data.duration,customer:required(data.customer,100),service:required(data.service,100),staffId:staff.id,staff:staff.name,status:data.status};
  const customerId=data.customerId??old?.customerId;if(customerId){const customer=get(db,salon,'customers',required(customerId,100));if(!customer&&customerId!==old?.customerId)fail('Customer must sync before their appointment',409);a.customerId=customerId;}
  if(a.status==='Booked'){const start=Date.parse(a.when),end=start+a.duration*60000;for(const row of db.prepare("SELECT id,data FROM records WHERE salon_id=? AND kind='appointments' AND data IS NOT NULL AND id!=?").all(salon,key)){const b=JSON.parse(row.data);if(b.status==='Booked'&&b.staffId===a.staffId&&start<Date.parse(b.when)+b.duration*60000&&end>Date.parse(b.when))fail('This stylist has another appointment during that time',409);}}
  return a;
 }
 if(kind==='sales'){
  if(old){if(u.role!=='owner')fail('Only the salon owner can refund a sale',403);if(old.status!=='Paid'||data.status!=='Refunded')fail('Saved sales cannot be edited',409);return{...old,status:'Refunded',refundReason:required(data.refundReason,500),refundDate:new Date().toISOString(),refundedBy:u.id};}
  if(data.status!=='Paid'||!Array.isArray(data.items)||data.items.length<1||data.items.length>100)fail('Invalid sale');
  const shop=get(db,salon,'settings','singleton');
  const items=data.items.map(i=>{const service=get(db,salon,'services',i.id);if(!service)fail('A service was removed. Review this pending bill.',409);if(i.price!==service.price)fail('A service price changed. Review this pending bill.',409);if(!Number.isInteger(i.qty)||i.qty<1||i.qty>100)fail('Invalid service quantity');return{...service,qty:i.qty}});
  const sub=amount(items.reduce((n,i)=>n+i.price*i.qty,0)),off=amount(data.off);if(off>sub)fail('Discount exceeds subtotal');const tax=Math.round((sub-off)*shop.tax/100),total=sub-off+tax;
  if(data.total!==total||data.tax!==tax||data.sub!==sub)fail('Bill totals differ from the cloud catalogue or tax settings. Review before syncing.',409);
  if(!['Cash','Card (external terminal)','Split'].includes(data.method))fail('Invalid payment method');
  const received=amount(data.received);if(received<total)fail('Insufficient payment');
  let cashAmount=data.method==='Cash'?total:0,cardAmount=data.method==='Card (external terminal)'?total:0;
  if(data.method==='Split'){cashAmount=amount(data.cashAmount);cardAmount=amount(data.cardAmount);if(cashAmount<=0||cardAmount<=0||cashAmount+cardAmount!==total)fail('Cash and card portions must both be positive and equal the bill total');}
  else {if(data.cashAmount!==undefined&&data.cashAmount!==cashAmount||data.cardAmount!==undefined&&data.cardAmount!==cardAmount)fail('Payment portions do not match the payment method');if(data.method==='Card (external terminal)'&&received!==total)fail('Card payment must equal the bill total');}
  const cashReceived=received-cardAmount;if(cashReceived<cashAmount)fail('Insufficient cash payment');
  if(!Number.isFinite(Date.parse(data.date))||Date.parse(data.date)>Date.now()+300000)fail('Invalid sale date');
  const customerId=text(data.customerId,100),customer=customerId?get(db,salon,'customers',customerId):null;if(customerId&&!customer)fail('Customer must sync before their sale',409);
  let commission={};
  if(data.staffId){const stylist=get(db,salon,'staff',data.staffId);if(!stylist)fail('Stylist no longer exists',409);const rate=stylist.commissionBps||0;if(data.commissionBps!==rate)fail('Stylist commission changed. Review this pending sale.',409);commission={staffId:stylist.id,commissionBps:rate,commissionAmount:Math.round((sub-off)*rate/10000)};}
  return {...commission,id:key,number:'SD-'+key.replace(/[^a-zA-Z0-9]/g,'').toUpperCase(),date:data.date,items,sub,off,tax,total,customerId,customer:customer?.name||'Walk-in customer',staff:commission.staffId?get(db,salon,'staff',commission.staffId).name:required(data.staff,100),method:data.method,cashAmount,cardAmount,cashReceived,received,change:received-total,shop,status:'Paid',createdBy:u.id,syncedAt:new Date().toISOString()};
 }
 fail('Unknown record type');
}
export function operation(db,u,op){
 if(!op||typeof op!=='object'||!['settings','vendor','services','staff','customers','appointments','sales'].includes(op.kind)||!['put','delete'].includes(op.action)||!Number.isInteger(op.base)||op.base<0)fail('Invalid sync operation');
 for(const key of ['id','key'])if(typeof op[key]!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(op[key]))fail('Invalid operation identifier');
 if(['settings','vendor'].includes(op.kind)&&op.key!=='singleton')fail('Invalid singleton key');
 if(op.action==='put'&&(!op.data||typeof op.data!=='object'))fail('Missing record');
 const digest=hash(JSON.stringify(op));
 db.exec('BEGIN IMMEDIATE');try{
  const previous=db.prepare('SELECT * FROM operations WHERE salon_id=? AND id=?').get(u.salon_id,op.id);
  if(previous){if(previous.user_id!==u.id||previous.digest!==digest)fail('Operation identifier already used',409);db.exec('COMMIT');return JSON.parse(previous.result)}
  if(['settings','vendor','services','staff'].includes(op.kind)&&u.role!=='owner')fail('Owner permission required',403);
  const row=db.prepare('SELECT * FROM records WHERE salon_id=? AND kind=? AND id=?').get(u.salon_id,op.kind,op.key),version=row?.version||0,old=row?.data?JSON.parse(row.data):null;
  if(version!==op.base)fail('This record changed on another device. Review the pending change.',409);
  if(op.action==='delete'){if(!['services'].includes(op.kind)||u.role!=='owner')fail('Deleting this record is not permitted',403);if(!old)fail('Record no longer exists',409)}
  const data=op.action==='delete'?null:validate(db,u,op.kind,op.key,op.data,old);
  db.prepare('INSERT INTO records VALUES (?,?,?,?,?) ON CONFLICT(salon_id,kind,id) DO UPDATE SET version=excluded.version,data=excluded.data').run(u.salon_id,op.kind,op.key,version+1,data===null?null:JSON.stringify(data));
  const result={id:op.id,kind:op.kind,key:op.key,version:version+1,data};
  db.prepare('INSERT INTO operations VALUES (?,?,?,?,?)').run(u.salon_id,u.id,op.id,digest,JSON.stringify(result));audit(db,u,op.action+':'+op.kind,op.key);db.exec('COMMIT');return result;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
