// Laundry module: price list (per piece or per kg) and laundry orders with tag numbers and a status flow.
// Payment reuses the core sales record (tax invoice, finance, printing); an order links to its sale by id.
import {fail,text,required,amount,get} from '../check.mjs';

export const LAUNDRY_STATUSES=['Received','Washing','Ready','Delivered','Cancelled'];
const NEXT={Received:['Washing','Ready','Cancelled'],Washing:['Ready','Cancelled'],Ready:['Delivered'],Delivered:[],Cancelled:[]};
const CATEGORIES=['Wash & iron','Dry clean','Iron only','Wash & fold','Household','Other'];
const quantity=(q,unit)=>{if(typeof q!=='number'||!Number.isFinite(q)||q<=0||q>1000||Math.round(q*100)!==q*100)fail('Invalid quantity');if(unit!=='kg'&&!Number.isInteger(q))fail('Pieces must be a whole number');return q};
const day=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))fail('Invalid date');return v};

export const laundry={
 type:'laundry',
 label:'Laundry',
 catalogKind:'laundry_items',
 kinds:['laundry_items','laundry_orders'],
 ownerKinds:['laundry_items'],
 deletable:['laundry_items'],
 // Starter price list: sample prices the owner edits on the Price list screen.
 seed:()=>({
  laundry_items:[
   {id:'l1',name:'Shirt',category:'Wash & iron',unit:'piece',price:800},
   {id:'l2',name:'Trousers',category:'Wash & iron',unit:'piece',price:1000},
   {id:'l3',name:'Kandura / thobe',category:'Wash & iron',unit:'piece',price:1200},
   {id:'l4',name:'Abaya',category:'Dry clean',unit:'piece',price:2000},
   {id:'l5',name:'Suit (2 pieces)',category:'Dry clean',unit:'piece',price:3500},
   {id:'l6',name:'Shirt',category:'Iron only',unit:'piece',price:400},
   {id:'l7',name:'Wash & fold',category:'Wash & fold',unit:'kg',price:800},
   {id:'l8',name:'Bedsheet',category:'Household',unit:'piece',price:1500},
   {id:'l9',name:'Blanket',category:'Household',unit:'piece',price:3500}
  ],
  staff:[{id:'t1',name:'Staff 1'}],
  laundry_orders:[]
 }),
 validate({db,business,kind,key,data,old,u}){
  if(kind==='laundry_items'){
   if(!CATEGORIES.includes(data.category))fail('Choose a price list category');
   if(!['piece','kg'].includes(data.unit))fail('Unit must be piece or kg');
   return{id:key,name:required(data.name,100),category:data.category,unit:data.unit,price:amount(data.price)};
  }
  if(kind==='laundry_orders'){
   if(!LAUNDRY_STATUSES.includes(data.status))fail('Invalid order status');
   if(old){
    // After drop-off only the status, payment link and notes change; items and customer stay as received.
    if(data.status!==old.status&&!NEXT[old.status].includes(data.status))fail(`An order cannot move from ${old.status} to ${data.status}`,409);
    const saleId=data.saleId??old.saleId??'';if(old.saleId&&saleId!==old.saleId)fail('Order payment cannot be changed',409);
    const o={...old,status:data.status,notes:text(data.notes??old.notes??'',500),saleId:text(saleId,100)};
    if(data.status!==old.status)o.history=[...(old.history||[]),{status:data.status,at:new Date().toISOString(),by:u.id}].slice(-20);
    if(o.status==='Delivered'&&!o.saleId)fail('Take payment before handing over the order',409);
    return o;
   }
   if(data.status!=='Received')fail('New orders start as Received');
   if(typeof data.tag!=='string'||!/^[A-Z0-9-]{3,20}$/.test(data.tag))fail('Invalid tag number');
   for(const row of db.prepare("SELECT data FROM records WHERE business_id=? AND kind='laundry_orders' AND data IS NOT NULL").all(business))if(JSON.parse(row.data).tag===data.tag)fail('This tag number is already used',409);
   if(!Array.isArray(data.items)||data.items.length<1||data.items.length>100)fail('Add at least one item');
   const items=data.items.map(i=>{const item=get(db,business,'laundry_items',i.id);if(!item)fail('A price list item was removed. Review this order.',409);if(i.price!==item.price)fail('A price changed. Review this order.',409);return{id:item.id,name:item.name,category:item.category,unit:item.unit,price:item.price,qty:quantity(i.qty,item.unit)}});
   const customerId=text(data.customerId??'',100),customer=customerId?get(db,business,'customers',customerId):null;if(customerId&&!customer)fail('Customer must sync before their order',409);
   const total=items.reduce((n,i)=>n+Math.round(i.price*i.qty),0);
   return{id:key,tag:data.tag,customerId,customer:customer?.name||required(data.customer,100),phone:customer?.phone||text(data.phone??'',40),items,total,express:data.express===true,notes:text(data.notes??'',500),received:new Date(Date.parse(data.received)||Date.now()).toISOString(),due:day(data.due),status:'Received',saleId:text(data.saleId??'',100),createdBy:u.id,history:[{status:'Received',at:new Date().toISOString(),by:u.id}]};
  }
  fail('Unknown record type');
 }
};
