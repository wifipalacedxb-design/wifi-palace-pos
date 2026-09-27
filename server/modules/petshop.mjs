// Pet shop module: retail products with stock (same engine as grocery: barcode, kg, label scale, credit),
// services (grooming, boarding per night, daycare per day), pet profiles with vaccinations,
// grooming appointments per groomer and boarding / daycare stays.
// Live animals (fish, birds, …) are ordinary products with stock in the "Live animals" category.
import {fail,text,required,get,OFFLINE_GRACE_DAYS} from '../check.mjs';
import {grocery,retailValidate,SCALE_DEFAULT} from './grocery.mjs';

export const PET_CATEGORIES=['Dog food','Cat food','Bird & fish food','Treats','Accessories','Toys','Health & hygiene','Litter & cages','Aquarium','Live animals','Grooming','Boarding & daycare','Other'];
export const SERVICE_TYPES=['grooming','boarding','daycare','other'];
export const SPECIES=['Dog','Cat','Bird','Fish','Rabbit','Hamster','Turtle','Other'];
const DAY=86400000;
const date=(v,label,{optional=false,future=true}={})=>{if(optional&&(v===undefined||v===null||v===''))return '';if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v||v<'1990-01-01'||v>'2100-01-01')fail('Enter a valid '+label);if(!future&&v>new Date(Date.now()+4*3600000).toISOString().slice(0,10))fail(label[0].toUpperCase()+label.slice(1)+' cannot be in the future');return v};
const time=(v,label,{optional=false}={})=>{if(optional&&(v===undefined||v===null||v===''))return '';const t=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(t)||t>Date.now()+400*DAY||t<Date.now()-OFFLINE_GRACE_DAYS*DAY-400*DAY)fail('Invalid '+label);return new Date(t).toISOString()};
const all=(db,business,kind)=>db.prepare('SELECT id,data FROM records WHERE business_id=? AND kind=? AND data IS NOT NULL').all(business,kind).map(r=>JSON.parse(r.data));
const RETAIL={categories:PET_CATEGORIES,serviceTypes:SERVICE_TYPES};

function vaccinations(list){
 if(list===undefined||list===null)return [];
 if(!Array.isArray(list)||list.length>40)fail('Up to 40 vaccination records');
 return list.map(v=>({id:required(v?.id,40),name:required(v?.name,60),date:date(v?.date,'vaccination date',{future:false}),due:date(v?.due,'next due date',{optional:true})}));
}

export const petshop={
 type:'petshop',
 label:'Pet shop',
 catalogKind:'grocery_items',
 kinds:['grocery_items','grocery_stock','grocery_payments','grocery_config','pets','appointments','pet_stays'],
 ownerKinds:['grocery_items','grocery_config'],
 deletable:['grocery_items'],
 creditSales:true,
 maxPieces:1000,
 seed:()=>({
  grocery_items:[
   {id:'p1',name:'Dry dog food 3kg',barcode:'',category:'Dog food',unit:'piece',price:9500,cost:0,minStock:5},
   {id:'p2',name:'Dry cat food 2kg',barcode:'',category:'Cat food',unit:'piece',price:6500,cost:0,minStock:5},
   {id:'p3',name:'Cat litter 10L',barcode:'',category:'Litter & cages',unit:'piece',price:3500,cost:0,minStock:5},
   {id:'p4',name:'Dog shampoo',barcode:'',category:'Health & hygiene',unit:'piece',price:2800,cost:0,minStock:3},
   {id:'p5',name:'Leash',barcode:'',category:'Accessories',unit:'piece',price:4000,cost:0,minStock:2},
   {id:'p6',name:'Bird seed mix',barcode:'',category:'Bird & fish food',unit:'kg',price:1800,cost:0,minStock:2},
   {id:'p7',name:'Goldfish',barcode:'',category:'Live animals',unit:'piece',price:500,cost:0,minStock:5},
   {id:'s1',type:'service',serviceType:'grooming',name:'Bath & dry (small dog)',barcode:'',category:'Grooming',unit:'piece',price:8000,cost:0,minStock:0,duration:60,openPrice:false},
   {id:'s2',type:'service',serviceType:'grooming',name:'Full grooming',barcode:'',category:'Grooming',unit:'piece',price:15000,cost:0,minStock:0,duration:120,openPrice:true},
   {id:'s3',type:'service',serviceType:'grooming',name:'Nail trim',barcode:'',category:'Grooming',unit:'piece',price:3000,cost:0,minStock:0,duration:15,openPrice:false},
   {id:'s4',type:'service',serviceType:'boarding',name:'Boarding (per night)',barcode:'',category:'Boarding & daycare',unit:'piece',price:10000,cost:0,minStock:0,duration:1440,openPrice:false},
   {id:'s5',type:'service',serviceType:'daycare',name:'Daycare (per day)',barcode:'',category:'Boarding & daycare',unit:'piece',price:6000,cost:0,minStock:0,duration:600,openPrice:false}
  ],
  staff:[{id:'t1',name:'Groomer 1'}],
  grocery_stock:[],grocery_payments:[],grocery_config:[{id:'config',scale:{...SCALE_DEFAULT}}],
  pets:[],appointments:[],pet_stays:[]
 }),
 summary:grocery.summary,
 validate(args){
  const {db,business,kind,key,data,old}=args;
  if(kind.startsWith('grocery_'))return retailValidate(args,RETAIL);
  if(kind==='pets'){
   const owner=get(db,business,'customers',required(data.customerId,100));if(!owner)fail('Owner must sync before their pet',409);
   if(!SPECIES.includes(data.species))fail('Choose the species');
   if(!['','Male','Female'].includes(data.sex??''))fail('Invalid sex');
   const weight=data.weight??0;if(typeof weight!=='number'||!Number.isFinite(weight)||weight<0||weight>200)fail('Weight must be 0 to 200 kg');
   return{id:key,customerId:owner.id,owner:owner.name,name:required(data.name,60),species:data.species,breed:text(data.breed??'',60),sex:data.sex??'',neutered:data.neutered===true,dob:date(data.dob,'date of birth',{optional:true,future:false}),weight:Math.round(weight*10)/10,color:text(data.color??'',40),microchip:text(data.microchip??'',40),allergies:text(data.allergies??'',300),notes:text(data.notes??'',500),vaccinations:vaccinations(data.vaccinations),active:data.active!==false};
  }
  if(kind==='appointments'){
   if(!['Booked','Checked in','Completed','Cancelled','No-show'].includes(data.status))fail('Invalid appointment status');
   if(old&&['Completed','Cancelled','No-show'].includes(old.status)&&data.status!==old.status)fail('This appointment is already closed',409);
   const minutes=data.duration;if(!Number.isInteger(minutes)||minutes<5||minutes>480)fail('Duration must be 5 to 480 minutes');
   const groomer=get(db,business,'staff',required(data.staffId,100));if(!groomer)fail('Groomer no longer exists',409);
   const pet=get(db,business,'pets',required(data.petId,100));if(!pet)fail('Pet must sync before its appointment',409);
   const service=get(db,business,'grocery_items',required(data.serviceId,100));if(!service||service.type!=='service'||service.serviceType!=='grooming')fail('Choose a grooming service',409);
   const a={id:key,when:time(data.when,'appointment time'),duration:minutes,petId:pet.id,pet:pet.name,species:pet.species,customerId:pet.customerId,customer:pet.owner,serviceId:service.id,service:service.name,staffId:groomer.id,staff:groomer.name,status:data.status,notes:text(data.notes??'',300),saleId:text(data.saleId??'',100)};
   if(data.status==='Cancelled')a.cancelReason=text(data.cancelReason??'',200);
   if(['Booked','Checked in'].includes(a.status)){const start=Date.parse(a.when),end=start+minutes*60000;for(const b of all(db,business,'appointments'))if(b.id!==key&&['Booked','Checked in'].includes(b.status)&&b.staffId===a.staffId&&start<Date.parse(b.when)+b.duration*60000&&end>Date.parse(b.when))fail(groomer.name+' has '+b.pet+' booked at that time',409)}
   return a;
  }
  if(kind==='pet_stays'){
   if(!['Booked','In','Out','Cancelled'].includes(data.status))fail('Invalid stay status');
   if(old){
    const flow={Booked:['In','Cancelled'],In:['Out'],Out:[],Cancelled:[]};
    if(data.status!==old.status&&!flow[old.status].includes(data.status))fail('A stay cannot move from '+old.status+' to '+data.status,409);
    const s={...old,status:data.status,kennel:text(data.kennel??old.kennel,40),care:text(data.care??old.care,500),until:date(data.until??old.until,'planned check-out date'),saleId:text(data.saleId??old.saleId??'',100)};
    if(data.status==='In'&&old.status!=='In')s.checkIn=time(data.checkIn||new Date().toISOString(),'check-in time');
    if(data.status==='Out'&&old.status!=='Out')s.checkOut=time(data.checkOut||new Date().toISOString(),'check-out time');
    if(data.status==='Cancelled')s.cancelReason=text(data.cancelReason??'',200);
    return s;
   }
   const pet=get(db,business,'pets',required(data.petId,100));if(!pet)fail('Pet must sync before its stay',409);
   const service=get(db,business,'grocery_items',required(data.serviceId,100));if(!service||service.type!=='service'||!['boarding','daycare'].includes(service.serviceType))fail('Choose a boarding or daycare service',409);
   if(!['Booked','In'].includes(data.status))fail('A new stay starts booked or checked in');
   const from=date(data.from,'arrival date'),until=date(data.until,'planned check-out date');if(until<from)fail('Check-out must be on or after arrival');
   const s={id:key,petId:pet.id,pet:pet.name,species:pet.species,customerId:pet.customerId,customer:pet.owner,serviceId:service.id,service:service.name,type:service.serviceType,status:data.status,from,until,kennel:text(data.kennel??'',40),care:text(data.care??'',500)};
   if(s.status==='In')s.checkIn=time(data.checkIn||new Date().toISOString(),'check-in time');
   return s;
  }
  fail('Unknown record type');
 }
};
