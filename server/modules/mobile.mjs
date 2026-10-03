// Mobile phone shop module. Retail engine shared with grocery (barcode, stock, customer credit for instalments),
// branches as in perfume shops, plus:
// * IMEI / serial tracking: a product marked "tracked by IMEI" has one unit record per phone. A bill line for it
//   must name the unit; the invoice prints the IMEI and the warranty end date; the unit is then marked sold.
// * warranty months per product, printed on the invoice and checked by IMEI.
// * repair job cards with a status flow, billed through the normal checkout (labour + parts).
// * buying used phones from customers (seller ID details kept), for cash / bank or as trade-in credit on the
//   customer's account.
// * recharge, SIM and repair labour as service items with a typed price.
import {fail,text,required,amount,get,OFFLINE_GRACE_DAYS} from '../check.mjs';
import {retailValidate,SCALE_DEFAULT} from './grocery.mjs';
import {perfume} from './perfume.mjs';

export const MOBILE_CATEGORIES=['Phones','Used phones','Tablets','Smart watches','Accessories','Chargers & cables','Cases & protectors','Audio','Parts','SIM & recharge','Repair services','Other'];
export const REPAIR_FLOW={Received:['Diagnosing','Waiting for parts','Repairing','Ready','Cancelled'],Diagnosing:['Waiting for parts','Repairing','Ready','Cancelled'],'Waiting for parts':['Repairing','Ready','Cancelled'],Repairing:['Waiting for parts','Ready','Cancelled'],Ready:['Delivered','Repairing','Cancelled'],Delivered:[],Cancelled:[]};
export const ID_TYPES=['Emirates ID','Passport','Driving licence'];
export const BUY_METHODS=['Cash','Bank / card','Trade-in'];
const DAY=86400000;
const all=(db,business,kind)=>db.prepare('SELECT data FROM records WHERE business_id=? AND kind=? AND data IS NOT NULL').all(business,kind).map(r=>JSON.parse(r.data));
const config=(db,business)=>get(db,business,'grocery_config','config')||{};
export const branchIds=(db,business)=>(config(db,business).branches||[]).map(b=>b.id);
const recent=(v,label)=>{const t=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(t)||t>Date.now()+300000||t<Date.now()-OFFLINE_GRACE_DAYS*DAY)fail('Invalid '+label+' time');return new Date(t).toISOString()};
const imei=v=>{const s=String(v??'').trim().toUpperCase();if(!/^[A-Z0-9]{8,20}$/.test(s))fail('An IMEI / serial number is 8 to 20 letters or digits');return s};
const nextNumber=(db,business,name)=>db.prepare('INSERT INTO counters(business_id,name,value) VALUES (?,?,1) ON CONFLICT(business_id,name) DO UPDATE SET value=value+1 RETURNING value').get(business,name).value;
// Warranty end date for something sold today (UAE date), or '' when the product has no warranty.
export const warrantyUntil=(months,from=new Date())=>{if(!months)return '';const d=new Date(from.getTime()+4*3600000);d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString().slice(0,10)};

export const mobile={
 type:'mobile',
 label:'Mobile shop',
 catalogKind:'grocery_items',
 kinds:['grocery_items','grocery_stock','grocery_payments','grocery_config','mobile_units','mobile_repairs','mobile_buys'],
 ownerKinds:['grocery_items','grocery_config'],
 deletable:['grocery_items'],
 creditSales:true,
 maxPieces:1000,
 branches:branchIds,
 summary:perfume.summary, // stock per product and per branch, customer credit
 seed:()=>({
  grocery_items:[
   {id:'ph1',name:'iPhone 15 128GB',barcode:'',category:'Phones',unit:'piece',price:299900,cost:0,minStock:1,serial:true,warrantyMonths:12},
   {id:'ph2',name:'Samsung Galaxy A55 256GB',barcode:'',category:'Phones',unit:'piece',price:139900,cost:0,minStock:1,serial:true,warrantyMonths:12},
   {id:'ph3',name:'Redmi 13C 128GB',barcode:'',category:'Phones',unit:'piece',price:44900,cost:0,minStock:2,serial:true,warrantyMonths:12},
   {id:'us1',name:'Used phone',barcode:'',category:'Used phones',unit:'piece',price:50000,cost:0,minStock:0,serial:true,warrantyMonths:1,openPrice:true},
   {id:'ac1',name:'Tempered glass',barcode:'',category:'Cases & protectors',unit:'piece',price:2500,cost:0,minStock:20},
   {id:'ac2',name:'Silicone case',barcode:'',category:'Cases & protectors',unit:'piece',price:3500,cost:0,minStock:20},
   {id:'ac3',name:'20W fast charger',barcode:'',category:'Chargers & cables',unit:'piece',price:5900,cost:0,minStock:10,warrantyMonths:6},
   {id:'ac4',name:'USB-C cable 1m',barcode:'',category:'Chargers & cables',unit:'piece',price:2500,cost:0,minStock:20},
   {id:'ac5',name:'Wireless earbuds',barcode:'',category:'Audio',unit:'piece',price:9900,cost:0,minStock:5,warrantyMonths:6},
   {id:'pt1',name:'iPhone screen (compatible)',barcode:'',category:'Parts',unit:'piece',price:25000,cost:0,minStock:2,openPrice:true},
   {id:'pt2',name:'Battery (compatible)',barcode:'',category:'Parts',unit:'piece',price:9000,cost:0,minStock:3,openPrice:true},
   {id:'sv1',type:'service',serviceType:'repair',name:'Repair labour',barcode:'',category:'Repair services',unit:'piece',price:5000,cost:0,minStock:0,duration:60,openPrice:true},
   {id:'sv2',type:'service',serviceType:'recharge',name:'Mobile recharge',barcode:'',category:'SIM & recharge',unit:'piece',price:1000,cost:0,minStock:0,duration:5,openPrice:true},
   {id:'sv3',type:'service',serviceType:'sim',name:'New SIM card',barcode:'',category:'SIM & recharge',unit:'piece',price:5500,cost:0,minStock:0,duration:10,openPrice:true}
  ],
  staff:[{id:'t1',name:'Sales 1'}],
  grocery_stock:[],grocery_payments:[],grocery_config:[{id:'config',scale:{...SCALE_DEFAULT},branches:[{id:'main',name:'Main shop'}]}],
  mobile_units:[],mobile_repairs:[],mobile_buys:[]
 }),
 // Bill lines. A phone tracked by IMEI is sold one unit per line, naming the unit; the invoice prints its IMEI
 // and warranty. Other products just print their warranty, if any.
 lineOptions(item,line,ctx){
  const out={price:item.price,options:[],note:text(line.note??'',100)},until=warrantyUntil(item.warrantyMonths);
  if(item.serial){
   const ids=Array.isArray(line.options)?line.options:[];if(ids.length!==1||line.qty!==1)fail('Choose the IMEI for '+item.name+' (one phone per line)',409);
   const id=typeof ids[0]==='object'&&ids[0]?ids[0].id:ids[0],unit=ctx?get(ctx.db,ctx.business,'mobile_units',required(id,100)):null;
   if(!unit||unit.itemId!==item.id)fail('This IMEI is not in stock for '+item.name+'. Review the bill.',409);
   if(unit.status!=='in')fail('IMEI '+unit.imei+' was already sold. Review the bill.',409);
   out.options.push('IMEI '+unit.imei);
  }
  if(until)out.options.push('Warranty until '+until);
  return out;
 },
 validate(args){
  const {db,business,kind,key,data,old,u}=args;
  if(kind.startsWith('grocery_'))return retailValidate(args,{
   categories:MOBILE_CATEGORIES,serviceTypes:['repair','recharge','sim','other'],branches:branchIds,paymentMethods:['Trade-in'],
   itemExtra:({data})=>{const x={};
    if(data.serial===true){if(data.type==='service'||data.unit!=='piece')fail('Only products sold per piece can be tracked by IMEI');x.serial=true}
    if(data.warrantyMonths){if(!Number.isInteger(data.warrantyMonths)||data.warrantyMonths<0||data.warrantyMonths>60)fail('Warranty is 0 to 60 months');x.warrantyMonths=data.warrantyMonths}
    if(data.openPrice===true&&data.type!=='service')x.openPrice=true; // negotiable prices: used phones, parts
    return x},
   configExtra:({data,old})=>{const list=Array.isArray(data.branches)?data.branches:(old?.branches||[{id:'main',name:'Main shop'}]);if(!list.length||list.length>20)fail('Keep 1 to 20 branches');
    const branches=list.map(b=>({id:required(b?.id,40),name:required(b?.name,60)}));if(new Set(branches.map(b=>b.id)).size!==branches.length)fail('Branch ids must be unique');return{branches}}
  });
  if(kind==='mobile_units'){
   const ids=branchIds(db,business);
   if(old){
    const n={...old},to=data.status??old.status;
    if(to!==old.status){
     if(old.status==='in'&&to==='sold'){const sale=get(db,business,'sales',required(data.saleId,100));if(!sale)fail('The bill must sync before its phone is marked sold',409);n.status='sold';n.saleId=sale.id;n.soldAt=sale.date;n.customer=sale.customer||'';const item=get(db,business,'grocery_items',old.itemId);n.warrantyUntil=warrantyUntil(item?.warrantyMonths,new Date(sale.date))}
     else if(old.status==='sold'&&to==='in'){if(u.role!=='owner')fail('Only the owner can put a sold phone back in stock',403);const sale=get(db,business,'sales',old.saleId);if(sale&&sale.status!=='Refunded')fail('Refund the bill first; then the phone can go back in stock',409);n.status='in';for(const k of ['saleId','soldAt','customer','warrantyUntil'])delete n[k]}
     else if(old.status==='in'&&to==='removed'){if(u.role!=='owner')fail('Only the owner can remove a phone from stock',403);n.status='removed';n.reason=required(data.reason,200)}
     else fail(`A phone cannot move from ${old.status} to ${to}`,409);
    }
    if(n.status==='in'&&data.branch!==undefined&&ids.length){if(!ids.includes(data.branch))fail('Choose the branch');n.branch=data.branch}
    return n;
   }
   const item=get(db,business,'grocery_items',required(data.itemId,100));if(!item||!item.serial)fail('This product is not tracked by IMEI',409);
   const code=imei(data.imei);if(all(db,business,'mobile_units').some(x=>x.imei===code&&x.status==='in'&&x.id!==key))fail('IMEI '+code+' is already recorded',409);
   if(data.status!=='in')fail('New phones start in stock');
   const n={id:key,itemId:item.id,item:item.name,imei:code,status:'in',cost:amount(data.cost??0),source:data.source==='used'?'used':'purchase',buyId:text(data.buyId??'',100),condition:text(data.condition??'',100),price:data.price?amount(data.price):0,at:recent(data.at,'stock'),by:u.id};
   if(ids.length){if(!ids.includes(data.branch))fail('Choose the branch');n.branch=data.branch}
   return n;
  }
  if(kind==='mobile_buys'){
   if(old)fail('A purchase from a customer cannot be changed. Ask the owner to correct the stock.',409);
   const item=get(db,business,'grocery_items',required(data.itemId,100));if(!item||!item.serial)fail('Choose a product that is tracked by IMEI',409);
   if(!ID_TYPES.includes(data.idType))fail('Choose the seller\'s ID type');if(!BUY_METHODS.includes(data.method))fail('Choose how the seller was paid');
   const price=amount(data.price);if(!price)fail('Enter the price paid');
   let customerId='';if(data.method==='Trade-in'){const c=get(db,business,'customers',required(data.customerId,100));if(!c)fail('Save the customer before a trade-in',409);customerId=c.id}
   return{id:key,number:nextNumber(db,business,'mobile-buy'),seller:required(data.seller,100),phone:required(data.phone,40),idType:data.idType,idNumber:required(data.idNumber,40),itemId:item.id,item:item.name,imei:imei(data.imei),condition:text(data.condition??'',200),price,method:data.method,customerId,at:recent(data.at,'purchase'),by:u.id};
  }
  if(kind==='mobile_repairs'){
   const due=v=>{if(!v)return '';if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))fail('Choose a valid date');return v};
   if(old){
    const r={...old};
    if(data.status!==undefined&&data.status!==old.status){if(!REPAIR_FLOW[old.status].includes(data.status))fail(`A repair cannot move from ${old.status} to ${data.status}`,409);
     if(data.status==='Cancelled')r.cancelReason=required(data.cancelReason,200);
     r.status=data.status;r.history=[...(old.history||[]),{status:data.status,at:new Date().toISOString(),by:u.id}].slice(-20)}
    const saleId=text(data.saleId??old.saleId??'',100);if(old.saleId&&saleId!==old.saleId)fail('The repair bill cannot be changed',409);r.saleId=saleId;
    if(data.noCharge!==undefined)r.noCharge=data.noCharge===true;
    if(r.status==='Delivered'&&!r.saleId&&!r.noCharge)fail('Bill the repair before handing over the device (or mark it no charge)',409);
    if(!['Delivered','Cancelled'].includes(old.status)){for(const k of ['technician','diagnosis','note','accessories'])if(data[k]!==undefined)r[k]=text(data[k],k==='diagnosis'?500:200);if(data.estimate!==undefined)r.estimate=amount(data.estimate);if(data.due!==undefined)r.due=due(data.due)}
    return r;
   }
   if(data.status!=='Received')fail('New repairs start as Received');
   const c=get(db,business,'customers',required(data.customerId,100));if(!c)fail('Customer must sync before their repair',409);
   const now=new Date().toISOString();
   return{id:key,number:nextNumber(db,business,'mobile-repair'),customerId:c.id,customer:c.name,phone:c.phone||'',device:required(data.device,100),imei:data.imei?imei(data.imei):'',fault:required(data.fault,300),accessories:text(data.accessories??'',200),estimate:amount(data.estimate??0),due:due(data.due),technician:text(data.technician??'',100),diagnosis:'',note:text(data.note??'',200),status:'Received',saleId:'',noCharge:false,created:now,createdBy:u.id,history:[{status:'Received',at:now,by:u.id}]};
  }
  fail('Unknown record type');
 }
};
