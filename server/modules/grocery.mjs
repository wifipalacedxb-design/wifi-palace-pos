// Grocery & baqala module: product list with barcodes (per piece or per kg), stock movements and
// customer credit (khata).
// Stock is never stored as a number that devices overwrite: it is computed from stock movements
// (goods in, count adjustments) minus quantities on paid sales. Offline devices therefore never
// overwrite each other's stock, and a sale is never blocked by a stock figure (it shows as low/negative).
// Credit sales are core sales with method "Credit (account)"; money collected later is a payment record.
import {fail,text,required,amount,get} from '../check.mjs';

export const GROCERY_CATEGORIES=['Fruits & vegetables','Dairy & eggs','Bakery','Meat & fish','Rice, flour & grains','Cooking & spices','Snacks & sweets','Drinks','Frozen','Household & cleaning','Personal care','Baby','Tobacco','Other'];
const DAY=86400000;
const qty=(v,unit,label='Quantity',allowNegative=false)=>{if(typeof v!=='number'||!Number.isFinite(v)||v===0||Math.abs(v)>100000||(!allowNegative&&v<0))fail(label+' must be a non-zero number');if(unit==='kg'?Math.round(v*1000)!==v*1000:!Number.isInteger(v))fail(unit==='kg'?label+' allows up to 3 decimals (grams)':label+' must be whole pieces');return v};
const recent=(v,label)=>{const t=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(t)||t>Date.now()+300000||t<Date.now()-3*DAY)fail('Invalid '+label+' time');return new Date(t).toISOString()};
const barcode=v=>{const b=text(v??'',40).replace(/\s+/g,'');if(b&&!/^[A-Za-z0-9-]{3,40}$/.test(b))fail('Barcode may only contain letters, numbers and dashes');return b};

// What a customer owes: unrefunded credit sales minus payments received.
export function creditBalance(db,business,customerId){
 let owed=0;
 for(const r of db.prepare("SELECT data FROM records WHERE business_id=? AND kind='sales' AND data IS NOT NULL").all(business)){const s=JSON.parse(r.data);if(s.customerId===customerId&&s.method==='Credit (account)'&&s.status==='Paid')owed+=s.total}
 for(const r of db.prepare("SELECT data FROM records WHERE business_id=? AND kind='grocery_payments' AND data IS NOT NULL").all(business)){const p=JSON.parse(r.data);if(p.customerId===customerId)owed-=p.amount}
 return owed;
}

export const grocery={
 type:'grocery',
 label:'Grocery & baqala',
 catalogKind:'grocery_items',
 kinds:['grocery_items','grocery_stock','grocery_payments'],
 ownerKinds:['grocery_items'],
 deletable:['grocery_items'],
 creditSales:true,
 maxPieces:1000,
 seed:()=>({
  grocery_items:[
   {id:'p1',name:'Milk 1L',barcode:'',category:'Dairy & eggs',unit:'piece',price:650,cost:0,minStock:10},
   {id:'p2',name:'Eggs (30)',barcode:'',category:'Dairy & eggs',unit:'piece',price:1800,cost:0,minStock:5},
   {id:'p3',name:'Arabic bread',barcode:'',category:'Bakery',unit:'piece',price:300,cost:0,minStock:10},
   {id:'p4',name:'Basmati rice 5kg',barcode:'',category:'Rice, flour & grains',unit:'piece',price:3500,cost:0,minStock:3},
   {id:'p5',name:'Tomatoes',barcode:'',category:'Fruits & vegetables',unit:'kg',price:450,cost:0,minStock:5},
   {id:'p6',name:'Bananas',barcode:'',category:'Fruits & vegetables',unit:'kg',price:600,cost:0,minStock:5},
   {id:'p7',name:'Water 1.5L',barcode:'',category:'Drinks',unit:'piece',price:150,cost:0,minStock:24},
   {id:'p8',name:'Soft drink can',barcode:'',category:'Drinks',unit:'piece',price:250,cost:0,minStock:24}
  ],
  staff:[{id:'t1',name:'Cashier 1'}],
  grocery_stock:[],grocery_payments:[]
 }),
 validate({db,business,kind,key,data,old,u}){
  if(kind==='grocery_items'){
   if(!GROCERY_CATEGORIES.includes(data.category))fail('Choose a category');
   if(!['piece','kg'].includes(data.unit))fail('Unit must be piece or kg');
   if(old&&old.unit!==data.unit)fail('A product cannot change between piece and kg. Add a new product instead.',409);
   const code=barcode(data.barcode);
   if(code)for(const r of db.prepare("SELECT id,data FROM records WHERE business_id=? AND kind='grocery_items' AND data IS NOT NULL AND id<>?").all(business,key))if(JSON.parse(r.data).barcode===code)fail('Barcode '+code+' is already used by '+JSON.parse(r.data).name,409);
   const minStock=data.minStock??0;if(typeof minStock!=='number'||!Number.isFinite(minStock)||minStock<0||minStock>100000)fail('Low-stock level must be 0 or more');
   return{id:key,name:required(data.name,100),barcode:code,category:data.category,unit:data.unit,price:amount(data.price),cost:amount(data.cost??0),minStock};
  }
  if(kind==='grocery_stock'){
   if(old)fail('Stock entries cannot be changed. Add a correction instead.',409);
   if(!['in','adjust'].includes(data.type))fail('Stock entry must be goods in or a count adjustment');
   if(data.type==='adjust'&&u.role!=='owner')fail('Only the owner can adjust stock counts',403);
   const item=get(db,business,'grocery_items',required(data.itemId,100));if(!item)fail('Product must sync before its stock',409);
   const e={id:key,type:data.type,itemId:item.id,item:item.name,unit:item.unit,qty:qty(data.qty,item.unit,'Quantity',data.type==='adjust'),at:recent(data.at,'stock'),by:u.id,note:text(data.note??'',200)};
   if(data.type==='in'){e.cost=amount(data.cost??0);e.supplier=text(data.supplier??'',100);e.invoice=text(data.invoice??'',60);}
   else e.reason=required(data.reason??'',200);
   return e;
  }
  if(kind==='grocery_payments'){
   if(old)fail('Payments cannot be changed. Record a correction with the owner.',409);
   const c=get(db,business,'customers',required(data.customerId,100));if(!c)fail('Customer must sync before their payment',409);
   if(!['Cash','Card (external terminal)'].includes(data.method))fail('Payment method must be cash or card');
   const value=amount(data.amount);if(!value)fail('Enter the amount received');
   // Pending payments on a device can go slightly past the balance while other devices are offline; the balance just shows as credit in favour.
   return{id:key,customerId:c.id,customer:c.name,amount:value,method:data.method,at:recent(data.at,'payment'),by:u.id,note:text(data.note??'',200),balanceBefore:creditBalance(db,business,c.id)};
  }
  fail('Unknown record type');
 }
};
