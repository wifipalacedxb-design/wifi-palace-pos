// Grocery & baqala module: product list with barcodes (per piece or per kg), stock movements and
// customer credit (khata).
// Stock is never stored as a number that devices overwrite: it is computed from stock movements
// (goods in, count adjustments) minus quantities on paid sales. Offline devices therefore never
// overwrite each other's stock, and a sale is never blocked by a stock figure (it shows as low/negative).
// Credit sales are core sales with method "Credit (account)"; money collected later is a payment record.
import {fail,text,required,amount,get,OFFLINE_GRACE_DAYS} from '../check.mjs';

export const GROCERY_CATEGORIES=['Fruits & vegetables','Dairy & eggs','Bakery','Meat & fish','Rice, flour & grains','Cooking & spices','Snacks & sweets','Drinks','Frozen','Household & cleaning','Personal care','Baby','Tobacco','Other'];
const DAY=86400000;
const qty=(v,unit,label='Quantity',allowNegative=false)=>{if(typeof v!=='number'||!Number.isFinite(v)||v===0||Math.abs(v)>100000||(!allowNegative&&v<0))fail(label+' must be a non-zero number');if(unit==='kg'?Math.abs(Math.round(v*1000)-v*1000)>1e-6:!Number.isInteger(v))fail(unit==='kg'?label+' allows up to 3 decimals (grams)':label+' must be whole pieces');return v};
const recent=(v,label)=>{const t=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(t)||t>Date.now()+300000||t<Date.now()-OFFLINE_GRACE_DAYS*DAY)fail('Invalid '+label+' time');return new Date(t).toISOString()};
// Scale code (PLU) keyed into the label scale for weighed products: 1 to 6 digits, stored without leading zeros.
const plu=v=>{if(v===undefined||v===null||v==='')return '';const s=String(v).trim();if(!/^\d{1,6}$/.test(s))fail('Scale code (PLU) must be 1 to 6 digits');return String(Number(s))};
export const SCALE_DEFAULT={prefix:'21',codeDigits:5,value:'weight'};
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
 kinds:['grocery_items','grocery_stock','grocery_payments','grocery_config'],
 ownerKinds:['grocery_items','grocery_config'],
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
  grocery_stock:[],grocery_payments:[],
  grocery_config:[{id:'config',scale:{...SCALE_DEFAULT}}]
 }),
 // Authoritative totals from every till's synced records; devices add their own unsynced changes on top.
 summary(db,business){
  const stock={},credit={},all=kind=>db.prepare('SELECT data FROM records WHERE business_id=? AND kind=? AND data IS NOT NULL').all(business,kind).map(r=>JSON.parse(r.data)),add=(m,k,v)=>{m[k]=Math.round(((m[k]||0)+v)*1000)/1000};
  for(const e of all('grocery_stock'))add(stock,e.itemId,e.qty);
  for(const s of all('sales')){if(s.status!=='Paid')continue;for(const i of s.items)add(stock,i.id,-i.qty);if(s.method==='Credit (account)')add(credit,s.customerId,s.total)}
  for(const p of all('grocery_payments'))add(credit,p.customerId,-p.amount);
  return{stock,credit};
 },
 validate(args){return retailValidate(args)}
};

// Shared by grocery and pet shop: products (piece/kg, barcode, scale code), services (pet shop: no stock),
// stock movements, customer credit payments and label-scale settings.
export function retailValidate({db,business,kind,key,data,old,u},{categories=GROCERY_CATEGORIES,serviceTypes=null}={}){
 {
  if(kind==='grocery_items'){
   if(!categories.includes(data.category))fail('Choose a category');
   if(serviceTypes&&data.type==='service'){
    if(old&&old.type!=='service')fail('A product cannot become a service. Add a new item instead.',409);
    if(!serviceTypes.includes(data.serviceType))fail('Choose the service type');
    const minutes=data.duration??60;if(!Number.isInteger(minutes)||minutes<5||minutes>1440)fail('Duration must be 5 to 1440 minutes');
    return{id:key,type:'service',serviceType:data.serviceType,name:required(data.name,100),barcode:'',category:data.category,unit:'piece',price:amount(data.price),cost:0,minStock:0,duration:minutes,openPrice:data.openPrice===true};
   }
   if(old?.type==='service')fail('A service cannot become a product. Add a new item instead.',409);
   if(!['piece','kg'].includes(data.unit))fail('Unit must be piece or kg');
   if(old&&old.unit!==data.unit)fail('A product cannot change between piece and kg. Add a new product instead.',409);
   const code=barcode(data.barcode);
   if(code)for(const r of db.prepare("SELECT id,data FROM records WHERE business_id=? AND kind='grocery_items' AND data IS NOT NULL AND id<>?").all(business,key))if(JSON.parse(r.data).barcode===code)fail('Barcode '+code+' is already used by '+JSON.parse(r.data).name,409);
   const scaleCode=plu(data.plu);if(scaleCode&&data.unit!=='kg')fail('Only products sold by weight (kg) can have a scale code');
   if(scaleCode)for(const r of db.prepare("SELECT id,data FROM records WHERE business_id=? AND kind='grocery_items' AND data IS NOT NULL AND id<>?").all(business,key))if(JSON.parse(r.data).plu===scaleCode)fail('Scale code '+scaleCode+' is already used by '+JSON.parse(r.data).name,409);
   const minStock=data.minStock??0;if(typeof minStock!=='number'||!Number.isFinite(minStock)||minStock<0||minStock>100000)fail('Low-stock level must be 0 or more');
   return{id:key,name:required(data.name,100),barcode:code,category:data.category,unit:data.unit,price:amount(data.price),cost:amount(data.cost??0),minStock,...(scaleCode?{plu:scaleCode}:{})};
  }
  // Barcode label scale: EAN-13 = prefix + product scale code + weight (grams) or price (fils) + check digit.
  if(kind==='grocery_config'){
   if(key!=='config')fail('Invalid settings record');
   const sc=data.scale||{},prefix=String(sc.prefix??'').trim(),digits=sc.codeDigits;
   if(!/^\d{1,2}$/.test(prefix)||prefix[0]!=='2')fail('Scale label prefix must be 2 or 20 to 29');
   if(![4,5,6].includes(digits))fail('Scale code length must be 4, 5 or 6 digits');
   if(12-prefix.length-digits<4)fail('This format leaves too few digits for the weight or price');
   if(!['weight','price'].includes(sc.value))fail('Labels carry either the weight or the price');
   return{id:'config',scale:{prefix,codeDigits:digits,value:sc.value}};
  }
  if(kind==='grocery_stock'){
   if(old)fail('Stock entries cannot be changed. Add a correction instead.',409);
   if(!['in','adjust'].includes(data.type))fail('Stock entry must be goods in or a count adjustment');
   if(data.type==='adjust'&&u.role!=='owner')fail('Only the owner can adjust stock counts',403);
   const item=get(db,business,'grocery_items',required(data.itemId,100));if(!item)fail('Product must sync before its stock',409);if(item.type==='service')fail('Services have no stock');
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
}
