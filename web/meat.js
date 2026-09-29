// Meat shop screens for Palace POS (business type "meat"). Checkout, products, stock, label scale and
// credit come from grocery.js; this file adds cutting options (chooser at checkout + editor on products),
// pre-orders (pickup / delivery, Eid & Qurbani, restaurant supply) and carcass breakdown with yield.
(function(){
 'use strict';
 const R=window.RetailUI;if(!R)return;
 R.ext??={};const EXT=R.ext.meat={};
 const ANIMALS=['Goat','Lamb','Sheep','Beef','Veal','Camel','Chicken','Other'];
 const OCCASIONS=['Regular','Eid / Qurbani','Party / event','Restaurant supply'];
 const STATUS_STYLE={New:'',Preparing:'background:#fdf0d8;color:#7a5200',Ready:'background:#dff3e9;color:#155e48','Out for delivery':'background:#e4ecff;color:#23408e',Done:'background:#eceaf3;color:#555',Cancelled:'background:#f6e1e1;color:#8a1f1f'};
 let orderView='Open',orderSearch='';
 const item=id=>db.grocery_items.find(i=>i.id===id);
 const customer=id=>db.customers.find(c=>c.id===id);
 const products=()=>db.grocery_items.filter(i=>!R.isSvc(i)).sort((a,b)=>a.name.localeCompare(b.name));
 const kgText=(q,u)=>R.qtyText(q,u);
 const day=t=>R.localDay(new Date(t));
 const when=t=>new Date(t).toLocaleString([], {weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
 const est=o=>o.items.reduce((n,l)=>n+Math.round(l.price*l.qty),0);
 const accountBalance=id=>R.balanceOf(id);

 // --- checkout: cut chooser ---------------------------------------------------------------------------------
 EXT.chooseCut=(i,done)=>{modal(`<h2>${esc(i.name)}</h2><p class="helper">How should the butcher cut it?</p><div class="grid">${[{id:'',name:'No cutting',charge:0},...i.cuts].map(c=>`<button class="service" data-cut="${esc(c.id)}"><strong>${esc(c.name)}</strong><b>${c.charge?'+'+money(c.charge)+' / kg':'No charge'}</b></button>`).join('')}</div><div class="actions"><button onclick="closeModal()">Cancel</button></div>`);
  document.querySelectorAll('[data-cut]').forEach(b=>b.onclick=()=>{closeModal();done(b.dataset.cut)})};
 // Advance on account: remind the cashier that Credit uses it.
 EXT.checkoutExtra=c=>{if(!c)return '';const bal=accountBalance(c.id);return bal<0?`<p class="helper" style="background:#dff3e9;color:#155e48;padding:8px 10px;border-radius:8px">Advance on account: <b>${money(-bal)}</b>. Press <b>Credit</b> to use it; any balance left to pay shows on the account.</p>`:''};
 EXT.onPaid=(sale,links)=>{let msg='';for(const l of links)if(l.kind==='meat_orders'){const o=db.meat_orders.find(x=>x.id===l.id);if(o&&!o.saleId){o.saleId=sale.id;msg='Order #'+o.number+' billed · mark it '+(o.type==='delivery'?'out for delivery':'collected')+' on Orders'}}
  if(sale.method==='Credit (account)'&&sale.customerId){const after=accountBalance(sale.customerId);if(after>0)msg+=(msg?' · ':'')+'Balance due on account '+money(after)}return msg};

 // --- products: cutting options editor -------------------------------------------------------------------------
 EXT.itemFields=i=>{setTimeout(()=>{const u=$('giUnit');if(!u)return;const show=()=>{$('mCutBox').style.display=u.value==='kg'?'':'none'};u.addEventListener('change',show);show()});
  return `<div id="mCutBox"><h3 style="margin-top:14px">Cutting options</h3><p class="helper">Shown at checkout. The charge is added per kg (0 = free).</p><div id="mCuts">${(i.cuts||[]).map(cutRow).join('')}</div><button type="button" onclick="meatCutRow()">+ Add cutting option</button></div>`};
 const cutRow=(c={})=>`<div class="row" style="gap:6px" data-cutrow data-id="${esc(c.id||uid())}"><input value="${esc(c.name||'')}" maxlength="40" placeholder="e.g. Curry cut" style="margin:0" data-cutname aria-label="Cutting option"><input type="number" min="0" step="0.5" value="${((c.charge||0)/100).toFixed(2)}" style="width:100px;margin:0" data-cutcharge aria-label="Charge per kg (AED)"><button type="button" onclick="this.closest('[data-cutrow]').remove()">×</button></div>`;
 EXT.readItem=()=>{if($('giUnit').value!=='kg')return{};const rows=[...document.querySelectorAll('[data-cutrow]')].map(r=>({id:r.dataset.id,name:r.querySelector('[data-cutname]').value.trim(),charge:cents(r.querySelector('[data-cutcharge]').value||'0')})).filter(c=>c.name);
  if(rows.some(c=>!Number.isSafeInteger(c.charge)||c.charge<0)){alert('Check the cutting charges');return false}return rows.length?{cuts:rows}:{cuts:[]}};

 // --- dashboard block --------------------------------------------------------------------------------------------------
 EXT.dashboard=()=>{const t=R.localDay(),open=db.meat_orders.filter(o=>!['Done','Cancelled'].includes(o.status)),today=open.filter(o=>day(o.due)<=t),tomorrow=open.filter(o=>day(o.due)===addDay(t,1)),kg=today.reduce((n,o)=>n+o.items.filter(l=>l.unit==='kg').reduce((m,l)=>m+l.qty,0),0),last=db.meat_breakdowns.slice().sort((a,b)=>b.at.localeCompare(a.at))[0];
  return `<div class="layout"><section class="panel"><div class="row"><h3>Orders due today · ${today.length}</h3><button onclick="navigate('Orders')">Orders →</button></div><p class="helper">${kgText(Math.round(kg*1000)/1000,'kg')} to prepare · ${tomorrow.length} due tomorrow</p>${today.slice(0,6).map(o=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee"><span>#${o.number} · ${esc(o.customer)} · ${esc(new Date(o.due).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</span><span class="badge" style="${STATUS_STYLE[o.status]}">${esc(o.status)}</span></div>`).join('')||'<div class="empty">Nothing due today.</div>'}</section>
  <aside class="panel"><div class="row"><h3>Last breakdown</h3><button onclick="navigate('Breakdown')">Breakdown →</button></div>${last?`<p><b>${esc(last.animal)}</b> ${esc(last.description||'')} · ${kgText(last.weight,'kg')}</p><p>Yield <b>${last.yieldPct}%</b> · cost ${money(last.costPerKg)} / usable kg</p>`:'<div class="empty">No breakdowns yet.</div>'}</aside></div>`};
 const addDay=(d,n)=>R.localDay(new Date(Date.parse(d+'T12:00:00')+n*86400000));

 // --- orders --------------------------------------------------------------------------------------------------------------
 function orders(){
  const t=R.localDay(),q=orderSearch.trim().toLowerCase(),match=o=>!q||[o.customer,o.phone,'#'+o.number,o.occasion].join(' ').toLowerCase().includes(q);
  const views={Open:o=>!['Done','Cancelled'].includes(o.status),Today:o=>!['Done','Cancelled'].includes(o.status)&&day(o.due)<=t,Tomorrow:o=>!['Done','Cancelled'].includes(o.status)&&day(o.due)===addDay(t,1),'Eid / Qurbani':o=>o.occasion==='Eid / Qurbani'&&o.status!=='Cancelled',Done:o=>['Done','Cancelled'].includes(o.status)};
  const list=db.meat_orders.filter(views[orderView]).filter(match).sort((a,b)=>orderView==='Done'?b.due.localeCompare(a.due):a.due.localeCompare(b.due));
  $('app').innerHTML=`<div class="panel"><div class="row"><div><h2>Orders</h2><p class="helper">Phone, WhatsApp, Eid &amp; Qurbani and restaurant orders · pickup or delivery</p></div><div class="actions" style="margin:0"><button onclick="meatPrep()">Prep sheet</button><button class="primary" onclick="meatOrder()">+ New order</button></div></div>
  <div class="actions" style="justify-content:flex-start">${Object.keys(views).map(v=>`<button class="${orderView===v?'primary':''}" onclick="meatView('${esc(v)}')">${esc(v)} (${db.meat_orders.filter(views[v]).length})</button>`).join('')}</div>
  <label for="moSearch">Search customer, mobile or order no.</label><input id="moSearch" value="${esc(orderSearch)}" oninput="meatSearch(this.value)">
  ${list.map(o=>{const late=!['Done','Cancelled'].includes(o.status)&&Date.parse(o.due)<Date.now(),s=o.saleId&&db.sales.find(x=>x.id===o.saleId);return `<div class="row" style="padding:12px 0;border-bottom:1px solid #eee;flex-wrap:wrap;gap:10px;align-items:flex-start"><div style="flex:1;min-width:250px"><b style="font-size:17px">#${o.number} · ${esc(o.customer)}</b> <span class="helper">${esc(o.phone||'')}</span><div class="helper">${o.type==='delivery'?'🚚 Delivery · '+esc(o.address):'🏪 Pickup'} · <span class="${late?'danger':''}">${esc(when(o.due))}</span>${o.occasion!=='Regular'?' · <b>'+esc(o.occasion)+'</b>':''}</div><div style="margin-top:4px">${o.items.map(l=>`${esc(kgText(l.qty,l.unit))} ${esc(l.name)}${l.cutName?' <span class="helper">('+esc(l.cutName)+')</span>':''}${l.note?' <span class="helper">! '+esc(l.note)+'</span>':''}`).join('<br>')}</div>${o.note?`<div class="helper">Note: ${esc(o.note)}</div>`:''}</div>
   <div style="text-align:right;min-width:170px"><span class="badge" style="${STATUS_STYLE[o.status]}">${esc(o.status)}</span><div class="helper">Est. ${money(est(o))}${o.advance?' · advance '+money(o.advance):''}</div>${s?`<div class="helper">Billed ${esc(s.number)}</div>`:''}<div class="actions" style="margin:6px 0 0;justify-content:flex-end">${actions(o)}</div></div></div>`}).join('')||'<div class="empty">No orders here.</div>'}</div>`;
 }
 function actions(o){const b=[],id=esc(o.id);
  if(o.status==='New')b.push(`<button onclick="meatStatus('${id}','Preparing')">Start</button>`);
  if(['New','Preparing'].includes(o.status))b.push(`<button class="primary" onclick="meatStatus('${id}','Ready')">Ready</button>`,`<button onclick="meatOrder('${id}')">Edit</button>`);
  if(o.status==='Ready'&&!o.saleId)b.push(`<button class="primary" onclick="meatBill('${id}')">Bill</button>`);
  if(o.status==='Ready'&&o.type==='delivery'&&o.saleId)b.push(`<button class="primary" onclick="meatStatus('${id}','Out for delivery')">Out for delivery</button>`);
  if(o.saleId&&(o.status==='Out for delivery'||o.status==='Ready'&&o.type==='pickup'))b.push(`<button class="primary" onclick="meatStatus('${id}','Done')">${o.type==='delivery'?'Delivered':'Collected'}</button>`);
  if(o.saleId)b.push(`<button onclick="receipt('${esc(o.saleId)}')">Bill</button>`);
  if(['Ready','Out for delivery'].includes(o.status)||o.type==='delivery')b.push(`<button onclick="meatNote('${id}')">${o.type==='delivery'?'Delivery note':'Slip'}</button>`);
  if(o.status==='Ready'&&o.phone)b.push(`<button onclick="meatWhatsApp('${id}')">WhatsApp</button>`);
  if(!['Done','Cancelled','Out for delivery'].includes(o.status)&&!o.saleId)b.push(`<button class="danger" onclick="meatStatus('${id}','Cancelled')">Cancel</button>`);
  return b.join('')}
 function orderForm(id){
  const o=db.meat_orders.find(x=>x.id===id),edit=!!o,base=o||{customerId:'',type:'pickup',occasion:'Regular',due:new Date(Date.now()+3*3600000).toISOString(),items:[],address:'',note:'',advance:0};
  const dt=new Date(base.due),local=new Date(dt.getTime()-dt.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const row=(l={})=>{const it=item(l.itemId)||products()[0];return `<div class="row" style="gap:6px;flex-wrap:wrap" data-orow><select style="margin:0;flex:2;min-width:180px" data-oitem>${products().map(p=>`<option value="${esc(p.id)}" ${p.id===it?.id?'selected':''}>${esc(p.name)} · ${money(p.price)}${p.unit==='kg'?'/kg':''}</option>`).join('')}</select><input type="number" min="0.001" step="0.001" value="${l.qty||1}" style="width:90px;margin:0" data-oqty aria-label="Quantity"><select style="margin:0;width:150px" data-ocut aria-label="Cutting">${cutOptions(it,l.cut)}</select><input value="${esc(l.note||'')}" maxlength="100" placeholder="Note" style="margin:0;flex:1;min-width:110px" data-onote aria-label="Note"><button type="button" onclick="this.closest('[data-orow]').remove();meatCalc()">×</button></div>`};
  modal(`<h2>${edit?'Edit order #'+o.number:'New order'}</h2><form id="mOrd">${edit?`<p><b>${esc(o.customer)}</b> ${esc(o.phone||'')}</p>`:`<label for="moCust">Customer</label><select id="moCust"><option value="">+ New customer</option>${db.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.phone?' · '+esc(c.phone):''}</option>`).join('')}</select><div id="moNew" class="business-grid"><div><label for="moName">Name</label><input id="moName" maxlength="100"></div><div><label for="moPhone">Mobile</label><input id="moPhone" type="tel" maxlength="40" placeholder="050 123 4567"></div></div>`}
  ${edit?'':`<div class="business-grid"><div><label for="moType">Pickup or delivery</label><select id="moType"><option value="pickup">Pickup at shop</option><option value="delivery">Delivery</option></select></div><div><label for="moOcc">Occasion</label><select id="moOcc">${OCCASIONS.map(x=>`<option>${x}</option>`).join('')}</select></div></div>`}
  <div class="business-grid"><div><label for="moDue">Needed on</label><input id="moDue" type="datetime-local" value="${local}" required></div><div id="moAddrBox"><label for="moAddr">Delivery address</label><input id="moAddr" maxlength="300" value="${esc(base.address)}" placeholder="Building, flat, area"></div></div>
  <h3 style="margin-top:14px">Items</h3><div id="moRows">${(base.items.length?base.items:[{}]).map(row).join('')}</div><button type="button" id="moAdd">+ Add item</button>
  <label for="moNote">Note</label><input id="moNote" maxlength="200" value="${esc(base.note)}" placeholder="e.g. cut small for biryani, call before delivery">
  ${edit?'':`<div class="business-grid"><div><label for="moAdv">Advance paid now (AED)</label><input id="moAdv" type="number" min="0" step="0.01" value="0"></div><div><label for="moAdvM">Paid by</label><select id="moAdvM"><option>Cash</option><option value="Card (external terminal)">Card</option></select></div></div>`}
  <p id="moTotal" style="font-size:18px"></p><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">${edit?'Save':'Create order'}</button></div></form>`);
  const addrShow=()=>{$('moAddrBox').style.visibility=(edit?o.type:$('moType').value)==='delivery'?'visible':'hidden'};if(!edit){$('moType').onchange=addrShow;const nw=()=>{$('moNew').style.display=$('moCust').value?'none':''};$('moCust').onchange=nw;nw()}addrShow();
  $('moRows').addEventListener('change',e=>{if(e.target.matches('[data-oitem]')){const r=e.target.closest('[data-orow]');r.querySelector('[data-ocut]').innerHTML=cutOptions(item(e.target.value),'')}meatCalc()});$('moRows').addEventListener('input',()=>meatCalc());
  $('moAdd').onclick=()=>{$('moRows').insertAdjacentHTML('beforeend',row());meatCalc()};
  window.meatCalc=()=>{let t=0;readRows().forEach(l=>{t+=Math.round(l.price*l.qty)});$('moTotal').innerHTML='Estimated total: <b>'+money(t)+'</b> <span class="helper">(final price by actual weight)</span>'};meatCalc();
  $('mOrd').onsubmit=e=>{e.preventDefault();const lines=readRows();if(!lines.length||lines.some(l=>!(l.qty>0))){alert('Add at least one item with its quantity');return}const due=new Date($('moDue').value);if(!Number.isFinite(due.getTime())){alert('Choose when the order is needed');return}
   const type=edit?o.type:$('moType').value,address=$('moAddr').value.trim();if(type==='delivery'&&!address){alert('Enter the delivery address');return}
   const items=lines.map(l=>({itemId:l.itemId,name:l.name,unit:l.unit,qty:l.qty,cut:l.cut,cutName:l.cutName,price:l.price,note:l.note}));
   if(edit){if(change(()=>{const x=db.meat_orders.find(y=>y.id===id);Object.assign(x,{items,due:due.toISOString(),address,note:$('moNote').value.trim()})})){closeModal();toast('Order saved')}return}
   let cid=$('moCust').value,newCust=null;if(!cid){const n=$('moName').value.trim();if(!n){alert('Choose the customer or enter a name');return}newCust={id:uid(),name:n,phone:$('moPhone').value.trim(),dob:''};cid=newCust.id}
   const adv=cents($('moAdv').value||'0');if(!Number.isSafeInteger(adv)||adv<0){alert('Check the advance amount');return}
   if(adv&&$('moAdvM').value!=='Cash'&&!confirm('Confirm '+money(adv)+' was approved on your card terminal?'))return;
   const c=newCust||customer(cid),v={id:uid(),customerId:cid,customer:c.name,phone:c.phone||'',type,occasion:$('moOcc').value,due:due.toISOString(),items,address,note:$('moNote').value.trim(),driver:'',advance:adv,status:'New',saleId:'',created:new Date().toISOString(),createdBy:cloudUser.id,history:[]};
   if(change(()=>{if(newCust)db.customers.push(newCust);db.meat_orders.push(v);if(adv)db.grocery_payments.push({id:uid(),customerId:cid,customer:c.name,amount:adv,method:$('moAdvM').value,note:'Advance for order',at:new Date().toISOString()})})){closeModal();orderView='Open';toast('Order created'+(adv?' · advance '+money(adv)+' on account':''));tab='Orders';render()}};
 }
 const cutOptions=(it,sel)=>`<option value="">${it?.cuts?.length?'No cutting':'—'}</option>`+(it?.cuts||[]).map(c=>`<option value="${esc(c.id)}" ${c.id===sel?'selected':''}>${esc(c.name)}${c.charge?' +'+(c.charge/100).toFixed(2):''}</option>`).join('');
 function readRows(){return [...document.querySelectorAll('[data-orow]')].map(r=>{const it=item(r.querySelector('[data-oitem]').value),n=Number(r.querySelector('[data-oqty]').value),cut=(it?.cuts||[]).find(c=>c.id===r.querySelector('[data-ocut]').value);return it?{itemId:it.id,name:it.name,unit:it.unit,qty:it.unit==='kg'?Math.round(n*1000)/1000:Math.round(n),cut:cut?.id||'',cutName:cut?.name||'',price:it.price+(cut?.charge||0),note:r.querySelector('[data-onote]').value.trim()}:null}).filter(Boolean)}
 function setStatus(id,status){const o=db.meat_orders.find(x=>x.id===id);if(!o)return;let reason='';
  if(status==='Cancelled'){reason=prompt('Reason for cancelling order #'+o.number+':'+(o.advance?'\nRemember to refund the advance of '+money(o.advance)+' from the customer account.':''));if(!reason?.trim())return}
  if(change(()=>{const x=db.meat_orders.find(y=>y.id===id);x.status=status;if(reason)x.cancelReason=reason.trim()}))toast('#'+o.number+': '+status)}
 function bill(id){const o=db.meat_orders.find(x=>x.id===id);if(!o)return;const link={kind:'meat_orders',id};
  const lines=o.items.filter(l=>item(l.itemId)).map(l=>({id:l.itemId,qty:l.qty,cut:l.cut||'',note:'Order #'+o.number+(l.note?' · '+l.note:''),link}));
  const del=o.type==='delivery'&&db.grocery_items.find(i=>R.isSvc(i)&&i.serviceType==='delivery');if(del)lines.push({id:del.id,qty:1,cut:'',link});
  R.bill({customerId:o.customerId,lines});toast('Weigh and adjust the quantities (or scan the scale labels), then take payment')}
 function slip(id){const o=db.meat_orders.find(x=>x.id===id);if(!o)return;const s=db.settings,l='--------------------------------',sale=o.saleId&&db.sales.find(x=>x.id===o.saleId);
  const lines=(sale?sale.items.map(i=>({name:i.name,qty:i.qty,unit:i.unit,cut:(i.options||[]).map(x=>typeof x==='string'?x:x.name).join(', ')})):o.items.map(i=>({name:i.name,qty:i.qty,unit:i.unit,cut:i.cutName})));
  const text=`${s.name}\n${s.phone||''}\n${l}\n${o.type==='delivery'?'DELIVERY NOTE':'ORDER SLIP'}  #${o.number}\n${when(o.due)}\n${l}\nCustomer: ${o.customer}\n${o.phone?'Mobile: '+o.phone+'\n':''}${o.type==='delivery'?'Address: '+o.address+'\n':''}${l}\n${lines.map(x=>`${kgText(x.qty,x.unit)}  ${x.name}${x.cut?'\n   '+x.cut:''}`).join('\n')}\n${l}${sale?'\nBill: '+sale.number+'  '+money(sale.total):''}${o.note?'\nNote: '+o.note:''}\n\n\nReceived by: ____________________\n\nSignature: ______________________`;
  modal(`<h2>${o.type==='delivery'?'Delivery note':'Order slip'}</h2><pre class="receipt" id="receiptText">${esc(text)}</pre><div class="actions"><button onclick="closeModal()">Close</button><button class="primary" onclick="printReceipt()">Print</button></div>`)}
 function prep(){const t=R.localDay(),days=[t,addDay(t,1),addDay(t,2)];
  const draw=d=>{const list=db.meat_orders.filter(o=>['New','Preparing'].includes(o.status)&&day(o.due)===d),m=new Map();for(const o of list)for(const l of o.items){const k=l.name+'|'+(l.cutName||'');const cur=m.get(k)||{name:l.name,cut:l.cutName,unit:l.unit,qty:0,orders:[]};cur.qty=Math.round((cur.qty+l.qty)*1000)/1000;cur.orders.push('#'+o.number);m.set(k,cur)}
   const rows=[...m.values()].sort((a,b)=>a.name.localeCompare(b.name)),l='--------------------------------';
   $('receiptText').textContent=`PREP SHEET · ${new Date(d+'T12:00:00').toDateString()}\n${list.length} orders\n${l}\n${rows.map(r=>`${kgText(r.qty,r.unit)}  ${r.name}${r.cut?' ('+r.cut+')':''}\n   ${r.orders.join(' ')}`).join('\n')||'Nothing to prepare'}\n${l}`};
  modal(`<h2>Prep sheet</h2><p class="helper">Total to prepare per cut, for orders not yet ready.</p><div class="actions" style="justify-content:flex-start">${days.map((d,k)=>`<button data-pd="${d}">${['Today','Tomorrow','Day after'][k]}</button>`).join('')}</div><pre class="receipt" id="receiptText"></pre><div class="actions"><button onclick="closeModal()">Close</button><button class="primary" onclick="printReceipt()">Print</button></div>`);
  document.querySelectorAll('[data-pd]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-pd]').forEach(x=>x.className='');b.className='primary';draw(b.dataset.pd)});document.querySelector('[data-pd]').click()}
 function whatsapp(id){const o=db.meat_orders.find(x=>x.id===id);if(!o?.phone)return;try{window.open(SalonWhatsApp.link(SalonWhatsApp.phone(o.phone),`Hello ${o.customer}, your order #${o.number} from ${db.settings.name} is ready${o.type==='delivery'?' and will be delivered soon':' for pickup'}. Thank you!`),'_blank','noopener')}catch(e){alert(e.message)}}

 // --- carcass breakdown ------------------------------------------------------------------------------------------------------
 function breakdown(){
  const list=db.meat_breakdowns.slice().sort((a,b)=>b.at.localeCompare(a.at)),by=new Map();for(const b of list){const x=by.get(b.animal)||{n:0,w:0,u:0,c:0};x.n++;x.w+=b.weight;x.u+=b.usable;x.c+=b.cost;by.set(b.animal,x)}
  $('app').innerHTML=`<div class="layout"><section class="panel"><div class="row"><div><h2>Carcass breakdown</h2><p class="helper">Receive a whole animal by weight and cost, cut it up, and record what came out. Each cut goes into stock at the real cost per kg.</p></div><button class="primary" onclick="meatBreak()">+ New breakdown</button></div>
  ${list.slice(0,40).map(b=>`<div style="padding:12px 0;border-bottom:1px solid #eee"><div class="row"><b>${esc(b.animal)} ${esc(b.description||'')} · ${kgText(b.weight,'kg')}</b><span class="badge" style="${b.yieldPct>=80?'background:#dff3e9;color:#155e48':'background:#fdf0d8;color:#7a5200'}">Yield ${b.yieldPct}%</span></div><div class="helper">${esc(new Date(b.at).toLocaleString([], {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}${b.supplier?' · '+esc(b.supplier):''} · cost ${money(b.cost)} · ${money(b.costPerKg)} per usable kg · waste ${kgText(b.waste,'kg')}</div><div class="helper">${b.outputs.map(o=>esc(kgText(o.qty,'kg'))+' '+esc(o.name)).join(' · ')}</div></div>`).join('')||'<div class="empty">No breakdowns yet.</div>'}</section>
  <aside class="panel"><h3>Average yield</h3>${[...by].map(([a,x])=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee"><span>${esc(a)} <span class="helper">(${x.n})</span></span><span><b>${Math.round(x.u/x.w*1000)/10}%</b> · ${money(Math.round(x.c/x.u))}/kg</span></div>`).join('')||'<p class="helper">Shows after the first breakdown.</p>'}</aside></div>`;
 }
 function breakForm(){const kgItems=products().filter(p=>p.unit==='kg');if(!kgItems.length){alert('Add products sold by kg first');return}
  const row=(o={})=>`<div class="row" style="gap:6px" data-brow><select style="margin:0;flex:1" data-bitem>${kgItems.map(p=>`<option value="${esc(p.id)}" ${p.id===o.itemId?'selected':''}>${esc(p.name)}</option>`).join('')}</select><input type="number" min="0.001" step="0.001" placeholder="kg" value="${o.qty||''}" style="width:100px;margin:0" data-bqty aria-label="Weight in kg"><button type="button" onclick="this.closest('[data-brow]').remove();meatBreakCalc()">×</button></div>`;
  modal(`<h2>New carcass breakdown</h2><form id="mBr"><div class="business-grid"><div><label for="mbAnimal">Animal</label><select id="mbAnimal">${ANIMALS.map(a=>`<option>${a}</option>`).join('')}</select></div><div><label for="mbDesc">Description</label><input id="mbDesc" maxlength="100" placeholder="e.g. Local goat, Australian lamb"></div></div>
  <div class="business-grid"><div><label for="mbWeight">Carcass weight (kg)</label><input id="mbWeight" type="number" min="0.1" step="0.001" required></div><div><label for="mbCost">Total cost (AED)</label><input id="mbCost" type="number" min="0" step="0.01" required></div></div>
  <div class="business-grid"><div><label for="mbSup">Supplier</label><input id="mbSup" maxlength="100" placeholder="e.g. Al Mawashi"></div><div><label for="mbInv">Supplier invoice no.</label><input id="mbInv" maxlength="60"></div></div>
  <h3 style="margin-top:14px">Cuts that came out</h3><div id="mbRows">${row()}${row()}${row()}</div><button type="button" id="mbAdd">+ Add cut</button><p id="mbSum" style="font-size:17px"></p>
  <div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save &amp; add to stock</button></div></form>`);
  const read=()=>[...document.querySelectorAll('[data-brow]')].map(r=>({itemId:r.querySelector('[data-bitem]').value,qty:Math.round(Number(r.querySelector('[data-bqty]').value)*1000)/1000})).filter(o=>o.qty>0);
  window.meatBreakCalc=()=>{const w=Number($('mbWeight').value)||0,c=cents($('mbCost').value||'0')||0,out=read(),u=Math.round(out.reduce((n,o)=>n+o.qty,0)*1000)/1000;$('mbSum').innerHTML=w?`Cuts ${kgText(u,'kg')} of ${kgText(w,'kg')} · waste ${kgText(Math.max(0,Math.round((w-u)*1000)/1000),'kg')} · <b>yield ${Math.round(u/w*1000)/10}%</b>${u?` · <b>${money(Math.round(c/u))}</b> per usable kg`:''}${u>w*1.02?' <span class="danger">Cuts weigh more than the carcass</span>':''}`:''};
  $('mBr').addEventListener('input',meatBreakCalc);$('mBr').addEventListener('change',meatBreakCalc);$('mbAdd').onclick=()=>$('mbRows').insertAdjacentHTML('beforeend',row());
  $('mBr').onsubmit=e=>{e.preventDefault();const weight=Math.round(Number($('mbWeight').value)*1000)/1000,cost=cents($('mbCost').value),out=read();if(!(weight>0)||!Number.isSafeInteger(cost)||cost<0||!out.length){alert('Enter the carcass weight, cost and at least one cut');return}if(new Set(out.map(o=>o.itemId)).size!==out.length){alert('List each cut once (add the weights together)');return}
   const usable=out.reduce((n,o)=>n+o.qty,0);if(usable>weight*1.02){alert('The cuts weigh more than the carcass. Check the weights.');return}
   const perKg=Math.round(cost/usable),at=new Date().toISOString(),animal=$('mbAnimal').value,desc=$('mbDesc').value.trim(),sup=$('mbSup').value.trim(),inv=$('mbInv').value.trim(),branch=R.branch();
   if(change(()=>{db.meat_breakdowns.push({id:uid(),animal,description:desc,supplier:sup,invoice:inv,weight,cost,outputs:out.map(o=>({itemId:o.itemId,name:item(o.itemId).name,qty:o.qty})),usable:Math.round(usable*1000)/1000,waste:Math.max(0,Math.round((weight-usable)*1000)/1000),yieldPct:Math.round(usable/weight*1000)/10,costPerKg:perKg,at});
    for(const o of out){const it=item(o.itemId);db.grocery_stock.push({id:uid(),type:'in',itemId:it.id,item:it.name,unit:it.unit,qty:o.qty,cost:perKg,supplier:sup,invoice:inv,note:'Breakdown: '+animal+' '+weight+' kg',at,...(branch?{branch}:{})})}})){closeModal();toast('Breakdown saved · '+Math.round(usable/weight*1000)/10+'% yield')}};
 }

 Object.assign(R.screens,{Orders:orders,Breakdown:breakdown});
 Object.assign(window,{
  meatCutRow:()=>$('mCuts').insertAdjacentHTML('beforeend',cutRow()),
  meatView:v=>{orderView=v;orders()},meatSearch:v=>{orderSearch=v;orders();const el=$('moSearch');el.focus();el.setSelectionRange(v.length,v.length)},
  meatOrder:orderForm,meatStatus:setStatus,meatBill:bill,meatNote:slip,meatPrep:prep,meatWhatsApp:whatsapp,meatBreak:breakForm
 });
})();
