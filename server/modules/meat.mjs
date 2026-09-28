// Meat shop / butchery module. Retail engine shared with grocery (barcode, label scale, stock by kg, credit
// accounts for restaurants and hotels), plus:
// * cutting options per product (curry cut, boneless, mince…) with an extra charge per kg, priced on the bill;
// * carcass breakdown: a whole goat / lamb / beef quarter received by weight and cost is broken into cuts;
//   records yield % and cost per usable kg (the cut stock itself arrives as ordinary "goods in" entries);
// * pre-orders (phone / WhatsApp, Eid & Qurbani, restaurant supply) for pickup or delivery, with a status flow.
//   Advances are account payments to the customer; the final bill can go on the account to use them.
import {fail,text,required,amount,get,OFFLINE_GRACE_DAYS} from '../check.mjs';
import {grocery,retailValidate,SCALE_DEFAULT} from './grocery.mjs';

export const MEAT_CATEGORIES=['Mutton & goat','Lamb','Beef','Veal','Camel','Chicken','Fish & seafood','Minced & marinated','Offal','Whole animals','Frozen','Bones & fat','Delivery & services','Other'];
export const ANIMALS=['Goat','Lamb','Sheep','Beef','Veal','Camel','Chicken','Other'];
export const OCCASIONS=['Regular','Eid / Qurbani','Party / event','Restaurant supply'];
const FLOW={New:['Preparing','Ready','Cancelled'],Preparing:['Ready','Cancelled'],Ready:['Out for delivery','Done','Cancelled'],'Out for delivery':['Done','Ready'],Done:[],Cancelled:[]};
const DAY=86400000;
const recent=(v,label)=>{const t=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(t)||t>Date.now()+300000||t<Date.now()-OFFLINE_GRACE_DAYS*DAY)fail('Invalid '+label+' time');return new Date(t).toISOString()};
const kg=(v,label,min=0.001,max=100000)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max||Math.abs(Math.round(v*1000)-v*1000)>1e-6)fail(label+' must be '+min+' to '+max+' kg (up to 3 decimals)');return v};
const nextNumber=(db,business)=>db.prepare('INSERT INTO counters(business_id,name,value) VALUES (?,?,1) ON CONFLICT(business_id,name) DO UPDATE SET value=value+1 RETURNING value').get(business,'meat-order').value;

function cuts(list,unit){
 if(list===undefined||list===null)return [];
 if(!Array.isArray(list)||list.length>15)fail('Up to 15 cutting options per product');
 if(list.length&&unit!=='kg')fail('Cutting options are for products sold by kg');
 const out=list.map(c=>({id:required(c?.id,40),name:required(c?.name,40),charge:amount(c?.charge??0)}));
 if(new Set(out.map(c=>c.id)).size!==out.length)fail('Cutting option ids must be unique');
 return out;
}
// The cut chosen on a bill or order line, checked against the product.
function chosenCut(item,ids){
 if(ids===undefined||ids===null||(Array.isArray(ids)&&!ids.length))return null;
 if(!Array.isArray(ids)||ids.length!==1)fail('Choose one cutting option');
 const key=typeof ids[0]==='object'&&ids[0]?ids[0].id:ids[0],c=(item.cuts||[]).find(x=>x.id===key);
 if(!c)fail('A cutting option for '+item.name+' changed. Review this bill.',409);
 return c;
}
const cutLabel=c=>c.name+(c.charge?' +'+(c.charge/100).toFixed(2)+'/kg':'');

export const meat={
 type:'meat',
 label:'Meat shop',
 catalogKind:'grocery_items',
 kinds:['grocery_items','grocery_stock','grocery_payments','grocery_config','meat_orders','meat_breakdowns'],
 ownerKinds:['grocery_items','grocery_config'],
 deletable:['grocery_items'],
 creditSales:true,
 maxPieces:1000,
 summary:grocery.summary,
 seed:()=>{
  const std=[{id:'c1',name:'Curry cut',charge:0},{id:'c2',name:'Boneless',charge:400},{id:'c3',name:'Mince',charge:300},{id:'c4',name:'Big pieces',charge:0}];
  return{
   grocery_items:[
    {id:'m1',name:'Goat meat (local)',barcode:'',category:'Mutton & goat',unit:'kg',price:5200,cost:0,minStock:5,plu:'1',cuts:std},
    {id:'m2',name:'Lamb (Australian)',barcode:'',category:'Lamb',unit:'kg',price:4200,cost:0,minStock:5,plu:'2',cuts:std},
    {id:'m3',name:'Lamb chops',barcode:'',category:'Lamb',unit:'kg',price:5800,cost:0,minStock:3,plu:'3',cuts:[{id:'c5',name:'Thin slices',charge:0},{id:'c6',name:'Frenched',charge:500}]},
    {id:'m4',name:'Beef (Indian)',barcode:'',category:'Beef',unit:'kg',price:3200,cost:0,minStock:5,plu:'4',cuts:std},
    {id:'m5',name:'Beef steak (tenderloin)',barcode:'',category:'Beef',unit:'kg',price:9500,cost:0,minStock:2,plu:'5',cuts:[{id:'c7',name:'Steaks 2 cm',charge:0},{id:'c8',name:'Cubes',charge:200}]},
    {id:'m6',name:'Camel meat',barcode:'',category:'Camel',unit:'kg',price:4800,cost:0,minStock:3,plu:'6',cuts:std},
    {id:'m7',name:'Whole chicken (fresh)',barcode:'',category:'Chicken',unit:'kg',price:1800,cost:0,minStock:10,plu:'7',cuts:[{id:'c9',name:'Curry cut',charge:0},{id:'c10',name:'Skinless',charge:200},{id:'c11',name:'Boneless breast',charge:800}]},
    {id:'m8',name:'Minced beef',barcode:'',category:'Minced & marinated',unit:'kg',price:3600,cost:0,minStock:3,plu:'8'},
    {id:'m9',name:'Mutton liver',barcode:'',category:'Offal',unit:'kg',price:3000,cost:0,minStock:1,plu:'9'},
    {id:'m10',name:'Mutton bones (soup)',barcode:'',category:'Bones & fat',unit:'kg',price:1200,cost:0,minStock:2,plu:'10'},
    {id:'w1',name:'Whole goat (Qurbani)',barcode:'',category:'Whole animals',unit:'piece',price:95000,cost:0,minStock:0},
    {id:'d1',type:'service',serviceType:'delivery',name:'Home delivery',barcode:'',category:'Delivery & services',unit:'piece',price:1000,cost:0,minStock:0,duration:60,openPrice:true}
   ],
   staff:[{id:'t1',name:'Butcher 1'}],
   grocery_stock:[],grocery_payments:[],grocery_config:[{id:'config',scale:{...SCALE_DEFAULT}}],
   meat_orders:[],meat_breakdowns:[]
  };
 },
 // Bill lines: price per kg = product price + the chosen cut's charge.
 lineOptions(item,line){const c=chosenCut(item,line.options);return{price:item.price+(c?.charge||0),options:c?[cutLabel(c)]:[],note:text(line.note??'',100)}},
 validate(args){
  const {db,business,kind,key,data,old,u}=args;
  if(kind.startsWith('grocery_'))return retailValidate(args,{categories:MEAT_CATEGORIES,serviceTypes:['delivery','other'],itemExtra:({data})=>{const c=cuts(data.cuts,data.unit);return c.length?{cuts:c}:{}}});
  if(kind==='meat_breakdowns'){
   if(old)fail('A breakdown cannot be changed. Record a stock count to correct it.',409);
   if(!ANIMALS.includes(data.animal))fail('Choose the animal');
   const weight=kg(data.weight,'Carcass weight',0.1,5000),cost=amount(data.cost);
   if(!Array.isArray(data.outputs)||!data.outputs.length||data.outputs.length>40)fail('Add the cuts that came out (1 to 40)');
   const outputs=data.outputs.map(o=>{const it=get(db,business,'grocery_items',required(o?.itemId,100));if(!it||it.unit!=='kg'||it.type==='service')fail('Cuts must be products sold by kg',409);return{itemId:it.id,name:it.name,qty:kg(o.qty,'Cut weight')}});
   if(new Set(outputs.map(o=>o.itemId)).size!==outputs.length)fail('List each cut once');
   const usable=Math.round(outputs.reduce((n,o)=>n+o.qty,0)*1000)/1000;if(usable>weight*1.02)fail('The cuts weigh more than the carcass');
   const waste=Math.round((weight-usable)*1000)/1000;
   return{id:key,animal:data.animal,description:text(data.description??'',100),supplier:text(data.supplier??'',100),invoice:text(data.invoice??'',60),weight,cost,outputs,usable,waste:Math.max(0,waste),yieldPct:Math.round(usable/weight*1000)/10,costPerKg:usable?Math.round(cost/usable):0,at:recent(data.at,'breakdown'),by:u.id};
  }
  if(kind==='meat_orders'){
   const items=Array.isArray(data.items)?data.items:null;
   const lines=()=>{if(!items||!items.length||items.length>40)fail('Add 1 to 40 items');return items.map(l=>{const it=get(db,business,'grocery_items',required(l?.itemId,100));if(!it||it.type==='service')fail('A product on this order was removed. Review it.',409);const c=chosenCut(it,l.cut?[l.cut]:null),qty=it.unit==='kg'?kg(l.qty,'Quantity'):(Number.isInteger(l.qty)&&l.qty>0&&l.qty<=1000?l.qty:fail('Pieces must be whole numbers'));return{itemId:it.id,name:it.name,unit:it.unit,qty,cut:c?.id||'',cutName:c?.name||'',price:it.price+(c?.charge||0),note:text(l.note??'',100)}})};
   const due=v=>{const t=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(t)||t<Date.now()-OFFLINE_GRACE_DAYS*DAY||t>Date.now()+400*DAY)fail('Choose when the order is needed');return new Date(t).toISOString()};
   if(old){
    const o={...old};
    if(data.status!==old.status){if(!FLOW[old.status].includes(data.status))fail(`An order cannot move from ${old.status} to ${data.status}`,409);
     if(data.status==='Out for delivery'&&old.type!=='delivery')fail('Only delivery orders go out for delivery',409);
     if(data.status==='Cancelled')o.cancelReason=required(data.cancelReason,200);
     o.status=data.status;o.history=[...(old.history||[]),{status:data.status,at:new Date().toISOString(),by:u.id}].slice(-20)}
    const saleId=text(data.saleId??old.saleId??'',100);if(old.saleId&&saleId!==old.saleId)fail('Order payment cannot be changed',409);o.saleId=saleId;
    if(o.status==='Done'&&!o.saleId)fail('Bill the order before closing it',409);
    if(['New','Preparing'].includes(old.status)&&data.items)o.items=lines();
    for(const k of ['address','note','driver'])if(data[k]!==undefined)o[k]=text(data[k],k==='address'?300:200);
    if(data.due!==undefined&&['New','Preparing','Ready'].includes(o.status))o.due=due(data.due);
    return o;
   }
   if(data.status!=='New')fail('New orders start as New');
   if(!['pickup','delivery'].includes(data.type))fail('Choose pickup or delivery');
   if(!OCCASIONS.includes(data.occasion))fail('Choose the occasion');
   const c=get(db,business,'customers',required(data.customerId,100));if(!c)fail('Customer must sync before their order',409);
   const o={id:key,number:nextNumber(db,business),customerId:c.id,customer:c.name,phone:c.phone||'',type:data.type,occasion:data.occasion,due:due(data.due),items:lines(),address:text(data.address??'',300),note:text(data.note??'',200),driver:text(data.driver??'',100),advance:amount(data.advance??0),status:'New',saleId:'',created:new Date().toISOString(),createdBy:u.id,history:[{status:'New',at:new Date().toISOString(),by:u.id}]};
   if(o.type==='delivery'&&!o.address)fail('Enter the delivery address');
   return o;
  }
  fail('Unknown record type');
 }
};
