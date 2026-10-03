// Tailoring & abaya shop module. Retail engine shared with grocery (ready-made abayas by size and colour with
// barcode and stock, fabric sold by the metre, customer accounts), branches as in perfume shops, plus:
// * saved measurements per customer and garment type;
// * stitching orders and alterations: garments with measurements, design notes, own or shop fabric, delivery
//   date, a production flow (New → Cutting → Stitching → Finishing → Ready → Delivered) and a job slip;
// * the tailor on each order and a piece rate, for a "pieces finished" pay report;
// * advances are account payments; the order is billed through the normal checkout, so the balance on
//   collection can be paid or left on the customer's account.
import {fail,text,required,amount,get,OFFLINE_GRACE_DAYS} from '../check.mjs';
import {retailValidate,SCALE_DEFAULT} from './grocery.mjs';
import {perfume} from './perfume.mjs';

export const TAILOR_CATEGORIES=['Abayas','Sheilas & scarves','Kaftans & jalabiyas','Kanduras','Dresses','Fabric','Lace & trims','Accessories','Stitching','Alterations','Other'];
export const STAGES=['New','Cutting','Stitching','Finishing','Ready','Delivered'];
export const ORDER_TYPES=['stitching','alteration'];
const config=(db,business)=>get(db,business,'grocery_config','config')||{};
export const branchIds=(db,business)=>(config(db,business).branches||[]).map(b=>b.id);
const nextNumber=(db,business)=>db.prepare('INSERT INTO counters(business_id,name,value) VALUES (?,?,1) ON CONFLICT(business_id,name) DO UPDATE SET value=value+1 RETURNING value').get(business,'tailor-order').value;
const day=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))fail('Choose the delivery date');return v};
const metres=(v,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>500||Math.abs(Math.round(v*1000)-v*1000)>1e-6)fail(label+' must be more than 0, up to 3 decimals');return v};
// Measurements are a short list of label / value pairs, e.g. Length 56, Shoulder 15.5.
function measures(list){
 if(list===undefined||list===null)return [];
 if(!Array.isArray(list)||list.length>30)fail('Up to 30 measurements');
 return list.map(m=>({label:required(m?.label,30),value:text(String(m?.value??''),20)})).filter(m=>m.value);
}
function garments(db,business,list){
 if(!Array.isArray(list)||!list.length||list.length>20)fail('Add 1 to 20 garments');
 const out=list.map(g=>{
  const x={key:required(g?.key,60),garment:required(g.garment,40),qty:Number.isInteger(g.qty)&&g.qty>=1&&g.qty<=50?g.qty:fail('Pieces must be 1 to 50'),price:amount(g.price??0),design:text(g.design??'',300),measurements:measures(g.measurements),fabric:g.fabric==='shop'?'shop':'customer'};
  if(x.fabric==='shop'){const f=get(db,business,'grocery_items',required(g.fabricItemId,100));if(!f||f.type==='service'||f.unit!=='m')fail('Choose a fabric sold by the metre',409);x.fabricItemId=f.id;x.fabricName=f.name;x.fabricQty=metres(g.fabricQty,'Metres per piece')}
  return x});
 if(new Set(out.map(g=>g.key)).size!==out.length)fail('Garment lines must be unique');
 return out;
}

export const tailor={
 type:'tailor',
 label:'Tailoring & abaya',
 catalogKind:'grocery_items',
 kinds:['grocery_items','grocery_stock','grocery_payments','grocery_config','tailor_orders','tailor_measurements'],
 ownerKinds:['grocery_items','grocery_config'],
 deletable:['grocery_items'],
 creditSales:true,
 maxPieces:1000,
 branches:branchIds,
 summary:perfume.summary,
 seed:()=>({
  grocery_items:[
   {id:'ab1',name:'Classic black abaya 54',barcode:'',category:'Abayas',unit:'piece',price:25000,cost:0,minStock:2,size:'54',colour:'Black'},
   {id:'ab2',name:'Classic black abaya 56',barcode:'',category:'Abayas',unit:'piece',price:25000,cost:0,minStock:2,size:'56',colour:'Black'},
   {id:'ab3',name:'Open abaya with lace 56',barcode:'',category:'Abayas',unit:'piece',price:38000,cost:0,minStock:1,size:'56',colour:'Black'},
   {id:'sh1',name:'Chiffon sheila',barcode:'',category:'Sheilas & scarves',unit:'piece',price:6000,cost:0,minStock:5,colour:'Black'},
   {id:'fb1',name:'Nida fabric',barcode:'',category:'Fabric',unit:'m',price:4500,cost:0,minStock:20,colour:'Black'},
   {id:'fb2',name:'Crepe fabric',barcode:'',category:'Fabric',unit:'m',price:3500,cost:0,minStock:20,colour:'Black'},
   {id:'tr1',name:'Lace trim',barcode:'',category:'Lace & trims',unit:'m',price:1500,cost:0,minStock:10},
   {id:'st1',type:'service',serviceType:'stitching',name:'Stitching charge',barcode:'',category:'Stitching',unit:'piece',price:15000,cost:0,minStock:0,duration:60,openPrice:true},
   {id:'al1',type:'service',serviceType:'alteration',name:'Alteration',barcode:'',category:'Alterations',unit:'piece',price:3000,cost:0,minStock:0,duration:30,openPrice:true}
  ],
  staff:[{id:'t1',name:'Tailor 1'}],
  grocery_stock:[],grocery_payments:[],grocery_config:[{id:'config',scale:{...SCALE_DEFAULT},branches:[{id:'main',name:'Main shop'}]}],
  tailor_orders:[],tailor_measurements:[]
 }),
 lineOptions(item,line){return{price:item.price,options:[],note:text(line.note??'',100)}},
 validate(args){
  const {db,business,kind,key,data,old,u}=args;
  if(kind.startsWith('grocery_'))return retailValidate(args,{
   categories:TAILOR_CATEGORIES,serviceTypes:['stitching','alteration','other'],units:['piece','m'],branches:branchIds,
   itemExtra:({data})=>{const x={};if(data.size)x.size=text(data.size,20);if(data.colour)x.colour=text(data.colour,30);return x},
   configExtra:({data,old})=>{const list=Array.isArray(data.branches)?data.branches:(old?.branches||[{id:'main',name:'Main shop'}]);if(!list.length||list.length>20)fail('Keep 1 to 20 branches');
    const branches=list.map(b=>({id:required(b?.id,40),name:required(b?.name,60)}));if(new Set(branches.map(b=>b.id)).size!==branches.length)fail('Branch ids must be unique');return{branches}}
  });
  if(kind==='tailor_measurements'){
   const c=get(db,business,'customers',key);if(!c)fail('Customer must sync before their measurements',409);
   const list=Array.isArray(data.garments)?data.garments:[];if(list.length>12)fail('Up to 12 garment types per customer');
   const garmentsOut=list.map(g=>({type:required(g?.type,40),fields:measures(g.fields),note:text(g.note??'',200)}));if(new Set(garmentsOut.map(g=>g.type)).size!==garmentsOut.length)fail('One set of measurements per garment type');
   return{id:key,customerId:key,customer:c.name,garments:garmentsOut,updated:new Date().toISOString()};
  }
  if(kind==='tailor_orders'){
   const who=id=>{if(!id)return{tailorId:'',tailor:''};const s=get(db,business,'staff',id);if(!s)fail('Choose a tailor from the staff list',409);return{tailorId:s.id,tailor:s.name}};
   if(old){
    const o={...old},closed=['Delivered','Cancelled'].includes(old.status);
    if(data.status!==undefined&&data.status!==old.status){
     if(closed)fail(`A ${old.status.toLowerCase()} order cannot change`,409);
     if(data.status==='Cancelled')o.cancelReason=required(data.cancelReason,200);
     else{const from=STAGES.indexOf(old.status),to=STAGES.indexOf(data.status);if(to<0)fail('Unknown stage');if(to<from&&!(old.status==='Ready'&&to>=1))fail(`An order cannot move back from ${old.status} to ${data.status}`,409)}
     o.status=data.status;const now=new Date().toISOString();if(data.status==='Ready')o.readyAt=now;o.history=[...(old.history||[]),{status:data.status,at:now,by:u.id}].slice(-20)}
    const saleId=text(data.saleId??old.saleId??'',100);if(old.saleId&&saleId!==old.saleId)fail('The order bill cannot be changed',409);o.saleId=saleId;
    if(o.status==='Delivered'&&!o.saleId)fail('Bill the order before handing it over',409);
    if(!closed){if(data.due!==undefined)o.due=day(data.due);if(data.note!==undefined)o.note=text(data.note,200);if(data.tailorId!==undefined)Object.assign(o,who(data.tailorId));if(data.rate!==undefined)o.rate=amount(data.rate);
     if(old.status==='New'&&Array.isArray(data.items))o.items=garments(db,business,data.items)}
    return o;
   }
   if(data.status!=='New')fail('New orders start as New');
   if(!ORDER_TYPES.includes(data.type))fail('Choose stitching or alteration');
   const c=get(db,business,'customers',required(data.customerId,100));if(!c)fail('Customer must sync before their order',409);
   const now=new Date().toISOString();
   return{id:key,number:nextNumber(db,business),type:data.type,customerId:c.id,customer:c.name,phone:c.phone||'',items:garments(db,business,data.items),due:day(data.due),advance:amount(data.advance??0),note:text(data.note??'',200),...who(data.tailorId),rate:amount(data.rate??0),status:'New',saleId:'',created:now,createdBy:u.id,history:[{status:'New',at:now,by:u.id}]};
  }
  fail('Unknown record type');
 }
};
