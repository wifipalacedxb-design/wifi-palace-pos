// Gym & fitness module: price list (membership plans, personal-training packs, shop products),
// memberships with freeze/renewal, front-desk check-ins and PT session tracking.
// Selling reuses the core sales record (tax invoice, finance, printing). Memberships and PT packs
// point at the paid sale; the client uploads them after the sale, so the server can check the sale.
import {fail,text,required,amount,get,OFFLINE_GRACE_DAYS} from '../check.mjs';

export const GYM_ITEM_TYPES=['plan','pt','product'];
const DAY=86400000;
const uaeDay=(t=Date.now())=>new Date(t+4*3600000).toISOString().slice(0,10);
const date=(v,label='date')=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('Invalid '+label);return v};
export const addDays=(d,n)=>new Date(Date.parse(d)+n*DAY).toISOString().slice(0,10);
export const daysBetween=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/DAY);
const int=(v,min,max,label)=>{if(!Number.isInteger(v)||v<min||v>max)fail(`${label} must be a whole number from ${min} to ${max}`);return v};
// Offline devices may upload late; accept event times from the offline grace period up to 5 minutes ahead.
const recent=(v,label)=>{const t=Date.parse(v);if(typeof v!=='string'||!Number.isFinite(t)||t>Date.now()+300000||t<Date.now()-OFFLINE_GRACE_DAYS*DAY)fail('Invalid '+label+' time');return new Date(t).toISOString()};
const member=(db,business,id)=>{const c=get(db,business,'customers',required(id,100));if(!c)fail('Member must sync before this record',409);return c};
const all=(db,business,kind)=>db.prepare('SELECT data FROM records WHERE business_id=? AND kind=? AND data IS NOT NULL').all(business,kind).map(r=>JSON.parse(r.data));

// A membership or PT pack must come from a paid sale for that member containing the item,
// and a sale line of quantity N can create at most N of them. Owners may add complimentary ones.
function paidFrom(db,business,u,{saleId,itemId,customerId,kind}){
 const id=text(saleId??'',100);
 if(!id){if(u.role!=='owner')fail('Take payment before creating this',409);return ''}
 const sale=get(db,business,'sales',id);if(!sale)fail('The payment must sync first',409);
 if(sale.status!=='Paid')fail('This sale was refunded',409);
 if(sale.customerId!==customerId)fail('The sale belongs to a different member',409);
 const line=sale.items.find(i=>i.id===itemId);if(!line)fail('The sale does not include this item',409);
 if(all(db,business,kind).filter(r=>r.saleId===id&&(r.planId??r.itemId)===itemId).length>=line.qty)fail('This sale line has already been used',409);
 return id;
}

export const gym={
 type:'gym',
 label:'Gym & fitness',
 catalogKind:'gym_items',
 kinds:['gym_items','gym_memberships','gym_checkins','gym_pt'],
 ownerKinds:['gym_items'],
 deletable:['gym_items'],
 seed:()=>({
  gym_items:[
   {id:'g1',name:'Day pass',type:'plan',days:1,price:3000},
   {id:'g2',name:'Monthly membership',type:'plan',days:30,price:25000},
   {id:'g3',name:'3 months membership',type:'plan',days:90,price:65000},
   {id:'g4',name:'6 months membership',type:'plan',days:180,price:120000},
   {id:'g5',name:'Yearly membership',type:'plan',days:365,price:200000},
   {id:'g6',name:'Personal training · 1 session',type:'pt',sessions:1,validDays:30,price:20000},
   {id:'g7',name:'Personal training · 10 sessions',type:'pt',sessions:10,validDays:90,price:150000},
   {id:'g8',name:'Water',type:'product',price:300},
   {id:'g9',name:'Protein shake',type:'product',price:1500},
   {id:'g10',name:'Towel rental',type:'product',price:500}
  ],
  staff:[{id:'t1',name:'Trainer 1'}],
  gym_memberships:[],gym_checkins:[],gym_pt:[]
 }),
 validate({db,business,kind,key,data,old,u}){
  if(kind==='gym_items'){
   if(!GYM_ITEM_TYPES.includes(data.type))fail('Choose plan, personal training or product');
   const item={id:key,name:required(data.name,100),type:data.type,price:amount(data.price)};
   if(old&&old.type!==item.type)fail('An item cannot change type. Add a new item instead.',409);
   if(item.type==='plan')item.days=int(data.days,1,3650,'Days');
   if(item.type==='pt'){item.sessions=int(data.sessions,1,500,'Sessions');item.validDays=int(data.validDays??0,0,3650,'Valid days');}
   return item;
  }
  if(kind==='gym_memberships'){
   if(old){
    const m={...old},today=uaeDay();
    if(data.status===old.status)return old; // nothing that can change
    if(old.status==='Active'&&data.status==='Frozen'){
     const from=date(data.frozenFrom,'freeze date');if(from<addDays(today,-OFFLINE_GRACE_DAYS)||from>today)fail('Invalid freeze date');if(from<old.start||from>old.end)fail('Only a running membership can be frozen',409);
     m.status='Frozen';m.frozenFrom=from;m.freezeReason=required(data.freezeReason,200);
    }else if(old.status==='Frozen'&&data.status==='Active'){
     const to=date(data.unfrozenOn,'unfreeze date');if(to<old.frozenFrom||to>today||to<addDays(today,-OFFLINE_GRACE_DAYS))fail('Invalid unfreeze date');
     const days=daysBetween(old.frozenFrom,to);m.status='Active';m.end=addDays(old.end,days);m.freezes=[...(old.freezes||[]),{from:old.frozenFrom,to,days,reason:old.freezeReason,by:u.id}].slice(-50);delete m.frozenFrom;delete m.freezeReason;
    }else if(data.status==='Cancelled'&&old.status!=='Cancelled'){
     if(u.role!=='owner')fail('Only the owner can cancel a membership',403);m.status='Cancelled';m.cancelReason=required(data.cancelReason,300);m.cancelledAt=new Date().toISOString();
    }else fail(`A membership cannot move from ${old.status} to ${data.status}`,409);
    m.history=[...(old.history||[]),{status:m.status,at:new Date().toISOString(),by:u.id}].slice(-30);
    return m;
   }
   if(data.status!=='Active')fail('New memberships start as Active');
   const plan=get(db,business,'gym_items',required(data.planId,100));if(!plan||plan.type!=='plan')fail('This plan was removed. Review this membership.',409);
   const c=member(db,business,data.customerId);
   const start=date(data.start,'start date'),today=uaeDay();if(start<addDays(today,-OFFLINE_GRACE_DAYS)||start>addDays(today,400))fail('Start date must be within the last month and 400 days ahead');
   const saleId=paidFrom(db,business,u,{saleId:data.saleId,itemId:plan.id,customerId:c.id,kind:'gym_memberships'});
   return{id:key,customerId:c.id,customer:c.name,phone:c.phone||'',planId:plan.id,plan:plan.name,days:plan.days,start,end:addDays(start,plan.days-1),status:'Active',freezes:[],saleId,complimentary:!saleId,createdBy:u.id,created:new Date().toISOString(),history:[{status:'Active',at:new Date().toISOString(),by:u.id}]};
  }
  if(kind==='gym_checkins'){
   if(old)fail('Check-ins cannot be changed',409);
   const c=member(db,business,data.customerId),membershipId=text(data.membershipId??'',100),ptId=text(data.ptId??'',100);
   if(membershipId){const m=get(db,business,'gym_memberships',membershipId);if(!m||m.customerId!==c.id)fail('Membership not found for this member',409);}
   if(ptId){const p=get(db,business,'gym_pt',ptId);if(!p||p.customerId!==c.id)fail('PT pack not found for this member',409);}
   return{id:key,customerId:c.id,customer:c.name,membershipId,ptId,at:recent(data.at,'check-in'),by:u.id,note:text(data.note??'',200)};
  }
  if(kind==='gym_pt'){
   if(old){
    if(data.status==='Cancelled'&&old.status!=='Cancelled'){if(u.role!=='owner')fail('Only the owner can cancel a PT pack',403);return{...old,status:'Cancelled',cancelReason:required(data.cancelReason,300)}}
    if(old.status!=='Active')fail('This PT pack is not active',409);
    const used=Array.isArray(data.used)?data.used:[];
    // Sessions are only ever added, one at a time, and past sessions never change.
    if(used.length!==old.used.length+1||old.used.some((s,i)=>JSON.stringify(s)!==JSON.stringify(used[i])))fail('Record one session at a time',409);
    if(old.used.length>=old.sessions)fail('No sessions left in this pack',409);
    const s=used.at(-1),at=recent(s?.at,'session');if(old.expires&&uaeDay(Date.parse(at))>old.expires)fail('This PT pack has expired',409);
    const trainer=s.trainerId?get(db,business,'staff',s.trainerId):null;if(s.trainerId&&!trainer)fail('Trainer no longer exists',409);
    return{...old,used:[...old.used,{at,by:u.id,trainerId:trainer?.id||old.trainerId,trainer:trainer?.name||old.trainer,note:text(s.note??'',200)}]};
   }
   if(data.status!=='Active')fail('New PT packs start as Active');
   const item=get(db,business,'gym_items',required(data.itemId,100));if(!item||item.type!=='pt')fail('This PT pack was removed. Review it.',409);
   const c=member(db,business,data.customerId),trainer=get(db,business,'staff',required(data.trainerId,100));if(!trainer)fail('Trainer no longer exists',409);
   const saleId=paidFrom(db,business,u,{saleId:data.saleId,itemId:item.id,customerId:c.id,kind:'gym_pt'});
   const today=uaeDay();
   return{id:key,customerId:c.id,customer:c.name,itemId:item.id,name:item.name,sessions:item.sessions,expires:item.validDays?addDays(today,item.validDays-1):'',trainerId:trainer.id,trainer:trainer.name,used:[],status:'Active',saleId,complimentary:!saleId,createdBy:u.id,created:new Date().toISOString()};
  }
  fail('Unknown record type');
 }
};
