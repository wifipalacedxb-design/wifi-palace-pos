// Restaurant & café screens for Palace POS. Active only when the signed-in business type is "restaurant".
// Waiters: Tables → order screen → "Send to kitchen" (a KOT record; printed straight to the kitchen/bar
// printer when this device has one, e.g. the Android or Windows app). Kitchen: live ticket board.
// Counter: takeaway, delivery and bills (service charge, discount, split equally or by items).
// Owner: dashboard, menu with options, tables, service charge.
(function(){
 'use strict';
 const OWN=['Dashboard','Tables','Orders','Kitchen','Menu','Order'];
 const OWNER_ONLY=['Dashboard','Menu','Sales','Settings','Finance','Reports','Team'];
 const isRest=()=>typeof cloudUser!=='undefined'&&cloudUser?.businessType==='restaurant';
 const isOwner=()=>cloudUser?.role==='owner';
 const isWaiter=()=>!!cloudUser?.waiter; // orders only: no payments, voids or sales figures
 const tabs=()=>isOwner()?['Dashboard','Tables','Orders','Kitchen','Menu','Customers','Sales','Settings','Finance','Reports','Team','Sync centre','Account']:isWaiter()?['Tables','Orders','Sync centre','Account']:['Tables','Orders','Kitchen','Customers','My sales','Sync centre','Account'];
 const localDay=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
 const optLabel=o=>typeof o==='string'?o:o.name+(o.price?' +'+(o.price/100).toFixed(2):''); // same wording the server stores on bills
 const sig=(itemId,opts,note)=>itemId+'|'+(opts||[]).map(optLabel).join(',')+'|'+(note||'');
 const mins=t=>Math.max(0,Math.floor((Date.now()-Date.parse(t))/60000));
 const K=key=>{try{return localStorage.getItem(key)||''}catch{return ''}};
 const setK=(key,v)=>{try{v?localStorage.setItem(key,v):localStorage.removeItem(key)}catch{}};
 let current=null,stationBusy=false,drafts={},kitchenRoute=K('wifipos-kds-route')||'kitchen',seenKots=null,kdsTimer=null,orderView='Open',liveTimer=null,seenReady=null,readyFor='',lastScreen='';

 // --- data helpers ------------------------------------------------------------------------------------
 function shim(){if(db){db.services??=[];db.appointments??=[];for(const k of ['restaurant_items','restaurant_tables','restaurant_config','restaurant_orders','restaurant_kots'])db[k]??=[]}}
 const cfg=()=>db.restaurant_config.find(c=>c.id==='config')||{serviceBps:0,serviceTypes:['dine-in']};
 const orderById=id=>db.restaurant_orders.find(o=>o.id===id);
 const label=o=>o?(o.type==='dine-in'?o.table:o.type==='takeaway'?'Takeaway':'Delivery')+(o.number?' · #'+o.number:''):'';
 function familyIds(o){const ids=[o.id];for(let i=0;i<ids.length;i++)for(const m of db.restaurant_orders)if(m.mergedInto===ids[i]&&!ids.includes(m.id))ids.push(m.id);return ids}
 const kotsOf=o=>{const ids=familyIds(o);return db.restaurant_kots.filter(k=>ids.includes(k.orderId)).sort((a,b)=>a.at.localeCompare(b.at))};
 // Items on an order after voids, grouped by item + options + note.
 function orderLines(o){const m=new Map();for(const k of kotsOf(o))for(const l of k.items){const s=sig(l.itemId,l.options,l.note);const cur=m.get(s)||{sig:s,itemId:l.itemId,name:l.name,category:l.category,route:l.route,price:l.price,options:l.options||[],note:l.note||'',qty:0,keys:[],status:k.status};cur.qty+=l.qty;if(l.qty>0)cur.keys.push(l.key);if(k.type==='order')cur.status=worst(cur.status,k.status);m.set(s,cur)}return [...m.values()].filter(l=>l.qty>0)}
 const worst=(a,b)=>['new','preparing','ready','served'][Math.min(['new','preparing','ready','served'].indexOf(a),['new','preparing','ready','served'].indexOf(b))];
 const salesOf=o=>{const ids=familyIds(o);return db.sales.filter(s=>ids.includes(s.ref))};
 function billedQty(o){const m=new Map();for(const s of salesOf(o)){if(s.status!=='Paid')continue;for(const i of s.items)if(i.id!=='service'){const k=sig(i.id,i.options,i.note);m.set(k,(m.get(k)||0)+i.qty)}}return m}
 function remaining(o){const b=billedQty(o);return orderLines(o).map(l=>({...l,qty:l.qty-(b.get(l.sig)||0)})).filter(l=>l.qty>0)}
 const orderTotal=o=>orderLines(o).reduce((n,l)=>n+l.price*l.qty,0);
 const openOrders=()=>db.restaurant_orders.filter(o=>o.status==='open');

 // --- this device's kitchen/bar printers (LAN, Android & Windows apps) ------------------------------------
 const canNetPrint=()=>!!window.Android?.printNetwork;
 const routeHost=r=>r==='bar'?(K('wifipos-bar')||K('wifipos-kitchen')):r==='kitchen'?K('wifipos-kitchen'):'';
 function kotText(k,o,route,lines){const l='--------------------------------',t=new Date(k.at);return `${k.type==='void'?'*** VOID ***':route==='bar'?'BAR ORDER':'KITCHEN ORDER'}\n${label(o)||k.table||''}${o?.guests?'  · '+o.guests+' guests':''}\n${k.byName||''}  ${t.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}\n${l}\n${lines.map(x=>`${Math.abs(x.qty)} x ${x.name}${(x.options||[]).map(p=>'\n   + '+optLabel(p)).join('')}${x.note?'\n   ! '+x.note:''}`).join('\n')}\n${l}${k.type==='void'?'\nReason: '+k.reason:''}${o?.note?'\nNote: '+o.note:''}`}
 // Prints a KOT on this device's printers; returns true only if every route with items was sent.
 function printKot(k,o){if(!canNetPrint())return false;let all=true;for(const route of ['kitchen','bar']){const lines=k.items.filter(x=>x.route===route);if(!lines.length)continue;const host=routeHost(route);if(!host||!privateIp(host)){all=false;continue}Android.printNetwork('kot-'+k.id+'-'+route,host,80,kotText(k,o,route,lines),'',true)}return all}
 function printersForm(){modal(`<h2>This device · KOT printers</h2><p class="helper">Network (LAN) printers for kitchen order tickets. Works in the Palace POS Android and Windows apps. Leave empty on phones or iPhones that cannot print; the kitchen screen can print for them.</p><label for="rpK">Kitchen printer IP</label><input id="rpK" inputmode="decimal" placeholder="192.168.1.60" value="${esc(K('wifipos-kitchen'))}"><label for="rpB">Bar printer IP (empty = kitchen printer)</label><input id="rpB" inputmode="decimal" placeholder="192.168.1.61" value="${esc(K('wifipos-bar'))}"><label style="display:flex;gap:10px;align-items:center;margin-top:14px"><input id="rpS" type="checkbox" style="width:auto;margin:0" ${K('wifipos-station-print')?'checked':''}> This is the kitchen screen: print tickets sent from phones that could not print</label><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button onclick="restTestPrint()">Test print</button><button class="primary" onclick="restSavePrinters()">Save</button></div>`)}
 function savePrinters(){const k=$('rpK').value.trim(),b=$('rpB').value.trim();for(const h of [k,b])if(h&&!privateIp(h)){alert('Enter printer IPs on your shop network, e.g. 192.168.1.60');return false}setK('wifipos-kitchen',k);setK('wifipos-bar',b);setK('wifipos-station-print',$('rpS').checked?'1':'');closeModal();toast('Printers saved on this device');return true}

 // --- navigation -----------------------------------------------------------------------------------------
 function paintNav(){$('nav').innerHTML=tabs().map(t=>`<button class="${tab===t||(tab==='Order'&&t==='Tables')?'active':''}" data-cloud-tab="${esc(t)}">${esc(t)}</button>`).join('');document.querySelectorAll('[data-cloud-tab]').forEach(b=>b.onclick=()=>navigate(b.dataset.cloudTab))}
 const prevRender=render,prevNavigate=navigate;
 render=function(){
  if(!isRest()){prevRender();return}
  if(!cloudReady)return;shim();
  if(tab!=='Order'&&!tabs().includes(tab))tab=tabs()[0];
  if(tab==='Order'&&!orderById(current))tab='Tables';
  kitchenTimer(tab==='Kitchen');liveSync(['Tables','Orders','Order'].includes(tab));
  if(OWN.includes(tab)){const t=tab,same=lastScreen===t+':'+(t==='Order'?current:''),y=window.scrollY;tab='Customers';prevRender();tab=t;paintNav();document.title=db.settings.name+' | Palace POS';SCREENS[t]();lastScreen=t+':'+(t==='Order'?current:'');if(same)window.scrollTo(0,y);readyAlerts();return}
  lastScreen='';prevRender();paintNav();readyAlerts();
 };
 navigate=function(next){
  if(!isRest()){prevNavigate(next);return}
  if(!isOwner()&&OWNER_ONLY.includes(next)){alert('Owner access required');return}
  if(isWaiter()&&next!=='Order'&&!tabs().includes(next)){alert('Waiter logins can only take orders.');return}
  if(OWN.includes(next)){tab=next;render();return}
  shim();kitchenTimer(false);prevNavigate(next);paintNav();
 };
 // The kitchen screen refreshes every 5 seconds (only the changed records are downloaded).
 // Waiter and counter screens pull changes every 8 seconds while visible, so table status and "ready" show up quickly.
 function liveSync(on){if(on&&!liveTimer)liveTimer=setInterval(()=>{if(!isRest()||!cloudReady||!['Tables','Orders','Order'].includes(tab)){liveSync(false);return}if(document.visibilityState==='visible'&&!syncing&&!$('modal').open)syncNow()},8000);if(!on&&liveTimer){clearInterval(liveTimer);liveTimer=null}}
 // "Food ready" for the person who sent the ticket: sound, vibration and a bar that stays until it is served.
 function readyAlerts(){
  const old=$('readyBar');if(!cloudReady||!isRest()||tab==='Kitchen'){old?.remove();return}
  if(readyFor!==cloudUser.id){readyFor=cloudUser.id;seenReady=null}
  const mine=db.restaurant_kots.filter(k=>k.status==='ready'&&k.type!=='void'&&k.by===cloudUser.id&&Date.now()-Date.parse(k.at)<6*3600000),ids=new Set(mine.map(k=>k.id));
  if(seenReady&&mine.some(k=>!seenReady.has(k.id))){beep();try{navigator.vibrate?.([200,100,200])}catch{}const k=mine.find(x=>!seenReady.has(x.id)),o=orderById(k.orderId);toast('Ready: '+(o?label(o):k.table||'#'+k.orderNumber))}
  seenReady=ids;
  if(!mine.length){old?.remove();return}
  const html=`<b>Ready to serve</b>${mine.map(k=>{const o0=orderById(k.orderId),o=o0?.status==='merged'?orderById(o0.mergedInto)||o0:o0;return `<span style="display:inline-flex;gap:8px;align-items:center;background:#fff;border-radius:999px;padding:4px 6px 4px 14px"><span><b>${esc(o?label(o):k.table||'#'+k.orderNumber)}</b> · ${esc(k.items.map(l=>l.qty+'× '+l.name).join(', ').slice(0,60))}</span><button class="primary" style="padding:6px 12px" onclick="restServe('${esc(k.id)}')">Served</button></span>`}).join('')}`;
  const bar=old||Object.assign(document.createElement('div'),{id:'readyBar'});bar.setAttribute('role','status');bar.style.cssText='position:sticky;top:'+(($('demoBar')?.offsetHeight||0)+6)+'px;z-index:5;box-shadow:0 6px 18px rgba(0,0,0,.12);display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#dff3e9;color:#155e48;border:1px solid #a8dcc4;border-radius:14px;padding:10px 14px;margin:0 0 12px';bar.innerHTML=html;if(!old)$('app').prepend(bar);else if(bar.parentNode!==$('app')||$('app').firstChild!==bar)$('app').prepend(bar);
 }
 function kitchenTimer(on){if(on&&!kdsTimer)kdsTimer=setInterval(()=>{if(tab!=='Kitchen'){kitchenTimer(false);return}if(!syncing)syncNow().then(()=>{if(tab==='Kitchen'&&!$('modal').open)kitchen()})},5000);if(!on&&kdsTimer){clearInterval(kdsTimer);kdsTimer=null}}

 // --- tables ------------------------------------------------------------------------------------------------
 function tables(){
  const open=openOrders(),byTable=new Map(open.filter(o=>o.type==='dine-in').map(o=>[o.tableId,o])),areas=[...new Set(db.restaurant_tables.map(t=>t.area||'Tables'))],others=open.filter(o=>o.type!=='dine-in');
  $('app').innerHTML=`<div class="row"><div><h2>Tables</h2><p class="helper">${byTable.size} of ${db.restaurant_tables.length} tables occupied</p></div><div class="actions" style="margin:0"><button class="primary" onclick="restNew('takeaway')">+ Takeaway</button><button onclick="restNew('delivery')">+ Delivery</button><button onclick="restPrinters()">Printers</button></div></div>
  ${areas.map(a=>`<div class="panel"><h3>${esc(a)}</h3><div class="grid">${db.restaurant_tables.filter(t=>(t.area||'Tables')===a).map(t=>{const o=byTable.get(t.id),ready=o?kotsOf(o).filter(k=>k.status==='ready'&&k.type==='order').length:0;return `<button class="service" style="min-height:118px;${o?'border-color:#6755bc;background:#f3f0ff':''}" onclick="restTable('${esc(t.id)}')"><span>${o?(o.guests?o.guests+' guests · ':'')+mins(o.opened)+' min':(t.seats?t.seats+' seats':'')}</span><strong>${esc(t.name)}</strong><b>${o?money(orderTotal(o)):'Free'}</b>${ready?`<span style="color:#155e48;font-weight:700">● ${ready} ready to serve</span>`:''}</button>`}).join('')}</div></div>`).join('')}
  ${others.length?`<div class="panel"><h3>Takeaway & delivery</h3>${others.map(o=>`<div class="row" style="padding:10px 0;border-bottom:1px solid #eee"><div><b>${esc(label(o))}</b><div class="helper">${esc(o.customer||'')}${o.phone?' · '+esc(o.phone):''}${o.type==='delivery'?' · '+esc(o.stage==='out'?'Out for delivery':o.stage==='delivered'?'Delivered':'Preparing'):''}</div></div><div class="actions" style="margin:0"><b>${money(orderTotal(o))}</b><button onclick="restOpen('${esc(o.id)}')">Open</button></div></div>`).join('')}</div>`:''}`;
 }
 function openTable(tableId){const o=openOrders().find(x=>x.type==='dine-in'&&x.tableId===tableId);if(o){restOpen(o.id);return}
  const t=db.restaurant_tables.find(x=>x.id===tableId);if(!t)return;
  modal(`<h2>Open ${esc(t.name)}</h2><form id="rOpen"><label for="roGuests">Guests</label><input id="roGuests" type="number" min="0" max="99" value="${t.seats||2}"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Open table</button></div></form>`);
  $('rOpen').onsubmit=e=>{e.preventDefault();const o={id:uid(),type:'dine-in',tableId:t.id,table:t.name,guests:Math.max(0,Math.min(99,Number($('roGuests').value)||0)),status:'open',opened:new Date().toISOString(),openedBy:cloudUser.id,note:'',customer:'',serviceCharge:cfg().serviceTypes.includes('dine-in')&&cfg().serviceBps>0};
   if(change(()=>db.restaurant_orders.push(o))){closeModal();current=o.id;tab='Order';render()}};
 }
 function newOrder(type){
  const svc=cfg().serviceTypes.includes(type)&&cfg().serviceBps>0;
  if(type==='takeaway'){const o={id:uid(),type,status:'open',opened:new Date().toISOString(),openedBy:cloudUser.id,guests:0,note:'',customer:'',serviceCharge:svc};if(change(()=>db.restaurant_orders.push(o))){current=o.id;tab='Order';render()}return}
  modal(`<h2>New delivery</h2><form id="rDel"><label for="rdPick">Customer</label><select id="rdPick"><option value="">New customer</option>${db.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.phone?' · '+esc(c.phone):''}</option>`).join('')}</select><label for="rdName">Name</label><input id="rdName" maxlength="100" required><label for="rdPhone">Mobile</label><input id="rdPhone" type="tel" maxlength="40" required><label for="rdAddr">Address</label><input id="rdAddr" maxlength="300" required placeholder="Building, flat, area"><label for="rdDriver">Driver (optional)</label><input id="rdDriver" maxlength="100"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Start order</button></div></form>`);
  $('rdPick').onchange=e=>{const c=db.customers.find(x=>x.id===e.target.value);if(c){$('rdName').value=c.name;$('rdPhone').value=c.phone||''}};
  $('rDel').onsubmit=e=>{e.preventDefault();const o={id:uid(),type:'delivery',status:'open',opened:new Date().toISOString(),openedBy:cloudUser.id,guests:0,note:'',customer:$('rdName').value.trim(),phone:$('rdPhone').value.trim(),address:$('rdAddr').value.trim(),driver:$('rdDriver').value.trim(),stage:'preparing',serviceCharge:svc};if(!o.customer||!o.phone||!o.address)return;
   if(change(()=>db.restaurant_orders.push(o))){closeModal();current=o.id;tab='Order';render()}};
 }

 // --- order screen ----------------------------------------------------------------------------------------------
 const draft=()=>drafts[current]??=[];
 function orderScreen(){
  const o=orderById(current);if(!o){tab='Tables';render();return}
  const items=db.restaurant_items.filter(i=>!i.system&&i.available!==false),cats=[...new Set(items.map(i=>i.category))],lines=orderLines(o),d=draft(),dTotal=d.reduce((n,l)=>n+l.price*l.qty,0),rem=remaining(o),billed=salesOf(o).filter(s=>s.status==='Paid');
  const badge=s=>`<span class="badge" style="${s==='ready'?'background:#dff3e9;color:#155e48':s==='served'?'background:#eceaf3;color:#555':s==='preparing'?'background:#fdf0d8;color:#7a5200':''}">${esc(s==='new'?'Sent':s[0].toUpperCase()+s.slice(1))}</span>`;
  $('app').innerHTML=`<div class="row"><div><button onclick="navigate('Tables')">← Tables</button> <b style="font-size:22px;margin-left:10px">${esc(label(o))}</b> <span class="helper">${o.guests?o.guests+' guests · ':''}${esc(o.customer||'')}${o.type==='delivery'?' · '+esc(o.address||''):''}</span></div><div class="actions" style="margin:0">${o.type==='dine-in'?`<button onclick="restMove()">Move table</button><button onclick="restMerge()">Merge</button>`:''}${o.type==='delivery'?`<button onclick="restStage()">${o.stage==='out'?'Mark delivered':o.stage==='delivered'?'Delivered ✓':'Out for delivery'}</button>`:''}<button onclick="restNote()">Note</button>${isWaiter()?'':'<button class="danger" onclick="restCancel()">Cancel order</button>'}</div></div>
  <div class="layout"><section>${cats.map(c=>`<div class="panel"><h3>${esc(c)}</h3><div class="grid">${items.filter(i=>i.category===c).map(i=>`<button class="service" onclick="restPick('${esc(i.id)}')"><span>${esc(i.route==='bar'?'Bar':i.route==='none'?'No ticket':'Kitchen')}</span><strong>${esc(i.name)}</strong><b>${money(i.price)}</b></button>`).join('')}</div></div>`).join('')||'<div class="panel empty">Add dishes on the Menu first.</div>'}</section>
  <aside class="panel"><h3>New round</h3>${d.length?d.map((l,k)=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee;gap:6px"><div style="flex:1"><b>${esc(l.name)}</b>${l.options.length?`<div class="helper">${esc(l.options.map(optLabel).join(', '))}</div>`:''}${l.note?`<div class="helper">! ${esc(l.note)}</div>`:''}</div><button aria-label="Less" onclick="restDraftQty(${k},-1)">−</button><b>${l.qty}</b><button aria-label="More" onclick="restDraftQty(${k},1)">+</button></div>`).join('')+`<div class="row"><span>Round</span><b>${money(dTotal)}</b></div><button class="primary" style="width:100%" onclick="restSend()">Send to kitchen</button><button class="primary" id="restSendFloat" onclick="restSend()" style="position:fixed;left:12px;right:12px;bottom:12px;z-index:20;padding:16px;font-size:17px;box-shadow:0 8px 24px rgba(0,0,0,.25);display:${window.innerWidth<900?'block':'none'}">Send to kitchen · ${d.reduce((n,l)=>n+l.qty,0)} item${d.reduce((n,l)=>n+l.qty,0)===1?'':'s'} · ${money(dTotal)}</button>`:'<div class="empty">Tap dishes to add them.</div>'}
  <h3 style="margin-top:20px">On this order</h3>${lines.length?lines.map(l=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee;gap:6px"><div style="flex:1"><b>${l.qty} × ${esc(l.name)}</b>${l.options.length?`<div class="helper">${esc(l.options.map(optLabel).join(', '))}</div>`:''}${l.note?`<div class="helper">! ${esc(l.note)}</div>`:''}</div>${badge(l.status)}<span>${money(l.price*l.qty)}</span>${isWaiter()?'':`<button aria-label="Void" title="Void" onclick="restVoid('${esc(l.sig)}')">×</button>`}</div>`).join(''):'<div class="empty">Nothing sent yet.</div>'}
  <div class="row total"><b>Order total</b><b>${money(orderTotal(o))}</b></div>${billed.length?`<p class="helper">Billed so far: ${billed.map(s=>esc(s.number)+' '+money(s.total)).join(', ')}</p>`:''}
  ${isWaiter()?'<p class="helper" style="margin-top:10px">To change sent items or take payment, ask the counter.</p>':`<button class="primary" style="width:100%;margin-top:10px" onclick="restBill()" ${rem.length?'':'disabled'}>Bill ${rem.length?'· '+money(rem.reduce((n,l)=>n+l.price*l.qty,0)):''}</button>${!rem.length&&lines.length?`<button style="width:100%;margin-top:8px" onclick="restClose()">Fully paid · close order</button>`:''}`}</aside></div>`;
 }
 function pick(id){const i=db.restaurant_items.find(x=>x.id===id);if(!i)return;
  if(!(i.options||[]).length){const same=draft().find(l=>l.itemId===i.id&&!l.options.length&&!l.note);if(same)same.qty++;else draft().push({key:uid(),itemId:i.id,name:i.name,category:i.category,route:i.route,price:i.price,options:[],note:'',qty:1});orderScreen();return}
  modal(`<h2>${esc(i.name)}</h2><form id="rPick">${i.options.map(o=>`<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" value="${esc(o.id)}" style="width:auto;margin:0"> ${esc(o.name)}${o.price?' <span class="helper">+'+money(o.price)+'</span>':''}</label>`).join('')}<label for="rpNote">Note for the kitchen</label><input id="rpNote" maxlength="100" placeholder="e.g. well done, less salt"><label for="rpQty">Quantity</label><input id="rpQty" type="number" min="1" max="99" value="1"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Add</button></div></form>`);
  $('rPick').onsubmit=e=>{e.preventDefault();const opts=[...document.querySelectorAll('#rPick input[type=checkbox]:checked')].map(c=>i.options.find(o=>o.id===c.value)).filter(Boolean),qty=Math.max(1,Math.min(99,Math.round(Number($('rpQty').value)||1)));draft().push({key:uid(),itemId:i.id,name:i.name,category:i.category,route:i.route,price:i.price+opts.reduce((n,o)=>n+o.price,0),options:opts.map(o=>({id:o.id,name:o.name,price:o.price})),note:$('rpNote').value.trim(),qty});closeModal();orderScreen()};
 }
 function send(){const o=orderById(current),d=draft();if(!o||!d.length)return;
  const k={id:uid(),orderId:o.id,orderNumber:o.number||0,type:'order',table:o.table||'',orderType:o.type,items:d.map(l=>({...l})),reason:'',status:'new',at:new Date().toISOString(),by:cloudUser.id,byName:cloudUser.name||'',printAtStation:false};
  const printed=printKot(k,o);k.printAtStation=!printed&&k.items.some(l=>l.route!=='none');
  // Draft lines carry option objects; the server re-prices them from the menu.
  const rec={...k,items:k.items.map(l=>({key:l.key,itemId:l.itemId,name:l.name,category:l.category,route:l.route,price:l.price,options:l.options,note:l.note,qty:l.qty}))};
  if(change(()=>db.restaurant_kots.push(rec))){drafts[current]=[];toast(printed?'Sent and printed':'Sent to kitchen');orderScreen()}
 }
 function voidLine(s){const o=orderById(current),l=orderLines(o).find(x=>x.sig===s);if(!l)return;
  modal(`<h2>Void ${esc(l.name)}</h2><p>${l.qty} on the order${l.status!=='new'?' · the kitchen may have started it':''}.</p><form id="rVoid"><label for="rvQty">Quantity to remove</label><input id="rvQty" type="number" min="1" max="${l.qty}" value="1"><label for="rvWhy">Reason</label><input id="rvWhy" maxlength="200" required placeholder="e.g. customer changed mind, wrong item"><div class="actions"><button type="button" onclick="closeModal()">Back</button><button class="danger">Void</button></div></form>`);
  $('rVoid').onsubmit=e=>{e.preventDefault();const q=Math.max(1,Math.min(l.qty,Math.round(Number($('rvQty').value)||1))),why=$('rvWhy').value.trim();if(!why)return;
   const k={id:uid(),orderId:o.id,orderNumber:o.number||0,type:'void',table:o.table||'',orderType:o.type,items:[{key:l.keys.at(-1)||uid(),itemId:l.itemId,name:l.name,category:l.category,route:l.route,price:l.price,options:l.options,note:l.note,qty:-q}],reason:why,status:'new',at:new Date().toISOString(),by:cloudUser.id,byName:cloudUser.name||'',printAtStation:false};
   const printed=l.route==='none'||printKot(k,o);k.printAtStation=!printed;if(change(()=>db.restaurant_kots.push(k))){closeModal();toast('Voided');orderScreen()}};
 }
 const editOrder=(fn,msg)=>{if(change(()=>{const o=orderById(current);if(!o)throw Error('Order not found');fn(o)})){closeModal();if(msg)toast(msg);render()}};
 function move(){const o=orderById(current),busy=new Set(openOrders().filter(x=>x.type==='dine-in').map(x=>x.tableId)),free=db.restaurant_tables.filter(t=>!busy.has(t.id));
  modal(`<h2>Move ${esc(o.table)}</h2>${free.length?`<div class="grid">${free.map(t=>`<button class="service" onclick="restMoveTo('${esc(t.id)}')"><strong>${esc(t.name)}</strong><span>${esc(t.area||'')}</span></button>`).join('')}</div>`:'<p>No free tables.</p>'}<div class="actions"><button onclick="closeModal()">Cancel</button></div>`)}
 function merge(){const o=orderById(current),others=openOrders().filter(x=>x.type==='dine-in'&&x.id!==o.id);
  modal(`<h2>Merge ${esc(o.table)} into…</h2><p class="helper">All items and bills of ${esc(o.table)} move to the table you choose; ${esc(o.table)} becomes free.</p>${others.length?others.map(x=>`<div class="row"><b>${esc(label(x))}</b><button class="primary" onclick="restMergeInto('${esc(x.id)}')">Merge here</button></div>`).join(''):'<p>No other open tables.</p>'}<div class="actions"><button onclick="closeModal()">Cancel</button></div>`)}

 // --- bill -----------------------------------------------------------------------------------------------------------
 function bill(){
  const o=orderById(current),rem=remaining(o);if(!rem.length)return;
  const c=cfg(),svcDefault=o.serviceCharge&&c.serviceBps>0;
  modal(`<h2>Bill · ${esc(label(o))}</h2><div class="actions" style="justify-content:flex-start"><button id="rbAll" class="primary">Whole bill</button><button id="rbItems">Split by items</button><button id="rbEqual">Split equally</button></div><div id="rbBody"></div>`);
  let mode='all',sel=Object.fromEntries(rem.map(l=>[l.sig,l.qty])),people=2,svc=svcDefault,disc=0;
  const draw=()=>{for(const [id,m] of [['rbAll','all'],['rbItems','items'],['rbEqual','equal']])$(id).className=mode===m?'primary':'';
   const lines=rem.map(l=>({...l,qty:mode==='items'?Math.min(l.qty,sel[l.sig]||0):l.qty})).filter(l=>l.qty>0),food=lines.reduce((n,l)=>n+l.price*l.qty,0),svcAmt=svc&&c.serviceBps?Math.round(food*c.serviceBps/10000):0,sub=food+svcAmt,off=Math.min(disc,sub),tax=Math.round((sub-off)*db.settings.tax/100),total=sub-off+tax;
   $('rbBody').innerHTML=`${rem.map(l=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee"><span>${mode==='items'?`<input type="number" min="0" max="${l.qty}" value="${sel[l.sig]||0}" style="width:64px;margin:0 8px 0 0" data-sel="${esc(l.sig)}">of ${l.qty} × `:l.qty+' × '}${esc(l.name)}${l.options.length?' <span class="helper">('+esc(l.options.map(optLabel).join(', '))+')</span>':''}</span><span>${money(l.price*l.qty)}</span></div>`).join('')}
   ${c.serviceBps?`<label style="display:flex;gap:10px;align-items:center;margin-top:12px"><input id="rbSvc" type="checkbox" style="width:auto;margin:0" ${svc?'checked':''}> Service charge ${c.serviceBps/100}%</label>`:''}<label for="rbDisc">Discount (AED)</label><input id="rbDisc" type="number" min="0" step="0.01" value="${(disc/100).toFixed(2)}">
   ${mode==='equal'?`<label for="rbPeople">Split between</label><input id="rbPeople" type="number" min="2" max="20" value="${people}">`:''}
   <div class="row"><span>Items</span><span>${money(food)}</span></div>${svcAmt?`<div class="row"><span>Service charge</span><span>${money(svcAmt)}</span></div>`:''}${off?`<div class="row"><span>Discount</span><span>−${money(off)}</span></div>`:''}${tax?`<div class="row"><span>VAT ${db.settings.tax}%</span><span>${money(tax)}</span></div>`:''}<div class="row total"><b>Total</b><b>${money(total)}</b></div>${mode==='equal'?`<p><b>${people} × ${money(Math.floor(total/people))}</b>${total%people?' (+'+money(total%people)+' on the first)':''} · one tax invoice, paid in parts</p>`:''}
   <div id="rbPay"></div><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary" id="rbGo" ${lines.length?'':'disabled'}>Take payment</button></div>`;
   document.querySelectorAll('[data-sel]').forEach(i=>i.onchange=e=>{sel[e.target.dataset.sel]=Math.max(0,Math.min(Number(e.target.max),Math.round(Number(e.target.value)||0)));draw()});
   if($('rbSvc'))$('rbSvc').onchange=e=>{svc=e.target.checked;draw()};$('rbDisc').onchange=e=>{disc=Math.max(0,cents(e.target.value)||0);draw()};if($('rbPeople'))$('rbPeople').onchange=e=>{people=Math.max(2,Math.min(20,Math.round(Number(e.target.value)||2)));draw()};
   $('rbGo').onclick=()=>pay(o,lines,svcAmt,off,tax,total,mode==='equal'?people:1);
  };
  $('rbAll').onclick=()=>{mode='all';draw()};$('rbItems').onclick=()=>{mode='items';sel=Object.fromEntries(rem.map(l=>[l.sig,0]));draw()};$('rbEqual').onclick=()=>{mode='equal';draw()};draw();
 }
 function pay(o,lines,svcAmt,off,tax,total,parts){
  const each=Array.from({length:parts},(_,i)=>Math.floor(total/parts)+(i===0?total%parts:0));
  $('rbBody').innerHTML=`<h3>Payment · ${money(total)}</h3>${each.map((a,i)=>`<div class="row" style="gap:8px"><span>${parts>1?'Guest '+(i+1)+' · ':''}${money(a)}</span><select data-part="${i}" style="max-width:160px;margin:0"><option>Cash</option><option value="Card">Card</option></select></div>`).join('')}<label for="rbCash">Cash received for cash parts (AED)</label><input id="rbCash" type="number" min="0" step="0.01"><p id="rbChange" class="helper"></p><div class="actions"><button type="button" onclick="restBill()">Back</button><button class="primary" id="rbConfirm">Confirm payment</button></div>`;
  const methods=()=>[...document.querySelectorAll('[data-part]')].map(s=>s.value),cashDue=()=>methods().reduce((n,m,i)=>n+(m==='Cash'?each[i]:0),0);
  const show=()=>{const due=cashDue(),r=cents($('rbCash').value||'0');$('rbCash').disabled=!due;if(due&&!$('rbCash').value)$('rbCash').value=(due/100).toFixed(2);$('rbChange').textContent=due?(cents($('rbCash').value)>=due?'Change: '+money(cents($('rbCash').value)-due):'Cash received must cover '+money(due)):'All card'};
  document.querySelectorAll('[data-part]').forEach(s=>s.onchange=()=>{$('rbCash').value='';show()});$('rbCash').oninput=show;show();
  $('rbConfirm').onclick=()=>{const cash=cashDue(),card=total-cash,cashIn=cash?cents($('rbCash').value):0;if(cash&&(!Number.isSafeInteger(cashIn)||cashIn<cash)){alert('Cash received must cover the cash part');return}if(card&&!confirm('Confirm '+money(card)+' was approved on your card terminal?'))return;
   const method=cash&&card?'Split':cash?'Cash':'Card (external terminal)',items=lines.map(l=>({id:l.itemId,name:l.name,category:l.category,price:l.price,qty:l.qty,...(l.options.length?{options:l.options}:{}),...(l.note?{note:l.note}:{})}));
   if(svcAmt)items.push({id:'service',name:'Service charge',category:'Charges',price:svcAmt,qty:1});
   const sub=items.reduce((n,i)=>n+i.price*i.qty,0),received=cashIn+card;
   const sale={id:uid(),number:'SD-'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+uid().slice(-3).toUpperCase(),date:new Date().toISOString(),items,sub,off,tax,total,customer:o.customer||'Walk-in customer',customerId:'',staff:cloudUser.name||'Staff',staffId:'',commissionBps:0,method,...(method==='Split'?{cashAmount:cash,cardAmount:card}:{cashAmount:cash,cardAmount:card}),cashReceived:cashIn,received,change:received-total,shop:{...db.settings},status:'Paid',ref:o.id,...(parts>1?{splitParts:parts}:{})};
   if(change(()=>{db.sales.push(sale);const cur=orderById(o.id);if(cur&&!remaining(cur).length){cur.status='closed';if(cur.type==='delivery')cur.stage='delivered'}})){closeModal();const closed=orderById(o.id)?.status==='closed';if(closed&&tab==='Order')tab=o.type==='dine-in'?'Tables':'Orders';render();receipt(sale.id)}};
 }

 // --- kitchen display --------------------------------------------------------------------------------------------------
 function beep(){try{const a=new (window.AudioContext||window.webkitAudioContext)(),o=a.createOscillator(),g=a.createGain();o.frequency.value=880;o.connect(g);g.connect(a.destination);g.gain.value=0.15;o.start();o.stop(a.currentTime+0.25)}catch{}}
 function kitchen(){
  const route=kitchenRoute,active=db.restaurant_kots.filter(k=>k.status!=='served'&&(k.type==='void'?Date.now()-Date.parse(k.at)<3600000:true)).filter(k=>route==='all'||k.items.some(l=>l.route===route)).sort((a,b)=>a.at.localeCompare(b.at));
  const ids=new Set(active.map(k=>k.id));if(seenKots&&[...ids].some(id=>!seenKots.has(id)))beep();seenKots=ids;
  // Station printing: this kitchen screen prints tickets from phones that could not print themselves.
  // Mark first (one change), then print, so a re-render during printing never prints a ticket twice.
  if(K('wifipos-station-print')&&canNetPrint()&&!stationBusy){const due=db.restaurant_kots.filter(k=>k.printAtStation&&!k.stationPrinted&&Date.now()-Date.parse(k.at)<6*3600000).map(k=>k.id);
   if(due.length){stationBusy=true;try{const ok=change(()=>{for(const id of due){const cur=db.restaurant_kots.find(x=>x.id===id);if(cur)cur.stationPrinted=true}});if(ok)for(const id of due){const k=db.restaurant_kots.find(x=>x.id===id);if(k)printKot(k,orderById(k.orderId))}}finally{stationBusy=false}}}
  const age=m=>m>=20?'#c44':m>=10?'#d69a2d':'#2f9b73';
  $('app').innerHTML=`<div class="row"><h2>Kitchen</h2><div class="actions" style="margin:0">${[['kitchen','Kitchen'],['bar','Bar'],['all','All']].map(([r,l])=>`<button class="${route===r?'primary':''}" onclick="restRoute('${r}')">${l}</button>`).join('')}<button onclick="restPrinters()">Printers</button></div></div><p class="helper">Refreshes every 5 seconds · ${active.filter(k=>k.status==='new').length} new · ${active.filter(k=>k.status==='preparing').length} preparing · ${active.filter(k=>k.status==='ready').length} ready</p>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${active.map(k=>{const m=mins(k.at),lines=k.items.filter(l=>route==='all'||l.route===route),o0=orderById(k.orderId),o=o0?.status==='merged'?orderById(o0.mergedInto)||o0:o0;return `<div class="panel" style="margin:0;border-top:6px solid ${k.type==='void'?'#c44':age(m)}"><div class="row"><b style="font-size:18px">${esc(o?label(o):k.table||'#'+k.orderNumber)}</b><span style="color:${age(m)};font-weight:700">${m} min</span></div>${k.type==='void'?`<p style="color:#c44;font-weight:700">VOID · ${esc(k.reason)}</p>`:''}<div class="helper">${esc(k.byName||'')} · ${esc(new Date(k.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</div>${lines.map(l=>`<div style="margin:8px 0;font-size:17px${k.type==='void'?';text-decoration:line-through':''}"><b>${Math.abs(l.qty)} ×</b> ${esc(l.name)}${(l.options||[]).map(p=>`<div class="helper">+ ${esc(optLabel(p))}</div>`).join('')}${l.note?`<div style="color:#7a5200">! ${esc(l.note)}</div>`:''}</div>`).join('')}${o?.note?`<p class="helper">Note: ${esc(o.note)}</p>`:''}<div class="actions" style="margin:6px 0 0">${k.type==='void'?`<button onclick="restKot('${esc(k.id)}','served')">OK</button>`:k.status==='new'?`<button onclick="restKot('${esc(k.id)}','preparing')">Start</button><button class="primary" onclick="restKot('${esc(k.id)}','ready')">Ready</button>`:k.status==='preparing'?`<button class="primary" onclick="restKot('${esc(k.id)}','ready')">Ready</button>`:`<span class="badge" style="background:#dff3e9;color:#155e48">Ready</span><button onclick="restKot('${esc(k.id)}','served')">Served</button>`}</div></div>`}).join('')||'<div class="panel empty">No open tickets. 👨‍🍳</div>'}</div>`;
 }

 // --- orders list ------------------------------------------------------------------------------------------------------
 function orders(){
  const today=localDay(),list=db.restaurant_orders.filter(o=>orderView==='Open'?o.status==='open':localDay(new Date(o.closedAt||o.opened))===today&&o.status!=='open').sort((a,b)=>(b.opened).localeCompare(a.opened));
  $('app').innerHTML=`<div class="panel"><div class="row"><h2>Orders</h2><div class="actions" style="margin:0"><button class="${orderView==='Open'?'primary':''}" onclick="restOrders('Open')">Open (${openOrders().length})</button><button class="${orderView==='Today'?'primary':''}" onclick="restOrders('Today')">Closed today</button><button onclick="restNew('takeaway')">+ Takeaway</button><button onclick="restNew('delivery')">+ Delivery</button></div></div>
  ${list.map(o=>`<div class="row" style="padding:10px 0;border-bottom:1px solid #eee;flex-wrap:wrap;gap:10px"><div style="min-width:180px"><b>${esc(label(o))}</b><div class="helper">${esc(o.type)}${o.customer?' · '+esc(o.customer):''} · ${esc(new Date(o.opened).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</div></div><span class="badge">${esc(o.status)}</span><b>${money(orderTotal(o))}</b><div class="actions" style="margin:0">${o.status==='open'?`<button onclick="restOpen('${esc(o.id)}')">Open</button>`:salesOf(o).map(s=>`<button onclick="receipt('${esc(s.id)}')">${esc(s.number)}</button>`).join('')}${o.status==='closed'&&isOwner()?`<button onclick="restReopen('${esc(o.id)}')">Reopen</button>`:''}</div></div>`).join('')||'<div class="empty">No orders here.</div>'}</div>`;
 }

 // --- dashboard (owner) ----------------------------------------------------------------------------------------------------
 function dashboard(){
  const today=localDay(),todayOrders=db.restaurant_orders.filter(o=>localDay(new Date(o.opened))===today&&o.status!=='merged'&&o.status!=='cancelled'),collected=TrendCharts.collections(db.sales)(today),bills=db.sales.filter(s=>localDay(new Date(s.date))===today&&s.status==='Paid'),avg=bills.length?Math.round(bills.reduce((n,s)=>n+s.total,0)/bills.length):0,pending=db.restaurant_kots.filter(k=>['new','preparing'].includes(k.status)&&k.type==='order').length;
  const top=new Map();for(const k of db.restaurant_kots)if(localDay(new Date(k.at))===today)for(const l of k.items)top.set(l.name,(top.get(l.name)||0)+l.qty);const best=[...top].filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,8);
  $('app').innerHTML=`<div class="hero"><div><div class="eyebrow">${esc(new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}).toUpperCase())}</div><h2 style="margin-top:14px">Full tables, happy guests.</h2><p>${esc(db.settings.name)} · today at a glance.</p></div><button onclick="navigate('Tables')">Tables →</button></div>
  <div class="kpis"><div class="kpi"><div class="dot"></div><small>Today’s net collections</small><div class="metric">${money(collected)}</div><span class="helper">After refunds</span></div><div class="kpi"><div class="dot" style="background:#e3ba98"></div><small>Orders today</small><div class="metric">${todayOrders.length}</div><span class="helper">${openOrders().length} open now</span></div><div class="kpi"><div class="dot" style="background:#95bbb0"></div><small>Average bill</small><div class="metric">${money(avg)}</div><span class="helper">${bills.length} bills</span></div><div class="kpi"><div class="dot" style="background:#d98a8a"></div><small>Kitchen queue</small><div class="metric">${pending}</div><span class="helper">Tickets not ready</span></div></div>
  ${TrendCharts.section([{id:'rcCash',title:'Net collections (AED)',value:TrendCharts.collections(db.sales),money:true},{id:'rcOrders',title:'Orders',value:TrendCharts.countBy(db.restaurant_orders.filter(o=>o.status!=='merged'&&o.status!=='cancelled'),o=>o.opened)}],'render')}
  <div class="layout"><section class="panel"><h3>Best sellers today</h3>${best.length?best.map(([n,q])=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee"><span>${esc(n)}</span><b>${q}</b></div>`).join(''):'<div class="empty">No orders yet today.</div>'}</section><aside class="panel"><h3>Open now</h3>${openOrders().slice(0,10).map(o=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee"><span>${esc(label(o))}</span><span>${money(orderTotal(o))} <button onclick="restOpen('${esc(o.id)}')">Open</button></span></div>`).join('')||'<div class="empty">No open orders.</div>'}</aside></div>`;
  TrendCharts.wire();
 }

 // --- menu, tables, service charge (owner) ----------------------------------------------------------------------------------
 function menu(){
  const c=cfg(),cats=[...new Set(db.restaurant_items.filter(i=>!i.system).map(i=>i.category))];
  $('app').innerHTML=`<div class="layout"><section class="panel"><div class="row"><h2>Menu</h2><button class="primary" onclick="restItem()">+ Add dish</button></div><p class="helper">Prices before VAT. "Kitchen" and "Bar" dishes print a ticket on that printer; "No ticket" items (e.g. canned drinks) go straight to the bill. Tap Available to mark a dish sold out.</p>${cats.map(cat=>`<h3>${esc(cat)}</h3>${db.restaurant_items.filter(i=>!i.system&&i.category===cat).map(i=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #eee"><span><b>${esc(i.name)}</b> <span class="helper">${esc(i.route==='bar'?'Bar':i.route==='none'?'No ticket':'Kitchen')}${(i.options||[]).length?' · '+i.options.length+' options':''}</span></span><span>${money(i.price)} <button onclick="restAvail('${esc(i.id)}')">${i.available===false?'Sold out':'Available'}</button> <button onclick="restItem('${esc(i.id)}')">Edit</button></span></div>`).join('')}`).join('')}</section>
  <aside><div class="panel"><div class="row"><h3>Tables</h3><button onclick="restTableForm()">+ Add</button></div>${db.restaurant_tables.map(t=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee"><span>${esc(t.name)} <span class="helper">${esc(t.area||'')}${t.seats?' · '+t.seats+' seats':''}</span></span><button onclick="restTableForm('${esc(t.id)}')">Edit</button></div>`).join('')}</div>
  <div class="panel"><h3>Service charge</h3><form id="rSvc"><label for="rsPct">Percent</label><input id="rsPct" type="number" min="0" max="30" step="0.5" value="${c.serviceBps/100}">${['dine-in','takeaway','delivery'].map(t=>`<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" value="${t}" style="width:auto;margin:0" ${c.serviceTypes.includes(t)?'checked':''}> Add to ${t} bills by default</label>`).join('')}<button class="primary" style="margin-top:12px">Save</button></form><p class="helper">Staff can switch it off on a bill. It is a separate line on the tax invoice, with VAT.</p></div></aside></div>`;
  $('rSvc').onsubmit=e=>{e.preventDefault();const v={id:'config',serviceBps:Math.round(Number($('rsPct').value)*100),serviceTypes:[...document.querySelectorAll('#rSvc input[type=checkbox]:checked')].map(x=>x.value)};if(!(v.serviceBps>=0&&v.serviceBps<=3000)){alert('Enter 0 to 30%');return}if(change(()=>{const k=db.restaurant_config.findIndex(x=>x.id==='config');if(k>=0)db.restaurant_config[k]=v;else db.restaurant_config.push(v)}))toast('Service charge saved')};
 }
 function itemForm(id){
  const i=db.restaurant_items.find(x=>x.id===id)||{name:'',category:'Mains',price:0,route:'kitchen',options:[],available:true};let opts=(i.options||[]).map(o=>({...o}));
  const drawOpts=()=>{$('riOpts').innerHTML=opts.map((o,k)=>`<div class="row" style="gap:6px"><input value="${esc(o.name)}" placeholder="Option, e.g. Extra cheese" maxlength="60" data-on="${k}" style="margin:0"><input type="number" min="0" step="0.01" value="${(o.price/100).toFixed(2)}" data-op="${k}" style="width:100px;margin:0"><button type="button" onclick="this.dispatchEvent(new CustomEvent('rm',{bubbles:true,detail:${k}}))">×</button></div>`).join('')||'<p class="helper">No options.</p>';
   document.querySelectorAll('[data-on]').forEach(x=>x.oninput=e=>{opts[e.target.dataset.on].name=e.target.value});document.querySelectorAll('[data-op]').forEach(x=>x.oninput=e=>{opts[e.target.dataset.op].price=cents(e.target.value)||0})};
  modal(`<h2>${id?'Edit dish':'Add dish'}</h2><form id="rItem"><label for="riName">Name</label><input id="riName" value="${esc(i.name)}" maxlength="100" required><div class="business-grid"><div><label for="riCat">Category</label><input id="riCat" value="${esc(i.category)}" maxlength="50" required list="riCats"><datalist id="riCats">${[...new Set(db.restaurant_items.filter(x=>!x.system).map(x=>x.category))].map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div><div><label for="riPrice">Price before VAT (AED)</label><input id="riPrice" type="number" min="0" step="0.01" value="${(i.price/100).toFixed(2)}" required></div></div><label for="riRoute">Ticket goes to</label><select id="riRoute"><option value="kitchen" ${i.route==='kitchen'?'selected':''}>Kitchen</option><option value="bar" ${i.route==='bar'?'selected':''}>Bar</option><option value="none" ${i.route==='none'?'selected':''}>No ticket</option></select><h3 style="margin-top:16px">Options</h3><div id="riOpts"></div><button type="button" id="riAdd">+ Add option</button><div class="actions">${id?`<button type="button" class="danger" onclick="restItemDelete('${esc(id)}')">Delete</button>`:''}<button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save dish</button></div></form>`);
  drawOpts();$('riAdd').onclick=()=>{opts.push({id:uid(),name:'',price:0});drawOpts()};$('riOpts').addEventListener('rm',e=>{opts.splice(e.detail,1);drawOpts()});
  $('rItem').onsubmit=e=>{e.preventDefault();const v={id:id||uid(),name:$('riName').value.trim(),category:$('riCat').value.trim(),price:cents($('riPrice').value),route:$('riRoute').value,options:opts.filter(o=>o.name.trim()).map(o=>({id:o.id,name:o.name.trim(),price:o.price||0})),available:i.available!==false};if(!v.name||!v.category||!Number.isSafeInteger(v.price)||v.price<0){alert('Check the name, category and price');return}
   if(change(()=>{const k=db.restaurant_items.findIndex(x=>x.id===v.id);if(k>=0)db.restaurant_items[k]=v;else db.restaurant_items.push(v)})){closeModal();toast('Menu saved')}};
 }
 function tableForm(id){const t=db.restaurant_tables.find(x=>x.id===id)||{name:'Table '+(db.restaurant_tables.length+1),area:'Indoor',seats:4};
  modal(`<h2>${id?'Edit table':'Add table'}</h2><form id="rTab"><label for="rtName">Name</label><input id="rtName" value="${esc(t.name)}" maxlength="40" required><label for="rtArea">Area</label><input id="rtArea" value="${esc(t.area||'')}" maxlength="40" placeholder="Indoor, Terrace, Family"><label for="rtSeats">Seats</label><input id="rtSeats" type="number" min="0" max="50" value="${t.seats||0}"><div class="actions">${id?`<button type="button" class="danger" onclick="restTableDelete('${esc(id)}')">Delete</button>`:''}<button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save</button></div></form>`);
  $('rTab').onsubmit=e=>{e.preventDefault();const v={id:id||uid(),name:$('rtName').value.trim(),area:$('rtArea').value.trim(),seats:Math.max(0,Math.min(50,Math.round(Number($('rtSeats').value)||0)))};if(!v.name)return;if(change(()=>{const k=db.restaurant_tables.findIndex(x=>x.id===v.id);if(k>=0)db.restaurant_tables[k]=v;else db.restaurant_tables.push(v)})){closeModal();toast('Table saved')}};
 }

 const SCREENS={'Dashboard':dashboard,'Tables':tables,'Orders':orders,'Kitchen':kitchen,'Menu':menu,'Order':orderScreen};
 Object.assign(window,{
  restTable:openTable,restNew:newOrder,restOpen:id=>{current=id;tab='Order';render()},restPick:pick,restSend:send,restVoid:voidLine,restBill:bill,
  restDraftQty:(k,d)=>{const l=draft()[k];if(!l)return;l.qty+=d;if(l.qty<1)draft().splice(k,1);orderScreen()},
  restMove:move,restMoveTo:tid=>{const t=db.restaurant_tables.find(x=>x.id===tid);editOrder(o=>{o.tableId=t.id;o.table=t.name},'Moved to '+t.name)},
  restMerge:merge,restMergeInto:target=>{const into=orderById(target);editOrder(o=>{o.status='merged';o.mergedInto=target},'Merged into '+label(into));current=target;tab='Order';render()},
  restNote:()=>{const o=orderById(current);const n=prompt('Note for this order (shown on tickets):',o?.note||'');if(n!==null)editOrder(x=>{x.note=n.trim().slice(0,200)},'Note saved')},
  restStage:()=>{const o=orderById(current);if(!o||o.stage==='delivered')return;editOrder(x=>{x.stage=x.stage==='out'?'delivered':'out'},o.stage==='out'?'Delivered':'Out for delivery')},
  restCancel:()=>{const o=orderById(current);if(!o)return;const hasItems=orderLines(o).length>0;if(hasItems&&!isOwner()){alert('Void the items first, or ask the owner to cancel this order.');return}const why=prompt('Reason for cancelling '+label(o)+':');if(!why?.trim())return;editOrder(x=>{x.status='cancelled';x.cancelReason=why.trim()},'Order cancelled');tab='Tables';render()},
  restClose:()=>{editOrder(x=>{x.status='closed'},'Order closed');tab='Tables';render()},
  restReopen:id=>{current=id;editOrder(x=>{x.status='open'},'Order reopened')},
  restOrders:v=>{orderView=v;orders()},restRoute:r=>{kitchenRoute=r;setK('wifipos-kds-route',r);kitchen()},
  restServe:id=>{if(change(()=>{const k=db.restaurant_kots.find(x=>x.id===id);if(!k)throw Error('Ticket not found');k.status='served'}))toast('Marked served')},
  restKot:(id,to)=>{if(change(()=>{const k=db.restaurant_kots.find(x=>x.id===id);if(!k)throw Error('Ticket not found');k.status=to}))kitchen()},
  restPrinters:printersForm,restSavePrinters:savePrinters,
  restTestPrint:()=>{if(!savePrinters())return;if(!canNetPrint()){alert('Direct printing works in the Palace POS Android and Windows apps.');return}for(const r of ['kitchen','bar']){const h=routeHost(r);if(h)Android.printNetwork('test-'+r,h,80,(r==='bar'?'BAR':'KITCHEN')+' PRINTER\nTest ticket\n'+new Date().toLocaleString(),'',true)}},
  restItem:itemForm,restTableForm:tableForm,
  restAvail:id=>{if(change(()=>{const i=db.restaurant_items.find(x=>x.id===id);i.available=i.available===false}))menu()},
  restItemDelete:id=>{if(!confirm('Delete this dish? Past bills keep it.'))return;if(change(()=>{db.restaurant_items=db.restaurant_items.filter(x=>x.id!==id)})){closeModal();toast('Dish deleted')}},
  restTableDelete:id=>{if(openOrders().some(o=>o.tableId===id)){alert('This table has an open order.');return}if(!confirm('Delete this table?'))return;if(change(()=>{db.restaurant_tables=db.restaurant_tables.filter(x=>x.id!==id)})){closeModal();toast('Table deleted')}}
 });
})();
