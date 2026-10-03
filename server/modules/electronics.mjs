// Electronics & computer shop module. Built on the serial-number engine of the mobile shop (serial on every
// invoice, warranty by serial, repair job cards, used devices and trade-in, branches, customer accounts), plus:
// * quotations (custom PC builds, company quotes): a parts list with a discount and a validity date, turned into
//   a bill when the customer accepts;
// * warranty claims to suppliers (RMA): a faulty item sent to the supplier and tracked until it comes back;
// * delivery and installation jobs (TV mounting, on-site setup) with a date, address and technician.
import {fail,text,required,amount,get} from '../check.mjs';
import {SCALE_DEFAULT} from './grocery.mjs';
import {serialShop} from './mobile.mjs';

export const ELECTRONICS_CATEGORIES=['Laptops','Desktops & all-in-ones','Used devices','Monitors','TVs','Printers & scanners','Components','Storage','Networking','CCTV & security','Peripherals','Cables & adapters','Home appliances','Software','Parts','Services','Other'];
export const QUOTE_STATUS=['Open','Accepted','Lost'];
export const RMA_FLOW={Open:['Sent','Cancelled'],Sent:['Back'],Back:['Closed'],Closed:[],Cancelled:[]};
export const RMA_OUTCOMES=['Repaired','Replaced','Credit note','Rejected'];
export const JOB_TYPES=['Delivery','Installation','Delivery & installation'];
export const JOB_FLOW={Booked:['On the way','Done','Cancelled'],'On the way':['Done','Booked','Cancelled'],Done:[],Cancelled:[]};
const nextNumber=(db,business,name)=>db.prepare('INSERT INTO counters(business_id,name,value) VALUES (?,?,1) ON CONFLICT(business_id,name) DO UPDATE SET value=value+1 RETURNING value').get(business,name).value;
const day=(v,label='date')=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))fail('Choose the '+label);return v};
const customerOf=(db,business,id,what)=>{const c=get(db,business,'customers',required(id,100));if(!c)fail('Customer must sync before their '+what,409);return c};
const step=(old,data,flow,u,what)=>{if(!flow[old.status].includes(data.status))fail(`${what} cannot move from ${old.status} to ${data.status}`,409);return[...(old.history||[]),{status:data.status,at:new Date().toISOString(),by:u.id}].slice(-20)};

function quoteLines(db,business,list){
 if(!Array.isArray(list)||!list.length||list.length>40)fail('A quotation has 1 to 40 lines');
 const lines=list.map(l=>{const item=get(db,business,'grocery_items',required(l?.itemId,100));if(!item)fail('A product on this quotation no longer exists',409);
  if(!Number.isInteger(l.qty)||l.qty<1||l.qty>1000)fail('Quantity must be 1 to 1000');
  return{key:required(l.key,60),itemId:item.id,name:item.name,qty:l.qty,price:item.openPrice?amount(l.price):item.price,note:text(l.note??'',100)}});
 if(new Set(lines.map(l=>l.key)).size!==lines.length)fail('Quotation lines must be unique');
 return lines;
}
function more({db,business,kind,key,data,old,u}){
 if(kind==='elec_quotes'){
  const totals=(lines,discount)=>{const sub=lines.reduce((n,l)=>n+l.price*l.qty,0),off=amount(discount??0);if(off>sub)fail('The discount is more than the quotation');return{sub,discount:off}};
  if(old){
   if(old.status!=='Open')fail(`An ${old.status.toLowerCase()} quotation cannot change`,409);
   const q={...old};
   if(Array.isArray(data.lines))q.lines=quoteLines(db,business,data.lines);
   Object.assign(q,totals(q.lines,data.discount??old.discount));
   if(data.title!==undefined)q.title=text(data.title,100);if(data.note!==undefined)q.note=text(data.note,300);if(data.validUntil!==undefined)q.validUntil=day(data.validUntil,'validity date');
   if(data.status!==undefined&&data.status!==old.status){
    if(data.status==='Accepted'){const sale=get(db,business,'sales',required(data.saleId,100));if(!sale)fail('The bill must sync before its quotation is closed',409);q.saleId=sale.id}
    else if(data.status==='Lost')q.lostReason=text(data.lostReason??'',200);
    else fail('Unknown quotation status');
    q.status=data.status;q.closed=new Date().toISOString()}
   return q;
  }
  if(data.status!=='Open')fail('New quotations start as Open');
  const c=customerOf(db,business,data.customerId,'quotation'),lines=quoteLines(db,business,data.lines);
  return{id:key,number:nextNumber(db,business,'elec-quote'),customerId:c.id,customer:c.name,phone:c.phone||'',title:text(data.title??'',100),lines,...totals(lines,data.discount),validUntil:day(data.validUntil,'validity date'),note:text(data.note??'',300),status:'Open',saleId:'',created:new Date().toISOString(),createdBy:u.id};
 }
 if(kind==='elec_rma'){
  if(old){
   const r={...old};
   if(data.status!==undefined&&data.status!==old.status){r.history=step(old,data,RMA_FLOW,u,'A warranty claim');r.status=data.status;
    if(data.status==='Back'){if(!RMA_OUTCOMES.includes(data.outcome))fail('Choose what the supplier did');r.outcome=data.outcome;r.newSerial=text(data.newSerial??'',40)}
    if(data.status==='Cancelled')r.cancelReason=required(data.cancelReason,200)}
   if(!['Closed','Cancelled'].includes(old.status)){for(const [k,max] of [['ref',60],['note',300],['supplier',100]])if(data[k]!==undefined)r[k]=k==='supplier'?required(data[k],max):text(data[k],max)}
   return r;
  }
  if(data.status!=='Open')fail('New warranty claims start as Open');
  let who={customerId:'',customer:'',phone:''};if(data.customerId){const c=customerOf(db,business,data.customerId,'warranty claim');who={customerId:c.id,customer:c.name,phone:c.phone||''}}
  const now=new Date().toISOString();
  return{id:key,number:nextNumber(db,business,'elec-rma'),supplier:required(data.supplier,100),item:required(data.item,100),serial:text(data.serial??'',40),fault:required(data.fault,300),...who,ref:text(data.ref??'',60),note:text(data.note??'',300),outcome:'',newSerial:'',status:'Open',created:now,createdBy:u.id,history:[{status:'Open',at:now,by:u.id}]};
 }
 if(kind==='elec_jobs'){
  if(old){
   const j={...old};
   if(data.status!==undefined&&data.status!==old.status){j.history=step(old,data,JOB_FLOW,u,'A job');j.status=data.status;if(data.status==='Cancelled')j.cancelReason=required(data.cancelReason,200)}
   const saleId=text(data.saleId??old.saleId??'',100);if(old.saleId&&saleId!==old.saleId)fail('The job bill cannot be changed',409);j.saleId=saleId;
   if(!['Done','Cancelled'].includes(old.status)){for(const [k,max] of [['address',200],['what',200]])if(data[k]!==undefined)j[k]=required(data[k],max);for(const [k,max] of [['slot',40],['staff',100],['note',200]])if(data[k]!==undefined)j[k]=text(data[k],max);if(data.date!==undefined)j.date=day(data.date);if(data.charge!==undefined)j.charge=amount(data.charge)}
   return j;
  }
  if(data.status!=='Booked')fail('New jobs start as Booked');if(!JOB_TYPES.includes(data.type))fail('Choose delivery or installation');
  const c=customerOf(db,business,data.customerId,'job'),now=new Date().toISOString();
  return{id:key,number:nextNumber(db,business,'elec-job'),type:data.type,customerId:c.id,customer:c.name,phone:c.phone||'',address:required(data.address,200),date:day(data.date),slot:text(data.slot??'',40),what:required(data.what,200),staff:text(data.staff??'',100),charge:amount(data.charge??0),note:text(data.note??'',200),status:'Booked',saleId:'',created:now,createdBy:u.id,history:[{status:'Booked',at:now,by:u.id}]};
 }
}
const P=(id,name,category,price,minStock,x={})=>({id,name,barcode:'',category,unit:'piece',price,cost:0,minStock,...x});
const S=(id,serviceType,name,price,duration)=>({id,type:'service',serviceType,name,barcode:'',category:'Services',unit:'piece',price,cost:0,minStock:0,duration,openPrice:true});
const seed=()=>({
 grocery_items:[
  P('lp1','HP 15 laptop i5 16GB 512GB','Laptops',229900,1,{serial:true,warrantyMonths:12}),
  P('lp2','Lenovo IdeaPad 3 Ryzen 5 8GB 512GB','Laptops',179900,1,{serial:true,warrantyMonths:12}),
  P('mn1','24" IPS monitor 100Hz','Monitors',42900,2,{serial:true,warrantyMonths:36}),
  P('tv1','55" 4K smart TV','TVs',159900,1,{serial:true,warrantyMonths:12}),
  P('pr1','Ink tank printer (print, scan, copy)','Printers & scanners',64900,1,{serial:true,warrantyMonths:12}),
  P('us1','Used device','Used devices',80000,0,{serial:true,warrantyMonths:1,openPrice:true}),
  P('c1','Intel Core i5-14400F processor','Components',79900,1,{warrantyMonths:36}),
  P('c2','B760M motherboard','Components',52900,1,{warrantyMonths:36}),
  P('c3','16GB DDR5 RAM','Components',21900,2,{warrantyMonths:36}),
  P('c4','RTX 4060 8GB graphics card','Components',129900,1,{warrantyMonths:36}),
  P('c5','650W power supply','Components',24900,1,{warrantyMonths:36}),
  P('c6','Mid-tower case with fans','Components',19900,1),
  P('s1','1TB NVMe SSD','Storage',28900,2,{warrantyMonths:36}),
  P('n1','Wi-Fi 6 router','Networking',19900,2,{warrantyMonths:12}),
  P('p1','Keyboard & mouse combo','Peripherals',6900,5,{warrantyMonths:6}),
  P('k1','HDMI cable 2m','Cables & adapters',2500,10),
  P('pt1','Laptop screen (compatible)','Parts',35000,1,{openPrice:true}),
  P('pt2','Laptop battery (compatible)','Parts',18000,1,{openPrice:true}),
  S('sv1','repair','Repair labour',10000,60),S('sv2','installation','Installation / TV mounting',15000,90),S('sv3','delivery','Delivery',3000,30),S('sv4','other','PC assembly & Windows setup',15000,120)
 ],
 staff:[{id:'t1',name:'Sales 1'}],
 grocery_stock:[],grocery_payments:[],grocery_config:[{id:'config',scale:{...SCALE_DEFAULT},branches:[{id:'main',name:'Main shop'}]}],
 mobile_units:[],mobile_repairs:[],mobile_buys:[],elec_quotes:[],elec_rma:[],elec_jobs:[]
});
export const electronics=serialShop({type:'electronics',label:'Electronics & computers',categories:ELECTRONICS_CATEGORIES,serviceTypes:['repair','installation','delivery','other'],tag:'S/N',thing:'device',seed,kinds:['elec_quotes','elec_rma','elec_jobs'],more});
