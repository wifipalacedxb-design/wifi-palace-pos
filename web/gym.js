// Gym & fitness screens for WiFi Palace POS. Active only when the signed-in business type is "gym".
// Front desk: Check-in (search by name, mobile or member code), Sell (plans, PT packs, products),
// Members (status, freeze, renew, WhatsApp reminders, member card). Owner: Dashboard, Price list.
// Shared screens (sales, settings, finance, reports, team, sync, account) come from the core app.
(function(){
 'use strict';
 const OWN=['Dashboard','Check-in','Sell','Members','Price list'];
 const OWNER_ONLY=['Dashboard','Sales','Price list','Settings','Finance','Reports','Team'];
 const isGym=()=>typeof cloudUser!=='undefined'&&cloudUser?.businessType==='gym';
 const isOwner=()=>cloudUser?.role==='owner';
 const tabs=()=>isOwner()?['Dashboard','Check-in','Sell','Members','Sales','Price list','Settings','Finance','Reports','Team','Sync centre','Account']:['Check-in','Sell','Members','My sales','Sync centre','Account'];
 const DAY=86400000;
 const localDay=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
 const addDays=(day,n)=>new Date(Date.parse(day)+n*DAY).toISOString().slice(0,10);
 const between=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/DAY);
 const code=id=>String(id).replace(/[^a-zA-Z0-9]/g,'').slice(-6).toUpperCase();
 const TYPE_LABEL={plan:'Membership plans',pt:'Personal training',product:'Products'};
 const pill=(text,kind)=>`<span class="badge" style="${kind==='ok'?'background:#dff3e9;color:#155e48':kind==='bad'?'background:#f6e1e1;color:#8a1f1f':kind==='warn'?'background:#fdf0d8;color:#7a5200':''}">${esc(text)}</span>`;
 let search='',memberFilter='All',memberSearch='',cart=null;
 const freshCart=(customerId='')=>({customerId,lines:{},start:'',trainerId:''});

 // --- data helpers ------------------------------------------------------------------------------
 function shim(){if(db){db.services??=[];db.appointments??=[];for(const k of ['gym_items','gym_memberships','gym_checkins','gym_pt'])db[k]??=[]}}
 const memberships=id=>db.gym_memberships.filter(m=>m.customerId===id&&m.status!=='Cancelled').sort((a,b)=>a.start.localeCompare(b.start));
 const packs=id=>db.gym_pt.filter(p=>p.customerId===id&&p.status==='Active'&&p.used.length<p.sessions&&(!p.expires||p.expires>=localDay()));
 function status(id){
  const today=localDay(),ms=memberships(id),frozen=ms.find(m=>m.status==='Frozen');
  if(frozen)return{state:'Frozen',kind:'warn',label:'Frozen since '+frozen.frozenFrom,m:frozen,last:frozen};
  const cur=ms.find(m=>m.start<=today&&today<=m.end),next=ms.find(m=>m.start>today),last=ms.at(-1);
  if(cur){const left=between(today,cur.end);const through=ms.filter(m=>m.start>cur.start).reduce((e,m)=>m.start<=addDays(e,1)?m.end:e,cur.end);return{state:'Active',kind:left<=7&&through===cur.end?'warn':'ok',label:'Active until '+through+(left===0&&through===cur.end?' (last day)':''),m:cur,last,through}}
  if(next)return{state:'Upcoming',kind:'warn',label:'Starts '+next.start,m:next,last};
  if(last)return{state:'Expired',kind:'bad',label:'Expired '+last.end,m:null,last};
  return{state:'None',kind:'bad',label:'No membership',m:null,last:null};
 }
 const checkedToday=id=>db.gym_checkins.filter(c=>c.customerId===id&&localDay(new Date(c.at))===localDay());
 const renewStart=id=>{const s=status(id),today=localDay();const end=s.through||s.last?.end;return end&&end>=today?addDays(end,1):today};

 // --- navigation ----------------------------------------------------------------------------------
 function paintNav(){$('nav').innerHTML=tabs().map(t=>`<button class="${tab===t?'active':''}" data-cloud-tab="${esc(t)}">${esc(t)}</button>`).join('');document.querySelectorAll('[data-cloud-tab]').forEach(b=>b.onclick=()=>navigate(b.dataset.cloudTab))}
 const prevRender=render,prevNavigate=navigate;
 render=function(){
  if(!isGym()){prevRender();return}
  if(!cloudReady)return;shim();
  if(!tabs().includes(tab))tab=tabs()[0];
  if(OWN.includes(tab)){const t=tab;tab='Customers';prevRender();tab=t;paintNav();document.title=db.settings.name+' | WiFi Palace POS';SCREENS[t]();return}
  prevRender();paintNav();
 };
 navigate=function(next){
  if(!isGym()){prevNavigate(next);return}
  if(!isOwner()&&OWNER_ONLY.includes(next)){alert('Owner access required');return}
  if(OWN.includes(next)){tab=next;render();return}
  shim();prevNavigate(next);paintNav();
 };

 // --- charts (single series each; one hue, thin rounded bars, hover tooltip, table view) ---------------
 let chartDays=14;
 function barChart(id,title,rows,fmt){
  const W=560,H=190,L=40,R=22,T=16,B=26,n=rows.length,top=Math.max(1,...rows.map(r=>r.v)),mag=10**Math.floor(Math.log10(top)),max=[1,1.2,1.5,2,2.5,3,4,5,6,8,10].map(f=>f*mag).find(v=>v>=top),step=(W-L-R)/n,bw=Math.max(3,step-2),y=v=>T+(H-T-B)*(1-v/max);
  const nice=[0,max/2,max],peak=rows.reduce((a,r,i)=>r.v>rows[a].v?i:a,0);
  const bars=rows.map((r,i)=>{const x=L+i*step+(step-bw)/2,h=Math.max(r.v?2:0,H-B-y(r.v)),top=H-B-h,rr=Math.min(4,bw/2,h);
   const path=h?`M${x},${H-B}V${top+rr}Q${x},${top} ${x+rr},${top}H${x+bw-rr}Q${x+bw},${top} ${x+bw},${top+rr}V${H-B}Z`:'';
   return `<g class="gbar" data-tip="${esc(r.label+' · '+fmt(r.v))}"><rect x="${L+i*step}" y="${T}" width="${step}" height="${H-T-B}" fill="transparent"/>${path?`<path d="${path}" fill="#6755bc"/>`:''}</g>`}).join('');
  const ticks=nice.map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#e7e5ef" stroke-width="1"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="#77758a">${esc(fmt(v,true))}</text>`).join('');
  const every=n>16?5:2,xl=rows.map((r,i)=>i%every===(n-1)%every?`<text x="${L+i*step+step/2}" y="${H-8}" text-anchor="middle" font-size="11" fill="#77758a">${esc(r.short)}</text>`:'').join('');
  const peakLabel=rows[peak].v?`<text x="${L+peak*step+step/2}" y="${y(rows[peak].v)-5}" text-anchor="middle" font-size="11" font-weight="600" fill="#2b2940">${esc(fmt(rows[peak].v,true))}</text>`:'';
  return `<section class="panel gchart"><div class="row"><h3 style="margin:0">${esc(title)}</h3><span class="helper">Total ${esc(fmt(rows.reduce((n,r)=>n+r.v,0)))}</span></div>
  <div style="position:relative"><svg id="${id}" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title+', last '+n+' days')}">${ticks}${bars}${peakLabel}${xl}</svg><div class="gtip" hidden></div></div>
  <details><summary class="helper">Show as table</summary><table><tr><th>Day</th><th>${esc(title)}</th></tr>${rows.slice().reverse().map(r=>`<tr><td>${esc(r.label)}</td><td>${esc(fmt(r.v))}</td></tr>`).join('')}</table></details></section>`;
 }
 function wireCharts(){document.querySelectorAll('.gchart').forEach(box=>{const tip=box.querySelector('.gtip'),svg=box.querySelector('svg');
  box.querySelectorAll('.gbar').forEach(g=>{g.onmouseenter=g.onfocus=e=>{tip.textContent=g.dataset.tip;tip.hidden=false;const b=g.getBoundingClientRect(),o=svg.getBoundingClientRect();tip.style.left=Math.min(o.width-150,Math.max(0,b.left-o.left+b.width/2-75))+'px'};g.onmouseleave=()=>{tip.hidden=true}});
  svg.onmouseleave=()=>{tip.hidden=true}})}
 function dayRows(days,value){const out=[],today=localDay();for(let i=days-1;i>=0;i--){const d=addDays(today,-i),dt=new Date(d+'T12:00:00');out.push({day:d,label:dt.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}),short:dt.toLocaleDateString(undefined,{day:'numeric',month:'short'}),v:value(d)})}return out}
 function charts(){
  const visits=new Map();for(const c of db.gym_checkins){const d=localDay(new Date(c.at));if(!visits.has(d))visits.set(d,new Set());visits.get(d).add(c.customerId)}
  const cash=new Map(),addTo=(d,v)=>cash.set(d,(cash.get(d)||0)+v);for(const s of db.sales){addTo(localDay(new Date(s.date)),s.total);if(s.status==='Refunded'&&s.refundDate)addTo(localDay(new Date(s.refundDate)),-s.total)}
  const aed=(v,short)=>short?(v>=100000?+(v/100000).toFixed(1)+'k':String(Math.round(v/100))):money(v);
  return `<div class="row" style="margin:6px 0 10px"><h3 style="margin:0">Trends</h3><div class="actions" style="margin:0">${[14,30].map(n=>`<button class="${chartDays===n?'primary':''}" onclick="gymChartDays(${n})">${n} days</button>`).join('')}</div></div>
  <div class="gcharts">${barChart('gcVisits','Check-ins',dayRows(chartDays,d=>visits.get(d)?.size||0),v=>String(v))}${barChart('gcCash','Net collections (AED)',dayRows(chartDays,d=>Math.max(0,cash.get(d)||0)),aed)}</div>`;
 }
 if(!document.getElementById('gymChartCss')){const st=document.createElement('style');st.id='gymChartCss';st.textContent='.gcharts{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}.gchart svg{display:block;margin-top:10px}.gbar:hover path{fill:#4f3fa3}.gtip{position:absolute;top:0;width:150px;background:#1f1d33;color:#fff;font-size:12px;padding:6px 8px;border-radius:8px;text-align:center;pointer-events:none}.gchart details{margin-top:8px}.gchart table{font-size:13px}@media(max-width:900px){.gcharts{grid-template-columns:1fr}}';document.head.appendChild(st)}

 // --- dashboard -------------------------------------------------------------------------------------
 function dashboard(){
  const today=localDay(),people=db.customers,st=Object.fromEntries(people.map(c=>[c.id,status(c.id)]));
  const active=people.filter(c=>['Active','Frozen'].includes(st[c.id].state)),soon=people.filter(c=>st[c.id].state==='Active'&&between(today,st[c.id].through)<=7),lapsed=people.filter(c=>st[c.id].state==='Expired'&&between(st[c.id].last.end,today)<=30);
  const visits=db.gym_checkins.filter(c=>localDay(new Date(c.at))===today),unique=new Set(visits.map(v=>v.customerId)).size;
  const sales=db.sales.filter(s=>localDay(new Date(s.date))===today),refunds=db.sales.filter(s=>s.status==='Refunded'&&s.refundDate&&localDay(new Date(s.refundDate))===today).reduce((n,s)=>n+s.total,0),net=sales.reduce((n,s)=>n+s.total,0)-refunds;
  $('app').innerHTML=`<div class="hero"><div><div class="eyebrow">${esc(new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}).toUpperCase())}</div><h2 style="margin-top:14px">Stronger every day.</h2><p>${esc(db.settings.name)} · today at a glance.</p></div><button onclick="navigate('Check-in')">Check-in desk →</button></div>
  <div class="kpis"><div class="kpi"><div class="dot"></div><small>Today’s net collections</small><div class="metric">${money(net)}</div><span class="helper">After today’s refunds</span></div><div class="kpi"><div class="dot" style="background:#95bbb0"></div><small>Active members</small><div class="metric">${active.length}</div><span class="helper">Including frozen</span></div><div class="kpi"><div class="dot" style="background:#e3ba98"></div><small>Check-ins today</small><div class="metric">${unique}</div><span class="helper">${visits.length} visits</span></div><div class="kpi"><div class="dot" style="background:#d98a8a"></div><small>Expiring in 7 days</small><div class="metric">${soon.length}</div><span class="helper">Not yet renewed</span></div></div>
  ${charts()}
  <div class="layout"><section class="panel"><div class="row"><h3>Expiring soon</h3><button onclick="gymMembers('Expiring')">View all →</button></div>${soon.length?soon.slice(0,8).map(memberRow).join(''):'<div class="empty">No memberships ending in the next 7 days.</div>'}<h3 style="margin-top:22px">Expired in the last 30 days</h3>${lapsed.length?lapsed.slice(0,8).map(memberRow).join(''):'<div class="empty">Nobody to win back right now.</div>'}</section>
  <aside class="panel"><h3>Recent check-ins</h3>${visits.length?visits.slice().reverse().slice(0,12).map(v=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #eee"><span>${esc(v.customer)}</span><span class="helper">${esc(new Date(v.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}${v.ptId?' · PT':''}</span></div>`).join(''):'<div class="empty">No check-ins yet today.</div>'}</aside></div>`;
  wireCharts();
 }

 // --- check-in desk -----------------------------------------------------------------------------------
 function find(q){q=q.trim().toLowerCase();if(!q)return [];const digits=q.replace(/\D/g,'');return db.customers.filter(c=>c.name.toLowerCase().includes(q)||code(c.id).toLowerCase()===q||(digits.length>=3&&String(c.phone||'').replace(/\D/g,'').includes(digits))).slice(0,12)}
 function checkinCard(c){
  const s=status(c.id),pts=packs(c.id),done=checkedToday(c.id),allowed=['Active'].includes(s.state);
  return `<div class="panel" style="border-left:6px solid ${s.kind==='ok'?'#2f9b73':s.kind==='warn'?'#d69a2d':'#c44'}"><div class="row" style="flex-wrap:wrap;gap:12px"><div><h3 style="margin:0">${esc(c.name)}</h3><div class="helper">Member ${esc(code(c.id))}${c.phone?' · '+esc(c.phone):''}</div></div><div style="text-align:right">${pill(s.state==='None'?'NO MEMBERSHIP':s.state.toUpperCase(),s.kind)}<div class="helper">${esc(s.m?.plan||s.last?.plan||'')}${s.label?' · '+esc(s.label):''}</div></div></div>
  ${pts.map(p=>`<div class="helper">PT: ${esc(p.name)} · ${p.sessions-p.used.length} of ${p.sessions} left · ${esc(p.trainer)}${p.expires?' · until '+esc(p.expires):''}</div>`).join('')}
  ${done.length?`<p class="helper">✓ Checked in today at ${esc(new Date(done.at(-1).at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}</p>`:''}
  <div class="actions" style="justify-content:flex-start">${allowed?`<button class="primary" onclick="gymCheckIn('${esc(c.id)}')">Check in</button>`:''}${pts.map(p=>`<button onclick="gymSession('${esc(p.id)}')">Use PT session</button>`).join('')}${s.state!=='Active'||s.kind==='warn'?`<button ${allowed?'':'class="primary"'} onclick="gymSell('${esc(c.id)}')">Renew / sell plan</button>`:''}${s.state==='Frozen'?`<button onclick="gymUnfreeze('${esc(s.m.id)}')">Unfreeze</button>`:''}${!allowed&&isOwner()?`<button onclick="gymCheckIn('${esc(c.id)}',true)">Allow once (owner)</button>`:''}</div></div>`;
 }
 function checkin(){
  const results=find(search),today=db.gym_checkins.filter(c=>localDay(new Date(c.at))===localDay());
  $('app').innerHTML=`<div class="layout"><section><div class="panel"><h2>Check-in desk</h2><label for="gSearch">Search name, mobile or member code</label><input id="gSearch" value="${esc(search)}" placeholder="e.g. Sara, 0501234567 or member code" autocomplete="off" oninput="gymSearch(this.value)"><p class="helper">Works offline. Green = allow in. Amber = check the note. Red = renew first.</p></div>
  <div id="gResults">${search.trim()?(results.length?results.map(checkinCard).join(''):`<div class="panel empty">No member found. <button onclick="gymMemberForm('',true)">+ Add new member</button></div>`):''}</div></section>
  <aside class="panel"><div class="row"><h3>Today</h3><b>${new Set(today.map(t=>t.customerId)).size}</b></div>${today.length?today.slice().reverse().slice(0,20).map(v=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #eee"><span>${esc(v.customer)}</span><span class="helper">${esc(new Date(v.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}))}${v.ptId?' · PT':''}${v.note?' · '+esc(v.note):''}</span></div>`).join(''):'<div class="empty">No check-ins yet.</div>'}<div class="actions"><button onclick="gymMemberForm('',true)">+ New member</button></div></aside></div>`;
 }
 function doCheckIn(id,override=false){
  const c=db.customers.find(x=>x.id===id);if(!c)return;const s=status(id);
  if(s.state!=='Active'&&!override){alert('No active membership. Renew first.');return}
  if(checkedToday(id).length&&!confirm(c.name+' already checked in today. Check in again?'))return;
  let note='';if(override){note=prompt('Reason for letting '+c.name+' in without an active membership:')?.trim();if(!note)return;note='Owner override: '+note}
  if(change(()=>db.gym_checkins.push({id:uid(),customerId:id,membershipId:s.m?.id||'',ptId:'',at:new Date().toISOString(),note})))toast('✓ '+c.name+' checked in');
 }
 function session(packId){
  const p=db.gym_pt.find(x=>x.id===packId);if(!p)return;const left=p.sessions-p.used.length;
  modal(`<h2>PT session · ${esc(p.customer)}</h2><p>${esc(p.name)} · <b>${left}</b> of ${p.sessions} sessions left${p.expires?' · valid until '+esc(p.expires):''}</p><form id="gPt"><label for="gPtTrainer">Trainer</label><select id="gPtTrainer">${db.staff.map(t=>`<option value="${esc(t.id)}" ${t.id===p.trainerId?'selected':''}>${esc(t.name)}</option>`).join('')}</select><label for="gPtNote">Note (optional)</label><input id="gPtNote" maxlength="200" placeholder="e.g. Legs, 45 min"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Record session</button></div></form>`);
  $('gPt').onsubmit=e=>{e.preventDefault();const at=new Date().toISOString(),trainerId=$('gPtTrainer').value,note=$('gPtNote').value.trim();
   if(change(()=>{const cur=db.gym_pt.find(x=>x.id===packId);if(!cur||cur.used.length>=cur.sessions)throw Error('No sessions left');cur.used=[...cur.used,{at,trainerId,note}];if(!checkedToday(cur.customerId).length)db.gym_checkins.push({id:uid(),customerId:cur.customerId,membershipId:'',ptId:cur.id,at,note:'PT session'})})){closeModal();toast('PT session recorded · '+(left-1)+' left')}};
 }

 // --- sell --------------------------------------------------------------------------------------------
 function sell(){
  cart??=freshCart();
  const c=db.customers.find(x=>x.id===cart.customerId),items=db.gym_items,chosen=Object.entries(cart.lines).map(([id,qty])=>{const i=items.find(x=>x.id===id);return i&&qty>0?{...i,qty}:null}).filter(Boolean);
  const needsMember=chosen.some(i=>i.type!=='product'),hasPlan=chosen.some(i=>i.type==='plan'),hasPt=chosen.some(i=>i.type==='pt'),sub=chosen.reduce((n,i)=>n+i.price*i.qty,0),tax=Math.round(sub*db.settings.tax/100);
  if(hasPlan&&!cart.start&&c)cart.start=renewStart(c.id);
  const s=c?status(c.id):null;
  $('app').innerHTML=`<div class="layout"><section>${['plan','pt','product'].map(t=>{const list=items.filter(i=>i.type===t);return list.length?`<div class="panel"><h3>${TYPE_LABEL[t]}</h3><div class="grid">${list.map(i=>{const q=cart.lines[i.id]||0;return `<div class="service"><b>${esc(i.name)}</b><div class="helper">${money(i.price)}${i.type==='plan'?' · '+i.days+' day'+(i.days>1?'s':''):i.type==='pt'?' · '+i.sessions+' session'+(i.sessions>1?'s':'')+(i.validDays?' · '+i.validDays+' days':''):''}</div>${t==='product'?`<div class="row" style="margin-top:10px"><button aria-label="Remove one ${esc(i.name)}" onclick="gymLine('${esc(i.id)}',-1)">−</button><b style="min-width:32px;text-align:center">${q}</b><button class="primary" aria-label="Add one ${esc(i.name)}" onclick="gymLine('${esc(i.id)}',1)">+</button></div>`:`<button class="${q?'primary':''}" style="margin-top:10px" onclick="gymToggle('${esc(i.id)}')">${q?'✓ Added':'Add'}</button>`}</div>`}).join('')}</div></div>`:''}).join('')||'<div class="panel empty">Add plans and products on the Price list first.</div>'}</section>
  <aside class="panel"><h3>Sale</h3><label for="gMember">Member</label><select id="gMember" onchange="gymCartMember(this.value)"><option value="">${needsMember?'Choose a member…':'Walk-in (products only)'}</option>${db.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(m=>`<option value="${esc(m.id)}" ${cart.customerId===m.id?'selected':''}>${esc(m.name)} · ${esc(code(m.id))}${m.phone?' · '+esc(m.phone):''}</option>`).join('')}</select><button onclick="gymMemberForm('',false,true)" style="margin-top:8px">+ New member</button>
  ${s?`<p class="helper">${pill(s.state==='None'?'No membership':s.state,s.kind)} ${esc(s.label)}</p>`:''}
  ${hasPlan?`<label for="gStart">Membership starts</label><input id="gStart" type="date" value="${esc(cart.start||localDay())}" min="${addDays(localDay(),-7)}" onchange="gymCartField('start',this.value)"><p class="helper">${c&&cart.start>localDay()?'Starts the day after the current membership ends, so no days are lost.':''}</p>`:''}
  ${hasPt?`<label for="gTrainer">Trainer</label><select id="gTrainer" onchange="gymCartField('trainerId',this.value)">${db.staff.map(t=>`<option value="${esc(t.id)}" ${cart.trainerId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select>`:''}
  <div style="margin-top:14px">${chosen.length?chosen.map(i=>`<div class="row"><span>${esc(i.name)}${i.qty>1?' × '+i.qty:''}</span><span>${money(i.price*i.qty)}</span></div>`).join(''):'<div class="empty">Nothing added yet.</div>'}</div>
  <div class="row total"><b>Total</b><b>${money(sub+tax)}</b></div><p class="helper">${tax?'Includes VAT '+money(tax):'VAT '+db.settings.tax+'%'}</p>
  <div class="actions"><button onclick="gymCartClear()">Clear</button><button class="primary" onclick="gymPay()" ${chosen.length?'':'disabled'}>Take payment</button></div></aside></div>`;
 }
 // PT packs earn the trainer commission, so they go on their own invoice credited to the trainer;
 // memberships and products go on a second invoice credited to the desk. One payment covers both.
 function pay(){
  const items=db.gym_items,chosen=Object.entries(cart.lines).map(([id,qty])=>{const i=items.find(x=>x.id===id);return i&&qty>0?{...i,qty}:null}).filter(Boolean);if(!chosen.length)return;
  const c=db.customers.find(x=>x.id===cart.customerId);
  if(chosen.some(i=>i.type!=='product')&&!c){alert('Choose the member for this plan or PT pack.');return}
  const hasPlan=chosen.some(i=>i.type==='plan'),hasPt=chosen.some(i=>i.type==='pt'),start=cart.start||(c?renewStart(c.id):localDay());
  if(hasPlan&&(!/^\d{4}-\d{2}-\d{2}$/.test(start)||start<addDays(localDay(),-7))){alert('Choose a valid start date.');return}
  const trainer=hasPt?db.staff.find(t=>t.id===(cart.trainerId||db.staff[0]?.id)):null;if(hasPt&&!trainer){alert('Add a trainer on the Price list first.');return}
  const bills=[chosen.filter(i=>i.type==='pt'),chosen.filter(i=>i.type!=='pt')].filter(b=>b.length).map(list=>{const sub=list.reduce((n,i)=>n+i.price*i.qty,0),tax=Math.round(sub*db.settings.tax/100);return{list,sub,tax,total:sub+tax,pt:list[0].type==='pt'}});
  const total=bills.reduce((n,b)=>n+b.total,0),tax=bills.reduce((n,b)=>n+b.tax,0);
  modal(`<h2>Payment${c?' · '+esc(c.name):''}</h2><p>Total to collect <b>${money(total)}</b>${tax?` (incl. VAT ${money(tax)})`:''}</p>${bills.length>1?'<p class="helper">Two invoices will print: personal training (credited to the trainer) and membership / products.</p>':''}<form id="gPay"><label for="gMethod">Payment method</label><select id="gMethod"><option>Cash</option><option value="Card (external terminal)">Card</option></select><label for="gReceived">Cash received (AED)</label><input id="gReceived" type="number" min="0" step="0.01" value="${(total/100).toFixed(2)}"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Confirm payment</button></div></form>`);
  $('gMethod').onchange=()=>{$('gReceived').disabled=$('gMethod').value!=='Cash'};
  $('gPay').onsubmit=e=>{e.preventDefault();const method=$('gMethod').value,card=method!=='Cash',received=card?total:cents($('gReceived').value);if(!Number.isSafeInteger(received)||received<total){alert('Cash received must cover the total.');return}if(card&&!confirm('Confirm '+money(total)+' was approved on your card terminal?'))return;
   let left=received;
   const sales=bills.map((b,k)=>{const last=k===bills.length-1,got=card?b.total:last?left:b.total;left-=got;const t=b.pt?trainer:null;
    return{id:uid(),number:'SD-'+new Date().toISOString().replace(/\D/g,'').slice(0,14)+'-'+uid().slice(-3).toUpperCase(),date:new Date().toISOString(),items:b.list.map(i=>({id:i.id,name:i.name,type:i.type,price:i.price,qty:i.qty})),sub:b.sub,off:0,tax:b.tax,total:b.total,customer:c?.name||'Walk-in customer',customerId:c?.id||'',staff:t?.name||cloudUser.name||'Staff',staffId:t?.id||'',commissionBps:t?(t.commissionBps||0):0,method,cashAmount:card?0:b.total,cardAmount:card?b.total:0,cashReceived:card?0:got,received:got,change:got-b.total,shop:{...db.settings},status:'Paid'}});
   const saleFor=type=>sales[bills.findIndex(b=>b.list.some(i=>i.type===type))];
   // Memberships and PT packs reference their sale; the sync uploads them after it.
   if(change(()=>{db.sales.push(...sales);let from=start;
    for(const i of chosen){const sale=saleFor(i.type);for(let n=0;n<i.qty;n++){
     if(i.type==='plan'){db.gym_memberships.push({id:uid(),customerId:c.id,customer:c.name,phone:c.phone||'',planId:i.id,plan:i.name,days:i.days,start:from,end:addDays(from,i.days-1),status:'Active',freezes:[],saleId:sale.id,createdBy:cloudUser.id});from=addDays(from,i.days)}
     if(i.type==='pt')db.gym_pt.push({id:uid(),customerId:c.id,customer:c.name,itemId:i.id,name:i.name,sessions:i.sessions,expires:i.validDays?addDays(localDay(),i.validDays-1):'',trainerId:trainer.id,trainer:trainer.name,used:[],status:'Active',saleId:sale.id,createdBy:cloudUser.id});
    }}})){cart=null;closeModal();render();
     if(sales.length===1)receipt(sales[0].id);
     else modal(`<h2>Payment complete</h2><p>${esc(c?.name||'')} · ${money(total)} · change ${money(received-total)}</p><p class="helper">Two receipts were created.</p><div class="actions">${sales.map((s,k)=>`<button class="primary" onclick="receipt('${esc(s.id)}')">${bills[k].pt?'PT receipt':'Membership / products receipt'}</button>`).join('')}<button onclick="closeModal()">Done</button></div>`)}};
 }

 // --- members -------------------------------------------------------------------------------------------
 function memberRow(c){
  const s=status(c.id),pts=packs(c.id);
  return `<div class="row" style="padding:12px 0;border-bottom:1px solid #eee;gap:12px;flex-wrap:wrap"><div style="min-width:200px"><b>${esc(c.name)}</b><div class="helper">${esc(code(c.id))}${c.phone?' · '+esc(c.phone):''}</div></div><div class="helper">${esc(s.m?.plan||s.last?.plan||'—')}<br>${esc(s.label)}${pts.length?'<br>PT: '+pts.map(p=>(p.sessions-p.used.length)+' left').join(', '):''}</div>${pill(s.state==='None'?'No membership':s.state,s.kind)}<div class="actions" style="margin:0"><button onclick="gymSell('${esc(c.id)}')">${s.state==='Active'?'Renew / add':'Renew'}</button>${s.state==='Active'?`<button onclick="gymFreeze('${esc(s.m.id)}')">Freeze</button>`:''}${s.state==='Frozen'?`<button onclick="gymUnfreeze('${esc(s.m.id)}')">Unfreeze</button>`:''}${c.phone&&['Active','Expired'].includes(s.state)&&(s.state==='Expired'||s.kind==='warn')?`<button onclick="gymRemind('${esc(c.id)}')">WhatsApp</button>`:''}<button onclick="gymCard('${esc(c.id)}')">Card</button><button onclick="gymMemberForm('${esc(c.id)}')">Edit</button></div></div>`;
 }
 function members(){
  const today=localDay(),q=memberSearch.trim().toLowerCase(),match=c=>{const s=status(c.id);return memberFilter==='All'||(memberFilter==='Expiring'?s.state==='Active'&&between(today,s.through)<=7:s.state===memberFilter)};
  const list=db.customers.filter(c=>match(c)&&(!q||[c.name,c.phone,code(c.id)].join(' ').toLowerCase().includes(q))).sort((a,b)=>a.name.localeCompare(b.name));
  const count=f=>db.customers.filter(c=>{const s=status(c.id);return f==='All'||(f==='Expiring'?s.state==='Active'&&between(today,s.through)<=7:s.state===f)}).length;
  $('app').innerHTML=`<div class="panel"><div class="row"><h2>Members</h2><button class="primary" onclick="gymMemberForm()">+ Add member</button></div><div class="actions" style="justify-content:flex-start">${['All','Active','Expiring','Frozen','Upcoming','Expired','None'].map(f=>`<button class="${memberFilter===f?'primary':''}" onclick="gymMembers('${f}')">${esc(f==='None'?'No membership':f)} (${count(f)})</button>`).join('')}</div><label for="gmSearch">Search name, mobile or member code</label><input id="gmSearch" value="${esc(memberSearch)}" oninput="gymMemberSearch(this.value)">${list.length?list.map(memberRow).join(''):'<div class="empty">No members here.</div>'}</div>`;
 }
 function memberForm(id='',fromDesk=false,fromSell=false){
  const c=db.customers.find(x=>x.id===id)||{name:fromDesk?search.trim():'',phone:'',dob:''};
  modal(`<h2>${id?'Edit member':'New member'}</h2><form id="gMemberForm"><label for="gmName">Full name</label><input id="gmName" value="${esc(c.name)}" maxlength="100" required><label for="gmPhone">Mobile (for WhatsApp)</label><input id="gmPhone" type="tel" value="${esc(c.phone||'')}" placeholder="050 123 4567" maxlength="40"><label for="gmDob">Date of birth (optional)</label><input id="gmDob" type="date" value="${esc(c.dob||'')}" max="${localDay()}"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">${id?'Save':'Add member'}</button></div></form>`);
  $('gMemberForm').onsubmit=e=>{e.preventDefault();const v={id:id||uid(),name:$('gmName').value.trim(),phone:$('gmPhone').value.trim(),dob:$('gmDob').value};if(!v.name){alert('Enter the member name');return}
   if(change(()=>{const k=db.customers.findIndex(x=>x.id===v.id);if(k>=0)db.customers[k]={...db.customers[k],...v};else db.customers.push(v)})){closeModal();toast(id?'Member saved':'Member added · code '+code(v.id));if(!id&&(fromDesk||fromSell)){cart=freshCart(v.id);tab='Sell';render()}}};
 }
 function freeze(mid){
  const m=db.gym_memberships.find(x=>x.id===mid);if(!m)return;
  modal(`<h2>Freeze membership · ${esc(m.customer)}</h2><p>${esc(m.plan)} · ends ${esc(m.end)}. From today the member cannot check in. When you unfreeze, the end date moves forward by the frozen days.</p><form id="gFreeze"><label for="gfReason">Reason</label><input id="gfReason" maxlength="200" required placeholder="e.g. Travel, injury"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Freeze from today</button></div></form>`);
  $('gFreeze').onsubmit=e=>{e.preventDefault();const reason=$('gfReason').value.trim();if(!reason)return;if(change(()=>{const cur=db.gym_memberships.find(x=>x.id===mid);if(!cur||cur.status!=='Active')throw Error('Membership is not active');cur.status='Frozen';cur.frozenFrom=localDay();cur.freezeReason=reason})){closeModal();toast('Membership frozen')}};
 }
 function unfreeze(mid){
  const m=db.gym_memberships.find(x=>x.id===mid);if(!m)return;const days=between(m.frozenFrom,localDay());
  if(!confirm(`Unfreeze ${m.customer}? Frozen ${days} day${days===1?'':'s'}; the end date moves from ${m.end} to ${addDays(m.end,days)}.`))return;
  if(change(()=>{const cur=db.gym_memberships.find(x=>x.id===mid);if(!cur||cur.status!=='Frozen')throw Error('Membership is not frozen');cur.status='Active';cur.unfrozenOn=localDay();cur.end=addDays(cur.end,days);cur.freezes=[...(cur.freezes||[]),{from:cur.frozenFrom,to:localDay(),days,reason:cur.freezeReason}];delete cur.frozenFrom;delete cur.freezeReason}))toast('Membership active · ends '+addDays(m.end,days));
 }
 function remind(id){
  const c=db.customers.find(x=>x.id===id);if(!c)return;const s=status(id);
  const text=s.state==='Expired'?`Hello ${c.name}, we miss you at ${db.settings.name}! Your membership ended on ${s.last.end}. Renew today and get back on track. Reply to this message or visit the front desk.`:`Hello ${c.name}, your ${s.m?.plan||'membership'} at ${db.settings.name} ends on ${s.through}. Renew before then to keep training without a break. See you at the gym!`;
  try{window.open(SalonWhatsApp.link(SalonWhatsApp.phone(c.phone),text),'_blank','noopener')}catch(e){alert(e.message)}
 }
 function card(id){
  const c=db.customers.find(x=>x.id===id);if(!c)return;const s=status(id),l='--------------------------------';
  const text=`${db.settings.name}\n${db.settings.phone||''}\n${l}\nMEMBER CARD\n${l}\n${c.name}\nMember code: ${code(c.id)}${c.phone?'\nMobile: '+c.phone:''}\n${l}\n${s.m||s.last?`${(s.m||s.last).plan}\n${s.state==='Active'?'Valid until: '+s.through:s.label}`:'No membership'}\n${packs(id).map(p=>`PT: ${p.name}\n  ${p.sessions-p.used.length} of ${p.sessions} sessions left`).join('\n')}\n\nShow this code at the front desk.`;
  modal(`<h2>Member card</h2><pre class="receipt" id="receiptText">${esc(text)}</pre><div class="actions"><button onclick="closeModal()">Close</button><button class="primary" onclick="printReceipt()">Print card</button></div>`);
 }

 // --- price list & trainers (owner) -------------------------------------------------------------------------
 function priceList(){
  $('app').innerHTML=`<div class="layout"><section class="panel"><div class="row"><h2>Price list</h2><button class="primary" onclick="gymItemForm()">+ Add item</button></div><p class="helper">Prices before VAT. Changing a price does not change memberships already sold.</p>${['plan','pt','product'].map(t=>`<h3>${TYPE_LABEL[t]}</h3>${db.gym_items.filter(i=>i.type===t).map(i=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #eee"><span><b>${esc(i.name)}</b> <span class="helper">${i.type==='plan'?i.days+' days':i.type==='pt'?i.sessions+' sessions'+(i.validDays?' · valid '+i.validDays+' days':''):''}</span></span><span>${money(i.price)} <button onclick="gymItemForm('${esc(i.id)}')">Edit</button></span></div>`).join('')||'<div class="empty">None yet.</div>'}`).join('')}</section>
  <aside class="panel"><div class="row"><h3>Trainers</h3><button onclick="gymTrainerForm()">+ Add</button></div><p class="helper">Trainers sell and deliver personal training. Commission is paid on their PT sales (shown in Finance).</p>${db.staff.map(t=>`<div class="row" style="padding:8px 0;border-bottom:1px solid #eee"><span>${esc(t.name)} <span class="helper">${(t.commissionBps||0)/100}%</span></span><button onclick="gymTrainerForm('${esc(t.id)}')">Edit</button></div>`).join('')||'<div class="empty">Add your first trainer.</div>'}</aside></div>`;
 }
 function itemForm(id){
  const i=db.gym_items.find(x=>x.id===id)||{name:'',type:'plan',days:30,sessions:10,validDays:90,price:0};
  modal(`<h2>${id?'Edit item':'Add item'}</h2><form id="gItem"><label for="giName">Name</label><input id="giName" value="${esc(i.name)}" maxlength="100" required><label for="giType">Type</label><select id="giType" ${id?'disabled':''}><option value="plan" ${i.type==='plan'?'selected':''}>Membership plan</option><option value="pt" ${i.type==='pt'?'selected':''}>Personal training pack</option><option value="product" ${i.type==='product'?'selected':''}>Product</option></select><div id="giPlan"><label for="giDays">Membership length (days)</label><input id="giDays" type="number" min="1" max="3650" step="1" value="${i.days||30}"></div><div id="giPt" class="business-grid"><div><label for="giSessions">Sessions</label><input id="giSessions" type="number" min="1" max="500" step="1" value="${i.sessions||10}"></div><div><label for="giValid">Valid for (days, 0 = no limit)</label><input id="giValid" type="number" min="0" max="3650" step="1" value="${i.validDays??90}"></div></div><label for="giPrice">Price before VAT (AED)</label><input id="giPrice" type="number" min="0" step="0.01" value="${(i.price/100).toFixed(2)}" required><div class="actions">${id?`<button type="button" class="danger" onclick="gymItemDelete('${esc(id)}')">Delete</button>`:''}<button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save item</button></div></form>`);
  const sync=()=>{const t=$('giType').value;$('giPlan').hidden=t!=='plan';$('giPt').hidden=t!=='pt'};$('giType').onchange=sync;sync();
  $('gItem').onsubmit=e=>{e.preventDefault();const type=$('giType').value,v={id:id||uid(),name:$('giName').value.trim(),type,price:cents($('giPrice').value)};
   if(type==='plan')v.days=Number($('giDays').value);if(type==='pt'){v.sessions=Number($('giSessions').value);v.validDays=Number($('giValid').value)}
   if(!v.name||!Number.isSafeInteger(v.price)||v.price<0||(type==='plan'&&!(Number.isInteger(v.days)&&v.days>=1&&v.days<=3650))||(type==='pt'&&!(Number.isInteger(v.sessions)&&v.sessions>=1&&v.sessions<=500&&Number.isInteger(v.validDays)&&v.validDays>=0))){alert('Check the name, price and numbers');return}
   if(change(()=>{const k=db.gym_items.findIndex(x=>x.id===v.id);if(k>=0)db.gym_items[k]=v;else db.gym_items.push(v)})){closeModal();toast('Price list saved')}};
 }
 function trainerForm(id){
  const t=db.staff.find(x=>x.id===id)||{name:'',commissionBps:0};
  modal(`<h2>${id?'Edit trainer':'Add trainer'}</h2><form id="gTrainerForm"><label for="gtName">Name</label><input id="gtName" value="${esc(t.name)}" maxlength="100" required><label for="gtRate">Commission on PT sales (%)</label><input id="gtRate" type="number" min="0" max="100" step="0.01" value="${(t.commissionBps||0)/100}"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save</button></div></form>`);
  $('gTrainerForm').onsubmit=e=>{e.preventDefault();const v={id:id||uid(),name:$('gtName').value.trim(),commissionBps:Math.round(Number($('gtRate').value)*100)};if(!v.name||!Number.isInteger(v.commissionBps)||v.commissionBps<0||v.commissionBps>10000){alert('Enter a name and a commission from 0 to 100%');return}
   if(change(()=>{const k=db.staff.findIndex(x=>x.id===v.id);if(k>=0)db.staff[k]={...db.staff[k],...v};else db.staff.push(v)})){closeModal();toast('Trainer saved')}};
 }

 const SCREENS={'Dashboard':dashboard,'Check-in':checkin,'Sell':sell,'Members':members,'Price list':priceList};
 Object.assign(window,{
  gymSearch:v=>{search=v;const html=v.trim()?(find(v).map(checkinCard).join('')||`<div class="panel empty">No member found. <button onclick="gymMemberForm('',true)">+ Add new member</button></div>`):'';$('gResults').innerHTML=html},
  gymCheckIn:doCheckIn,gymSession:session,gymFreeze:freeze,gymUnfreeze:unfreeze,gymRemind:remind,gymCard:card,gymMemberForm:memberForm,
  gymSell:id=>{cart=freshCart(id);tab='Sell';render()},
  gymMembers:f=>{memberFilter=f;tab='Members';render()},
  gymMemberSearch:v=>{memberSearch=v;members();const el=$('gmSearch');el.focus();el.setSelectionRange(v.length,v.length)},
  gymToggle:id=>{cart??=freshCart();const i=db.gym_items.find(x=>x.id===id);if(!i)return;if(cart.lines[id]){delete cart.lines[id]}else{if(i.type==='plan')for(const k of Object.keys(cart.lines))if(db.gym_items.find(x=>x.id===k)?.type==='plan')delete cart.lines[k];cart.lines[id]=1}sell()},
  gymLine:(id,d)=>{cart??=freshCart();cart.lines[id]=Math.max(0,Math.min(99,(cart.lines[id]||0)+d));sell()},
  gymCartMember:id=>{cart??=freshCart();cart.customerId=id;cart.start=id?renewStart(id):'';sell()},
  gymCartField:(k,v)=>{cart??=freshCart();cart[k]=v;sell()},
  gymCartClear:()=>{cart=freshCart();sell()},
  gymChartDays:n=>{chartDays=n;dashboard()},
  gymPay:pay,gymItemForm:itemForm,gymTrainerForm:trainerForm,
  gymItemDelete:id=>{if(!confirm('Delete this item? Memberships already sold are not affected.'))return;if(change(()=>{db.gym_items=db.gym_items.filter(x=>x.id!==id)})){closeModal();toast('Item deleted')}}
 });
})();
