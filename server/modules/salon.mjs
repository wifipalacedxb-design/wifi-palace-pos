// Salon & spa module: service catalogue and stylist appointments.
import {fail,text,required,amount,get} from '../check.mjs';
export const salon={
 type:'salon',
 label:'Salon & spa',
 catalogKind:'services',       // what the core sales rules price bills against
 kinds:['services','appointments'],
 ownerKinds:['services'],      // only owners may change these
 deletable:['services'],
 seed:()=>({
  services:[{id:'s1',name:'Haircut',category:'Hair',price:5000},{id:'s2',name:'Beard trim',category:'Grooming',price:2500},{id:'s3',name:'Hair colour',category:'Hair',price:12000},{id:'s4',name:'Facial',category:'Skin',price:9000}],
  staff:[{id:'t1',name:'Stylist 1'}],
  appointments:[]
 }),
 validate({db,business,kind,key,data,old}){
  if(kind==='services')return{id:key,name:required(data.name,100),category:required(data.category,50),price:amount(data.price),openPrice:data.openPrice===true};
  if(kind==='appointments'){
   if(!Number.isFinite(Date.parse(data.when))||!Number.isInteger(data.duration)||data.duration<5||data.duration>480||!['Booked','Completed','Cancelled'].includes(data.status))fail('Invalid appointment');
   const staff=get(db,business,'staff',data.staffId);if(!staff)fail('Stylist no longer exists',409);
   const a={id:key,when:text(data.when,50),duration:data.duration,customer:required(data.customer,100),service:required(data.service,100),staffId:staff.id,staff:staff.name,status:data.status};
   const customerId=data.customerId??old?.customerId;if(customerId){const customer=get(db,business,'customers',required(customerId,100));if(!customer&&customerId!==old?.customerId)fail('Customer must sync before their appointment',409);a.customerId=customerId;}
   if(a.status==='Booked'){const start=Date.parse(a.when),end=start+a.duration*60000;for(const row of db.prepare("SELECT id,data FROM records WHERE business_id=? AND kind='appointments' AND data IS NOT NULL AND id!=?").all(business,key)){const b=JSON.parse(row.data);if(b.status==='Booked'&&b.staffId===a.staffId&&start<Date.parse(b.when)+b.duration*60000&&end>Date.parse(b.when))fail('This stylist has another appointment during that time',409);}}
   return a;
  }
  fail('Unknown record type');
 }
};
