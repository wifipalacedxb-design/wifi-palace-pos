// Demo shops: one ready-to-show business per type (salon, laundry, gym, grocery, restaurant, pet shop,
// perfume), filled with a month of realistic sample data so dashboards and charts look alive.
// Anyone can open them from /demo without a password (as owner or as cashier). Every night (04:00 UAE)
// each demo is deleted and rebuilt, so whatever visitors change disappears. Sign-in changes, team accounts
// and password changes are blocked for demo businesses.
//
// Sample records go through the same validation as real ones (operation()), so demos never contain data
// the app would reject.
import {randomBytes} from 'node:crypto';
import {createBusiness,passwordHash,hash,audit} from './store.mjs';
import {operation,ApiError} from './rules.mjs';
import {setStaffOptions} from './staff.mjs';
import {BUSINESS_TYPES,businessModule} from './modules.mjs';

const DAY=86400000;
export const DEMO_SHOPS={
 salon:{slug:'demo-salon',name:'Glamour Salon & Spa',blurb:'Appointments, stylists, commission, services'},
 laundry:{slug:'demo-laundry',name:'FreshPress Laundry',blurb:'Tag orders, washing → ready → delivered, pay on collection'},
 gym:{slug:'demo-gym',name:'IronFit Gym',blurb:'Memberships, check-in desk, freeze, PT packs, expiry alerts'},
 grocery:{slug:'demo-grocery',name:'Al Madina Baqala',blurb:'Barcode checkout, stock, customer credit (khata), label scale'},
 restaurant:{slug:'demo-restaurant',name:'Spice Route Restaurant',blurb:'Tables, kitchen tickets, kitchen screen, split bills'},
 petshop:{slug:'demo-petshop',name:'Paws & Claws Pet Shop',blurb:'Pet profiles, grooming, boarding, products & stock'},
 perfume:{slug:'demo-perfume',name:'Oud House Perfumes',blurb:'Oils by tola/ml, custom blends, loyalty points, branches'},
 meat:{slug:'demo-meat',name:'Al Noor Butchery',blurb:'Label scale, cutting options, carcass yield, Eid pre-orders'},
 mobile:{slug:'demo-mobile',name:'Smart Zone Mobiles',blurb:'IMEI tracking, warranty, repair job cards, used phones & trade-in'},
 tailor:{slug:'demo-tailor',name:'Noor Abayas & Tailoring',blurb:'Stitching orders, measurements, ready-made abayas, fabric by the metre'},
 electronics:{slug:'demo-electronics',name:'Tech Hub Computers',blurb:'Serial numbers & warranty, quotations, repairs, delivery & installation, RMA'}
};
const PEOPLE=[['Fatima Al Mansoori','0501234501'],['Ahmed Khan','0551234502'],['Priya Nair','0521234503'],['Omar Haddad','0561234504'],['Sara Ahmed','0501234505'],['John Mathew','0581234506'],['Aisha Rahman','0541234507'],['Mohammed Ali','0501234508'],['Maria Santos','0551234509'],['Rashid Al Suwaidi','0521234510'],['Noura Saeed','0561234511'],['Vikram Patel','0501234512'],['Layla Hassan','0541234513'],['Yusuf Qureshi','0551234514'],['Elena Petrova','0581234515']];

export function initDemo(db){db.exec('CREATE TABLE IF NOT EXISTS demo_businesses(business_id TEXT PRIMARY KEY,type TEXT NOT NULL,owner_id TEXT NOT NULL,cashier_id TEXT NOT NULL,reset TEXT NOT NULL,topup TEXT NOT NULL DEFAULT \'\')')}
export const isDemo=(db,business)=>{try{return !!db.prepare('SELECT 1 FROM demo_businesses WHERE business_id=?').get(business)}catch{return false}};

// --- helpers -------------------------------------------------------------------------------------------------
function rng(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
const uaeDay=(t=Date.now())=>new Date(t+4*3600000).toISOString().slice(0,10);
const addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
// A moment `daysAgo` days back at hour:minute UAE time.
const slot=(daysAgo,hour,minute=0)=>{const d=addDays(uaeDay(),-daysAgo);return new Date(Date.parse(d+'T00:00:00Z')+(hour-4)*3600000+minute*60000).toISOString()};
// Past moments only (sales, check-ins, tickets): anything that would fall later today is moved to just before now.
const at=(daysAgo,hour,minute=0)=>{const t=Date.parse(slot(daysAgo,hour,minute)),limit=Date.now()-120000;return new Date(t>limit?limit-((hour*7+minute)%90)*60000:t).toISOString()};
const uid=()=>randomBytes(12).toString('hex');
function ctx(db,business,type,owner,seed){
 const r=rng(seed),pick=a=>a[Math.floor(r()*a.length)],int=(a,b)=>a+Math.floor(r()*(b-a+1));
 const u={id:owner,business_id:business,business_type:type,role:'owner'};
 const put=(kind,key,data,base)=>{if(base===undefined)base=db.prepare('SELECT version FROM records WHERE business_id=? AND kind=? AND id=?').get(business,kind,key)?.version||0;return operation(db,u,{id:uid(),kind,key,action:'put',base,data}).data};
 const get=(kind,key)=>{const row=db.prepare('SELECT data FROM records WHERE business_id=? AND kind=? AND id=?').get(business,kind,key);return row?.data?JSON.parse(row.data):null};
 const list=kind=>db.prepare('SELECT data FROM records WHERE business_id=? AND kind=? AND data IS NOT NULL').all(business,kind).map(x=>JSON.parse(x.data));
 const tax=()=>get('settings','singleton').tax;
 // A paid bill: lines [{id, qty, price?, note?, options?}] priced from the catalogue.
 function sale(lines,{date,method,customerId='',off=0,extra={}}={}){
  const cat=businessModule(type).catalogKind,items=lines.map(l=>{const it=get(cat,l.id);return{id:it.id,name:it.name,price:l.price??it.price,qty:l.qty??1,...(l.note?{note:l.note}:{}),...(l.options?{options:l.options}:{})}});
  const sub=items.reduce((n,i)=>n+Math.round(i.price*i.qty),0),o=Math.min(off,sub),t=Math.round((sub-o)*tax()/100),total=sub-o+t;
  method=method||pick(['Cash','Cash','Card (external terminal)','Card (external terminal)','Split']);
  if(method==='Split'&&total<200)method='Cash';
  const cash=method==='Split'?Math.round(total/2):method==='Cash'?total:0,card=method==='Split'?total-cash:method.startsWith('Card')?total:0,received=method==='Credit (account)'?0:method==='Cash'?Math.ceil(total/1000)*1000:total;
  const key=uid();
  return put('sales',key,{status:'Paid',items,sub,off:o,tax:t,total,method,...(method==='Split'?{cashAmount:cash,cardAmount:card}:{}),received:method==='Split'?total:received,date,customerId,customer:'',staff:'Demo staff',...extra});
 }
 return{u,r,pick,int,put,get,list,sale};
}
const DAYS=27;
// Busier on Thursday–Saturday evenings.
const perDay=(c,daysAgo,base)=>{const dow=new Date(Date.now()-daysAgo*DAY+4*3600000).getUTCDay();return Math.max(1,base+(dow===4||dow===5||dow===6?2:0)+c.int(-1,1))};

// --- per type sample data ----------------------------------------------------------------------------------------
const BUILD={
 salon(c,cust){
  const staff=[['s1','Anna',1000],['s2','Reem',1200],['s3','Karim',800]];c.put('staff','t1',{name:'Anna',commissionBps:1000});for(const [id,n,b] of staff.slice(1))c.put('staff',id,{name:n,commissionBps:b});
  for(const [id,n,cat,p,open] of [['s5','Manicure','Nails',6000],['s6','Pedicure','Nails',8000],['s7','Blow dry','Hair',7000],['s8','Keratin treatment','Hair',45000,true]])c.put('services',id,{name:n,category:cat,price:p,openPrice:!!open});
  const svcs=['s1','s2','s3','s4','s5','s6','s7','s8'],stylists=['t1','s2','s3'];
  for(let d=DAYS;d>=1;d--)for(let k=0;k<perDay(c,d,4);k++){const st=c.pick(stylists),rate=c.get('staff',st).commissionBps||0;c.sale([...new Set([c.pick(svcs),...(c.r()<.35?[c.pick(svcs)]:[])])].map(id=>({id})),{date:at(d,c.int(10,21),c.int(0,59)),customerId:c.r()<.8?c.pick(cust):'',extra:{staffId:st,commissionBps:rate}})}
  // Upcoming bookings: today and tomorrow, two-hour gaps per stylist.
  for(const [n,st] of stylists.entries())for(const [dayAgo,hour] of [[0,11+n],[0,15+n],[-1,10+n],[-1,14+n]]){const s=c.get('services',c.pick(svcs)),cu=c.get('customers',c.pick(cust));c.put('appointments',uid(),{when:slot(dayAgo,hour,n%2?30:0),duration:60,customer:cu.name,customerId:cu.id,service:s.name,staffId:st,status:'Booked'})}
 },
 laundry(c,cust){
  c.put('staff','t1',{name:'Joseph'});c.put('staff','s2',{name:'Ravi'});
  const items=['l1','l2','l3','l4','l5','l6','l8','l9'];let tag=1001;
  const order=(daysAgo,status)=>{const cu=c.get('customers',c.pick(cust)),lines=[...new Set(Array.from({length:c.int(1,4)},()=>c.pick(items)))].map(id=>{const it=c.get('laundry_items',id);return{id,price:it.price,qty:c.int(1,5)}});if(c.r()<.25){lines.push({id:'l7',price:800,qty:c.int(2,6)+0.5})}
   const o=c.put('laundry_orders',uid(),{tag:'T-'+(tag++),customerId:cu.id,customer:cu.name,items:lines,express:c.r()<.2,notes:'',received:at(daysAgo,c.int(9,20)),due:addDays(uaeDay(),-daysAgo+2),status:'Received'});
   if(status==='Received')return;let cur=c.put('laundry_orders',o.id,{...o,status:'Washing'});if(status==='Washing')return;cur=c.put('laundry_orders',o.id,{...cur,status:'Ready'});if(status==='Ready')return;
   const s=c.sale(o.items.map(i=>({id:i.id,qty:i.qty})),{date:at(Math.max(0,daysAgo-2),c.int(10,21)),customerId:cu.id,extra:{ref:o.id}});c.put('laundry_orders',o.id,{...cur,saleId:s.id,status:'Delivered'})};
  for(let d=DAYS;d>=3;d--)for(let k=0;k<perDay(c,d,3);k++)order(d,'Delivered');
  for(const [d,s] of [[2,'Ready'],[2,'Ready'],[1,'Ready'],[1,'Washing'],[1,'Washing'],[0,'Received'],[0,'Received'],[0,'Washing']])order(d,s);
 },
 gym(c,cust){
  c.put('staff','t1',{name:'Coach Sam'});c.put('staff','s2',{name:'Coach Hana'});
  const plans=[['g2',30],['g3',90],['g2',30],['g5',365],['g4',180]];
  cust.forEach((id,k)=>{const [plan,days]=plans[k%plans.length],ago=[2,5,9,14,20,24,26,28,27,26][k%10],s=c.sale([{id:plan}],{date:at(ago,c.int(7,21)),customerId:id,method:c.pick(['Cash','Card (external terminal)'])});
   const m=c.put('gym_memberships',uid(),{customerId:id,planId:plan,start:addDays(uaeDay(),-ago),status:'Active',saleId:s.id});
   for(let d=Math.min(ago,20);d>=0;d--)if(c.r()<.45)c.put('gym_checkins',uid(),{customerId:id,membershipId:m.id,at:at(d,c.int(6,21),c.int(0,59))});
   if(k<3){const p=c.sale([{id:'g7'}],{date:at(ago,c.int(7,20)),customerId:id,method:'Card (external terminal)'});const pt=c.put('gym_pt',uid(),{customerId:id,itemId:'g7',trainerId:k%2?'s2':'t1',status:'Active',saleId:p.id});let cur=pt;for(let n=0;n<c.int(2,6);n++)cur=c.put('gym_pt',pt.id,{...cur,used:[...cur.used,{at:at(Math.max(0,5-n),c.int(7,19)),trainerId:cur.trainerId}]})}});
  for(let d=DAYS;d>=0;d--)for(let k=0;k<perDay(c,d,3);k++)c.sale([{id:c.pick(['g8','g8','g9','g10','g1']),qty:c.int(1,2)}],{date:at(d,c.int(6,22),c.int(0,59))});
 },
 grocery(c,cust){
  c.put('staff','t1',{name:'Cashier Ali'});
  const more=[['p9','Pepsi 330ml','6281000001','Drinks','piece',250,180,24],['p10','Lays Salt 45g','6281000002','Snacks & sweets','piece',200,140,10],['p11','Nido milk powder 900g','6281000003','Dairy & eggs','piece',3900,3300,4],['p12','Sunflower oil 1.8L','6281000004','Cooking & spices','piece',1650,1350,4],['p13','Tide powder 2kg','6281000005','Household & cleaning','piece',2200,1800,3],['p14','Colgate toothpaste','6281000006','Personal care','piece',950,700,5],['p15','Masafi water 500ml (12)','6281000007','Drinks','piece',1000,750,6],['p16','Onions','','Fruits & vegetables','kg',350,220,5],['p17','Potatoes','','Fruits & vegetables','kg',300,200,5],['p18','Chicken breast','','Meat & fish','kg',2600,2000,3]];
  for(const [id,n,b,cat,unit,price,cost,min] of more)c.put('grocery_items',id,{name:n,barcode:b,category:cat,unit,price,cost,minStock:min,...(id==='p16'?{plu:'16'}:id==='p17'?{plu:'17'}:{})});
  const all=c.list('grocery_items'),stock={p1:60,p2:20,p3:80,p4:15,p5:40,p6:40,p7:120,p8:96,p9:96,p10:48,p11:10,p12:12,p13:8,p14:15,p15:30,p16:40,p17:50,p18:12};
  for(const i of all)c.put('grocery_stock',uid(),{type:'in',itemId:i.id,qty:stock[i.id]||20,cost:i.cost,supplier:c.pick(['Al Maya Distribution','Emirates Foods','Fresh Farms']),invoice:'INV-'+c.int(1000,9999),at:at(DAYS,9)});
  const credit=cust.slice(0,4);
  for(let d=DAYS-1;d>=0;d--)for(let k=0;k<perDay(c,d,7);k++){const lines=[...new Set(Array.from({length:c.int(1,4)},()=>c.pick(all).id))].map(id=>{const it=all.find(x=>x.id===id);return{id,qty:it.unit==='kg'?c.int(5,25)/10:c.int(1,3)}});const onCredit=c.r()<.15;c.sale(lines,{date:at(d,c.int(7,23),c.int(0,59)),...(onCredit?{method:'Credit (account)',customerId:c.pick(credit)}:{})})}
  for(const id of credit.slice(0,2))c.put('grocery_payments',uid(),{customerId:id,amount:5000,method:'Cash',note:'Weekly settlement',at:at(3,20)});
 },
 restaurant(c,cust,db,business){
  c.put('staff','t1',{name:'Waiter Ali'});c.put('restaurant_config','config',{serviceBps:1000,serviceTypes:['dine-in']});
  const run=restaurantRunner(c,cust),tables=c.list('restaurant_tables');
  for(let d=DAYS;d>=1;d--)for(let k=0;k<perDay(c,d,6);k++)run(d,c.pick(['dine-in','dine-in','dine-in','takeaway','delivery']));
  db.prepare("DELETE FROM counters WHERE business_id=? AND name LIKE 'order-%'").run(business); // today's order numbers start at 1
  // Open right now: three tables in the kitchen queue and a takeaway.
  [['preparing',0],['new',2],['ready',4]].forEach(([status,k])=>run(0,'dine-in',{open:true,status,table:tables[k]}));run(0,'takeaway',{open:true,status:'new'});
 },
 petshop(c,cust){
  c.put('staff','t1',{name:'Groomer Maya'});c.put('staff','s2',{name:'Groomer Leo'});
  for(const i of c.list('grocery_items').filter(i=>i.type!=='service'))c.put('grocery_stock',uid(),{type:'in',itemId:i.id,qty:i.unit==='kg'?25:i.id==='p7'?40:c.int(8,30),cost:Math.round(i.price*.6),supplier:'Pet Supplies LLC',at:at(DAYS,10)});
  const pets=[['Max','Dog','Shih Tzu'],['Luna','Cat','Persian'],['Rocky','Dog','Golden Retriever'],['Bella','Dog','Pomeranian'],['Simba','Cat','British Shorthair'],['Coco','Bird','Cockatiel'],['Milo','Dog','Beagle'],['Nala','Cat','Siamese']];
  const ids=pets.map(([name,species,breed],k)=>c.put('pets',uid(),{customerId:cust[k],name,species,breed,sex:k%2?'Female':'Male',weight:species==='Dog'?c.int(40,300)/10:species==='Cat'?c.int(30,60)/10:0.1,dob:addDays(uaeDay(),-c.int(400,3000)),allergies:k===0?'Chicken allergy':'',vaccinations:species==='Bird'?[]:[{id:uid(),name:'Rabies',date:addDays(uaeDay(),-c.int(300,360)),due:addDays(uaeDay(),c.int(-3,40))}]}).id);
  const groom=['s1','s2','s3'];
  for(let d=DAYS;d>=1;d--){for(let k=0;k<perDay(c,d,2);k++){const p=c.get('pets',c.pick(ids.slice(0,5).concat(ids.slice(6)))),svc=c.pick(groom),a=c.put('appointments',uid(),{when:at(d,10+k*2),duration:60,petId:p.id,serviceId:svc,staffId:k%2?'s2':'t1',status:'Booked'});const s=c.sale([{id:svc}],{date:at(d,11+k*2),customerId:p.customerId});c.put('appointments',a.id,{...a,status:'Completed',saleId:s.id})}
   for(let k=0;k<perDay(c,d,3);k++)c.sale([{id:c.pick(['p1','p2','p3','p4','p5','p7']),qty:c.int(1,2)}],{date:at(d,c.int(10,21),c.int(0,59)),customerId:c.r()<.5?c.pick(cust.slice(0,8)):''})}
  c.put('appointments',uid(),{when:slot(0,10),duration:120,petId:ids[2],serviceId:'s2',staffId:'t1',status:'Checked in',notes:'Summer cut'});c.put('appointments',uid(),{when:slot(0,13),duration:60,petId:ids[0],serviceId:'s1',staffId:'t1',status:'Booked'});c.put('appointments',uid(),{when:slot(0,15),duration:15,petId:ids[4],serviceId:'s3',staffId:'s2',status:'Booked'});
  const today=uaeDay();c.put('pet_stays',uid(),{petId:ids[3],serviceId:'s4',status:'In',from:addDays(today,-2),until:addDays(today,2),kennel:'K2',care:'Own food twice a day',checkIn:at(2,10)});c.put('pet_stays',uid(),{petId:ids[6],serviceId:'s4',status:'Booked',from:addDays(today,1),until:addDays(today,5),kennel:'K4',care:'Walk twice daily'});
 },
 perfume(c,cust){
  c.put('staff','t1',{name:'Aisha'});
  const cfg=c.get('grocery_config','config');c.put('grocery_config','config',{...cfg,branches:[{id:'main',name:'Deira main shop'},{id:'mall',name:'Mall of the Emirates kiosk'}]});
  for(const [id,n,cat,unit,price,fam,min] of [['p3','Rose Taifi 100ml (EDP)','Perfumes (bottles)','piece',28000,'Rose',3],['o5','Sandalwood (oil)','Oils & attar','ml',1200,'Woody',20],['g1','Eid gift set','Gift sets','piece',22000,'Oud',2]])c.put('grocery_items',id,{name:n,barcode:'',category:cat,unit,price,cost:Math.round(price*.5),minStock:min,family:fam,...(id==='g1'?{components:[{itemId:'p2',qty:1},{itemId:'b2',qty:2}]}:{})});
  const stockIn={p1:14,p2:20,p3:10,o1:12,o2:300,o3:400,o4:350,o5:250,b1:500,b2:30,k1:120,k2:60};
  for(const [id,q] of Object.entries(stockIn)){const it=c.get('grocery_items',id);c.put('grocery_stock',uid(),{type:'in',itemId:id,qty:q,cost:Math.round(it.price*.5),supplier:'Ajmal Trading',branch:'main',at:at(DAYS,10)})}
  for(const [id,q] of [['p1',4],['p2',6],['o2',80],['b2',8]]){const it=c.get('grocery_items',id);c.put('grocery_stock',uid(),{type:'transfer',itemId:id,qty:q,branch:'main',toBranch:'mall',at:at(DAYS-1,11)})}
  for(const q of [['g1',3],['p2',-3],['b2',-6]])c.put('grocery_stock',uid(),{type:'assemble',itemId:q[0],qty:q[1],branch:'main',reason:'Gift set: Eid gift set',at:at(DAYS-1,12)});
  const blends=[['Royal Rose Oud',[['o2',6],['o1',0.25]],'k1'],['Musk Amber Night',[['o3',8],['o4',4]],'k1'],['Sandal Oud Classic',[['o5',10],['o1',0.5]],'k2']].map(([name,parts,bottle],k)=>c.put('perfume_blends',uid(),{name,customerId:cust[k],components:parts.map(([itemId,qty])=>({itemId,qty})),bottleId:bottle}));
  cust.slice(0,6).forEach((id,k)=>c.put('perfume_profiles',id,{families:[['Oud','Rose'],['Musk','Amber'],['Woody','Oud'],['Floral','Fresh'],['Oud','Spicy'],['Sweet','Musk']][k],favourites:['Oud Royal','White Musk','Rose Taifi','','',''][k],avoid:k===1?'Too sweet':''}));
  const l={earnPerAed:1};
  for(let d=DAYS-2;d>=0;d--)for(let k=0;k<perDay(c,d,3);k++){const branch=c.r()<.35?'mall':'main',cu=c.r()<.7?c.pick(cust.slice(0,10)):'';let lines;
   if(c.r()<.25){const b=c.pick(blends);lines=[...b.components.map(x=>({id:x.itemId,qty:x.qty,note:'Blend: '+b.name})),{id:b.bottleId,qty:1,note:'Blend: '+b.name}]}
   else lines=[...new Set(Array.from({length:c.int(1,3)},()=>c.pick(['p1','p2','p3','b1','b2','o2','o3','g1','w1'])))].map(id=>{const it=c.get('grocery_items',id);return{id,qty:it.unit==='piece'?1:it.unit==='g'?c.int(10,50):c.int(3,12)}});
   const s=c.sale(lines,{date:at(d,c.int(10,22),c.int(0,59)),customerId:cu,extra:{branch}});
   if(cu){const pts=Math.floor((s.sub-s.off)*l.earnPerAed/100);if(pts>0)c.put('perfume_points','earn-'+s.id,{customerId:cu,type:'earn',points:pts,saleId:s.id,at:s.date})}}
 },
 meat(c,cust){
  c.put('staff','t1',{name:'Butcher Rafiq'});
  const hotel=c.put('customers',uid(),{name:'Hotel Rimal (restaurant account)',phone:'0507654321',dob:''}).id,cafe=c.put('customers',uid(),{name:'Spice Route Restaurant',phone:'0507654322',dob:''}).id;
  const bd=(daysAgo,animal,desc,weight,cost,outs)=>{const when=at(daysAgo,7),usable=outs.reduce((n,o)=>n+o[1],0),perKg=Math.round(cost/usable);c.put('meat_breakdowns',uid(),{animal,description:desc,supplier:'Al Mawashi',invoice:'AM-'+c.int(1000,9999),weight,cost,outputs:outs.map(([itemId,qty])=>({itemId,qty})),at:when});for(const [itemId,qty] of outs)c.put('grocery_stock',uid(),{type:'in',itemId,qty,cost:perKg,supplier:'Al Mawashi',note:'Breakdown: '+animal+' '+weight+' kg',at:when})};
  for(let d=DAYS;d>=1;d-=3){bd(d,'Goat','Local goat',c.int(170,200)/10,c.int(520,600)*100,[['m1',c.int(125,140)/10],['m9',0.6],['m10',c.int(18,24)/10]]);bd(d,'Lamb','Australian lamb',c.int(190,220)/10,c.int(560,640)*100,[['m2',c.int(120,135)/10],['m3',c.int(30,40)/10],['m10',1.5]]);bd(d,'Beef','Beef forequarter',c.int(480,520)/10,c.int(1100,1250)*100,[['m4',c.int(300,340)/10],['m5',c.int(40,55)/10],['m8',c.int(60,80)/10]])}
  for(const [id,q] of [['m6',25],['m7',60]])c.put('grocery_stock',uid(),{type:'in',itemId:id,qty:q,cost:c.get('grocery_items',id).price*0.7|0,supplier:'Al Rawdah Farms',at:at(DAYS,8)});
  const kgItems=['m1','m1','m2','m3','m4','m4','m5','m6','m7','m7','m7','m8','m9'],line=()=>{const id=c.pick(kgItems),it=c.get('grocery_items',id),cut=it.cuts?.length&&c.r()<.7?c.pick(it.cuts):null;return{id,qty:c.int(5,30)/10,price:it.price+(cut?.charge||0),...(cut?{options:[cut.id]}:{})}};
  for(let d=DAYS-1;d>=1;d--){for(let k=0;k<perDay(c,d,6);k++)c.sale(Array.from({length:c.int(1,3)},line),{date:at(d,c.int(8,22),c.int(0,59)),customerId:c.r()<.3?c.pick(cust):''});
   if(d%2===0)c.sale([{id:'m4',qty:c.int(80,150)/10,price:3200},{id:'m7',qty:c.int(100,200)/10,price:1800}],{date:at(d,9),method:'Credit (account)',customerId:c.pick([hotel,cafe])})}
  c.put('grocery_payments',uid(),{customerId:hotel,amount:150000,method:'Card (external terminal)',note:'Monthly settlement',at:at(10,11)});
  const order=(dueDays,hour,{type='pickup',occasion='Regular',who=c.pick(cust),items,advance=0,status='New'}={})=>{const o=c.put('meat_orders',uid(),{status:'New',type,occasion,customerId:who,due:slot(-dueDays,hour),address:type==='delivery'?c.pick(['JLT Cluster D, Tower 2','Al Barsha 1, Villa 14','Rimal Hotel, JBR']):'',items,advance,note:''});if(advance)c.put('grocery_payments',uid(),{customerId:who,amount:advance,method:'Cash',note:'Advance for order',at:at(1,12)});let cur=o;for(const st of {New:[],Preparing:['Preparing'],Ready:['Preparing','Ready']}[status])cur=c.put('meat_orders',o.id,{...cur,status:st});return cur};
  order(0,17,{type:'delivery',who:hotel,items:[{itemId:'m4',qty:15,cut:'c1'},{itemId:'m7',qty:20,cut:'c9'}],status:'Preparing'});
  order(0,19,{items:[{itemId:'m1',qty:2,cut:'c2',note:'for biryani'}],status:'Ready'});
  order(1,10,{occasion:'Eid / Qurbani',items:[{itemId:'w1',qty:1}],advance:30000});
  order(1,11,{occasion:'Eid / Qurbani',type:'delivery',items:[{itemId:'w1',qty:2},{itemId:'m10',qty:2}],advance:50000});
  order(2,18,{occasion:'Party / event',items:[{itemId:'m2',qty:8,cut:'c4'},{itemId:'m3',qty:3,cut:'c5'}]});
 },
 mobile(c,cust){
  c.put('staff','t1',{name:'Sales Imran'});c.put('staff','t2',{name:'Technician Arif'});
  const B={branch:'main'},imei=()=>'35'+String(c.int(1000000,9999999))+String(c.int(100000,999999)),units={};
  for(const [id,n,cost] of [['ph1',10,265000],['ph2',12,118000],['ph3',16,36000]]){c.put('grocery_stock',uid(),{type:'in',itemId:id,qty:n,cost,supplier:'Gulf Mobile Distribution',invoice:'GM-'+c.int(1000,9999),...B,at:at(DAYS,9)});units[id]=Array.from({length:n},()=>c.put('mobile_units',uid(),{itemId:id,imei:imei(),status:'in',cost,...B,at:at(DAYS,9)}).id)}
  for(const [id,n] of [['ac1',260],['ac2',240],['ac3',200],['ac4',240],['ac5',180],['pt1',12],['pt2',16]])c.put('grocery_stock',uid(),{type:'in',itemId:id,qty:n,cost:c.get('grocery_items',id).price*0.5|0,supplier:'Deira Accessories Trading',...B,at:at(DAYS,10)});
  // used phones bought from customers
  units.us1=[];for(const [d,cond,paid,ask,seller] of [[20,'iPhone 12 64GB black · good',80000,105000,'Ravi Kumar'],[12,'Samsung S21 128GB · screen scratch',55000,75000,'Joseph Mathew'],[4,'iPhone 13 128GB blue · battery 88%',120000,155000,'Hassan Ali']]){const code=imei(),when=at(d,12),b=c.put('mobile_buys',uid(),{seller,phone:'05'+c.int(10000000,99999999),idType:'Emirates ID',idNumber:'784-19'+c.int(80,99)+'-'+c.int(1000000,9999999)+'-'+c.int(1,9),itemId:'us1',imei:code,condition:cond,price:paid,method:'Cash',at:when});units.us1.push({id:c.put('mobile_units',uid(),{itemId:'us1',imei:code,status:'in',cost:paid,source:'used',buyId:b.id,condition:cond,price:ask,...B,at:when}).id,ask});c.put('grocery_stock',uid(),{type:'in',itemId:'us1',qty:1,cost:paid,supplier:seller,...B,at:when})}
  const acc=['ac1','ac1','ac2','ac2','ac3','ac4','ac4','ac5'],sellPhone=(id,date,customerId,price)=>{const u=id==='us1'?units.us1.shift():units[id].shift();if(!u)return;const unit=typeof u==='object'?u.id:u,s=c.sale([{id,qty:1,price:price??(typeof u==='object'?u.ask:undefined),options:[{id:unit}]},...(c.r()<.7?[{id:c.pick(['ac1','ac2']),qty:1}]:[])],{date,customerId,method:c.pick(['Cash','Card (external terminal)','Card (external terminal)']),extra:B});c.put('mobile_units',unit,{status:'sold',saleId:s.id})};
  for(let d=DAYS-1;d>=1;d--){
   for(let k=0;k<perDay(c,d,5);k++)c.sale(Array.from({length:c.int(1,2)},()=>({id:c.pick(acc),qty:c.int(1,2)})),{date:at(d,c.int(10,22),c.int(0,59)),customerId:c.r()<.2?c.pick(cust):'',extra:B});
   for(let k=0;k<c.int(1,4);k++)c.sale([{id:'sv2',qty:1,price:c.pick([1000,2000,2500,5000,10000])}],{date:at(d,c.int(10,22),c.int(0,59)),method:'Cash',extra:B});
   if(c.r()<.75)sellPhone(c.pick(['ph1','ph2','ph2','ph3','ph3','ph3']),at(d,c.int(11,21),c.int(0,59)),c.pick(cust));
   if(d===9||d===2)sellPhone('us1',at(d,18),c.pick(cust));
  }
  // an instalment customer: phone on account, part paid
  const inst=c.put('customers',uid(),{name:'Abdul Rahman (instalments)',phone:'0507654399',dob:''}).id,u=units.ph2.shift();
  if(u){const s=c.sale([{id:'ph2',qty:1,options:[{id:u}]}],{date:at(8,17),method:'Credit (account)',customerId:inst,extra:B});c.put('mobile_units',u,{status:'sold',saleId:s.id});c.put('grocery_payments',uid(),{customerId:inst,amount:50000,method:'Cash',note:'1st instalment',at:at(8,17)});c.put('grocery_payments',uid(),{customerId:inst,amount:30000,method:'Cash',note:'2nd instalment',at:at(1,16)})}
  // repairs in every stage
  const job=(daysAgo,device,fault,est,steps=[],bill)=>{const id=uid();c.put('mobile_repairs',id,{status:'Received',customerId:c.pick(cust),device,imei:c.r()<.6?imei():'',fault,accessories:c.pick(['Case','','SIM tray','Case and charger']),estimate:est,due:addDays(uaeDay(),2-daysAgo),technician:'Technician Arif'});for(const st of steps)c.put('mobile_repairs',id,{status:st,diagnosis:fault+' fixed'});if(bill){const r=c.get('mobile_repairs',id),s=c.sale(bill,{date:at(Math.max(0,daysAgo-1),18),customerId:r.customerId,extra:B});c.put('mobile_repairs',id,{status:'Delivered',saleId:s.id})}};
  job(6,'iPhone 12','Broken screen',35000,['Repairing','Ready'],[{id:'sv1',qty:1,price:10000},{id:'pt1',qty:1,price:25000}]);
  job(4,'Samsung A52','Battery drains fast',14000,['Repairing','Ready'],[{id:'sv1',qty:1,price:5000},{id:'pt2',qty:1,price:9000}]);
  job(2,'iPhone 13 Pro','Not charging',15000,['Diagnosing','Repairing','Ready']);
  job(1,'Redmi Note 12','Broken screen',22000,['Waiting for parts']);
  job(1,'iPhone 11','Water damage',0,['Diagnosing']);
  job(0,'Samsung S22','Back glass cracked',18000);
 },
 tailor(c,cust){
  c.put('staff','t1',{name:'Master Iqbal'});c.put('staff','t2',{name:'Tailor Salma'});c.put('staff','t3',{name:'Tailor Rafiq'});
  const B={branch:'main'};
  for(const [id,n] of [['ab1',60],['ab2',95],['ab3',48],['sh1',230],['fb1',520],['fb2',460],['tr1',420]])c.put('grocery_stock',uid(),{type:'in',itemId:id,qty:n,cost:c.get('grocery_items',id).price*0.45|0,supplier:'Naif Textiles Trading',invoice:'NT-'+c.int(1000,9999),...B,at:at(DAYS,10)});
  for(let d=DAYS-1;d>=1;d--){
   for(let k=0;k<perDay(c,d,3);k++)c.sale([{id:c.pick(['ab1','ab2','ab2','ab3']),qty:1},...(c.r()<.6?[{id:'sh1',qty:c.int(1,2)}]:[])],{date:at(d,c.int(10,22),c.int(0,59)),customerId:c.r()<.5?c.pick(cust):'',extra:B});
   if(c.r()<.7)c.sale([{id:c.pick(['fb1','fb2']),qty:c.int(4,12)/2},...(c.r()<.4?[{id:'tr1',qty:c.int(2,6)}]:[])],{date:at(d,c.int(10,21),c.int(0,59)),extra:B});
   if(c.r()<.6)c.sale([{id:'al1',qty:1,price:c.pick([2000,3000,3000,4000,5000])}],{date:at(d,c.int(11,21),c.int(0,59)),method:'Cash',extra:B});
  }
  const M={Abaya:[['Length','56'],['Shoulder','15.5'],['Bust','38'],['Hip','42'],['Sleeve length','23'],['Sleeve opening','7']],Kandura:[['Length','58'],['Shoulder','18'],['Chest','42'],['Sleeve length','24'],['Neck','15.5']],'Kaftan / jalabiya':[['Length','57'],['Shoulder','15'],['Bust','40'],['Sleeve length','22']]};
  const fields=g=>(M[g]||M.Abaya).map(([label,value])=>({label,value}));
  for(const id of cust.slice(0,6))c.put('tailor_measurements',id,{garments:[{type:'Abaya',fields:fields('Abaya'),note:c.pick(['','Likes loose fit','Prefers long sleeves'])}]});
  // stitching orders and alterations in every stage; finished ones billed against the advance
  const tailors=['t1','t2','t3'];let n=0;
  const order=(dueIn,type,items,{advance=0,stage=0,deliver=false}={})=>{const id=uid(),customerId=cust[n++%cust.length];
   c.put('tailor_orders',id,{status:'New',type,customerId,items:items.map(([garment,qty,price,design,fabricItemId,fabricQty],k)=>({key:'g'+k,garment,qty,price,design:design||'',measurements:type==='stitching'?fields(garment):[],fabric:fabricItemId?'shop':'customer',...(fabricItemId?{fabricItemId,fabricQty}:{})})),due:addDays(uaeDay(),dueIn),advance,tailorId:c.pick(tailors),rate:type==='stitching'?4000:1000,note:''});
   if(advance)c.put('grocery_payments',uid(),{customerId,amount:advance,method:'Cash',note:'Advance · '+(type==='stitching'?'stitching order':'alteration'),at:at(Math.max(0,7-dueIn),12)});
   for(const st of ['Cutting','Stitching','Finishing','Ready'].slice(0,stage))c.put('tailor_orders',id,{status:st});
   if(deliver){const svc=type==='stitching'?'st1':'al1',lines=items.flatMap(([,qty,price,,f,m])=>[{id:svc,qty,price},...(f?[{id:f,qty:Math.round(m*qty*1000)/1000}]:[])]),s=c.sale(lines,{date:at(Math.max(0,-dueIn),17),method:advance?'Credit (account)':'Cash',customerId,extra:B});
    if(advance){const due=s.total-advance;if(due>0)c.put('grocery_payments',uid(),{customerId,amount:due,method:'Cash',note:'Balance on collection',at:at(Math.max(0,-dueIn),17)})}
    c.put('tailor_orders',id,{status:'Delivered',saleId:s.id})}};
  order(-9,'stitching',[['Abaya',2,15000,'Open front, lace on sleeves','fb1',3.5]],{advance:20000,stage:4,deliver:true});
  order(-6,'stitching',[['Kaftan / jalabiya',1,18000,'Embroidered neck']],{advance:10000,stage:4,deliver:true});
  order(-4,'alteration',[['Shorten length',2,3000,'Shorten by 2 inches']],{stage:4,deliver:true});
  order(-2,'stitching',[['Abaya',1,16000,'Butterfly cut','fb2',3.5]],{advance:10000,stage:4,deliver:true});
  order(-1,'stitching',[['Abaya',3,15000,'Plain, pockets both sides','fb1',3.5]],{advance:30000,stage:4});
  order(0,'alteration',[['Take in sides',1,4000,'Take in 1 inch each side']],{stage:4});
  order(-1,'stitching',[['Kandura',2,12000,'Emirati style, tarboosh']],{advance:10000,stage:2});
  order(0,'stitching',[['Abaya',1,20000,'Bisht style, crystal work on cuffs','fb1',4]],{advance:15000,stage:3});
  order(1,'stitching',[['Dress',1,22000,'A-line, lined']],{advance:10000,stage:2});
  order(2,'stitching',[['Abaya',2,15000,'Closed, zip front','fb2',3.5],['Kaftan / jalabiya',1,18000,'Wide sleeves']],{advance:25000,stage:1});
  order(3,'alteration',[['Replace zip',1,2500,'Black invisible zip']],{stage:0});
  order(5,'stitching',[['Abaya',1,17000,'Kimono sleeves, piping in gold','fb1',3.75]],{advance:10000,stage:0});
 },
 electronics(c,cust){
  c.put('staff','t1',{name:'Sales Faisal'});c.put('staff','t2',{name:'Technician Arif'});c.put('staff','t3',{name:'Installer Sunil'});
  const B={branch:'main'},sn=()=>c.pick(['5CD','PF4','SN','CN0','R9'])+String(c.int(100000,999999))+c.pick(['X','K','Q','Z'])+String(c.int(10,99)),units={};
  for(const [id,n,cost] of [['lp1',14,185000],['lp2',14,142000],['mn1',16,31000],['tv1',10,121000],['pr1',10,49000]]){c.put('grocery_stock',uid(),{type:'in',itemId:id,qty:n,cost,supplier:'Jumbo Distribution',invoice:'JD-'+c.int(1000,9999),...B,at:at(DAYS,9)});units[id]=Array.from({length:n},()=>c.put('mobile_units',uid(),{itemId:id,imei:sn(),status:'in',cost,...B,at:at(DAYS,9)}).id)}
  for(const [id,n] of [['c1',30],['c2',30],['c3',80],['c4',24],['c5',30],['c6',30],['s1',70],['n1',50],['p1',160],['k1',260],['pt1',10],['pt2',12]])c.put('grocery_stock',uid(),{type:'in',itemId:id,qty:n,cost:c.get('grocery_items',id).price*0.72|0,supplier:'Al Khoory Computer Trading',...B,at:at(DAYS,10)});
  const sell=(id,date,customerId,more=[])=>{const u=units[id].shift();if(!u)return;const s=c.sale([{id,qty:1,options:[{id:u}]},...more],{date,customerId,method:c.pick(['Cash','Card (external terminal)','Card (external terminal)']),extra:B});c.put('mobile_units',u,{status:'sold',saleId:s.id});return s};
  for(let d=DAYS-1;d>=1;d--){
   for(let k=0;k<perDay(c,d,4);k++)c.sale(Array.from({length:c.int(1,2)},()=>({id:c.pick(['k1','k1','p1','p1','n1','s1','c3']),qty:c.int(1,2)})),{date:at(d,c.int(10,22),c.int(0,59)),customerId:c.r()<.2?c.pick(cust):'',extra:B});
   if(c.r()<.55)sell(c.pick(['lp1','lp2','mn1','mn1','tv1','pr1']),at(d,c.int(11,21),c.int(0,59)),c.pick(cust),c.r()<.5?[{id:'k1',qty:1}]:[]);
   if(d%6===0)c.sale([{id:'c1',qty:1},{id:'c2',qty:1},{id:'c3',qty:2},{id:'s1',qty:1},{id:'c5',qty:1},{id:'c6',qty:1},{id:'sv4',qty:1,price:15000}],{date:at(d,17),customerId:c.pick(cust),method:'Card (external terminal)',extra:B});
  }
  // a company customer buying on account with an LPO
  const co=c.put('customers',uid(),{name:'Gulf Star Trading LLC',phone:'043334455',dob:'',trn:'100234567890003',address:'Office 1204, Business Bay, Dubai'}).id;
  for(const [d,lpo] of [[9,'LPO-2231'],[3,'LPO-2260']]){const a=units.lp2.shift(),b=units.mn1.shift();if(a&&b){const s=c.sale([{id:'lp2',qty:1,options:[{id:a}]},{id:'mn1',qty:1,options:[{id:b}]},{id:'p1',qty:1}],{date:at(d,12),method:'Credit (account)',customerId:co,extra:{...B,lpo}});c.put('mobile_units',a,{status:'sold',saleId:s.id});c.put('mobile_units',b,{status:'sold',saleId:s.id})}}
  c.put('grocery_payments',uid(),{customerId:co,amount:200000,method:'Card (external terminal)',note:'Bank transfer · LPO-2231',at:at(4,11)});
  // used laptop bought from a customer
  for(const [d,cond,paid,ask,seller] of [[10,'Dell Latitude 5420 i5 16GB · good',70000,99000,'Ravi Kumar'],[3,'MacBook Air M1 8GB · battery 84%',160000,205000,'Hassan Ali']]){const code=sn(),when=at(d,12),b=c.put('mobile_buys',uid(),{seller,phone:'05'+c.int(10000000,99999999),idType:'Emirates ID',idNumber:'784-19'+c.int(80,99)+'-'+c.int(1000000,9999999)+'-'+c.int(1,9),itemId:'us1',imei:code,condition:cond,price:paid,method:'Cash',at:when});c.put('mobile_units',uid(),{itemId:'us1',imei:code,status:'in',cost:paid,source:'used',buyId:b.id,condition:cond,price:ask,...B,at:when});c.put('grocery_stock',uid(),{type:'in',itemId:'us1',qty:1,cost:paid,supplier:seller,...B,at:when})}
  // repairs
  const job=(daysAgo,device,fault,est,steps=[],bill)=>{const id=uid();c.put('mobile_repairs',id,{status:'Received',customerId:c.pick(cust),device,imei:c.r()<.6?sn():'',fault,accessories:c.pick(['Charger','','Bag and charger']),estimate:est,due:addDays(uaeDay(),2-daysAgo),technician:'Technician Arif'});for(const st of steps)c.put('mobile_repairs',id,{status:st,diagnosis:fault+' fixed'});if(bill){const r=c.get('mobile_repairs',id),s=c.sale(bill,{date:at(Math.max(0,daysAgo-1),18),customerId:r.customerId,extra:B});c.put('mobile_repairs',id,{status:'Delivered',saleId:s.id})}};
  job(6,'HP Pavilion 15','Broken screen',45000,['Repairing','Ready'],[{id:'sv1',qty:1,price:10000},{id:'pt1',qty:1,price:35000}]);
  job(3,'Dell Inspiron 14','Battery not charging',28000,['Diagnosing','Repairing','Ready']);
  job(1,'Custom gaming PC','No display, beeps on start',15000,['Diagnosing']);
  job(1,'Lenovo ThinkPad T14','Keyboard keys not working',22000,['Waiting for parts']);
  job(0,'Epson printer','Paper jam, lines on print',10000);
  // quotations
  const quote=(daysAgo,customerId,title,lines,discount,close)=>{const q=c.put('elec_quotes',uid(),{status:'Open',customerId,title,lines:lines.map(([itemId,qty,price],k)=>({key:'l'+k,itemId,qty,...(price?{price}:{})})),discount,validUntil:addDays(uaeDay(),14-daysAgo),note:'Delivery in 2 days · payment on delivery'});if(close)c.put('elec_quotes',q.id,close(q));return q};
  quote(1,cust[1],'Gaming PC build',[['c1',1],['c2',1],['c3',2],['c4',1],['s1',1],['c5',1],['c6',1],['sv4',1,15000]],10000);
  quote(2,co,'10 office workstations',[['c1',10],['c2',10],['c3',10],['s1',10],['c5',10],['c6',10],['p1',10],['sv4',10,10000]],150000);
  quote(0,cust[3],'Home office setup',[['n1',1],['p1',1],['k1',2],['sv2',1,20000]],0);
  quote(8,cust[4],'Budget editing PC',[['c1',1],['c2',1],['c3',1],['s1',1],['c5',1],['c6',1]],5000,()=>({status:'Lost',lostReason:'Bought online'}));
  const won=c.sale([{id:'c1',qty:1},{id:'c2',qty:1},{id:'c3',qty:2},{id:'s1',qty:2},{id:'c5',qty:1},{id:'c6',qty:1},{id:'sv4',qty:1,price:15000}],{date:at(5,16),customerId:cust[2],off:8000,extra:B});
  quote(7,cust[2],'Office PC with 2TB storage',[['c1',1],['c2',1],['c3',2],['s1',2],['c5',1],['c6',1],['sv4',1,15000]],8000,()=>({status:'Accepted',saleId:won.id}));
  // delivery & installation jobs
  const visit=(dayIn,type,what,staff,charge,steps=[],slot='4–6 pm')=>{const id=uid(),cu=c.get('customers',cust[(dayIn+7)%cust.length]);c.put('elec_jobs',id,{status:'Booked',type,customerId:cu.id,address:c.pick(['Villa 14, Mirdif','Apt 803, Marina Heights, Dubai Marina','Office 210, Al Garhoud','Flat 5, Al Nahda 2','Villa 7, Al Barsha 2']),date:addDays(uaeDay(),dayIn),slot,what,staff,charge});for(const st of steps)c.put('elec_jobs',id,{status:st})};
  visit(-3,'Delivery & installation','Wall-mount 55" TV and tune channels','Installer Sunil',15000,['On the way','Done'],'10–12 am');
  visit(-1,'Installation','Set up printer and Wi-Fi on 3 laptops','Technician Arif',10000,['Done']);
  visit(0,'Delivery & installation','Deliver gaming PC, set up at home','Installer Sunil',10000,['On the way'],'2–4 pm');
  visit(0,'Delivery','Deliver 2 monitors','Installer Sunil',3000,[],'6–8 pm');
  visit(1,'Installation','Install Wi-Fi router and 2 access points','Technician Arif',25000);
  visit(3,'Delivery & installation','Wall-mount 55" TV','Installer Sunil',15000,[],'10–12 am');
  // warranty claims with suppliers
  const claim=(item,serial,fault,supplier,customerId,steps=[])=>{const id=uid();c.put('elec_rma',id,{status:'Open',supplier,item,serial,fault,customerId,note:'With box'});for(const st of steps)c.put('elec_rma',id,st)};
  claim('24" IPS monitor 100Hz',sn(),'Dead pixels in the corner','Jumbo Distribution',cust[5],[{status:'Sent',ref:'RMA-55120'}]);
  claim('RTX 4060 8GB graphics card',sn(),'Artifacts on screen, crashes','Al Khoory Computer Trading',cust[0],[{status:'Sent',ref:'AK-9917'},{status:'Back',outcome:'Replaced',newSerial:sn()}]);
  claim('HP 15 laptop i5 16GB 512GB',sn(),'Does not power on','HP service centre',cust[6]);
  claim('Wi-Fi 6 router','','Dead on arrival','Al Khoory Computer Trading','',[{status:'Sent',ref:'AK-9950'},{status:'Back',outcome:'Credit note'},{status:'Closed'}]);
 },
};

// One restaurant order: table/takeaway/delivery, a kitchen ticket and (unless left open) the paid bill.
function restaurantRunner(c,cust){
 const menu=c.list('restaurant_items').filter(i=>!i.system),tables=c.list('restaurant_tables');
 const meal=()=>[...new Set(Array.from({length:c.int(2,5)},()=>c.pick(menu).id))].map(id=>({key:uid(),itemId:id,qty:c.int(1,3)}));
 return(daysAgo,type,{open=false,status,table,opened}={})=>{const t=table||c.pick(tables),o=c.put('restaurant_orders',uid(),{type,status:'open',opened:opened||at(daysAgo,c.int(12,22),c.int(0,59)),guests:type==='dine-in'?c.int(1,6):0,...(type==='dine-in'?{tableId:t.id}:{}),...(type==='delivery'?{customer:c.get('customers',c.pick(cust)).name,phone:'0501234567',address:c.pick(['JLT Cluster D, Tower 2','Al Barsha 1, Villa 14','Marina Gate 1, Apt 1203'])}:{})});
  const k=c.put('restaurant_kots',uid(),{orderId:o.id,items:meal(),at:o.opened,byName:'Waiter Ali'});
  if(open){if(status&&status!=='new')c.put('restaurant_kots',k.id,{...k,status});return o}
  c.put('restaurant_kots',k.id,{...k,status:'served'});
  const food=k.items.map(l=>({id:l.itemId,qty:l.qty})),sub=k.items.reduce((n,l)=>n+l.price*l.qty,0),lines=type==='dine-in'?[...food,{id:'service',price:Math.round(sub*0.1),qty:1}]:food;
  c.sale(lines,{date:new Date(Math.min(Date.parse(o.opened)+50*60000,Date.now()-60000)).toISOString(),extra:{ref:o.id}});c.put('restaurant_orders',o.id,{...c.get('restaurant_orders',o.id),status:'closed'});return o};
}

// Once a day, the first time a demo is opened after 09:30 UAE: a few sales from earlier today so "today"
// on the dashboard is not empty (demos are rebuilt at 04:00). The restaurant also keeps a fresh ticket in
// the kitchen whenever the last one is more than 45 minutes old.
export function topUp(db,type){
 const d=db.prepare('SELECT * FROM demo_businesses WHERE type=?').get(type);if(!d)return;
 const now=new Date(Date.now()+4*3600000),today=uaeDay(),minutes=now.getUTCHours()*60+now.getUTCMinutes();
 const c=ctx(db,d.business_id,type,d.owner_id,Date.now()%100000),cust=c.list('customers').map(x=>x.id);
 if(type==='restaurant'){const kots=c.list('restaurant_kots');const fresh=kots.some(k=>k.status!=='served'&&Date.now()-Date.parse(k.at)<45*60000);const busy=new Set(c.list('restaurant_orders').filter(o=>o.status==='open'&&o.type==='dine-in').map(o=>o.tableId)),free=c.list('restaurant_tables').filter(t=>!busy.has(t.id));
  if(!fresh&&free.length)restaurantRunner(c,cust)(0,'dine-in',{open:true,table:free[0],opened:new Date(Date.now()-c.int(3,15)*60000).toISOString()})}
 if(d.topup===today||minutes<570)return;
 db.prepare('UPDATE demo_businesses SET topup=? WHERE business_id=?').run(today,d.business_id);
 const times=Array.from({length:c.int(4,7)},()=>new Date(Date.now()-c.int(5,minutes-570)*60000).toISOString()).sort();
 const cat=businessModule(type).catalogKind,items=c.list(cat).filter(i=>type==='gym'?i.type==='product':type==='restaurant'?false:!(i.system||i.serial||i.type==='service'&&type!=='salon'&&type!=='petshop'));
 if(type==='restaurant'){for(const t of times.slice(0,3))restaurantRunner(c,cust)(0,c.pick(['dine-in','takeaway']),{opened:new Date(Date.parse(t)-40*60000).toISOString()});return}
 for(const t of times){const lines=[...new Set(Array.from({length:c.int(1,3)},()=>c.pick(items).id))].map(id=>{const it=items.find(x=>x.id===id);return{id,qty:it.unit&&it.unit!=='piece'?(it.unit==='kg'?c.int(5,20)/10:c.int(3,10)):1}});
  c.sale(lines,{date:t,customerId:c.r()<.6?c.pick(cust):'',extra:['perfume','mobile','tailor','electronics'].includes(type)?{branch:'main'}:{}})}
}

async function buildOne(db,type){
 const shop=DEMO_SHOPS[type];if(!shop)return null;
 const old=db.prepare('SELECT d.business_id FROM demo_businesses d JOIN businesses b ON b.id=d.business_id WHERE d.type=?').get(type);
 if(old)removeBusiness(db,old.business_id);
 db.prepare('DELETE FROM demo_businesses WHERE type=?').run(type);
 const taken=db.prepare('SELECT id FROM businesses WHERE slug=?').get(shop.slug);if(taken){console.error('Demo code '+shop.slug+' is used by a real business; demo skipped');return null}
 const password=randomBytes(24).toString('hex'); // never shown: demos open only through /api/demo
 const r=await createBusiness(db,{name:shop.name+' (Demo)',slug:shop.slug,owner:'Demo owner',email:'owner@'+type+'.demo.invalid',password,type});
 const cashier=randomBytes(16).toString('hex');db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(cashier,r.businessId,'staff@'+type+'.demo.invalid','Demo staff',await passwordHash(password),'cashier');
 db.prepare('INSERT INTO demo_businesses(business_id,type,owner_id,cashier_id,reset) VALUES (?,?,?,?,?)').run(r.businessId,type,r.userId,cashier,new Date().toISOString());
 if(type==='restaurant'){ // a waiter to try "Switch user": PIN 1234
  const w=randomBytes(16).toString('hex');db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(w,r.businessId,'waiter@restaurant.demo.invalid','Ali (waiter)',await passwordHash(password),'cashier');await setStaffOptions(db,r.businessId,w,{waiter:true,pin:'1234'});await setStaffOptions(db,r.businessId,cashier,{pin:'1234'})}
 const c=ctx(db,r.businessId,type,r.userId,[...type].reduce((n,ch)=>n*31+ch.charCodeAt(0),7));
 c.put('settings','singleton',{name:shop.name,phone:'+971 4 000 0000',address:'Dubai, United Arab Emirates',trn:'',tax:5,logo:''});
 let cust;try{cust=PEOPLE.map(([name,phone])=>c.put('customers',uid(),{name,phone,dob:''}).id)}catch(e){removeBusiness(db,r.businessId);db.prepare('DELETE FROM demo_businesses WHERE business_id=?').run(r.businessId);throw e}
 try{BUILD[type](c,cust,db,r.businessId)}catch(e){removeBusiness(db,r.businessId);db.prepare('DELETE FROM demo_businesses WHERE business_id=?').run(r.businessId);throw e}
 try{demoAccounts(db,r.businessId,r.userId)}catch(e){console.error('Demo accounts skipped: '+e.message)}
 db.prepare('DELETE FROM audit WHERE business_id=?').run(r.businessId);
 return r.businessId;
}
// A few suppliers, bills, payments and expenses so the Finance → accounts screens have something to show.
function demoAccounts(db,business,owner){
 const day=n=>new Date(Date.now()+4*3600000-n*86400000).toISOString().slice(0,10),now=new Date().toISOString();
 const sup=db.prepare('INSERT INTO suppliers VALUES (?,?,?,?,?,?,?,?)'),bill=db.prepare('INSERT INTO purchase_bills VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)'),pay=db.prepare('INSERT INTO supplier_payments VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL)'),exp=db.prepare('INSERT INTO expenses(business_id,id,date,amount,method,category,note,created_by,created_at,vat) VALUES (?,?,?,?,?,?,?,?,?,?)');
 sup.run(business,'demo-sup-1','Gulf Star Wholesale LLC','100234567800003','+971 4 111 2233','Weekly delivery',now,now);
 sup.run(business,'demo-sup-2','Marina Tower Landlord','','+971 4 222 3344','Shop rent',now,now);
 const b=(id,s,no,d,due,cat,net,vat)=>bill.run(business,id,s,no,day(d),due===null?'':day(due),cat,net,vat,net+vat,'',owner,now);
 b('demo-bill-1','demo-sup-1','GS-2041',20,5,'Stock for resale',240000,12000);
 b('demo-bill-2','demo-sup-1','GS-2077',6,-24,'Stock for resale',180000,9000);
 b('demo-bill-3','demo-sup-1','GS-2080',3,-27,'Supplies',12000,600);
 b('demo-bill-4','demo-sup-2','RENT-'+day(0).slice(0,7),1,null,'Rent',650000,0);
 pay.run(business,'demo-pay-1','demo-sup-1','demo-bill-1',day(12),150000,'Bank / card','Transfer ref 55821',owner,now);
 pay.run(business,'demo-pay-2','demo-sup-2','demo-bill-4',day(1),650000,'Bank / card','Cheque 000412',owner,now);
 exp.run(business,'demo-exp-1',day(4),84000,'Bank / card','Utilities','DEWA bill',owner,now,4000);
 exp.run(business,'demo-exp-2',day(2),5250,'Cash','Transport & fuel','Delivery fuel',owner,now,250);
}
// Deletes a business and everything that belongs to it (every table with business_id / user_id).
function removeBusiness(db,business){
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t=>t.name),cols=t=>db.prepare(`PRAGMA table_info("${t}")`).all().map(c=>c.name);
 const users=db.prepare('SELECT id FROM users WHERE business_id=?').all(business).map(u=>u.id);
 db.exec('BEGIN IMMEDIATE');try{
  for(const t of tables)if(!['users','businesses'].includes(t)&&cols(t).includes('user_id')&&!cols(t).includes('business_id'))for(const id of users)db.prepare(`DELETE FROM "${t}" WHERE user_id=?`).run(id);
  for(const t of tables)if(!['users','businesses','demo_businesses'].includes(t)&&cols(t).includes('business_id'))db.prepare(`DELETE FROM "${t}" WHERE business_id=?`).run(business);
  db.prepare('DELETE FROM users WHERE business_id=?').run(business);db.prepare('DELETE FROM businesses WHERE id=?').run(business);
  db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
}
export async function resetDemos(db,types=Object.keys(DEMO_SHOPS)){const done={};for(const t of types)if(BUSINESS_TYPES.includes(t)){try{done[t]=!!await buildOne(db,t)}catch(e){console.error('Demo '+t+' failed: '+e.message);done[t]=false}}return done}
// Build missing demos at start-up and rebuild all of them once a day at 04:00 UAE time.
export function scheduleDemos(db){
 let busy=false;const run=async force=>{if(busy)return;busy=true;try{const have=new Map(db.prepare('SELECT type,reset FROM demo_businesses').all().map(r=>[r.type,r.reset]));const stale=Object.keys(DEMO_SHOPS).filter(t=>force||!have.has(t)||uaeDay(Date.parse(have.get(t)))!==uaeDay()&&new Date(Date.now()+4*3600000).getUTCHours()>=4);if(stale.length)await resetDemos(db,stale)}finally{busy=false}};
 // A restaurant demo built before waiter logins existed gets its sample waiter and PINs now (no need to wait for the nightly rebuild).
 const addWaiter=async()=>{const d=db.prepare("SELECT business_id,cashier_id FROM demo_businesses WHERE type='restaurant'").get();if(!d||db.prepare('SELECT 1 FROM user_options WHERE business_id=? AND waiter=1').get(d.business_id))return;const w=randomBytes(16).toString('hex');db.prepare('INSERT OR IGNORE INTO users VALUES (?,?,?,?,?,?,1)').run(w,d.business_id,'waiter@restaurant.demo.invalid','Ali (waiter)',await passwordHash(randomBytes(24).toString('hex')),'cashier');const id=db.prepare("SELECT id FROM users WHERE business_id=? AND email='waiter@restaurant.demo.invalid'").get(d.business_id).id;await setStaffOptions(db,d.business_id,id,{waiter:true,pin:'1234'});await setStaffOptions(db,d.business_id,d.cashier_id,{pin:'1234'})};
 setTimeout(()=>run(false).then(addWaiter).catch(e=>console.error(e.message)),1000);
 const timer=setInterval(()=>run(false).catch(e=>console.error(e.message)),15*60000);timer.unref?.();return{run,stop:()=>clearInterval(timer)};
}

export async function demoRoute({db,req,res,path,body,send,limited,secure,publicUser}){
 if(path==='/api/demo'&&req.method==='GET'){const rows=db.prepare('SELECT type FROM demo_businesses').all().map(r=>r.type);send(res,200,{shops:Object.entries(DEMO_SHOPS).filter(([t])=>rows.includes(t)).map(([type,s])=>({type,name:s.name,blurb:s.blurb}))});return true}
 if(path==='/api/demo'&&req.method==='POST'){
  limited(hash('demo:'+req.socket.remoteAddress),60);
  const b=await body(req),d=db.prepare('SELECT * FROM demo_businesses WHERE type=?').get(String(b.type||''));if(!d)throw new ApiError(404,'This demo is not available right now');
  try{topUp(db,d.type)}catch(e){console.error('Demo top-up '+d.type+': '+e.message)}
  const role=b.role==='cashier'?'cashier':'owner',user=db.prepare('SELECT u.*,s.type business_type FROM users u JOIN businesses s ON s.id=u.business_id WHERE u.id=?').get(role==='owner'?d.owner_id:d.cashier_id);
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token),user.id,csrf,Date.now()+4*3600000);
  send(res,200,{user:publicUser(user),csrf},{'Set-Cookie':`salon_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400${secure?'; Secure':''}`});return true;
 }
 return false;
}
