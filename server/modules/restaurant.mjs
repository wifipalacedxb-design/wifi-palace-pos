// Restaurant & café module: menu (kitchen / bar / no-KOT items with options), tables, order sessions
// (dine-in, takeaway, delivery) and kitchen order tickets (KOTs).
//
// Waiters never edit a shared list of items. Every "Send to kitchen" is its own KOT record, so several
// phones can add to the same table at once, even offline, without overwriting each other. The order record
// only holds the table, customer and status (move, merge, close, cancel). Bills are core sales that point at
// the order (sale.ref), so tax invoices, finance, reports and printing work as for every business type.
import {fail,text,required,amount,get,OFFLINE_GRACE_DAYS} from '../check.mjs';

export const ROUTES=['kitchen','bar','none'];
export const ORDER_TYPES=['dine-in','takeaway','delivery'];
const KOT_FLOW=['new','preparing','ready','served'];
const DAY=86400000;
const uaeDay=(t=Date.now())=>new Date(t+4*3600000).toISOString().slice(0,10);
const recent=(v,label)=>{const t=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(t)||t>Date.now()+300000||t<Date.now()-OFFLINE_GRACE_DAYS*DAY)fail('Invalid '+label+' time');return new Date(t).toISOString()};
const int=(v,min,max,label)=>{if(!Number.isInteger(v)||v<min||v>max)fail(`${label} must be a whole number from ${min} to ${max}`);return v};
const all=(db,business,kind)=>db.prepare('SELECT data FROM records WHERE business_id=? AND kind=? AND data IS NOT NULL').all(business,kind).map(r=>JSON.parse(r.data));
// Daily order numbers (1, 2, 3 … per UAE day) shown on KOTs and to takeaway customers.
const nextOrderNumber=(db,business)=>db.prepare('INSERT INTO counters(business_id,name,value) VALUES (?,?,1) ON CONFLICT(business_id,name) DO UPDATE SET value=value+1 RETURNING value').get(business,'order-'+uaeDay()).value;

function options(item,ids){
 if(ids===undefined||ids===null)ids=[];
 if(!Array.isArray(ids)||ids.length>20)fail('Invalid item options');
 const chosen=ids.map(id=>{const key=typeof id==='object'&&id?id.id:id;const o=(item.options||[]).find(x=>x.id===key);if(!o)fail('An option for '+item.name+' changed. Review this order.',409);return{id:o.id,name:o.name,price:o.price}});
 if(new Set(chosen.map(o=>o.id)).size!==chosen.length)fail('An option was chosen twice');
 return chosen;
}
// Net quantity per KOT line key for an order (orders + voids), used to allow cancelling empty orders.
export function netItems(db,business,orderIds){
 const net=new Map();
 for(const k of all(db,business,'restaurant_kots'))if(orderIds.includes(k.orderId))for(const l of k.items)net.set(l.key,(net.get(l.key)||0)+l.qty);
 return [...net.values()].reduce((n,q)=>n+Math.max(0,q),0);
}

export const restaurant={
 type:'restaurant',
 label:'Restaurant & café',
 catalogKind:'restaurant_items',
 kinds:['restaurant_items','restaurant_tables','restaurant_config','restaurant_orders','restaurant_kots'],
 ownerKinds:['restaurant_items','restaurant_tables','restaurant_config'],
 deletable:['restaurant_items','restaurant_tables'],
 maxPieces:200,
 seed:()=>({
  restaurant_items:[
   {id:'m1',name:'Hummus',category:'Starters',price:1800,route:'kitchen',options:[],available:true},
   {id:'m2',name:'Chicken soup',category:'Starters',price:1500,route:'kitchen',options:[],available:true},
   {id:'m3',name:'Chicken biryani',category:'Mains',price:3200,route:'kitchen',options:[{id:'o1',name:'Extra raita',price:300},{id:'o2',name:'Spicy',price:0},{id:'o3',name:'Mild',price:0}],available:true},
   {id:'m4',name:'Mixed grill',category:'Mains',price:5500,route:'kitchen',options:[{id:'o4',name:'Extra bread',price:200}],available:true},
   {id:'m5',name:'Beef burger',category:'Mains',price:3500,route:'kitchen',options:[{id:'o5',name:'Extra cheese',price:300},{id:'o6',name:'No onion',price:0}],available:true},
   {id:'m6',name:'Fresh orange juice',category:'Drinks',price:1400,route:'bar',options:[{id:'o7',name:'No ice',price:0}],available:true},
   {id:'m7',name:'Karak tea',category:'Drinks',price:500,route:'bar',options:[],available:true},
   {id:'m8',name:'Soft drink',category:'Drinks',price:600,route:'none',options:[],available:true},
   {id:'m9',name:'Kunafa',category:'Desserts',price:2000,route:'kitchen',options:[],available:true},
   {id:'service',name:'Service charge',category:'Charges',price:0,route:'none',options:[],available:true,system:true,openPrice:true}
  ],
  restaurant_tables:Array.from({length:8},(_,i)=>({id:'t'+(i+1),name:'Table '+(i+1),area:i<6?'Indoor':'Outdoor',seats:4})),
  restaurant_config:[{id:'config',serviceBps:0,serviceTypes:['dine-in']}],
  restaurant_orders:[],restaurant_kots:[],
  staff:[{id:'t1',name:'Waiter 1'}]
 }),
 // Sale lines: menu price + chosen options (checked against the menu). The service-charge line is open-priced.
 lineOptions(item,line){const chosen=options(item,line.options);return{price:item.price+chosen.reduce((n,o)=>n+o.price,0),options:chosen.map(o=>o.name+(o.price?' +'+(o.price/100).toFixed(2):'')),note:text(line.note??'',100)}},
 validate({db,business,kind,key,data,old,u}){
  if(kind==='restaurant_items'){
   if(!ROUTES.includes(data.route))fail('Choose Kitchen, Bar or No KOT');
   const opts=Array.isArray(data.options)?data.options:[];if(opts.length>20)fail('Up to 20 options per item');
   const clean=opts.map(o=>({id:required(o?.id,40),name:required(o?.name,60),price:amount(o?.price??0)}));if(new Set(clean.map(o=>o.id)).size!==clean.length)fail('Option ids must be unique');
   const item={id:key,name:required(data.name,100),category:required(data.category,50),price:amount(data.price),route:data.route,options:clean,available:data.available!==false};
   if(key==='service'||old?.system){item.system=true;item.openPrice=true;item.route='none';item.options=[]}
   return item;
  }
  if(kind==='restaurant_tables')return{id:key,name:required(data.name,40),area:text(data.area??'',40),seats:int(data.seats??4,0,50,'Seats')};
  if(kind==='restaurant_config'){if(key!=='config')fail('Invalid settings record');const types=Array.isArray(data.serviceTypes)?data.serviceTypes.filter(t=>ORDER_TYPES.includes(t)):[];return{id:'config',serviceBps:int(data.serviceBps??0,0,3000,'Service charge (basis points)'),serviceTypes:[...new Set(types)]}}
  if(kind==='restaurant_orders'){
   if(old){
    const o={...old};
    for(const k of ['id','type','number','opened','openedBy'])if(data[k]!==undefined&&data[k]!==old[k])fail('Order details cannot be changed',409);
    if(data.status!==old.status){
     const to=data.status,from=old.status;
     if(from==='open'&&to==='closed'){o.status='closed';o.closedAt=new Date().toISOString();o.closedBy=u.id}
     else if(from==='open'&&to==='cancelled'){const hasItems=netItems(db,business,[old.id])>0;if(hasItems&&u.role!=='owner')fail('Only the owner can cancel an order that has items. Void the items first.',403);o.status='cancelled';o.cancelReason=required(data.cancelReason,200);o.closedAt=new Date().toISOString();o.closedBy=u.id}
     else if(from==='open'&&to==='merged'){const target=get(db,business,'restaurant_orders',required(data.mergedInto,100));if(!target||target.status!=='open'||target.id===old.id||target.type!=='dine-in'||old.type!=='dine-in')fail('Choose another open table to merge into',409);o.status='merged';o.mergedInto=target.id;o.closedAt=new Date().toISOString();o.closedBy=u.id}
     else if(from==='closed'&&to==='open'){if(u.role!=='owner')fail('Only the owner can reopen a closed order',403);o.status='open';delete o.closedAt}
     else fail(`An order cannot move from ${from} to ${to}`,409);
    }
    if(o.status==='open'){
     if(old.type==='dine-in'&&data.tableId&&data.tableId!==old.tableId){const t=get(db,business,'restaurant_tables',data.tableId);if(!t)fail('Table not found',409);o.tableId=t.id;o.table=t.name;o.moves=[...(old.moves||[]),{from:old.table,to:t.name,at:new Date().toISOString(),by:u.id}].slice(-20)}
     if(data.guests!==undefined)o.guests=int(data.guests,0,99,'Guests');
     if(data.note!==undefined)o.note=text(data.note,200);
     if(data.serviceCharge!==undefined)o.serviceCharge=data.serviceCharge===true;
     if(old.type==='delivery'){for(const k of ['customer','phone','address','driver'])if(data[k]!==undefined)o[k]=text(data[k],k==='address'?300:100);if(data.stage!==undefined){if(!['preparing','out','delivered'].includes(data.stage))fail('Invalid delivery stage');o.stage=data.stage}}
     else if(data.customer!==undefined)o.customer=text(data.customer,100);
    }
    return o;
   }
   if(!ORDER_TYPES.includes(data.type))fail('Choose dine-in, takeaway or delivery');
   if(data.status!=='open')fail('New orders start open');
   const o={id:key,type:data.type,number:nextOrderNumber(db,business),status:'open',opened:recent(data.opened||new Date().toISOString(),'order'),openedBy:u.id,guests:int(data.guests??0,0,99,'Guests'),note:text(data.note??'',200),customer:text(data.customer??'',100),serviceCharge:data.serviceCharge===true};
   if(o.type==='dine-in'){const t=get(db,business,'restaurant_tables',required(data.tableId,100));if(!t)fail('Table must sync before its order',409);o.tableId=t.id;o.table=t.name}
   if(o.type==='delivery'){o.customer=required(data.customer,100);o.phone=required(data.phone,40);o.address=required(data.address,300);o.driver=text(data.driver??'',100);o.stage='preparing'}
   return o;
  }
  if(kind==='restaurant_kots'){
   if(old){
    const to=data.status??old.status,k={...old};
    if(to!==old.status){if(KOT_FLOW.indexOf(to)<=KOT_FLOW.indexOf(old.status))fail('A ticket can only move forward',409);k.status=to;k[to+'At']=new Date().toISOString()}
    if(data.stationPrinted===true)k.stationPrinted=true;
    return k;
   }
   let order=get(db,business,'restaurant_orders',required(data.orderId,100));if(!order)fail('Order must sync before its ticket',409);
   if(order.status==='merged'){order=get(db,business,'restaurant_orders',order.mergedInto)||order}
   if(order.status==='cancelled')fail('This order was cancelled',409);
   const type=data.type==='void'?'void':'order';
   if(!Array.isArray(data.items)||data.items.length<1||data.items.length>60)fail('A ticket needs 1 to 60 lines');
   const items=data.items.map(l=>{
    const item=get(db,business,'restaurant_items',required(l.itemId,100));if(!item||item.system)fail('A menu item was removed. Review this order.',409);
    const qty=type==='void'?int(l.qty,-99,-1,'Void quantity'):int(l.qty,1,99,'Quantity');
    const chosen=options(item,l.options);
    return{key:required(l.key,100),itemId:item.id,name:item.name,category:item.category,route:item.route,price:item.price+chosen.reduce((n,o)=>n+o.price,0),options:chosen,note:text(l.note??'',100),qty};
   });
   return{id:key,orderId:order.id,orderNumber:order.number,type,table:order.table||'',orderType:order.type,items,reason:type==='void'?required(data.reason,200):'',status:'new',at:recent(data.at,'ticket'),by:u.id,byName:text(data.byName??'',100),printAtStation:data.printAtStation===true};
  }
  fail('Unknown record type');
 }
};
