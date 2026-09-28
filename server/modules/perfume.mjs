// Perfume & oud module. Retail engine shared with grocery / pet shop (barcode, stock, credit), plus:
// * units for loose goods: ml, gram, tola (11.664 g) — oils, attar, oud chips and bakhoor sold from bulk;
// * custom blends: saved recipes (oils + quantities + bottle) per customer; selling a blend puts each oil and
//   the bottle on the bill, so every oil's stock goes down by what was used;
// * gift sets (a product made from other products: assembling takes the parts out of stock) and gift wrapping
//   (a service);
// * loyalty points per customer (earn on paid bills, redeem as a discount) and a scent profile;
// * several branches / mall kiosks: every stock movement and sale belongs to a branch; stock can be transferred.
import {fail,text,required,amount,get,OFFLINE_GRACE_DAYS} from '../check.mjs';
import {retailValidate,creditBalance,SCALE_DEFAULT} from './grocery.mjs';

export const PERFUME_CATEGORIES=['Perfumes (bottles)','Oils & attar','Oud & bakhoor','Bottles & packaging','Gift sets','Burners & accessories','Body & home','Gift wrapping','Other'];
export const FAMILIES=['Oud','Musk','Rose','Amber','Floral','Woody','Citrus','Fresh','Sweet','Spicy','Leather','Aquatic'];
export const PERFUME_UNITS=['piece','ml','g','tola'];
const DAY=86400000;
const all=(db,business,kind)=>db.prepare('SELECT data FROM records WHERE business_id=? AND kind=? AND data IS NOT NULL').all(business,kind).map(r=>JSON.parse(r.data));
const config=(db,business)=>get(db,business,'grocery_config','config')||{};
export const branchIds=(db,business)=>(config(db,business).branches||[]).map(b=>b.id);
export const LOYALTY_DEFAULT={enabled:true,earnPerAed:1,redeemFils:5,minRedeem:100}; // 1 point per AED 1 · 100 points = AED 5
const loyalty=(db,business)=>({...LOYALTY_DEFAULT,...(config(db,business).loyalty||{})});
const recent=(v,label)=>{const t=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(t)||t>Date.now()+300000||t<Date.now()-OFFLINE_GRACE_DAYS*DAY)fail('Invalid '+label+' time');return new Date(t).toISOString()};
const dec=(v,label,max=100000)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>max||Math.abs(Math.round(v*1000)-v*1000)>1e-6)fail(label+' must be more than 0, up to 3 decimals');return v};

// Points a paid bill earns: whole points on the amount after discount, before VAT.
export const earnFor=(sale,l)=>Math.floor((sale.sub-sale.off)*l.earnPerAed/100);
// A customer's points: all earn / redeem / adjust records, except those of refunded bills.
export function pointsBalance(db,business,customerId,{sales}={}){
 const refunded=new Set((sales||all(db,business,'sales')).filter(s=>s.status==='Refunded').map(s=>s.id));
 return all(db,business,'perfume_points').filter(p=>p.customerId===customerId&&!(p.saleId&&refunded.has(p.saleId))).reduce((n,p)=>n+p.points,0);
}

function components(db,business,list,self,label){
 if(list===undefined||list===null)return [];
 if(!Array.isArray(list)||list.length>20)fail(label+': up to 20 items');
 const out=list.map(c=>{const it=get(db,business,'grocery_items',required(c?.itemId,100));if(!it||it.type==='service'||it.id===self)fail(label+': an item is missing or not a product',409);return{itemId:it.id,name:it.name,unit:it.unit,qty:it.unit==='piece'?(Number.isInteger(c.qty)&&c.qty>0&&c.qty<=1000?c.qty:fail(label+': whole pieces only')):dec(c.qty,label+' quantity')}});
 if(new Set(out.map(c=>c.itemId)).size!==out.length)fail(label+': each item once');
 return out;
}

export const perfume={
 type:'perfume',
 label:'Perfume & oud',
 catalogKind:'grocery_items',
 kinds:['grocery_items','grocery_stock','grocery_payments','grocery_config','perfume_blends','perfume_profiles','perfume_points'],
 ownerKinds:['grocery_items','grocery_config'],
 deletable:['grocery_items','perfume_blends'],
 creditSales:true,
 maxPieces:1000,
 branches:branchIds,
 seed:()=>({
  grocery_items:[
   {id:'p1',name:'Oud Royal 100ml (EDP)',barcode:'',category:'Perfumes (bottles)',unit:'piece',price:35000,cost:0,minStock:3,family:'Oud'},
   {id:'p2',name:'White Musk 50ml',barcode:'',category:'Perfumes (bottles)',unit:'piece',price:12000,cost:0,minStock:3,family:'Musk'},
   {id:'o1',name:'Dehn al Oud (oil)',barcode:'',category:'Oils & attar',unit:'tola',price:25000,cost:0,minStock:2,family:'Oud'},
   {id:'o2',name:'Taifi Rose (oil)',barcode:'',category:'Oils & attar',unit:'ml',price:1500,cost:0,minStock:20,family:'Rose'},
   {id:'o3',name:'White Musk (oil)',barcode:'',category:'Oils & attar',unit:'ml',price:600,cost:0,minStock:30,family:'Musk'},
   {id:'o4',name:'Amber (oil)',barcode:'',category:'Oils & attar',unit:'ml',price:800,cost:0,minStock:30,family:'Amber'},
   {id:'b1',name:'Cambodian oud chips',barcode:'',category:'Oud & bakhoor',unit:'g',price:1200,cost:0,minStock:50,family:'Oud'},
   {id:'b2',name:'Bakhoor box',barcode:'',category:'Oud & bakhoor',unit:'piece',price:4500,cost:0,minStock:5,family:'Oud'},
   {id:'k1',name:'Crystal bottle 12ml',barcode:'',category:'Bottles & packaging',unit:'piece',price:1500,cost:0,minStock:20},
   {id:'k2',name:'Gold bottle 30ml',barcode:'',category:'Bottles & packaging',unit:'piece',price:3000,cost:0,minStock:10},
   {id:'w1',type:'service',serviceType:'wrapping',name:'Gift wrapping',barcode:'',category:'Gift wrapping',unit:'piece',price:1000,cost:0,minStock:0,duration:10,openPrice:true}
  ],
  staff:[{id:'t1',name:'Sales 1'}],
  grocery_stock:[],grocery_payments:[],
  grocery_config:[{id:'config',scale:{...SCALE_DEFAULT},branches:[{id:'main',name:'Main shop'}],loyalty:{...LOYALTY_DEFAULT}}],
  perfume_blends:[],perfume_profiles:[],perfume_points:[]
 }),
 // Blend lines carry a note ("Blend: Royal Night") so the receipt shows which oils made which blend.
 lineOptions(item,line){return{price:item.price,options:[],note:text(line.note??'',100)}},
 summary(db,business){
  const stock={},byBranch={},credit={},points={},add=(m,k,v)=>{m[k]=Math.round(((m[k]||0)+v)*1000)/1000},addB=(item,branch,v)=>{if(!branch)return;const m=byBranch[item]??={};add(m,branch,v)};
  for(const e of all(db,business,'grocery_stock')){if(e.type==='transfer'){addB(e.itemId,e.branch,-e.qty);addB(e.itemId,e.toBranch,e.qty);continue}add(stock,e.itemId,e.qty);addB(e.itemId,e.branch,e.qty)}
  const sales=all(db,business,'sales');
  for(const s of sales){if(s.status!=='Paid')continue;for(const i of s.items){add(stock,i.id,-i.qty);addB(i.id,s.branch,-i.qty)}if(s.method==='Credit (account)')add(credit,s.customerId,s.total)}
  for(const p of all(db,business,'grocery_payments'))add(credit,p.customerId,-p.amount);
  const refunded=new Set(sales.filter(s=>s.status==='Refunded').map(s=>s.id));
  for(const p of all(db,business,'perfume_points'))if(!(p.saleId&&refunded.has(p.saleId)))points[p.customerId]=(points[p.customerId]||0)+p.points;
  return{stock,stockByBranch:byBranch,credit,points};
 },
 validate(args){
  const {db,business,kind,key,data,old,u}=args;
  if(kind.startsWith('grocery_'))return retailValidate(args,{
   categories:PERFUME_CATEGORIES,serviceTypes:['wrapping','other'],units:PERFUME_UNITS,branches:branchIds,
   itemExtra:({db,business,key,data})=>{const x={};if(data.family){if(!FAMILIES.includes(data.family))fail('Choose a scent family');x.family=data.family}
    if(data.category==='Gift sets'){x.components=components(db,business,data.components,key,'Gift set');if(!x.components.length)fail('A gift set needs its items')}return x},
   configExtra:({data,old})=>{
    const list=Array.isArray(data.branches)?data.branches:(old?.branches||[{id:'main',name:'Main shop'}]);if(!list.length||list.length>20)fail('Keep 1 to 20 branches');
    const branches=list.map(b=>({id:required(b?.id,40),name:required(b?.name,60)}));if(new Set(branches.map(b=>b.id)).size!==branches.length)fail('Branch ids must be unique');
    const l={...LOYALTY_DEFAULT,...(old?.loyalty||{}),...(data.loyalty||{})};
    if(!Number.isFinite(l.earnPerAed)||l.earnPerAed<0||l.earnPerAed>100)fail('Points per AED must be 0 to 100');
    if(!Number.isInteger(l.redeemFils)||l.redeemFils<1||l.redeemFils>100)fail('Point value must be 1 to 100 fils');
    if(!Number.isInteger(l.minRedeem)||l.minRedeem<1||l.minRedeem>100000)fail('Minimum points to redeem must be 1 or more');
    return{branches,loyalty:{enabled:l.enabled!==false,earnPerAed:l.earnPerAed,redeemFils:l.redeemFils,minRedeem:l.minRedeem}}}
  });
  if(kind==='perfume_profiles'){
   const c=get(db,business,'customers',key);if(!c)fail('Customer must sync before their profile',409);
   const fam=Array.isArray(data.families)?data.families:[];if(fam.some(f=>!FAMILIES.includes(f)))fail('Unknown scent family');
   return{id:key,customerId:key,customer:c.name,families:[...new Set(fam)],favourites:text(data.favourites??'',300),avoid:text(data.avoid??'',200),notes:text(data.notes??'',500)};
  }
  if(kind==='perfume_blends'){
   let customer=null;if(data.customerId){customer=get(db,business,'customers',data.customerId);if(!customer)fail('Customer must sync before their blend',409)}
   const parts=components(db,business,data.components,'','Blend');if(!parts.length)fail('A blend needs at least one oil');if(parts.some(p=>p.unit==='piece'))fail('Blend ingredients are oils sold by ml, gram or tola');
   let bottle=null;if(data.bottleId){bottle=get(db,business,'grocery_items',data.bottleId);if(!bottle||bottle.type==='service'||bottle.unit!=='piece')fail('Choose a bottle sold per piece',409)}
   return{id:key,name:required(data.name,60),customerId:customer?.id||'',customer:customer?.name||'',components:parts,bottleId:bottle?.id||'',bottle:bottle?.name||'',notes:text(data.notes??'',300),created:old?.created||new Date().toISOString(),by:old?.by||u.id};
  }
  if(kind==='perfume_points'){
   if(old)fail('Points records cannot be changed. Add an adjustment.',409);
   const l=loyalty(db,business),c=get(db,business,'customers',required(data.customerId,100));if(!c)fail('Customer must sync before their points',409);
   const p={id:key,customerId:c.id,customer:c.name,type:data.type,points:data.points,at:recent(data.at,'points'),by:u.id};
   if(!Number.isInteger(p.points)||p.points===0||Math.abs(p.points)>10000000)fail('Points must be a whole number');
   if(data.type==='adjust'){if(u.role!=='owner')fail('Only the owner can adjust points',403);p.reason=required(data.reason,200);if(pointsBalance(db,business,c.id)+p.points<0)fail('Points cannot go below zero');return p}
   if(!l.enabled)fail('Loyalty points are switched off');
   const sale=get(db,business,'sales',required(data.saleId,100));if(!sale)fail('Bill must sync before its points',409);if(sale.customerId!==c.id||sale.status!=='Paid')fail('Points must match a paid bill for this customer',409);
   p.saleId=sale.id;p.sale=sale.number;
   if(data.type==='earn'){if(key!=='earn-'+sale.id)fail('Invalid points record');if(p.points!==earnFor(sale,l))fail('Points do not match the bill',409);return p}
   if(data.type==='redeem'){if(key!=='redeem-'+sale.id)fail('Invalid points record');const used=-p.points;if(used<l.minRedeem)fail('Redeem at least '+l.minRedeem+' points');if(used*l.redeemFils>sale.off)fail('Points value is more than the bill discount',409);const bal=pointsBalance(db,business,c.id);if(bal<used)fail(c.name+' has only '+bal+' points',409);return p}
   fail('Invalid points record');
  }
  fail('Unknown record type');
 }
};
export {creditBalance};
