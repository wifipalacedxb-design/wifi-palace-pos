// Grocery & baqala screens for WiFi Palace POS. Active only when the signed-in business type is "grocery".
// Checkout: scan a barcode (USB/Bluetooth scanners type like a keyboard + Enter) or search by name;
// weighed items ask for kilos. Pay by cash, card or customer credit (khata).
// Products: price list with live stock, low-stock filter, CSV import/export. Stock: goods in and counts.
// Credit: customer balances, payments received, statements and WhatsApp reminders.
(function(){
 'use strict';
 const OWN=['Dashboard','Checkout','Products','Stock','Credit'];
 const OWNER_ONLY=['Dashboard','Sales','Settings','Finance','Reports','Team'];
 const CATEGORIES=['Fruits & vegetables','Dairy & eggs','Bakery','Meat & fish','Rice, flour & grains','Cooking & spices','Snacks & sweets','Drinks','Frozen','Household & cleaning','Personal care','Baby','Tobacco','Other'];
 const CREDIT='Credit (account)';
 const isGrocery=()=>typeof cloudUser!=='undefined'&&cloudUser?.businessType==='grocery';
 const isOwner=()=>cloudUser?.role==='owner';
 const tabs=()=>isOwner()?['Dashboard','Checkout','Products','Stock','Credit','Customers','Sales','Settings','Finance','Reports','Team','Sync centre','Account']:['Checkout','Products','Stock','Credit','Customers','My sales','Sync centre','Account'];
 const localDay=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
 const qtyText=(q,unit)=>unit==='kg'?(+q.toFixed(3))+' kg':String(+q.toFixed(3));
 const line=i=>Math.round(i.price*i.qty);
 let cart=[],cartCustomer='',scanText='',productSearch='',productFilter='All',stockSearch='',creditSearch='';

 // --- derived data ---------------------------------------------------------------------------------
 function shim(){if(db){db.services??=[];db.appointments??=[];for(const k of ['grocery_items','grocery_stock','grocery_payments'])db[k]??=[]}}
 // Stock = goods in + count adjustments − quantities on paid (not refunded) sales. Pending sales count too.
 function stockLevels(){const m=new Map(db.grocery_items.map(i=>[i.id,0]));for(const e of db.grocery_stock)m.set(e.itemId,(m.get(e.itemId)||0)+e.qty);for(const s of db.sales)if(s.status==='Paid')for(const i of s.items)if(m.has(i.id))m.set(i.id,m.get(i.id)-i.qty);for(const [k,v] of m)m.set(k,Math.round(v*1000)/1000);return m}
 const low=(i,levels)=>levels.get(i.id)<=(i.minStock||0);
 function balances(){const m=new Map();for(const s of db.sales)if(s.method===CREDIT&&s.status==='Paid')m.set(s.customerId,(m.get(s.customerId)||0)+s.total);for(const p of db.grocery_payments)m.set(p.customerId,(m.get(p.customerId)||0)-p.amount);return m}
 const balanceOf=id=>balances().get(id)||0;

 // --- navigation ------------------------------------------------------------------------------------
 function paintNav(){$('nav').innerHTML=tabs().map(t=>`<button class="${tab===t?'active':''}" data-cloud-tab="${esc(t)}">${esc(t)}</button>`).join('');document.querySelectorAll('[data-cloud-tab]').forEach(b=>b.onclick=()=>navigate(b.dataset.cloudTab))}
 const prevRender=render,prevNavigate=navigate;
 render=function(){
  if(!isGrocery()){prevRender();return}
  if(!cloudReady)return;shim();
  if(!tabs().includes(tab))tab=tabs()[0];
  if(OWN.includes(tab)){const t=tab;tab='Customers';prevRender();tab=t;paintNav();document.title=db.settings.name+' | WiFi Palace POS';SCREENS[t]();return}
  prevRender();paintNav();
 };
 navigate=function(next){
  if(!isGrocery()){prevNavigate(next);return}
  if(!isOwner()&&OWNER_ONLY.includes(next)){alert('Owner access required');return}
  if(OWN.includes(next)){tab=next;render();return}
  shim();prevNavigate(next);paintNav();
 };

 // --- dashboard ---------------------------------------------------------------------------------------
 function dashboard(){
  const today=localDay(),levels=stockLevels(),lows=db.grocery_items.filter(i=>low(i,levels)).sort((a,b)=>levels.get(a.id)-levels.get(b.id)),bal=balances(),owing=db.customers.filter(c=>(bal.get(c.id)||0)>0).sort((a,b)=>bal.get(b.id)-bal.get(a.id)),outstanding=owing.reduce((n,c)=>n+bal.get(c.id),0);
  const collected=TrendCharts.collections(db.sales,db.grocery_payments)(today),bills=db.sales.filter(s=>localDay(new Date(s.date))===today).length;
  $('app').innerHTML=`<div class="hero"><div><div class="eyebrow">${esc(new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}).toUpperCase())}</div><h2 style="margin-top:14px">Shelves full, customers happy.</h2><p>${esc(db.settings.name)} · today at a glance.</p></div><button onclick="navigate('Checkout')">Open checkout →</button></div>
  <div class="kpis"><div class="kpi"><div class="dot"></div><small>Today’s net collections</small><div class="metric">${money(collected)}</div><span class="helper">Cash + card, incl. account payments</span></div><div class="kpi"><div class="dot" style="background:#e3ba98"></div><small>Bills today</small><div class="metric">${bills}</div><span class="helper">All payment types</span></div><div class="kpi"><div class="dot" style="background:#d98a8a"></div><small>Low stock</small><div class="metric">${lows.length}</div><span class="helper">At or below the alert level</span></div><div class="kpi"><div class="dot" style="background:#95bbb0"></div><small>Credit outstanding</small><div class="metric">${money(outstanding)}</div><span class="helper">${owing.length} customer${owing.length===1?'':'s'}</span></div></div>
  ${TrendCharts.section([{id:'grCash',title:'Net collections (AED)',value:TrendCharts.collections(db.sales,db.grocery_payments),money:true},{id:'grBills',title:'Bills',value:TrendCharts.countBy(db.sales,x=>x.date)}],'render')}
  <div class="layout"><section class="panel"><div class="row"><h3>Low stock</h3><button onclick="groceryProducts('Low stock')">View all →</button></div>${lows.length?lows.slice(0,10).map(i=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #eee"><span>${esc(i.name)}</span><span class="${levels.get(i.id)<=0?'danger':'helper'}">${esc(qtyText(levels.get(i.id),i.unit))} left · alert at ${esc(qtyText(i.minStock||0,i.unit))}</span></div>`).join(''):'<div class="empty">Every product is above its alert level.</div>'}</section>
  <aside class="panel"><div class="row"><h3>Top balances</h3><button onclick="navigate('Credit')">Credit →</button></div>${owing.length?owing.slice(0,8).map(c=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #eee"><span>${esc(c.name)}</span><b>${money(bal.get(c.id))}</b></div>`).join(''):'<div class="empty">No customer owes anything.</div>'}</aside></div>`;
  TrendCharts.wire();
 }

 // --- checkout ------------------------------------------------------------------------------------------
 function find(q){q=q.trim().toLowerCase();if(!q)return [];return db.grocery_items.filter(i=>i.name.toLowerCase().includes(q)||(i.barcode&&i.barcode.toLowerCase().includes(q))).slice(0,20)}
 function add(id,q){const i=db.grocery_items.find(x=>x.id===id);if(!i)return;
  if(i.unit==='kg'&&q===undefined){const w=prompt('Weight of '+i.name+' in kg (e.g. 1.25):');if(w===null)return;q=Math.round(Number(w)*100)/100;if(!(q>0&&q<=1000)){alert('Enter a weight in kg, e.g. 0.75');return}}
  q=q??1;const cur=cart.find(x=>x.id===id);if(cur&&i.unit!=='kg')cur.qty=Math.min(1000,cur.qty+q);else cart.push({id:i.id,name:i.name,unit:i.unit,category:i.category,price:i.price,qty:q});
  scanText='';checkout(true);
 }
 function scan(){const q=scanText.trim();if(!q)return;const exact=db.grocery_items.filter(i=>i.barcode&&i.barcode===q.replace(/\s+/g,''));if(exact.length===1){add(exact[0].id);return}
  const found=find(q);if(found.length===1){add(found[0].id);return}if(!found.length){scanText='';checkout(true);toast('Not found: '+q+(isOwner()?' · add it on Products':''));return}checkout(true)}
 function totals(){const sub=cart.reduce((n,i)=>n+line(i),0),tax=Math.round(sub*db.settings.tax/100);return{sub,tax,total:sub+tax}}
 function checkout(focus=true){
  const t=totals(),results=scanText.trim()?find(scanText):[],quick=db.grocery_items.filter(i=>!i.barcode).slice(0,24),levels=stockLevels(),c=db.customers.find(x=>x.id===cartCustomer),bal=c?balanceOf(c.id):0;
  $('app').innerHTML=`<div class="layout"><section><div class="panel"><label for="gScan">Scan barcode or type product name, then Enter</label><input id="gScan" value="${esc(scanText)}" autocomplete="off" placeholder="Scan or search…" style="font-size:20px">
  ${results.length?`<div style="margin-top:10px">${results.map(i=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #eee"><span><b>${esc(i.name)}</b> <span class="helper">${esc(i.barcode||'')} · ${esc(qtyText(levels.get(i.id)||0,i.unit))} in stock</span></span><span>${money(i.price)}${i.unit==='kg'?'/kg':''} <button class="primary" onclick="groceryAdd('${esc(i.id)}')">Add</button></span></div>`).join('')}</div>`:''}</div>
  ${quick.length?`<div class="panel"><h3>Quick items (no barcode)</h3><div class="grid">${quick.map(i=>`<button class="service" onclick="groceryAdd('${esc(i.id)}')"><b>${esc(i.name)}</b><span>${money(i.price)}${i.unit==='kg'?' / kg':''}</span></button>`).join('')}</div></div>`:''}</section>
  <aside class="panel"><div class="row"><h3>Bill</h3>${cart.length?'<button onclick="groceryClear()">Clear</button>':''}</div>
  ${cart.length?cart.map((i,k)=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #eee;gap:8px"><div style="flex:1"><b>${esc(i.name)}</b><div class="helper">${money(i.price)}${i.unit==='kg'?' / kg':''}</div></div><input aria-label="Quantity of ${esc(i.name)}" type="number" min="${i.unit==='kg'?'0.01':'1'}" step="${i.unit==='kg'?'0.01':'1'}" value="${i.qty}" style="width:84px" onchange="groceryQty(${k},this.value)"><b style="min-width:86px;text-align:right">${money(line(i))}</b><button aria-label="Remove ${esc(i.name)}" onclick="groceryRemove(${k})">×</button></div>`).join(''):'<div class="empty">Scan the first item.</div>'}
  <div class="row" style="margin-top:10px"><span>Subtotal</span><span>${money(t.sub)}</span></div>${t.tax?`<div class="row"><span>VAT ${db.settings.tax}%</span><span>${money(t.tax)}</span></div>`:''}<div class="row total"><b>Total</b><b>${money(t.total)}</b></div>
  <label for="gCustomer">Customer (needed for credit)</label><select id="gCustomer" onchange="groceryCustomer(this.value)"><option value="">Walk-in customer</option>${db.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(x=>`<option value="${esc(x.id)}" ${cartCustomer===x.id?'selected':''}>${esc(x.name)}${x.phone?' · '+esc(x.phone):''}</option>`).join('')}</select>${c?`<p class="helper">Account balance: <b>${money(bal)}</b></p>`:''}
  <div class="actions"><button class="primary" onclick="groceryPay('Cash')" ${cart.length?'':'disabled'}>Cash</button><button onclick="groceryPay('Card (external terminal)')" ${cart.length?'':'disabled'}>Card</button><button onclick="groceryPay('${CREDIT}')" ${cart.length?'':'disabled'}>Credit</button></div></aside></div>`;
  const input=$('gScan');input.oninput=e=>{scanText=e.target.value;if(!scanText.trim())checkout(true)};input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();scanText=input.value;scan()}};
  if(focus){input.focus();input.setSelectionRange(input.value.length,input.value.length)}
 }
 function pay(method){
  if(!cart.length)return;const t=totals(),c=db.customers.find(x=>x.id===cartCustomer);
  if(method===CREDIT&&!c){alert('Choose the customer whose account this goes on.');return}
  const finish=received=>{const card=method==='Card (external terminal)',credit=method===CREDIT;
   const sale={id:uid(),number:'SD-'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+uid().slice(-3).toUpperCase(),date:new Date().toISOString(),items:cart.map(i=>({id:i.id,name:i.name,category:i.category,unit:i.unit,price:i.price,qty:i.qty})),sub:t.sub,off:0,tax:t.tax,total:t.total,customer:c?.name||'Walk-in customer',customerId:c?.id||'',staff:cloudUser.name||'Staff',staffId:'',commissionBps:0,method,cashAmount:credit||card?0:t.total,cardAmount:card?t.total:0,cashReceived:credit||card?0:received,received:credit?0:received,change:credit?0:received-t.total,shop:{...db.settings},status:'Paid'};
   if(change(()=>db.sales.push(sale))){cart=[];cartCustomer='';scanText='';closeModal();render();receipt(sale.id)}};
  if(method==='Cash'){modal(`<h2>Cash · ${money(t.total)}</h2><form id="gCash"><label for="gReceived">Cash received (AED)</label><input id="gReceived" type="number" min="0" step="0.01" value="${(t.total/100).toFixed(2)}"><p id="gChange" class="helper"></p><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Complete sale</button></div></form>`);
   const show=()=>{const r=cents($('gReceived').value);$('gChange').textContent=Number.isSafeInteger(r)&&r>=t.total?'Change: '+money(r-t.total):'Cash received must cover the total'};$('gReceived').oninput=show;show();$('gReceived').select();
   $('gCash').onsubmit=e=>{e.preventDefault();const r=cents($('gReceived').value);if(!Number.isSafeInteger(r)||r<t.total){alert('Cash received must cover the total.');return}finish(r)};return}
  if(method===CREDIT){const bal=balanceOf(c.id);if(confirm(`Put ${money(t.total)} on ${c.name}'s account?\nBalance now ${money(bal)} → after this sale ${money(bal+t.total)}.`))finish(0);return}
  if(confirm('Confirm '+money(t.total)+' was approved on your card terminal?'))finish(t.total);
 }

 // --- products ------------------------------------------------------------------------------------------
 function products(){
  const levels=stockLevels(),q=productSearch.trim().toLowerCase(),list=db.grocery_items.filter(i=>(productFilter==='All'||(productFilter==='Low stock'?low(i,levels):i.category===productFilter))&&(!q||(i.name+' '+(i.barcode||'')).toLowerCase().includes(q))).sort((a,b)=>a.name.localeCompare(b.name));
  const cats=[...new Set(db.grocery_items.map(i=>i.category))];
  $('app').innerHTML=`<div class="panel"><div class="row"><h2>Products</h2><div class="actions" style="margin:0">${isOwner()?`<button class="primary" onclick="groceryItemForm()">+ Add product</button><button onclick="groceryImport()">Import CSV</button>`:''}<button onclick="groceryExport()">Export CSV</button></div></div>
  <div class="actions" style="justify-content:flex-start">${['All','Low stock',...cats].map(f=>`<button class="${productFilter===f?'primary':''}" onclick="groceryProducts('${esc(f)}')">${esc(f)}${f==='Low stock'?' ('+db.grocery_items.filter(i=>low(i,levels)).length+')':''}</button>`).join('')}</div>
  <label for="gpSearch" style="display:block;margin-top:14px">Search name or barcode</label><input id="gpSearch" value="${esc(productSearch)}" oninput="groceryProductSearch(this.value)">
  <div class="scroll"><table><tr><th>Product</th><th>Barcode</th><th>Price</th>${isOwner()?'<th>Cost</th>':''}<th>In stock</th><th></th></tr>${list.map(i=>{const s=levels.get(i.id);return `<tr><td><b>${esc(i.name)}</b><div class="helper">${esc(i.category)}</div></td><td>${esc(i.barcode||'—')}</td><td>${money(i.price)}${i.unit==='kg'?'/kg':''}</td>${isOwner()?`<td>${i.cost?money(i.cost):'—'}</td>`:''}<td class="${s<=0?'danger':low(i,levels)?'':''}">${esc(qtyText(s,i.unit))}${low(i,levels)?' <span class="badge" style="background:#f6e1e1;color:#8a1f1f">Low</span>':''}</td><td><button onclick="groceryStockIn('${esc(i.id)}')">Stock in</button>${isOwner()?` <button onclick="groceryItemForm('${esc(i.id)}')">Edit</button>`:''}</td></tr>`}).join('')}</table></div>${list.length?'':'<div class="empty">No products here.</div>'}</div>`;
 }
 function itemForm(id){
  const i=db.grocery_items.find(x=>x.id===id)||{name:'',barcode:'',category:'Other',unit:'piece',price:0,cost:0,minStock:0};
  modal(`<h2>${id?'Edit product':'Add product'}</h2><form id="gItem"><label for="giName">Name</label><input id="giName" value="${esc(i.name)}" maxlength="100" required><label for="giCode">Barcode (scan it into this box)</label><input id="giCode" value="${esc(i.barcode||'')}" maxlength="40" autocomplete="off"><div class="business-grid"><div><label for="giCat">Category</label><select id="giCat">${CATEGORIES.map(c=>`<option ${i.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div><div><label for="giUnit">Sold by</label><select id="giUnit" ${id?'disabled':''}><option value="piece" ${i.unit==='piece'?'selected':''}>Piece</option><option value="kg" ${i.unit==='kg'?'selected':''}>Weight (kg)</option></select></div></div><div class="business-grid"><div><label for="giPrice">Selling price before VAT (AED)</label><input id="giPrice" type="number" min="0" step="0.01" value="${(i.price/100).toFixed(2)}" required></div><div><label for="giCost">Cost price (AED, optional)</label><input id="giCost" type="number" min="0" step="0.01" value="${((i.cost||0)/100).toFixed(2)}"></div></div><label for="giMin">Low-stock alert at</label><input id="giMin" type="number" min="0" step="${i.unit==='kg'?'0.1':'1'}" value="${i.minStock||0}"><div class="actions">${id?`<button type="button" class="danger" onclick="groceryItemDelete('${esc(id)}')">Delete</button>`:''}<button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save product</button></div></form>`);
  $('giCode').onkeydown=e=>{if(e.key==='Enter')e.preventDefault()};
  $('gItem').onsubmit=e=>{e.preventDefault();const v={id:id||uid(),name:$('giName').value.trim(),barcode:$('giCode').value.replace(/\s+/g,''),category:$('giCat').value,unit:$('giUnit').value,price:cents($('giPrice').value),cost:cents($('giCost').value||'0'),minStock:Number($('giMin').value||0)};
   if(!v.name||!Number.isSafeInteger(v.price)||v.price<0||!Number.isSafeInteger(v.cost)||v.cost<0||!(v.minStock>=0)){alert('Check the name, prices and alert level');return}
   const dupe=v.barcode&&db.grocery_items.find(x=>x.barcode===v.barcode&&x.id!==v.id);if(dupe){alert('Barcode already used by '+dupe.name);return}
   if(change(()=>{const k=db.grocery_items.findIndex(x=>x.id===v.id);if(k>=0)db.grocery_items[k]=v;else db.grocery_items.push(v)})){closeModal();toast('Product saved')}};
 }
 // CSV import: columns name, barcode, category, unit (piece/kg), price, cost, stock, min stock. Existing barcodes are updated.
 function parseCSV(text){const rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const ch=text[i];if(q){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')q=false;else cell+=ch}else if(ch==='"')q=true;else if(ch===','||ch===';'||ch==='\t'){row.push(cell);cell=''}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=''}else cell+=ch}row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows}
 function importCSV(){
  modal(`<h2>Import products</h2><p>Use a CSV file. In Excel: <b>File → Save As → CSV (UTF-8)</b>. First row must be headers:</p><pre class="receipt">name, barcode, category, unit, price, cost, stock, min stock</pre><p class="helper">unit = piece or kg · prices in AED before VAT · stock = opening quantity (optional). Rows with a barcode already in your list update that product's name and prices. Unknown categories go to "Other".</p><button onclick="groceryTemplate()">Download template</button><label for="gFile">CSV file</label><input id="gFile" type="file" accept=".csv,text/csv,.txt"><p id="gImportInfo" class="helper"></p><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary" id="gImportGo" disabled>Import</button></div>`);
  let plan=null;
  $('gFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;const rows=parseCSV((await f.text()).replace(/^﻿/,''));if(rows.length<2){$('gImportInfo').textContent='No rows found.';return}
   const head=rows[0].map(h=>h.trim().toLowerCase().replace(/[^a-z]/g,'')),col=n=>head.indexOf(n),get=(r,n)=>(col(n)>=0?r[col(n)]:'').trim(),errors=[],items=[],stock=[],byCode=new Map(db.grocery_items.filter(i=>i.barcode).map(i=>[i.barcode,i])),seen=new Set();
   if(col('name')<0||col('price')<0){$('gImportInfo').textContent='The first row must include at least "name" and "price" columns.';return}
   rows.slice(1).forEach((r,k)=>{const n=k+2,name=get(r,'name'),code=get(r,'barcode').replace(/\s+/g,''),unit=/^kg|kilo|weight/i.test(get(r,'unit'))?'kg':'piece',price=cents(get(r,'price')),cost=get(r,'cost')?cents(get(r,'cost')):0,open=Number(get(r,'stock')||0),min=Number(get(r,'minstock')||get(r,'min')||0),catRaw=get(r,'category'),category=CATEGORIES.find(c=>c.toLowerCase()===catRaw.toLowerCase())||'Other';
    if(!name){errors.push('Row '+n+': no name');return}if(!Number.isSafeInteger(price)||price<0){errors.push('Row '+n+': bad price');return}if(!Number.isSafeInteger(cost)||cost<0){errors.push('Row '+n+': bad cost');return}if(code&&!/^[A-Za-z0-9-]{3,40}$/.test(code)){errors.push('Row '+n+': bad barcode');return}if(code&&seen.has(code)){errors.push('Row '+n+': barcode repeated in file');return}if(code)seen.add(code);
    const old=code&&byCode.get(code);if(old&&old.unit!==unit){errors.push('Row '+n+': '+old.name+' is sold by '+old.unit);return}
    const v={id:old?.id||uid(),name,barcode:code,category:old&&!catRaw?old.category:category,unit,price,cost,minStock:min>=0?min:0};items.push(v);
    const q=unit==='kg'?Math.round(open*1000)/1000:Math.round(open);if(q>0&&!old)stock.push({id:uid(),type:'in',itemId:v.id,qty:q,cost,supplier:'',invoice:'',note:'Opening stock (import)',at:new Date().toISOString()})});
   plan={items,stock};$('gImportInfo').innerHTML=`${items.length} products ready (${items.filter(i=>db.grocery_items.some(x=>x.id===i.id)).length} updates), ${stock.length} opening stock entries.${errors.length?'<br><span class="danger">'+errors.length+' rows skipped: '+esc(errors.slice(0,5).join('; '))+(errors.length>5?'…':'')+'</span>':''}${items.length>200?'<br>Large lists upload in the background; keep this device online until “0 pending”.':''}`;$('gImportGo').disabled=!items.length};
  $('gImportGo').onclick=()=>{if(!plan)return;if(change(()=>{for(const v of plan.items){const k=db.grocery_items.findIndex(x=>x.id===v.id);if(k>=0)db.grocery_items[k]=v;else db.grocery_items.push(v)}db.grocery_stock.push(...plan.stock)})){closeModal();toast(plan.items.length+' products imported')}};
 }
 const csvCell=v=>'"'+String(v??'').replace(/^[\s]*[=+@-]/,"'$&").replace(/"/g,'""')+'"';
 function exportCSV(){const levels=stockLevels();const rows=[['name','barcode','category','unit','price','cost','stock','min stock'],...db.grocery_items.map(i=>[i.name,i.barcode||'',i.category,i.unit,(i.price/100).toFixed(2),((i.cost||0)/100).toFixed(2),levels.get(i.id),i.minStock||0])];download('products-'+localDay()+'.csv','﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv')}
 function template(){download('products-template.csv','﻿name,barcode,category,unit,price,cost,stock,min stock\r\nMilk 1L,6291003000017,Dairy & eggs,piece,6.50,5.00,48,10\r\nTomatoes,,Fruits & vegetables,kg,4.50,3.00,20,5\r\n','text/csv')}

 // --- stock -------------------------------------------------------------------------------------------------
 function stock(){
  const levels=stockLevels(),q=stockSearch.trim().toLowerCase(),recent=db.grocery_stock.slice().sort((a,b)=>b.at.localeCompare(a.at)).filter(e=>!q||e.item.toLowerCase().includes(q)).slice(0,60);
  $('app').innerHTML=`<div class="layout"><section class="panel"><div class="row"><h2>Stock</h2><div class="actions" style="margin:0"><button class="primary" onclick="groceryStockIn()">+ Goods in</button>${isOwner()?'<button onclick="groceryCount()">Stock count</button>':''}</div></div><label for="gsSearch">Filter by product</label><input id="gsSearch" value="${esc(stockSearch)}" oninput="groceryStockSearch(this.value)">
  <div class="scroll"><table><tr><th>When</th><th>Product</th><th>Type</th><th>Qty</th><th>Details</th></tr>${recent.map(e=>`<tr><td>${esc(new Date(e.at).toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</td><td>${esc(e.item)}</td><td>${e.type==='in'?'Goods in':'Count adjustment'}</td><td>${e.qty>0?'+':''}${esc(qtyText(e.qty,e.unit))}</td><td class="helper">${esc([e.supplier,e.invoice&&'Inv '+e.invoice,e.cost?money(e.cost)+'/unit':'',e.reason,e.note].filter(Boolean).join(' · '))}</td></tr>`).join('')}</table></div>${recent.length?'':'<div class="empty">No stock movements yet. Record goods in when a delivery arrives.</div>'}</section>
  <aside class="panel"><h3>How stock works</h3><p class="helper">Stock = goods in + count adjustments − items sold. Sales never block on stock; negative stock means a delivery was not recorded or the count is off.</p><p class="helper">${db.grocery_items.filter(i=>levels.get(i.id)<0).length} products show negative stock.</p><button onclick="groceryProducts('Low stock')">Low-stock list →</button></aside></div>`;
 }
 function pick(selected=''){return `<label for="gsItem">Product</label><select id="gsItem">${db.grocery_items.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(i=>`<option value="${esc(i.id)}" ${i.id===selected?'selected':''}>${esc(i.name)}${i.barcode?' · '+esc(i.barcode):''}</option>`).join('')}</select>`}
 function stockIn(id=''){
  modal(`<h2>Goods in</h2><form id="gIn">${pick(id)}<div class="business-grid"><div><label for="gsQty">Quantity received</label><input id="gsQty" type="number" min="0" step="0.001" required></div><div><label for="gsCost">Cost per unit (AED, optional)</label><input id="gsCost" type="number" min="0" step="0.01"></div></div><div class="business-grid"><div><label for="gsSupplier">Supplier</label><input id="gsSupplier" maxlength="100"></div><div><label for="gsInv">Supplier invoice no.</label><input id="gsInv" maxlength="60"></div></div><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Add to stock</button></div></form>`);
  $('gIn').onsubmit=e=>{e.preventDefault();const item=db.grocery_items.find(x=>x.id===$('gsItem').value),q=Number($('gsQty').value),qty=item?.unit==='kg'?Math.round(q*1000)/1000:Math.round(q);if(!item||!(qty>0)){alert('Enter the quantity received'+(item?.unit==='kg'?' in kg':' in pieces'));return}
   const cost=$('gsCost').value?cents($('gsCost').value):0;if(!Number.isSafeInteger(cost)||cost<0){alert('Check the cost');return}
   if(change(()=>db.grocery_stock.push({id:uid(),type:'in',itemId:item.id,item:item.name,unit:item.unit,qty,cost,supplier:$('gsSupplier').value.trim(),invoice:$('gsInv').value.trim(),note:'',at:new Date().toISOString()}))){closeModal();toast('+'+qtyText(qty,item.unit)+' '+item.name)}};
 }
 function count(){
  const levels=stockLevels();
  modal(`<h2>Stock count</h2><p class="helper">Enter what is physically on the shelf. The difference is recorded as an adjustment with your reason.</p><form id="gCount">${pick()}<p id="gcNow" class="helper"></p><label for="gcQty">Counted quantity</label><input id="gcQty" type="number" min="0" step="0.001" required><label for="gcReason">Reason</label><input id="gcReason" maxlength="200" required placeholder="e.g. Monthly count, expired, damaged"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save count</button></div></form>`);
  const show=()=>{const i=db.grocery_items.find(x=>x.id===$('gsItem').value);$('gcNow').textContent=i?'System shows '+qtyText(levels.get(i.id),i.unit):''};$('gsItem').onchange=show;show();
  $('gCount').onsubmit=e=>{e.preventDefault();const item=db.grocery_items.find(x=>x.id===$('gsItem').value),n=Number($('gcQty').value),reason=$('gcReason').value.trim();if(!item||!(n>=0)||!reason)return;const diff=Math.round((n-levels.get(item.id))*1000)/1000,qty=item.unit==='kg'?diff:Math.round(diff);if(!qty){closeModal();toast('Count matches · no change');return}
   if(change(()=>db.grocery_stock.push({id:uid(),type:'adjust',itemId:item.id,item:item.name,unit:item.unit,qty,reason,note:'',at:new Date().toISOString()}))){closeModal();toast(item.name+': '+(qty>0?'+':'')+qtyText(qty,item.unit))}};
 }

 // --- credit (khata) ------------------------------------------------------------------------------------------------
 function credit(){
  const bal=balances(),q=creditSearch.trim().toLowerCase(),has=new Set([...db.sales.filter(s=>s.method===CREDIT).map(s=>s.customerId),...db.grocery_payments.map(p=>p.customerId)]),list=db.customers.filter(c=>has.has(c.id)&&(!q||(c.name+' '+c.phone).toLowerCase().includes(q))).sort((a,b)=>(bal.get(b.id)||0)-(bal.get(a.id)||0)),total=[...bal.values()].filter(v=>v>0).reduce((n,v)=>n+v,0);
  $('app').innerHTML=`<div class="panel"><div class="row"><div><h2>Customer credit</h2><p class="helper">Total outstanding <b>${money(total)}</b>. Sell on credit from Checkout by choosing the customer and pressing Credit.</p></div><button onclick="groceryNewAccount()">+ New customer</button></div><label for="gcSearch">Search name or mobile</label><input id="gcSearch" value="${esc(creditSearch)}" oninput="groceryCreditSearch(this.value)">
  ${list.length?list.map(c=>{const b=bal.get(c.id)||0;return `<div class="row" style="padding:12px 0;border-bottom:1px solid #eee;flex-wrap:wrap;gap:10px"><div style="min-width:200px"><b>${esc(c.name)}</b><div class="helper">${esc(c.phone||'No mobile')}</div></div><b class="${b>0?'danger':''}">${b>0?money(b)+' due':b<0?money(-b)+' in credit':'Settled'}</b><div class="actions" style="margin:0">${b>0?`<button class="primary" onclick="groceryPayment('${esc(c.id)}')">Receive payment</button>`:''}<button onclick="groceryStatement('${esc(c.id)}')">Statement</button>${b>0&&c.phone?`<button onclick="groceryRemind('${esc(c.id)}')">WhatsApp</button>`:''}</div></div>`}).join(''):'<div class="empty">No customer accounts yet.</div>'}</div>`;
 }
 function payment(id){
  const c=db.customers.find(x=>x.id===id);if(!c)return;const b=balanceOf(id);
  modal(`<h2>Receive payment · ${esc(c.name)}</h2><p>Balance due <b>${money(b)}</b></p><form id="gPayIn"><label for="gpAmt">Amount received (AED)</label><input id="gpAmt" type="number" min="0.01" step="0.01" value="${(b/100).toFixed(2)}" required><label for="gpMethod">Paid by</label><select id="gpMethod"><option>Cash</option><option value="Card (external terminal)">Card</option></select><label for="gpNote">Note (optional)</label><input id="gpNote" maxlength="200"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save payment</button></div></form>`);
  $('gpAmt').select();
  $('gPayIn').onsubmit=e=>{e.preventDefault();const amount=cents($('gpAmt').value),method=$('gpMethod').value;if(!Number.isSafeInteger(amount)||amount<=0){alert('Enter the amount received');return}if(amount>b&&!confirm('This is more than the balance due. Keep the extra as credit in the customer’s favour?'))return;if(method!=='Cash'&&!confirm('Confirm '+money(amount)+' was approved on your card terminal?'))return;
   const p={id:uid(),customerId:c.id,customer:c.name,amount,method,note:$('gpNote').value.trim(),at:new Date().toISOString()};
   if(change(()=>db.grocery_payments.push(p))){closeModal();paymentReceipt(p.id,b)}};
 }
 function paymentReceipt(id,before){const p=db.grocery_payments.find(x=>x.id===id);if(!p)return;const s=db.settings,l='--------------------------------';
  modal(`<h2>Payment received</h2><pre class="receipt" id="receiptText">${esc(`${s.name}\n${s.phone||''}${s.trn?'\nTRN: '+s.trn:''}\n${l}\nACCOUNT PAYMENT RECEIPT\n${new Date(p.at).toLocaleString()}\n${l}\nCustomer: ${p.customer}\nReceived: ${money(p.amount)} (${p.method==='Cash'?'Cash':'Card'})${p.note?'\nNote: '+p.note:''}\n${l}\nBalance before: ${money(before)}\nBalance now: ${money(before-p.amount)}\n\nThank you!`)}</pre><div class="actions"><button onclick="closeModal()">Close</button><button class="primary" onclick="printReceipt()">Print</button></div>`)}
 function statement(id){
  const c=db.customers.find(x=>x.id===id);if(!c)return;
  const rows=[...db.sales.filter(s=>s.customerId===id&&s.method===CREDIT).flatMap(s=>[{at:s.date,text:'Bill '+s.number,amount:s.total},...(s.status==='Refunded'?[{at:s.refundDate,text:'Refund '+(s.creditNote||s.number),amount:-s.total}]:[])]),...db.grocery_payments.filter(p=>p.customerId===id).map(p=>({at:p.at,text:'Payment · '+(p.method==='Cash'?'cash':'card'),amount:-p.amount}))].sort((a,b)=>a.at.localeCompare(b.at));
  let run=0;const lines=rows.map(r=>{run+=r.amount;return{...r,run}});const s=db.settings,l='--------------------------------';
  const text=`${s.name}\n${s.phone||''}\n${l}\nACCOUNT STATEMENT\n${c.name}${c.phone?'\n'+c.phone:''}\n${new Date().toLocaleDateString()}\n${l}\n${lines.map(r=>`${new Date(r.at).toLocaleDateString()} ${r.text}\n  ${r.amount>0?'+':''}${money(r.amount)}   bal ${money(r.run)}`).join('\n')||'No activity'}\n${l}\nBALANCE DUE: ${money(run)}`;
  modal(`<h2>Statement · ${esc(c.name)}</h2><pre class="receipt" id="receiptText">${esc(text)}</pre><div class="actions"><button onclick="closeModal()">Close</button><button class="primary" onclick="printReceipt()">Print / Save PDF</button></div>`);
 }
 function remind(id){const c=db.customers.find(x=>x.id===id);if(!c)return;const b=balanceOf(id);try{window.open(SalonWhatsApp.link(SalonWhatsApp.phone(c.phone),`Hello ${c.name}, this is a friendly reminder from ${db.settings.name}. Your account balance is ${money(b)}. You can pay at the shop any time. Thank you!`),'_blank','noopener')}catch(e){alert(e.message)}}
 function newAccount(){modal(`<h2>New customer</h2><form id="gAcc"><label for="gaName">Name</label><input id="gaName" maxlength="100" required><label for="gaPhone">Mobile (for WhatsApp reminders)</label><input id="gaPhone" type="tel" maxlength="40" placeholder="050 123 4567"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Add</button></div></form>`);
  $('gAcc').onsubmit=e=>{e.preventDefault();const v={id:uid(),name:$('gaName').value.trim(),phone:$('gaPhone').value.trim(),dob:''};if(!v.name)return;if(change(()=>db.customers.push(v))){closeModal();cartCustomer=v.id;toast('Customer added · selected at checkout')}}}

 const SCREENS={'Dashboard':dashboard,'Checkout':()=>checkout(true),'Products':products,'Stock':stock,'Credit':credit};
 Object.assign(window,{
  groceryAdd:id=>add(id),groceryRemove:k=>{cart.splice(k,1);checkout(true)},groceryClear:()=>{if(confirm('Clear this bill?')){cart=[];checkout(true)}},
  groceryQty:(k,v)=>{const i=cart[k];if(!i)return;const n=i.unit==='kg'?Math.round(Number(v)*100)/100:Math.round(Number(v));if(n>0&&n<=1000)i.qty=n;else alert('Enter a quantity from '+(i.unit==='kg'?'0.01 kg':'1')+' to 1000');checkout(true)},
  groceryCustomer:id=>{cartCustomer=id;checkout(true)},groceryPay:pay,
  groceryProducts:f=>{productFilter=f;tab='Products';render()},
  groceryProductSearch:v=>{productSearch=v;products();const el=$('gpSearch');el.focus();el.setSelectionRange(v.length,v.length)},
  groceryItemForm:itemForm,groceryImport:importCSV,groceryExport:exportCSV,groceryTemplate:template,
  groceryItemDelete:id=>{if(!confirm('Delete this product? Past bills keep their lines.'))return;if(change(()=>{db.grocery_items=db.grocery_items.filter(x=>x.id!==id)})){closeModal();toast('Product deleted')}},
  groceryStockIn:stockIn,groceryCount:count,groceryStockSearch:v=>{stockSearch=v;stock();const el=$('gsSearch');el.focus();el.setSelectionRange(v.length,v.length)},
  groceryPayment:payment,groceryStatement:statement,groceryRemind:remind,groceryNewAccount:newAccount,
  groceryCreditSearch:v=>{creditSearch=v;credit();const el=$('gcSearch');el.focus();el.setSelectionRange(v.length,v.length)}
 });
})();
