// Optical shop module. Retail engine shared with grocery (frames, sunglasses and contact lenses with barcode and
// stock, customer accounts), branches as in perfume shops, plus:
// * prescriptions (eye power) per customer, with history;
// * spectacle orders: frame + lenses made to a prescription, sent to the lab, ready, delivered; billed through
//   the normal checkout, with an advance on the order and the balance on collection;
// * eye test bookings;
// * insurance claims: the insurer's share of a bill, tracked until it is paid ("Insurance" account payment);
// * recalls: contact-lens reorder and yearly eye-test reminders.
import {fail,text,required,amount,get} from '../check.mjs';
import {retailValidate,SCALE_DEFAULT} from './grocery.mjs';
import {perfume} from './perfume.mjs';

export const OPTICAL_CATEGORIES=['Frames','Sunglasses','Reading glasses','Contact lenses','Lens solutions','Accessories','Lenses','Services','Other'];
export const ORDER_FLOW={Ordered:['At lab','Ready','Cancelled'],'At lab':['Ready','Cancelled'],Ready:['Delivered','At lab','Cancelled'],Delivered:[],Cancelled:[]};
export const TEST_FLOW={Booked:['Done','No-show','Cancelled'],Done:[],'No-show':['Booked'],Cancelled:[]};
export const CLAIM_FLOW={'To submit':['Submitted','Paid','Rejected'],Submitted:['Paid','Rejected'],Paid:[],Rejected:[]};
export const RX_TYPES=['Distance','Reading','Progressive / bifocal','Contact lens'];
const config=(db,business)=>get(db,business,'grocery_config','config')||{};
export const branchIds=(db,business)=>(config(db,business).branches||[]).map(b=>b.id);
const nextNumber=(db,business,name)=>db.prepare('INSERT INTO counters(business_id,name,value) VALUES (?,?,1) ON CONFLICT(business_id,name) DO UPDATE SET value=value+1 RETURNING value').get(business,name).value;
const day=(v,label='date')=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))fail('Choose the '+label);return v};
const customerOf=(db,business,id,what)=>{const c=get(db,business,'customers',required(id,100));if(!c)fail('Customer must sync before their '+what,409);return c};
const step=(old,data,flow,u,what)=>{if(!flow[old.status].includes(data.status))fail(`${what} cannot move from ${old.status} to ${data.status}`,409);return[...(old.history||[]),{status:data.status,at:new Date().toISOString(),by:u.id}].slice(-20)};
// One eye: sphere, cylinder and addition in dioptres (quarter steps), axis in degrees.
const power=(v,label,max)=>{const s=String(v??'').trim();if(!s||/^(pl|plano)$/i.test(s))return s?'Plano':'';const n=Number(s);if(!/^[+-]?\d{1,2}(\.\d{1,2})?$/.test(s)||Math.abs(n)>max||Math.abs(n*4-Math.round(n*4))>1e-9)fail(label+' must be in steps of 0.25, up to ±'+max);return(n>0?'+':n<0?'-':'')+Math.abs(n).toFixed(2)};
const eye=(e={},side)=>{const axis=String(e?.axis??'').trim();if(axis&&(!/^\d{1,3}$/.test(axis)||Number(axis)>180))fail(side+' axis is 0 to 180');return{sph:power(e?.sph,side+' SPH',30),cyl:power(e?.cyl,side+' CYL',10),axis,add:power(e?.add,side+' ADD',4)}};
const pd=v=>{const s=String(v??'').trim();if(s&&!/^\d{2}(\.\d)?(\s*\/\s*\d{2}(\.\d)?)?$/.test(s))fail('PD looks like 62 or 31/31');return s};
export const rxOf=d=>({right:eye(d.right,'Right'),left:eye(d.left,'Left'),pd:pd(d.pd)});

export const optical={
 type:'optical',
 label:'Optical shop',
 catalogKind:'grocery_items',
 kinds:['grocery_items','grocery_stock','grocery_payments','grocery_config','optical_rx','optical_orders','optical_tests','optical_claims','optical_recalls'],
 ownerKinds:['grocery_items','grocery_config'],
 deletable:['grocery_items'],
 creditSales:true,
 maxPieces:1000,
 branches:branchIds,
 summary:perfume.summary,
 seed:()=>{const P=(id,name,category,price,minStock,x={})=>({id,name,barcode:'',category,unit:'piece',price,cost:0,minStock,...x}),S=(id,serviceType,name,category,price)=>({id,type:'service',serviceType,name,barcode:'',category,unit:'piece',price,cost:0,minStock:0,duration:30,openPrice:true});return{
  grocery_items:[
   P('fr1','Classic acetate frame black','Frames',35000,2,{brand:'House brand',colour:'Black',size:'52-18-140'}),
   P('fr2','Metal round frame gold','Frames',45000,2,{brand:'House brand',colour:'Gold',size:'49-21-145'}),
   P('fr3','Kids flexible frame blue','Frames',25000,2,{brand:'House brand',colour:'Blue',size:'46-16-125'}),
   P('sg1','Polarised sunglasses','Sunglasses',39000,2,{brand:'House brand',colour:'Black'}),
   P('rg1','Reading glasses +1.50','Reading glasses',6000,5),
   P('cl1','Monthly contact lenses (box of 6)','Contact lenses',14000,5,{supplyDays:90}),
   P('cl2','Daily contact lenses (box of 30)','Contact lenses',12000,5,{supplyDays:15}),
   P('so1','Lens solution 360 ml','Lens solutions',4500,5),
   P('ac1','Hard case & cloth','Accessories',2500,5),
   S('ln1','lens','Single vision lenses (pair)','Lenses',20000),S('ln2','lens','Blue-cut lenses (pair)','Lenses',35000),S('ln3','lens','Progressive lenses (pair)','Lenses',85000),S('ln4','lens','Photochromic lenses (pair)','Lenses',55000),
   S('sv1','eyetest','Eye test','Services',5000),S('sv2','other','Frame repair / fitting','Services',3000)
  ],
  staff:[{id:'t1',name:'Optometrist 1'}],
  grocery_stock:[],grocery_payments:[],grocery_config:[{id:'config',scale:{...SCALE_DEFAULT},branches:[{id:'main',name:'Main shop'}]}],
  optical_rx:[],optical_orders:[],optical_tests:[],optical_claims:[],optical_recalls:[]
 }},
 lineOptions(item,line){return{price:item.price,options:[],note:text(line.note??'',100)}},
 validate(args){
  const {db,business,kind,key,data,old,u}=args;
  if(kind.startsWith('grocery_'))return retailValidate(args,{
   categories:OPTICAL_CATEGORIES,serviceTypes:['lens','eyetest','other'],units:['piece'],branches:branchIds,paymentMethods:['Insurance'],
   itemExtra:({data})=>{const x={};for(const [k,max] of [['brand',40],['colour',30],['size',20]])if(data[k])x[k]=text(data[k],max);
    if(data.supplyDays){if(!Number.isInteger(data.supplyDays)||data.supplyDays<1||data.supplyDays>400)fail('Days of wear per box is 1 to 400');x.supplyDays=data.supplyDays}return x},
   configExtra:({data,old})=>{const list=Array.isArray(data.branches)?data.branches:(old?.branches||[{id:'main',name:'Main shop'}]);if(!list.length||list.length>20)fail('Keep 1 to 20 branches');
    const branches=list.map(b=>({id:required(b?.id,40),name:required(b?.name,60)}));if(new Set(branches.map(b=>b.id)).size!==branches.length)fail('Branch ids must be unique');return{branches}}
  });
  if(kind==='optical_rx'){
   const c=old?{id:old.customerId,name:old.customer}:customerOf(db,business,data.customerId,'prescription');
   if(!RX_TYPES.includes(data.type))fail('Choose the prescription type');
   const rx=rxOf(data);if(![rx.right,rx.left].some(e=>e.sph||e.cyl||e.add))fail('Enter the power for at least one eye');
   return{id:key,customerId:c.id,customer:c.name,date:day(data.date,'test date'),type:data.type,...rx,optometrist:text(data.optometrist??'',100),source:data.source==='outside'?'outside':'shop',note:text(data.note??'',300),created:old?.created||new Date().toISOString(),...(old?{updated:new Date().toISOString()}:{}),by:u.id};
  }
  if(kind==='optical_orders'){
   if(old){
    const o={...old},closed=['Delivered','Cancelled'].includes(old.status);
    if(data.status!==undefined&&data.status!==old.status){o.history=step(old,data,ORDER_FLOW,u,'An order');o.status=data.status;if(data.status==='Cancelled')o.cancelReason=required(data.cancelReason,200)}
    const saleId=text(data.saleId??old.saleId??'',100);if(old.saleId&&saleId!==old.saleId)fail('The order bill cannot be changed',409);o.saleId=saleId;
    if(o.status==='Delivered'&&!o.saleId)fail('Bill the order before handing it over',409);
    if(!closed){if(data.due!==undefined)o.due=day(data.due,'ready date');for(const [k,max] of [['lab',100],['labRef',60],['note',200]])if(data[k]!==undefined)o[k]=text(data[k],max)}
    return o;
   }
   if(data.status!=='Ordered')fail('New orders start as Ordered');
   const c=customerOf(db,business,data.customerId,'order');
   let frame={frameItemId:'',frame:text(data.frame??'',100)||'Customer’s own frame',framePrice:0};
   if(data.frameItemId){const f=get(db,business,'grocery_items',required(data.frameItemId,100));if(!f||f.type==='service')fail('Choose a frame from your products',409);frame={frameItemId:f.id,frame:f.name,framePrice:f.price}}
   const lens=get(db,business,'grocery_items',required(data.lensItemId,100));if(!lens||lens.type!=='service'||lens.serviceType!=='lens')fail('Choose the lenses',409);
   const rx=rxOf(data);if(![rx.right,rx.left].some(e=>e.sph||e.cyl||e.add))fail('Enter the prescription for the lenses');
   const now=new Date().toISOString();
   return{id:key,number:nextNumber(db,business,'optical-order'),customerId:c.id,customer:c.name,phone:c.phone||'',...frame,lensItemId:lens.id,lens:lens.name,lensPrice:lens.openPrice?amount(data.lensPrice):lens.price,lensDetails:text(data.lensDetails??'',200),rxType:RX_TYPES.includes(data.rxType)?data.rxType:'Distance',...rx,due:day(data.due,'ready date'),advance:amount(data.advance??0),lab:text(data.lab??'',100),labRef:text(data.labRef??'',60),note:text(data.note??'',200),status:'Ordered',saleId:'',created:now,createdBy:u.id,history:[{status:'Ordered',at:now,by:u.id}]};
  }
  if(kind==='optical_tests'){
   const when=v=>{const t=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(t))fail('Choose the date and time');return new Date(t).toISOString()};
   if(old){
    const t={...old};if(data.status!==undefined&&data.status!==old.status){t.history=step(old,data,TEST_FLOW,u,'A booking');t.status=data.status}
    if(['Booked','No-show'].includes(old.status)){if(data.when!==undefined)t.when=when(data.when);for(const [k,max] of [['optometrist',100],['note',200]])if(data[k]!==undefined)t[k]=text(data[k],max)}
    return t;
   }
   if(data.status!=='Booked')fail('New bookings start as Booked');
   const c=customerOf(db,business,data.customerId,'eye test'),now=new Date().toISOString();
   return{id:key,customerId:c.id,customer:c.name,phone:c.phone||'',when:when(data.when),optometrist:text(data.optometrist??'',100),note:text(data.note??'',200),status:'Booked',created:now,history:[{status:'Booked',at:now,by:u.id}]};
  }
  if(kind==='optical_claims'){
   if(old){
    const c={...old};
    if(data.status!==undefined&&data.status!==old.status){c.history=step(old,data,CLAIM_FLOW,u,'A claim');c.status=data.status;
     if(data.status==='Paid'){const paid=amount(data.paidAmount);if(!paid||paid>old.amount)fail('Enter what the insurer paid, up to the claim amount');c.paidAmount=paid;c.paidAt=new Date().toISOString()}
     if(data.status==='Rejected')c.rejectReason=required(data.rejectReason,200)}
    if(!['Paid','Rejected'].includes(old.status)){for(const [k,max] of [['claimRef',60],['note',200],['approval',60]])if(data[k]!==undefined)c[k]=text(data[k],max)}
    return c;
   }
   if(data.status!=='To submit')fail('New claims start as To submit');
   const sale=get(db,business,'sales',required(data.saleId,100));if(!sale||!sale.customerId)fail('The bill must sync before its insurance claim',409);
   const value=amount(data.amount);if(!value||value>sale.total)fail('The insurer’s share is more than the bill');
   const now=new Date().toISOString();
   return{id:key,number:nextNumber(db,business,'optical-claim'),saleId:sale.id,invoice:sale.number,customerId:sale.customerId,customer:sale.customer,insurer:required(data.insurer,80),memberId:text(data.memberId??'',60),approval:text(data.approval??'',60),claimRef:'',amount:value,total:sale.total,paidAmount:0,note:text(data.note??'',200),status:'To submit',created:now,createdBy:u.id,history:[{status:'To submit',at:now,by:u.id}]};
  }
  if(kind==='optical_recalls'){
   if(old){if(old.status!=='Open')fail('This reminder is already closed',409);if(!['Done','Dismissed'].includes(data.status))fail('Close the reminder as Done or Dismissed');return{...old,status:data.status,closed:new Date().toISOString()}}
   if(data.status!=='Open')fail('New reminders start as Open');if(!['contact','test'].includes(data.type))fail('Unknown reminder type');
   const c=customerOf(db,business,data.customerId,'reminder');
   return{id:key,type:data.type,customerId:c.id,customer:c.name,phone:c.phone||'',due:day(data.due,'reminder date'),about:text(data.about??'',100),status:'Open',created:new Date().toISOString()};
  }
  fail('Unknown record type');
 }
};
