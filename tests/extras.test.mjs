import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {start} from '../server/server.mjs';
import {createSalon,passwordHash} from '../server/store.mjs';
import {businessDay} from '../server/finance.mjs';
import {gratuity} from '../server/hr.mjs';
const dir=mkdtempSync(join(tmpdir(),'pos-extras-')),app=await start({file:join(dir,'db.sqlite'),port:0}),base='http://127.0.0.1:'+app.server.address().port;
const salon=await createSalon(app.db,{name:'Glam',slug:'glam',owner:'O',email:'o@test.test',password:'test-password-123'});
await createSalon(app.db,{name:'Bistro',slug:'bistro',owner:'O',email:'r@test.test',password:'test-password-123',type:'restaurant'});
await createSalon(app.db,{name:'Other',slug:'other',owner:'O',email:'x@test.test',password:'test-password-123'});
app.db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run('cash-x',salon.salonId,'c@test.test','Cashier',await passwordHash('test-password-123'),'cashier');
async function req(path,method='GET',data,s={}){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:s.cookie||'','X-CSRF-Token':s.csrf||''},...(data!==undefined?{body:JSON.stringify(data)}:{})});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
async function login(slug,email){const r=await req('login','POST',{salon:slug,email,password:'test-password-123'});assert.equal(r.status,200);return{cookie:r.cookie,csrf:r.data.csrf}}
const op=(kind,key,data,base=0)=>({id:randomUUID(),kind,key,data,base,action:'put'});
const owner=await login('glam','o@test.test'),cashier=await login('glam','c@test.test'),rest=await login('bistro','r@test.test'),other=await login('other','x@test.test');
const today=businessDay(),month=today.slice(0,7),ago=n=>new Date(Date.now()-n*86400000).toISOString();
const sale=(id,customerId,date,net=10000)=>({id,date,items:[{id:'s1',price:5000,qty:net/5000}],sub:net,off:0,tax:0,total:net,received:net,customerId,staff:'Stylist 1',method:'Cash',status:'Paid'});
try{
await test('marketing: groups come from sales; owner only; other businesses see nothing',async()=>{
 for(const [id,name,dob] of [['c1','Aisha',today.slice(0,4)-30+today.slice(4)],['c2','Bilal',''],['c3','Chen','']])assert.equal((await req('sync','POST',op('customers',id,{name,phone:'0501234567',dob}),owner)).status,200);
 // sales can only be dated recently, so back-date two directly in the database to build "not seen" groups
 for(const [id,c,d] of [['m1','c1',ago(0)],['m2','c1',ago(0)],['m3','c2',ago(0)],['m4','c3',ago(0)]])assert.equal((await req('sync','POST',op('sales',id,sale(id,c,d)),owner)).status,200);
 const back=(id,days)=>{const r=app.db.prepare("SELECT data FROM records WHERE business_id=? AND kind='sales' AND id=?").get(salon.salonId,id),s=JSON.parse(r.data);s.date=ago(days);app.db.prepare("UPDATE records SET data=? WHERE business_id=? AND kind='sales' AND id=?").run(JSON.stringify(s),salon.salonId,id)};back('m3',45);back('m4',120);
 assert.equal((await req('marketing/overview','GET',undefined,cashier)).status,403);
 const o=(await req('marketing/overview','GET',undefined,owner)).data,names=g=>o.groups[g].map(c=>c.name);
 assert.deepEqual(names('lapsed30'),['Bilal']);assert.deepEqual(names('lapsed90'),['Chen']);assert.deepEqual(names('birthday'),['Aisha']);assert.equal(names('top')[0],'Aisha');assert.deepEqual(names('new'),['Aisha']);
 assert.equal((await req('marketing/overview','GET',undefined,other)).data.groups.all.length,0);
});
await test('loyalty: points come from paid sales, refunds take them back, redeeming is checked and replay-safe',async()=>{
 assert.equal((await req('marketing/loyalty','POST',{enabled:true,earnPerAed:1,redeemFils:5,minRedeem:100},cashier)).status,403);
 assert.equal((await req('marketing/loyalty','POST',{enabled:true,earnPerAed:1,redeemFils:5,minRedeem:100},owner)).status,200);
 let r=(await req('marketing/rewards?customerId=c1','GET',undefined,cashier)).data;assert.equal(r.points.balance,200);assert.equal(r.points.value,1000); // AED 200 spent → 200 points → AED 10
 assert.equal((await req('marketing/redeem','POST',{id:'rd1',type:'points',customerId:'c1',points:50},cashier)).status,409);
 assert.equal((await req('marketing/redeem','POST',{id:'rd1',type:'points',customerId:'c1',points:500},cashier)).status,409);
 const ok=await req('marketing/redeem','POST',{id:'rd1',type:'points',customerId:'c1',points:150},cashier);assert.equal(ok.status,200);assert.equal(ok.data.amount,750);
 assert.equal((await req('marketing/redeem','POST',{id:'rd1',type:'points',customerId:'c1',points:150},cashier)).data.replay,true);
 assert.equal((await req('marketing/rewards?customerId=c1','GET',undefined,cashier)).data.points.balance,50);
 const s=JSON.parse(app.db.prepare("SELECT data FROM records WHERE business_id=? AND kind='sales' AND id='m2'").get(salon.salonId).data);
 assert.equal((await req('sync','POST',op('sales','m2',{...s,status:'Refunded',refundReason:'Returned'},1),owner)).status,200);
 assert.equal((await req('marketing/rewards?customerId=c1','GET',undefined,cashier)).data.points.balance,-50,'refund takes the points back');
 assert.equal((await req('marketing/redeem','POST',{id:'rd2',type:'points',customerId:'c1',points:100},cashier)).status,409);
});
await test('coupons: percent and amount, minimum spend, expiry and usage limit',async()=>{
 const c={id:'cp1',code:'eid10',kind:'percent',value:1000,minSpend:5000,expires:today,maxUses:2};
 assert.equal((await req('marketing/coupons','POST',c,cashier)).status,403);assert.equal((await req('marketing/coupons','POST',{...c,code:'a b'},owner)).status,400);
 assert.equal((await req('marketing/coupons','POST',c,owner)).status,200);assert.equal((await req('marketing/coupons','POST',{...c,id:'cp2'},owner)).status,409);
 assert.equal((await req('marketing/redeem','POST',{id:'k1',type:'coupon',code:'nope',subtotal:10000},cashier)).status,404);
 assert.equal((await req('marketing/redeem','POST',{id:'k1',type:'coupon',code:'EID10',subtotal:1000},cashier)).status,409);
 assert.equal((await req('marketing/redeem','POST',{id:'k1',type:'coupon',code:'Eid10',subtotal:20000},cashier)).data.amount,2000);
 assert.equal((await req('marketing/redeem','POST',{id:'k1',type:'coupon',code:'EID10',subtotal:20000},cashier)).data.replay,true);
 assert.equal((await req('marketing/redeem','POST',{id:'k2',type:'coupon',code:'EID10',subtotal:20000},cashier)).status,200);
 assert.equal((await req('marketing/redeem','POST',{id:'k3',type:'coupon',code:'EID10',subtotal:20000},cashier)).status,409,'usage limit');
 assert.equal((await req('marketing/coupons','POST',{id:'cp3',code:'OLD',kind:'amount',value:500,expires:'2020-01-01'},owner)).status,200);
 assert.equal((await req('marketing/redeem','POST',{id:'k4',type:'coupon',code:'OLD',subtotal:20000},cashier)).status,409);
 assert.equal((await req('marketing/redeem','POST',{id:'k5',type:'coupon',code:'EID10',subtotal:20000},other)).status,404);
});
await test('campaigns: recipients are fixed when created; sends are tracked',async()=>{
 const c=await req('marketing/campaigns','POST',{id:'cm1',name:'We miss you',group:'lapsed30',message:'Hi {name}, 10% off this week'},owner);assert.equal(c.status,201);assert.equal(c.data.recipients,1);
 assert.equal((await req('marketing/campaigns','POST',{id:'cm2',name:'x',group:'lapsed60',message:'m'},owner)).status,409);
 assert.equal((await req('marketing/campaigns/sent','POST',{id:'cm1',customerId:'c2'},owner)).status,200);assert.equal((await req('marketing/campaigns/sent','POST',{id:'cm1',customerId:'c1'},owner)).status,404);
 const v=(await req('marketing/overview','GET',undefined,owner)).data.campaigns[0];assert.equal(v.sent,1);assert.equal(v.returned,0);
});
await test('HR: employee files, expiring documents, gratuity estimate; owner only',async()=>{
 const soon=new Date(Date.now()+20*86400000).toISOString().slice(0,10),e={id:'e1',name:'Maria',job:'Stylist',joined:'2020-01-01',phone:'050',basic:300000,allowances:100000,startTime:'09:00',pin:'4321',docs:[{type:'Visa',number:'V1',expiry:soon},{type:'Passport',number:'P1',expiry:'2035-01-01'},{type:'Emirates ID',number:'E1',expiry:'2024-01-01'}]};
 assert.equal((await req('hr/employees','POST',e,cashier)).status,403);assert.equal((await req('hr/employees','POST',{...e,pin:'12'},owner)).status,400);assert.equal((await req('hr/employees','POST',{...e,joined:'2999-01-01'},owner)).status,400);
 assert.equal((await req('hr/employees','POST',e,owner)).status,200);assert.equal((await req('hr/employees','POST',{id:'e2',name:'New Joiner',joined:today,basic:200000},owner)).status,200);
 const o=(await req('hr/overview','GET',undefined,owner)).data;assert.equal(JSON.stringify(o).includes('4321'),false);assert.equal(o.employees.find(x=>x.id==='e1').hasPin,true);
 assert.deepEqual(o.expiring.map(x=>x.type+':'+x.expired),['Emirates ID:true','Visa:false']);
 assert.equal(o.employees.find(x=>x.id==='e2').gratuity.amount,0);
 // 6 full years on AED 3,650 basic: daily 120.00 → 5×21 + 1×30 = 135 days → AED 16,200
 const g=gratuity(365000,'2020-01-01','2025-12-31');assert.equal(g.years,6);assert.ok(Math.abs(g.amount-1620000)<2000,'about AED 16,200 (part years count pro rata)');
 assert.equal(gratuity(365000,'2025-06-01','2025-12-31').amount,0);assert.equal(gratuity(100000,'1980-01-01','2025-12-31').amount,2400000,'capped at two years of basic pay');
 assert.equal((await req('hr/overview','GET',undefined,other)).data.employees.length,0);
});
await test('HR: clock in and out by PIN from any signed-in device; wrong PINs lock',async()=>{
 assert.deepEqual((await req('hr/clock-list','GET',undefined,cashier)).data.map(x=>x.name+':'+x.in),['Maria:false']);
 assert.equal((await req('hr/clock','POST',{employeeId:'e1',pin:'0000'},cashier)).status,401);assert.equal((await req('hr/clock','POST',{employeeId:'e1',pin:'4321'},other)).status,401);
 assert.equal((await req('hr/clock','POST',{employeeId:'e1',pin:'4321'},cashier)).data.action,'in');assert.equal((await req('hr/clock-list','GET',undefined,cashier)).data[0].in,true);
 assert.equal((await req('hr/clock','POST',{employeeId:'e1',pin:'4321'},cashier)).data.action,'out');
 const a=(await req('hr/attendance?month='+month,'GET',undefined,owner)).data.rows;assert.equal(a.length,1);assert.equal(a[0].days,1);assert.equal(a[0].entries.length,1);
 assert.equal((await req('hr/attendance','GET',undefined,cashier)).status,403);
});
await test('HR: leave, salary sheet with unpaid-leave deduction, paying records one expense',async()=>{
 assert.equal((await req('hr/leaves','POST',{id:'l1',employeeId:'e1',type:'Unpaid',from:month+'-01',to:month+'-03'},owner)).data.days,3);
 assert.equal((await req('hr/leaves','POST',{id:'l2',employeeId:'e1',type:'Annual',from:month+'-05',to:month+'-01'},owner)).status,400);
 let p=(await req('hr/payroll?month='+month,'GET',undefined,owner)).data,m=p.lines.find(l=>l.employeeId==='e1');
 assert.equal(m.deductions,30000);assert.equal(m.net,300000+100000-30000);assert.equal(p.paid,false);
 assert.equal((await req('hr/payroll/save','POST',{month,lines:[{employeeId:'e1',additions:5000,deductions:999999999}]},owner)).status,400);
 p=(await req('hr/payroll/save','POST',{month,lines:[{employeeId:'e1',additions:5000,deductions:30000,note:'Bonus'}]},owner)).data;assert.equal(p.lines.find(l=>l.employeeId==='e1').net,375000);
 assert.equal((await req('hr/payroll/pay','POST',{month,method:'Card'},owner)).status,400);
 p=(await req('hr/payroll/pay','POST',{month,method:'Bank / card'},owner)).data;assert.equal(p.paid,true);assert.equal(p.totals.net,375000+200000);
 assert.equal((await req('hr/payroll/pay','POST',{month,method:'Bank / card'},owner)).status,409);
 const exp=(await req('finance/report?date='+today,'GET',undefined,owner)).data.expenses.find(e=>e.id==='payroll-'+month);assert.equal(exp.amount,575000);assert.equal(exp.method,'Bank / card');
 assert.equal((await req('hr/payroll','GET',undefined,cashier)).status,403);
});
await test('recipes: food cost per dish, stock falls with paid bills, counts reset it, invoice adds stock and a bill',async()=>{
 assert.equal((await req('recipes/overview','GET',undefined,owner)).status,404,'restaurants only');
 const state=(await req('state','GET',undefined,rest)).data.state,dish=state.restaurant_items.find(i=>!i.system);
 assert.equal((await req('recipes/ingredients','POST',{id:'rice',name:'Rice',unit:'kg',cost:800,minStock:5},rest)).status,200);
 assert.equal((await req('recipes/ingredients','POST',{id:'chk',name:'Chicken',unit:'kg',cost:2000},rest)).status,200);
 assert.equal((await req('recipes/ingredients','POST',{id:'dup',name:'rice',unit:'kg',cost:1},rest)).status,409);
 assert.equal((await req('recipes/recipe','POST',{itemId:dish.id,lines:[{ingredientId:'rice',qty:0.2},{ingredientId:'chk',qty:0.25},{ingredientId:'rice',qty:1}]},rest)).status,400);
 assert.equal((await req('recipes/recipe','POST',{itemId:dish.id,lines:[{ingredientId:'rice',qty:0.2},{ingredientId:'chk',qty:0.25}]},rest)).status,200);
 let o=(await req('recipes/overview','GET',undefined,rest)).data,d=o.menu.find(i=>i.id===dish.id);
 assert.equal(d.cost,160+500);assert.equal(d.margin,dish.price-660);assert.equal(d.foodCostPct,Math.round(660/dish.price*1000)/10);
 // invoice: 10 kg rice @ 9.00 + 4 kg chicken @ 21.00 = 174.00 + 8.70 VAT
 assert.equal((await req('finance/suppliers','POST',{id:'sup',name:'Farm Fresh'},rest)).status,200);
 const inv={billId:'kb1',supplierId:'sup',number:'FF-1',date:today,vat:870,lines:[{ingredientId:'rice',qty:10,cost:900},{ingredientId:'chk',qty:4,cost:2100}]};
 assert.equal((await req('recipes/receive','POST',inv,rest)).status,201);assert.equal((await req('recipes/receive','POST',inv,rest)).status,200,'replay adds nothing');
 assert.equal((await req('recipes/receive','POST',{...inv,billId:'kb2'},rest)).status,409,'same invoice number refused');
 o=(await req('recipes/overview','GET',undefined,rest)).data;const ing=id=>o.ingredients.find(i=>i.id===id);
 assert.equal(ing('rice').stock,10);assert.equal(ing('rice').cost,900);assert.equal(ing('chk').stock,4);assert.equal(o.stockValue,9000+8400);
 assert.equal((await req('finance/vat?from='+today+'&to='+today,'GET',undefined,rest)).data.input.vat,870);
 // sell 3 portions on a paid bill
 const price=dish.price,sub=price*3,tax=Math.round(sub*state.settings.tax/100);
 const s=await req('sync','POST',op('sales','rs1',{id:'rs1',date:new Date().toISOString(),items:[{id:dish.id,price,qty:3}],sub,off:0,tax,total:sub+tax,received:sub+tax,customerId:'',staff:'Counter',method:'Cash',status:'Paid'}),rest);assert.equal(s.status,200,JSON.stringify(s.data));
 o=(await req('recipes/overview','GET',undefined,rest)).data;
 assert.equal(o.ingredients.find(i=>i.id==='rice').stock,9.4);assert.equal(o.ingredients.find(i=>i.id==='chk').stock,3.25);
 assert.equal(o.usageCost,Math.round(0.6*900)+Math.round(0.75*2100));assert.equal(o.netSales,sub);assert.equal(o.foodCostPct,Math.round(o.usageCost/sub*1000)/10);
 // stock count sets the level; waste takes off; low stock flagged at the minimum
 assert.equal((await req('recipes/moves','POST',{id:'mv1',ingredientId:'rice',type:'count',qty:5,note:'Monthly count'},rest)).status,201);
 assert.equal((await req('recipes/moves','POST',{id:'mv2',ingredientId:'rice',type:'waste',qty:0.5},rest)).status,400,'waste needs a reason');
 assert.equal((await req('recipes/moves','POST',{id:'mv2',ingredientId:'rice',type:'waste',qty:0.5,note:'Spilled'},rest)).status,201);
 const rice=(await req('recipes/overview','GET',undefined,rest)).data.ingredients.find(i=>i.id==='rice');assert.equal(rice.stock,4.5);assert.equal(rice.low,true);
 // a refund gives the ingredients back
 const paid=JSON.parse(app.db.prepare("SELECT data FROM records WHERE kind='sales' AND id='rs1'").get().data);
 assert.equal((await req('sync','POST',op('sales','rs1',{...paid,status:'Refunded',refundReason:'Wrong order'},1),rest)).status,200);
 assert.equal((await req('recipes/overview','GET',undefined,rest)).data.ingredients.find(i=>i.id==='chk').stock,4);
});
}finally{await app.close();rmSync(dir,{recursive:true,force:true})}
