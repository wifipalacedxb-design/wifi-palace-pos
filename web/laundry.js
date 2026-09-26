// Laundry screens for WiFi Palace POS. Active only when the signed-in business type is "laundry";
// salons and other types keep their own screens. Shared screens (customers, settings, finance, team,
// sync, account) come from the core app.
(function(){
 'use strict';
 const STATUSES=['Received','Washing','Ready','Delivered','Cancelled'];
 const NEXT={Received:'Washing',Washing:'Ready'};
 const OWN=['Dashboard','New order','Orders','Price list'];
 const OWNER_ONLY=['Dashboard','Sales','Price list','Settings','Finance','Team'];
 const CATEGORIES=['Wash & iron','Dry clean','Iron only','Wash & fold','Household','Other'];
 const isLaundry=()=>typeof cloudUser!=='undefined'&&cloudUser?.businessType==='laundry';
 const isOwner=()=>cloudUser?.role==='owner';
 const tabs=()=>isOwner()?['Dashboard','New order','Orders','Customers','Sales','Price list','Settings','Finance','Team','Sync centre','Account']:['New order','Orders','Customers','My sales','Sync centre','Account'];
 const localDay=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
 const addDays=n=>{const d=new Date();d.setDate(d.getDate()+n);return localDay(d)};
 const line=i=>Math.round(i.price*i.qty);
 const qtyText=i=>i.unit==='kg'?i.qty+' kg':i.qty+' pc';
 const badge=s=>`<span class="badge" style="${s==='Ready'?'background:#dff3e9;color:#155e48':s==='Cancelled'?'background:#f6e1e1;color:#8a1f1f':s==='Delivered'?'background:#eceaf3;color:#555':''}">${esc(s)}</span>`;
 let order=null,orderFilter='Open',orderSearch='';
 const fresh=()=>({items:{},customerId:'',customer:'',phone:'',express:false,due:addDays(1),notes:''});

 // --- navigation -------------------------------------------------------------------------------
 function paintNav(){$('nav').innerHTML=tabs().map(t=>`<button class="${tab===t?'active':''}" data-cloud-tab="${esc(t)}">${esc(t)}</button>`).join('');document.querySelectorAll('[data-cloud-tab]').forEach(b=>b.onclick=()=>navigate(b.dataset.cloudTab))}
 function shim(){if(db){db.services??=[];db.appointments??=[];db.laundry_items??=[];db.laundry_orders??=[]}}
 const prevRender=render,prevNavigate=navigate;
 render=function(){
  if(!isLaundry()){prevRender();return}
  if(!cloudReady)return;shim();
  if(!tabs().includes(tab))tab=tabs()[0];
  if(OWN.includes(tab)){const t=tab;tab='Customers';prevRender();tab=t;paintNav();document.title=db.settings.name+' | WiFi Palace POS';SCREENS[t]();return}
  prevRender();paintNav();
 };
 navigate=function(next){
  if(!isLaundry()){prevNavigate(next);return}
  if(!isOwner()&&OWNER_ONLY.includes(next)){alert('Owner access required');return}
  if(OWN.includes(next)){tab=next;render();return}
  shim();prevNavigate(next);paintNav();
 };

 // --- dashboard --------------------------------------------------------------------------------
 function dashboard(){
  const today=localDay(),orders=db.laundry_orders,open=orders.filter(o=>['Received','Washing'].includes(o.status)),ready=orders.filter(o=>o.status==='Ready'),dueToday=orders.filter(o=>['Received','Washing'].includes(o.status)&&o.due===today),overdue=orders.filter(o=>['Received','Washing'].includes(o.status)&&o.due<today);
  const sales=db.sales.filter(s=>localDay(new Date(s.date))===today),refunds=db.sales.filter(s=>s.status==='Refunded'&&s.refundDate&&localDay(new Date(s.refundDate))===today).reduce((n,s)=>n+s.total,0),net=sales.reduce((n,s)=>n+s.total,0)-refunds;
  $('app').innerHTML=`<div class="hero"><div><div class="eyebrow">${esc(new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}).toUpperCase())}</div><h2 style="margin-top:14px">Fresh and ready.</h2><p>${esc(db.settings.name)} · today at a glance.</p></div><button onclick="navigate('New order')">+ New order</button></div>
  <div class="kpis"><div class="kpi"><div class="dot"></div><small>Today’s net collections</small><div class="metric">${money(net)}</div><span class="helper">After today’s refunds</span></div><div class="kpi"><div class="dot" style="background:#e3ba98"></div><small>In progress</small><div class="metric">${open.length}</div><span class="helper">Received or washing</span></div><div class="kpi"><div class="dot" style="background:#95bbb0"></div><small>Ready for pickup</small><div class="metric">${ready.length}</div><span class="helper">Waiting for the customer</span></div><div class="kpi"><div class="dot" style="background:#d98a8a"></div><small>Due today / overdue</small><div class="metric">${dueToday.length} / ${overdue.length}</div><span class="helper">Not ready yet</span></div></div>
  <div class="layout"><section class="panel"><div class="row"><h3>Ready for pickup</h3><button onclick="laundryShowOrders('Ready')">View all →</button></div>${ready.length?ready.slice(0,8).map(rowHTML).join(''):'<div class="empty">No orders waiting for pickup.</div>'}</section><aside class="panel"><h3>Overdue</h3>${overdue.length?overdue.slice(0,8).map(rowHTML).join(''):'<div class="empty">Nothing overdue. Well done.</div>'}</aside></div>`;
 }

 // --- new order --------------------------------------------------------------------------------
 function newOrder(){
  order??=fresh();
  const items=db.laundry_items,cats=[...new Set(items.map(i=>i.category))],chosen=Object.entries(order.items).map(([id,qty])=>{const i=items.find(x=>x.id===id);return i&&qty>0?{...i,qty}:null}).filter(Boolean),total=chosen.reduce((n,i)=>n+line(i),0);
  $('app').innerHTML=`<div class="layout"><section><div class="row"><div><h2>New laundry order</h2><p class="helper">Tap items to add pieces. Enter kilos for wash &amp; fold.</p></div></div>
  ${cats.map(c=>`<div class="panel"><h3>${esc(c)}</h3><div class="grid">${items.filter(i=>i.category===c).map(i=>{const q=order.items[i.id]||0;return i.unit==='kg'?`<div class="service"><b>${esc(i.name)}</b><div class="helper">${money(i.price)} / kg</div><label for="kg-${esc(i.id)}">Kilos</label><input id="kg-${esc(i.id)}" type="number" min="0" max="1000" step="0.1" value="${q||''}" placeholder="0.0" onchange="laundrySetQty('${esc(i.id)}',this.value)"></div>`:`<div class="service"><b>${esc(i.name)}</b><div class="helper">${money(i.price)} / piece</div><div class="row" style="margin-top:10px"><button aria-label="Remove one ${esc(i.name)}" onclick="laundryAdd('${esc(i.id)}',-1)">−</button><b style="min-width:32px;text-align:center">${q}</b><button class="primary" aria-label="Add one ${esc(i.name)}" onclick="laundryAdd('${esc(i.id)}',1)">+</button></div></div>`}).join('')}</div></div>`).join('')||'<div class="panel empty">Add items on the Price list first.</div>'}</section>
  <aside class="panel"><h3>Order</h3><label for="lCustomer">Customer</label><select id="lCustomer" onchange="laundryField('customerId',this.value)"><option value="">New / walk-in customer</option>${db.customers.map(c=>`<option value="${esc(c.id)}" ${order.customerId===c.id?'selected':''}>${esc(c.name)}${c.phone?' · '+esc(c.phone):''}</option>`).join('')}</select>
  ${order.customerId?'':`<label for="lName">Customer name</label><input id="lName" value="${esc(order.customer)}" maxlength="100" oninput="laundryField('customer',this.value,false)"><label for="lPhone">Mobile (for WhatsApp)</label><input id="lPhone" type="tel" value="${esc(order.phone)}" placeholder="050 123 4567" oninput="laundryField('phone',this.value,false)">`}
  <div class="business-grid"><div><label for="lDue">Ready by</label><input id="lDue" type="date" value="${esc(order.due)}" min="${localDay()}" onchange="laundryField('due',this.value)"></div><div><label for="lExpress">Service</label><select id="lExpress" onchange="laundryField('express',this.value==='1')"><option value="0">Normal</option><option value="1" ${order.express?'selected':''}>Express</option></select></div></div>
  <label for="lNotes">Notes (stains, starch, folding)</label><input id="lNotes" value="${esc(order.notes)}" maxlength="500" oninput="laundryField('notes',this.value,false)">
  <div style="margin-top:14px">${chosen.length?chosen.map(i=>`<div class="row"><span>${esc(i.name)} · ${esc(qtyText(i))}</span><span>${money(line(i))}</span></div>`).join(''):'<div class="empty">No items yet.</div>'}</div>
  <div class="row total"><b>Total</b><b>${money(total)}</b></div><p class="helper">VAT (${db.settings.tax}%) is added on the invoice.</p>
  <div class="actions"><button onclick="laundryClear()">Clear</button><button onclick="laundrySave(false)" ${chosen.length?'':'disabled'}>Save · pay on pickup</button><button class="primary" onclick="laundrySave(true)" ${chosen.length?'':'disabled'}>Save &amp; take payment</button></div></aside></div>`;
 }
 function newTag(){const used=new Set(db.laundry_orders.map(o=>o.tag)),md=localDay().slice(5).replace('-','');for(;;){const t=md+'-'+Math.random().toString(36).slice(2,5).toUpperCase();if(/^\d{4}-[A-Z0-9]{3}$/.test(t)&&!used.has(t))return t}}
 function save(payNow){
  const chosen=Object.entries(order.items).map(([id,qty])=>{const i=db.laundry_items.find(x=>x.id===id);return i&&qty>0?{id:i.id,name:i.name,category:i.category,unit:i.unit,price:i.price,qty}:null}).filter(Boolean);
  if(!chosen.length){alert('Add at least one item');return}
  const c=db.customers.find(x=>x.id===order.customerId),name=c?.name||order.customer.trim()||'Walk-in customer';
  const o={id:uid(),tag:newTag(),customerId:c?.id||'',customer:name,phone:c?.phone||order.phone.trim(),items:chosen,total:chosen.reduce((n,i)=>n+line(i),0),express:order.express,notes:order.notes.trim(),received:new Date().toISOString(),due:order.due,status:'Received',saleId:'',createdBy:cloudUser.id};
  if(!change(()=>db.laundry_orders.push(o)))return;
  order=null;render();
  if(payNow)takePayment(o.id);else ticket(o.id);
 }

 // --- orders -----------------------------------------------------------------------------------
 function rowHTML(o){const paid=!!o.saleId;return `<div class="row" style="padding:12px 0;border-bottom:1px solid #eee;gap:12px;flex-wrap:wrap"><div style="min-width:220px"><b>#${esc(o.tag)}</b> ${o.express?'<span class="badge">Express</span>':''}<div>${esc(o.customer)}${o.phone?' · '+esc(o.phone):''}</div><div class="helper">${o.items.map(i=>esc(i.name)+' '+esc(qtyText(i))).join(', ')}</div></div><div class="helper">Due ${esc(o.due)}</div><div><b>${money(o.total)}</b><div class="helper">${paid?'Paid':'To pay on pickup'}</div></div>${badge(o.status)}<div class="actions" style="margin:0">${NEXT[o.status]?`<button onclick="laundryStatus('${esc(o.id)}','${NEXT[o.status]}')">Mark ${esc(NEXT[o.status])}</button>`:''}${o.status==='Ready'&&o.phone?`<button onclick="laundryWhatsApp('${esc(o.id)}')">WhatsApp</button>`:''}${!paid&&!['Cancelled','Delivered'].includes(o.status)?`<button onclick="laundryPay('${esc(o.id)}')">Take payment</button>`:''}${o.status==='Ready'&&paid?`<button class="primary" onclick="laundryStatus('${esc(o.id)}','Delivered')">Hand over</button>`:''}<button onclick="laundryTicket('${esc(o.id)}')">Ticket</button>${['Received','Washing'].includes(o.status)&&!paid?`<button class="danger" onclick="laundryStatus('${esc(o.id)}','Cancelled')">Cancel</button>`:''}</div></div>`}
 function orders(){
  const q=orderSearch.toLowerCase(),list=db.laundry_orders.filter(o=>(orderFilter==='All'||(orderFilter==='Open'?['Received','Washing','Ready'].includes(o.status):o.status===orderFilter))&&(!q||[o.tag,o.customer,o.phone].join(' ').toLowerCase().includes(q))).sort((a,b)=>(a.due+a.received).localeCompare(b.due+b.received));
  $('app').innerHTML=`<div class="panel"><div class="row"><h2>Laundry orders</h2><button class="primary" onclick="navigate('New order')">+ New order</button></div><div class="actions" style="justify-content:flex-start">${['Open',...STATUSES,'All'].map(s=>`<button class="${orderFilter===s?'primary':''}" onclick="laundryShowOrders('${s}')">${esc(s)} (${db.laundry_orders.filter(o=>s==='All'||(s==='Open'?['Received','Washing','Ready'].includes(o.status):o.status===s)).length})</button>`).join('')}</div><label for="lSearch">Search tag, name or mobile</label><input id="lSearch" value="${esc(orderSearch)}" oninput="laundrySearch(this.value)">${list.length?list.map(rowHTML).join(''):'<div class="empty">No orders here.</div>'}</div>`;
 }
 function setStatus(id,status){
  const o=db.laundry_orders.find(x=>x.id===id);if(!o)return;
  if(status==='Cancelled'&&!confirm('Cancel order #'+o.tag+'?'))return;
  if(status==='Delivered'&&!o.saleId){takePayment(id);return}
  if(change(()=>{const cur=db.laundry_orders.find(x=>x.id===id);if(!cur)throw Error('Order no longer exists');cur.status=status}))toast('Order #'+o.tag+' · '+status);
  if(status==='Ready'&&o.phone&&confirm('Send "ready for pickup" WhatsApp to '+o.customer+'?'))whatsapp(id);
 }
 function whatsapp(id){
  const o=db.laundry_orders.find(x=>x.id===id);if(!o)return;
  try{const n=SalonWhatsApp.phone(o.phone),text=`Hello ${o.customer}, your laundry (tag #${o.tag}) is ready for pickup at ${db.settings.name}. ${o.saleId?'It is already paid.':'Amount due: '+money(o.total)+' + VAT.'} Thank you!`;window.open(SalonWhatsApp.link(n,text),'_blank','noopener')}catch(e){alert(e.message)}
 }

 // --- payment (a normal tax-invoice sale linked to the order) -----------------------------------
 function takePayment(id){
  const o=db.laundry_orders.find(x=>x.id===id);if(!o)return;if(o.saleId){toast('Already paid');return}
  const changed=o.items.find(i=>{const p=db.laundry_items.find(x=>x.id===i.id);return !p||p.price!==i.price});if(changed){alert('The price of '+changed.name+' changed after this order was taken. Ask the owner to restore the price, or cancel and re-enter the order.');return}
  const sub=o.items.reduce((n,i)=>n+line(i),0),tax=Math.round(sub*db.settings.tax/100),total=sub+tax;
  modal(`<h2>Payment · order #${esc(o.tag)}</h2><p>Total to collect <b>${money(total)}</b>${tax?` (incl. VAT ${money(tax)})`:''}</p><form id="lPay"><label for="lMethod">Payment method</label><select id="lMethod"><option>Cash</option><option value="Card (external terminal)">Card</option></select><label for="lReceived">Cash received (AED)</label><input id="lReceived" type="number" min="0" step="0.01" value="${(total/100).toFixed(2)}"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Confirm payment</button></div></form>`);
  $('lMethod').onchange=()=>{$('lReceived').disabled=$('lMethod').value!=='Cash'};
  $('lPay').onsubmit=e=>{e.preventDefault();const method=$('lMethod').value,card=method!=='Cash',received=card?total:cents($('lReceived').value);if(!Number.isSafeInteger(received)||received<total){alert('Cash received must cover the total.');return}if(card&&!confirm('Confirm '+money(total)+' was approved on your card terminal?'))return;
   const sale={id:uid(),number:'SD-'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+uid().slice(-3).toUpperCase(),date:new Date().toISOString(),items:o.items.map(i=>({id:i.id,name:i.name,category:i.category,unit:i.unit,price:i.price,qty:i.qty})),sub,off:0,tax,total,customer:o.customer,customerId:o.customerId,staff:cloudUser.name||'Staff',staffId:'',commissionBps:0,method,cashAmount:card?0:total,cardAmount:card?total:0,cashReceived:card?0:received,received,change:received-total,shop:{...db.settings},status:'Paid',ref:o.id};
   // Look the order up again: a background sync may have replaced db while this window was open.
   if(change(()=>{const cur=db.laundry_orders.find(x=>x.id===id);if(!cur)throw Error('Order no longer exists');if(cur.saleId)throw Error('Order is already paid');db.sales.push(sale);cur.saleId=sale.id}))
    {closeModal();render();receipt(sale.id)}};
 }

 // --- ticket (customer copy / tag) ----------------------------------------------------------------
 function ticketText(o){const s=db.settings,l='--------------------------------';return `${s.name}\n${s.phone||''}\n${l}\nLAUNDRY ORDER\nTag: #${o.tag}${o.express?'  EXPRESS':''}\n${l}\nCustomer: ${o.customer}${o.phone?'\nMobile: '+o.phone:''}\nReceived: ${new Date(o.received).toLocaleString()}\nReady by: ${o.due}\n${l}\n${o.items.map(i=>`${i.name}\n  ${qtyText(i)} x ${money(i.price)} = ${money(line(i))}`).join('\n')}\n${l}\nTotal before VAT: ${money(o.total)}\n${o.saleId?'PAID':'Pay on pickup'}${o.notes?'\nNotes: '+o.notes:''}\n\nPlease bring this ticket to collect.`}
 function ticket(id){const o=db.laundry_orders.find(x=>x.id===id);if(!o)return;modal(`<h2>Order ticket #${esc(o.tag)}</h2><pre class="receipt" id="receiptText">${esc(ticketText(o))}</pre><div class="actions"><button onclick="closeModal()">Close</button><button class="primary" onclick="printReceipt()">Print ticket</button></div>`)}

 // --- price list -------------------------------------------------------------------------------
 function priceList(){
  $('app').innerHTML=`<div class="layout"><section class="panel"><div class="row"><h2>Price list</h2><button class="primary" onclick="laundryItemForm()">+ Add item</button></div><p class="helper">Prices before VAT. Changing a price does not change orders already taken.</p>${CATEGORIES.filter(c=>db.laundry_items.some(i=>i.category===c)).map(c=>`<h3>${esc(c)}</h3>${db.laundry_items.filter(i=>i.category===c).map(i=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #eee"><span><b>${esc(i.name)}</b> <span class="helper">per ${esc(i.unit==='kg'?'kg':'piece')}</span></span><span>${money(i.price)} <button onclick="laundryItemForm('${esc(i.id)}')">Edit</button></span></div>`).join('')}`).join('')}</section><aside class="panel"><h3>Tips</h3><p class="helper">Use "Wash &amp; fold" priced per kg for bulk loads. Add an "Express charge" item under Other if you charge extra for same-day service.</p></aside></div>`;
 }
 function itemForm(id){
  const i=db.laundry_items.find(x=>x.id===id)||{name:'',category:'Wash & iron',unit:'piece',price:0};
  modal(`<h2>${id?'Edit item':'Add item'}</h2><form id="lItem"><label for="liName">Item name</label><input id="liName" value="${esc(i.name)}" maxlength="100" required><label for="liCat">Category</label><select id="liCat">${CATEGORIES.map(c=>`<option ${i.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select><label for="liUnit">Priced per</label><select id="liUnit"><option value="piece" ${i.unit==='piece'?'selected':''}>Piece</option><option value="kg" ${i.unit==='kg'?'selected':''}>Kilogram</option></select><label for="liPrice">Price before VAT (AED)</label><input id="liPrice" type="number" min="0" step="0.01" value="${(i.price/100).toFixed(2)}" required><div class="actions">${id?`<button type="button" class="danger" onclick="laundryItemDelete('${esc(id)}')">Delete</button>`:''}<button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save item</button></div></form>`);
  $('lItem').onsubmit=e=>{e.preventDefault();const v={id:id||uid(),name:$('liName').value.trim(),category:$('liCat').value,unit:$('liUnit').value,price:cents($('liPrice').value)};if(!v.name||!Number.isSafeInteger(v.price)||v.price<0){alert('Enter a name and a valid price');return}if(change(()=>{const k=db.laundry_items.findIndex(x=>x.id===v.id);if(k>=0)db.laundry_items[k]=v;else db.laundry_items.push(v)})){closeModal();toast('Price list saved')}};
 }

 const SCREENS={'Dashboard':dashboard,'New order':newOrder,'Orders':orders,'Price list':priceList};
 // Handlers used from the markup above.
 Object.assign(window,{
  laundryAdd:(id,d)=>{order??=fresh();order.items[id]=Math.max(0,(order.items[id]||0)+d);newOrder()},
  laundrySetQty:(id,v)=>{order??=fresh();const n=Math.round(Number(v)*10)/10;order.items[id]=Number.isFinite(n)&&n>0?Math.min(n,1000):0;setTimeout(newOrder)},
  laundryField:(k,v,redraw=true)=>{order??=fresh();order[k]=v;if(redraw)setTimeout(newOrder)},
  laundryClear:()=>{order=fresh();newOrder()},
  laundrySave:save,laundryStatus:setStatus,laundryWhatsApp:whatsapp,laundryPay:takePayment,laundryTicket:ticket,
  laundryShowOrders:f=>{orderFilter=f;tab='Orders';render()},
  laundrySearch:v=>{orderSearch=v;orders();const el=$('lSearch');el.focus();el.setSelectionRange(v.length,v.length)},
  laundryItemForm:itemForm,
  laundryItemDelete:id=>{if(!confirm('Delete this item from the price list? Existing orders keep their prices.'))return;if(change(()=>{db.laundry_items=db.laundry_items.filter(x=>x.id!==id)})){closeModal();toast('Item deleted')}}
 });
})();
