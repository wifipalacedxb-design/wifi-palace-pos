// Pet shop screens for WiFi Palace POS (business type "petshop"). Checkout, products, stock and credit come
// from grocery.js; this file adds Pets (profiles + vaccinations), Grooming (appointments per groomer) and
// Boarding (boarding / daycare stays). "Bill" puts the charge on the checkout for the pet's owner; once paid,
// the appointment or stay is marked paid.
(function(){
 'use strict';
 const R=window.RetailUI;if(!R)return;
 const SPECIES=['Dog','Cat','Bird','Fish','Rabbit','Hamster','Turtle','Other'];
 const ICON={Dog:'🐶',Cat:'🐱',Bird:'🐦',Fish:'🐟',Rabbit:'🐰',Hamster:'🐹',Turtle:'🐢',Other:'🐾'};
 const DAY=86400000;
 let petSearch='',petFilter='All',groomDay='',stayView='In';
 const today=()=>R.localDay();
 const addDays=(d,n)=>R.localDay(new Date(Date.parse(d+'T12:00:00')+n*DAY));
 const hm=t=>new Date(t).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
 const pet=id=>db.pets.find(p=>p.id===id);
 const ownerOf=p=>db.customers.find(c=>c.id===p?.customerId);
 const services=type=>db.grocery_items.filter(i=>i.type==='service'&&(Array.isArray(type)?type.includes(i.serviceType):i.serviceType===type));
 const petLabel=p=>`${ICON[p.species]||'🐾'} ${p.name}`;
 const petOptions=(sel='')=>db.pets.filter(p=>p.active!==false).slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>{const o=ownerOf(p);return `<option value="${esc(p.id)}" ${p.id===sel?'selected':''}>${esc(p.name)} (${esc(p.species)}${p.breed?' · '+esc(p.breed):''}) · ${esc(o?.name||p.owner)}${o?.phone?' · '+esc(o.phone):''}</option>`}).join('');
 // Next vaccination due for a pet: the earliest "next due" date among its records.
 const nextDue=p=>(p.vaccinations||[]).filter(v=>v.due).map(v=>({...v})).sort((a,b)=>a.due.localeCompare(b.due))[0]||null;
 const dueSoon=(p,days=30)=>{const n=nextDue(p);return n&&n.due<=addDays(today(),days)?n:null};
 const paidSale=id=>db.sales.find(s=>s.id===id);

 // --- dashboard block (inside the retail dashboard) -------------------------------------------------------
 R.ext??={};const EXT=R.ext.petshop={};
 EXT.dashboard=()=>{
  const t=today(),appts=db.appointments.filter(a=>R.localDay(new Date(a.when))===t&&a.status!=='Cancelled'),inHouse=db.pet_stays.filter(s=>s.status==='In'),due=db.pets.filter(p=>p.active!==false&&dueSoon(p,14));
  return `<div class="layout"><section class="panel"><div class="row"><h3>Grooming today · ${appts.length}</h3><button onclick="navigate('Grooming')">Grooming →</button></div>${appts.length?appts.sort((a,b)=>a.when.localeCompare(b.when)).slice(0,8).map(a=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee"><span>${esc(hm(a.when))} · <b>${esc(a.pet)}</b> · ${esc(a.service)}</span><span class="badge">${esc(a.status)}</span></div>`).join(''):'<div class="empty">No grooming booked today.</div>'}</section>
  <aside class="panel"><div class="row"><h3>In boarding · ${inHouse.length}</h3><button onclick="navigate('Boarding')">Boarding →</button></div>${inHouse.slice(0,8).map(s=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee"><span><b>${esc(s.pet)}</b> ${s.kennel?'· '+esc(s.kennel):''}</span><span class="helper">out ${esc(s.until)}</span></div>`).join('')||'<div class="empty">No pets staying.</div>'}
  <div class="row" style="margin-top:14px"><h3>Vaccines due (14 days) · ${due.length}</h3><button onclick="petShopFilter('Vaccines due')">Pets →</button></div></aside></div>`;
 };

 // --- pets ---------------------------------------------------------------------------------------------------
 function pets(){
  const q=petSearch.trim().toLowerCase(),list=db.pets.filter(p=>{const o=ownerOf(p);return(petFilter==='All'?p.active!==false:petFilter==='Vaccines due'?p.active!==false&&dueSoon(p):p.active===false)&&(!q||[p.name,p.breed,p.microchip,o?.name,o?.phone].join(' ').toLowerCase().includes(q))}).sort((a,b)=>petFilter==='Vaccines due'?nextDue(a).due.localeCompare(nextDue(b).due):a.name.localeCompare(b.name));
  $('app').innerHTML=`<div class="panel"><div class="row"><h2>Pets</h2><button class="primary" onclick="petShopPetForm()">+ Add pet</button></div>
  <div class="actions" style="justify-content:flex-start">${['All','Vaccines due','Archived'].map(f=>`<button class="${petFilter===f?'primary':''}" onclick="petShopFilter('${f}')">${f}${f==='Vaccines due'?' ('+db.pets.filter(p=>p.active!==false&&dueSoon(p)).length+')':''}</button>`).join('')}</div>
  <label for="ppSearch" style="display:block;margin-top:14px">Search pet, owner, mobile or microchip</label><input id="ppSearch" value="${esc(petSearch)}" oninput="petShopSearch(this.value)">
  ${list.map(p=>{const o=ownerOf(p),n=nextDue(p),soon=dueSoon(p);return `<div class="row" style="padding:12px 0;border-bottom:1px solid #eee;flex-wrap:wrap;gap:10px"><div style="min-width:220px;flex:1"><b style="font-size:17px">${esc(petLabel(p))}</b> <span class="helper">${esc([p.species,p.breed,p.sex,p.weight?p.weight+' kg':''].filter(Boolean).join(' · '))}</span><div class="helper">${esc(o?.name||p.owner)}${o?.phone?' · '+esc(o.phone):''}</div>${p.allergies?`<div style="color:#8a1f1f;font-size:13px">⚠ ${esc(p.allergies)}</div>`:''}</div>${n?`<span class="badge" style="${soon?(n.due<today()?'background:#f6e1e1;color:#8a1f1f':'background:#fdf0d8;color:#7a5200'):''}">${esc(n.name)} ${n.due<today()?'overdue':'due'} ${esc(n.due)}</span>`:''}<div class="actions" style="margin:0"><button onclick="petShopPet('${esc(p.id)}')">Open</button><button onclick="petShopBook('','${esc(p.id)}')">Groom</button><button onclick="petShopStayForm('${esc(p.id)}')">Board</button>${soon&&o?.phone?`<button onclick="petShopRemind('${esc(p.id)}')">WhatsApp</button>`:''}</div></div>`}).join('')||`<div class="empty">${petFilter==='Vaccines due'?'No vaccinations due in the next 30 days.':'No pets yet. Add the first pet and its owner.'}</div>`}</div>`;
 }
 function petForm(id,customerId=''){
  const p=pet(id)||{name:'',species:'Dog',breed:'',sex:'',neutered:false,dob:'',weight:0,color:'',microchip:'',allergies:'',notes:'',vaccinations:[],customerId,active:true};
  modal(`<h2>${id?'Edit '+esc(p.name):'Add pet'}</h2><form id="pForm"><label for="pfOwner">Owner</label><select id="pfOwner"><option value="">+ New owner</option>${db.customers.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${esc(c.id)}" ${c.id===p.customerId?'selected':''}>${esc(c.name)}${c.phone?' · '+esc(c.phone):''}</option>`).join('')}</select>
  <div id="pfNew" class="business-grid"><div><label for="pfOName">Owner name</label><input id="pfOName" maxlength="100"></div><div><label for="pfOPhone">Owner mobile</label><input id="pfOPhone" type="tel" maxlength="40" placeholder="050 123 4567"></div></div>
  <div class="business-grid"><div><label for="pfName">Pet name</label><input id="pfName" value="${esc(p.name)}" maxlength="60" required></div><div><label for="pfSpecies">Species</label><select id="pfSpecies">${SPECIES.map(s=>`<option ${p.species===s?'selected':''}>${s}</option>`).join('')}</select></div></div>
  <div class="business-grid"><div><label for="pfBreed">Breed</label><input id="pfBreed" value="${esc(p.breed)}" maxlength="60"></div><div><label for="pfSex">Sex</label><select id="pfSex">${[['','—'],['Male','Male'],['Female','Female']].map(([v,l])=>`<option value="${v}" ${p.sex===v?'selected':''}>${l}</option>`).join('')}</select></div></div>
  <div class="business-grid"><div><label for="pfDob">Date of birth</label><input id="pfDob" type="date" value="${esc(p.dob)}" max="${today()}"></div><div><label for="pfWeight">Weight (kg)</label><input id="pfWeight" type="number" min="0" max="200" step="0.1" value="${p.weight||''}"></div></div>
  <div class="business-grid"><div><label for="pfColor">Colour / markings</label><input id="pfColor" value="${esc(p.color)}" maxlength="40"></div><div><label for="pfChip">Microchip no.</label><input id="pfChip" value="${esc(p.microchip)}" maxlength="40"></div></div>
  <label style="display:flex;gap:10px;align-items:center"><input id="pfNeut" type="checkbox" style="width:auto;margin:0" ${p.neutered?'checked':''}> Neutered / spayed</label>
  <label for="pfAll">Allergies / warnings</label><input id="pfAll" value="${esc(p.allergies)}" maxlength="300" placeholder="e.g. chicken allergy, bites when nails are cut">
  <label for="pfNotes">Notes (food, behaviour, grooming style)</label><input id="pfNotes" value="${esc(p.notes)}" maxlength="500">
  <div class="actions">${id?`<button type="button" onclick="petShopArchive('${esc(id)}')">${p.active===false?'Restore':'Archive'}</button>`:''}<button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save pet</button></div></form>`);
  const toggle=()=>{$('pfNew').style.display=$('pfOwner').value?'none':''};$('pfOwner').onchange=toggle;toggle();
  $('pForm').onsubmit=e=>{e.preventDefault();let cid=$('pfOwner').value,newOwner=null;
   if(!cid){const n=$('pfOName').value.trim();if(!n){alert('Enter the owner name or choose an owner');return}newOwner={id:uid(),name:n,phone:$('pfOPhone').value.trim(),dob:''};cid=newOwner.id}
   const w=Number($('pfWeight').value||0),v={...p,id:id||uid(),customerId:cid,owner:newOwner?.name||db.customers.find(c=>c.id===cid)?.name||'',name:$('pfName').value.trim(),species:$('pfSpecies').value,breed:$('pfBreed').value.trim(),sex:$('pfSex').value,neutered:$('pfNeut').checked,dob:$('pfDob').value,weight:Math.round(w*10)/10,color:$('pfColor').value.trim(),microchip:$('pfChip').value.trim(),allergies:$('pfAll').value.trim(),notes:$('pfNotes').value.trim()};
   if(!v.name||!(w>=0&&w<=200)){alert('Check the pet name and weight');return}
   if(change(()=>{if(newOwner)db.customers.push(newOwner);const k=db.pets.findIndex(x=>x.id===v.id);if(k>=0)db.pets[k]=v;else db.pets.push(v)})){closeModal();toast('Pet saved');if(!id)petCard(v.id)}};
 }
 function petCard(id){
  const p=pet(id);if(!p)return;const o=ownerOf(p),appts=db.appointments.filter(a=>a.petId===id).sort((a,b)=>b.when.localeCompare(a.when)).slice(0,10),stays=db.pet_stays.filter(s=>s.petId===id).sort((a,b)=>b.from.localeCompare(a.from)).slice(0,10),others=db.pets.filter(x=>x.customerId===p.customerId&&x.id!==id);
  const age=p.dob?Math.floor((Date.now()-Date.parse(p.dob))/(365.25*DAY)):null;
  modal(`<h2>${esc(petLabel(p))}</h2><p>${esc([p.species,p.breed,p.sex,p.neutered?'neutered':'',age!==null?(age<1?'under 1 year':age+' yrs'):'',p.weight?p.weight+' kg':'',p.color].filter(Boolean).join(' · '))}${p.microchip?'<br><span class="helper">Microchip '+esc(p.microchip)+'</span>':''}</p>
  <p><b>${esc(o?.name||p.owner)}</b>${o?.phone?' · '+esc(o.phone):''}${others.length?`<br><span class="helper">Also: ${others.map(x=>esc(x.name)).join(', ')}</span>`:''}</p>
  ${p.allergies?`<p style="color:#8a1f1f">⚠ ${esc(p.allergies)}</p>`:''}${p.notes?`<p class="helper">${esc(p.notes)}</p>`:''}
  <h3>Vaccinations</h3>${(p.vaccinations||[]).length?p.vaccinations.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(v=>`<div class="row" style="padding:4px 0;border-bottom:1px solid #eee"><span>${esc(v.name)} · ${esc(v.date)}</span><span class="${v.due&&v.due<today()?'danger':'helper'}">${v.due?'next '+esc(v.due):''} <button aria-label="Remove" onclick="petShopVaxDel('${esc(id)}','${esc(v.id)}')">×</button></span></div>`).join(''):'<p class="helper">None recorded.</p>'}
  <form id="pVax" class="business-grid" style="align-items:end"><div><label for="pvName">Vaccine</label><input id="pvName" list="pvList" maxlength="60" required placeholder="Rabies"><datalist id="pvList">${['Rabies','DHPP','Parvo','Leptospirosis','Kennel cough','FVRCP','Feline leukaemia','Deworming','Flea & tick'].map(x=>`<option value="${x}">`).join('')}</datalist></div><div><label for="pvDate">Given on</label><input id="pvDate" type="date" value="${today()}" max="${today()}" required></div><div><label for="pvDue">Next due</label><input id="pvDue" type="date" value="${addDays(today(),365)}"></div><div><button class="primary">Add</button></div></form>
  <h3>History</h3>${[...appts.map(a=>({at:a.when,text:'✂ '+a.service+' · '+a.staff+' · '+a.status})),...stays.map(s=>({at:s.from,text:'🏠 '+s.service+' · '+s.from+' → '+s.until+' · '+s.status}))].sort((a,b)=>b.at.localeCompare(a.at)).map(h=>`<div class="helper" style="padding:3px 0">${esc(R.localDay(new Date(h.at)))} · ${esc(h.text)}</div>`).join('')||'<p class="helper">No visits yet.</p>'}
  <div class="actions"><button onclick="closeModal()">Close</button><button onclick="petShopPetForm('${esc(id)}')">Edit</button><button onclick="petShopStayForm('${esc(id)}')">Board</button><button class="primary" onclick="petShopBook('','${esc(id)}')">Book grooming</button></div>`);
  $('pVax').onsubmit=e=>{e.preventDefault();const v={id:uid(),name:$('pvName').value.trim(),date:$('pvDate').value,due:$('pvDue').value};if(!v.name||!v.date){return}if(v.date>today()){alert('The vaccination date cannot be in the future');return}if(v.due&&v.due<v.date){alert('Next due must be after the date given');return}
   if(change(()=>{const x=pet(id);x.vaccinations=[...(x.vaccinations||[]),v]}))petCard(id)};
 }
 function remind(id){const p=pet(id),o=ownerOf(p),n=nextDue(p);if(!o?.phone||!n)return;
  try{window.open(SalonWhatsApp.link(SalonWhatsApp.phone(o.phone),`Hello ${o.name}, this is ${db.settings.name}. ${p.name}'s ${n.name} vaccination is ${n.due<today()?'overdue since':'due on'} ${n.due}. Reply to book a visit. Thank you!`),'_blank','noopener')}catch(e){alert(e.message)}}

 // --- grooming -----------------------------------------------------------------------------------------------
 function grooming(){
  const d=groomDay||today(),list=db.appointments.filter(a=>R.localDay(new Date(a.when))===d).sort((a,b)=>a.when.localeCompare(b.when)),groomers=db.staff;
  const color={Booked:'',"Checked in":'background:#fdf0d8;color:#7a5200',Completed:'background:#dff3e9;color:#155e48',Cancelled:'background:#eceaf3;color:#555','No-show':'background:#f6e1e1;color:#8a1f1f'};
  $('app').innerHTML=`<div class="panel"><div class="row"><div><h2>Grooming</h2><p class="helper">${esc(new Date(d+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'}))} · ${list.filter(a=>a.status!=='Cancelled').length} appointments</p></div><div class="actions" style="margin:0"><button aria-label="Previous day" onclick="petShopDay(-1)">←</button><button onclick="petShopDay(0)">Today</button><button aria-label="Next day" onclick="petShopDay(1)">→</button><input type="date" value="${d}" onchange="petShopDate(this.value)" style="width:auto;margin:0">${cloudUser?.role==='owner'?'<button onclick="petShopGroomers()">Groomers</button>':''}<button class="primary" onclick="petShopBook()">+ Book</button></div></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));margin-top:12px">${groomers.map(g=>{const mine=list.filter(a=>a.staffId===g.id);return `<div class="panel" style="margin:0"><h3>${esc(g.name)} <span class="helper">· ${mine.filter(a=>a.status!=='Cancelled').length}</span></h3>${mine.map(a=>{const p=pet(a.petId),paid=a.saleId&&paidSale(a.saleId),open=['Booked','Checked in'].includes(a.status);return `<div style="padding:10px 0;border-bottom:1px solid #eee"><div class="row"><b>${esc(hm(a.when))} · ${esc(p?petLabel(p):a.pet)}</b><span class="badge" style="${color[a.status]||''}">${esc(a.status)}${paid?' · paid':''}</span></div><div class="helper">${esc(a.service)} · ${a.duration} min · ${esc(a.customer)}</div>${p?.allergies?`<div style="color:#8a1f1f;font-size:13px">⚠ ${esc(p.allergies)}</div>`:''}${a.notes?`<div class="helper">${esc(a.notes)}</div>`:''}<div class="actions" style="margin:6px 0 0;justify-content:flex-start">${a.status==='Booked'?`<button onclick="petShopAppt('${esc(a.id)}','Checked in')">Check in</button>`:''}${open?`<button class="primary" onclick="petShopGroomBill('${esc(a.id)}')">Done · bill</button><button onclick="petShopBook('${esc(a.id)}')">Edit</button><button onclick="petShopAppt('${esc(a.id)}','No-show')">No-show</button><button class="danger" onclick="petShopAppt('${esc(a.id)}','Cancelled')">Cancel</button>`:''}${a.status==='Completed'&&!paid?`<button class="primary" onclick="petShopGroomBill('${esc(a.id)}')">Bill</button>`:''}${paid?`<button onclick="receipt('${esc(a.saleId)}')">Receipt</button>`:''}</div></div>`}).join('')||'<div class="empty">Free all day.</div>'}</div>`}).join('')}</div>${groomers.length?'':'<div class="empty">Add groomers on Team / Services & staff first.</div>'}</div>`;
 }
 function book(id='',petId=''){
  const a=db.appointments.find(x=>x.id===id),svcs=services('grooming');if(!svcs.length){alert('Add a grooming service on Products → + Add service first.');return}if(!db.pets.length){alert('Add the pet first.');petForm();return}
  const d=groomDay||today(),when=a?new Date(a.when):new Date(d+'T'+String(Math.max(9,Math.min(20,new Date().getHours()+1))).padStart(2,'0')+':00'),local=new Date(when.getTime()-when.getTimezoneOffset()*60000).toISOString().slice(0,16);
  modal(`<h2>${a?'Edit appointment':'Book grooming'}</h2><form id="gBook"><label for="gbPet">Pet</label><select id="gbPet">${petOptions(a?.petId||petId)}</select><button type="button" onclick="petShopPetForm()" style="margin-top:6px">+ New pet</button>
  <label for="gbSvc">Service</label><select id="gbSvc">${svcs.map(s=>`<option value="${esc(s.id)}" data-min="${s.duration||60}" ${a?.serviceId===s.id?'selected':''}>${esc(s.name)} · ${money(s.price)}</option>`).join('')}</select>
  <div class="business-grid"><div><label for="gbStaff">Groomer</label><select id="gbStaff">${db.staff.map(g=>`<option value="${esc(g.id)}" ${a?.staffId===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}</select></div><div><label for="gbWhen">Date & time</label><input id="gbWhen" type="datetime-local" value="${local}" required></div></div>
  <label for="gbMin">Minutes</label><input id="gbMin" type="number" min="5" max="480" value="${a?.duration||svcs[0].duration||60}"><label for="gbNotes">Notes</label><input id="gbNotes" maxlength="300" value="${esc(a?.notes||'')}" placeholder="e.g. short summer cut, sensitive paws">
  <div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">${a?'Save':'Book'}</button></div></form>`);
  $('gbSvc').onchange=e=>{$('gbMin').value=e.target.selectedOptions[0].dataset.min};
  $('gBook').onsubmit=e=>{e.preventDefault();const p=pet($('gbPet').value),s=db.grocery_items.find(x=>x.id===$('gbSvc').value),g=db.staff.find(x=>x.id===$('gbStaff').value),t=new Date($('gbWhen').value),min=Math.round(Number($('gbMin').value));
   if(!p||!s||!g||!Number.isFinite(t.getTime())||!(min>=5&&min<=480)){alert('Check the pet, service, groomer, time and minutes');return}
   const start=t.getTime(),end=start+min*60000,clash=db.appointments.find(x=>x.id!==a?.id&&x.staffId===g.id&&['Booked','Checked in'].includes(x.status)&&start<Date.parse(x.when)+x.duration*60000&&end>Date.parse(x.when));if(clash){alert(g.name+' has '+clash.pet+' at '+hm(clash.when)+'. Choose another time or groomer.');return}
   const v={...(a||{}),id:a?.id||uid(),when:t.toISOString(),duration:min,petId:p.id,pet:p.name,species:p.species,customerId:p.customerId,customer:p.owner,serviceId:s.id,service:s.name,staffId:g.id,staff:g.name,status:a?.status||'Booked',notes:$('gbNotes').value.trim()};
   if(change(()=>{const k=db.appointments.findIndex(x=>x.id===v.id);if(k>=0)db.appointments[k]=v;else db.appointments.push(v)})){closeModal();groomDay=R.localDay(t);toast(a?'Appointment saved':'Booked · '+p.name+' '+hm(v.when));tab='Grooming';render()}};
 }
 function groomers(){
  modal(`<h2>Groomers</h2>${db.staff.map(g=>`<div class="row" style="padding:6px 0;border-bottom:1px solid #eee"><span>${esc(g.name)}</span><button onclick="petShopGroomer('${esc(g.id)}')">Rename</button></div>`).join('')}<div class="actions"><button onclick="closeModal()">Close</button><button class="primary" onclick="petShopGroomer()">+ Add groomer</button></div>`)}
 function groomer(id){const g=db.staff.find(x=>x.id===id),name=prompt('Groomer name',g?.name||'');if(!name?.trim())return;if(change(()=>{const x=db.staff.find(y=>y.id===id);if(x)x.name=name.trim().slice(0,100);else db.staff.push({id:uid(),name:name.trim().slice(0,100),commissionBps:0})}))groomers()}
 function setAppt(id,status){const a=db.appointments.find(x=>x.id===id);if(!a)return;let reason='';if(status==='Cancelled'){reason=prompt('Reason for cancelling '+a.pet+"'s appointment:");if(reason===null)return}if(status==='No-show'&&!confirm('Mark '+a.pet+' as no-show?'))return;
  if(change(()=>{const x=db.appointments.find(y=>y.id===id);x.status=status;if(reason)x.cancelReason=reason.trim()}))toast(a.pet+': '+status)}
 function groomBill(id){const a=db.appointments.find(x=>x.id===id);if(!a)return;if(!db.grocery_items.some(i=>i.id===a.serviceId)){alert('This service was removed from the price list.');return}
  const link={kind:'appointments',id};if(R.billed(link)){tab='Checkout';render();return}
  R.bill({customerId:a.customerId,lines:[{id:a.serviceId,qty:1,link,note:a.pet+' · '+a.staff}]});toast('Added to bill · add any products, then take payment')}

 // --- boarding & daycare --------------------------------------------------------------------------------------
 // Boarding: nights between check-in day and check-out day (minimum 1). Daycare: days, check-in day included.
 const units=s=>{const from=R.localDay(new Date(s.checkIn||s.from+'T12:00:00')),to=R.localDay(new Date(s.checkOut||Date.now())),n=Math.round((Date.parse(to+'T12:00:00')-Date.parse(from+'T12:00:00'))/DAY);return s.type==='daycare'?Math.max(1,n+1):Math.max(1,n)};
 function boarding(){
  const t=today(),list=db.pet_stays.filter(s=>stayView==='In'?s.status==='In':stayView==='Booked'?s.status==='Booked':['Out','Cancelled'].includes(s.status)).sort((a,b)=>stayView==='Out'?(b.checkOut||b.until).localeCompare(a.checkOut||a.until):a.from.localeCompare(b.from));
  const count=st=>db.pet_stays.filter(s=>s.status===st).length;
  $('app').innerHTML=`<div class="panel"><div class="row"><div><h2>Boarding & daycare</h2><p class="helper">${count('In')} staying now · ${db.pet_stays.filter(s=>s.status==='Booked'&&s.from===t).length} arriving today · ${db.pet_stays.filter(s=>s.status==='In'&&s.until<=t).length} due out</p></div><button class="primary" onclick="petShopStayForm()">+ Check in / book</button></div>
  <div class="actions" style="justify-content:flex-start">${[['In','Staying now'],['Booked','Booked'],['Out','Checked out']].map(([v,l])=>`<button class="${stayView===v?'primary':''}" onclick="petShopStays('${v}')">${l}${v!=='Out'?' ('+count(v)+')':''}</button>`).join('')}</div>
  ${list.slice(0,80).map(s=>{const p=pet(s.petId),paid=s.saleId&&paidSale(s.saleId),n=units(s),late=s.status==='In'&&s.until<t;return `<div class="row" style="padding:12px 0;border-bottom:1px solid #eee;flex-wrap:wrap;gap:10px"><div style="min-width:220px;flex:1"><b style="font-size:17px">${esc(p?petLabel(p):s.pet)}</b>${s.kennel?` <span class="badge">${esc(s.kennel)}</span>`:''}<div class="helper">${esc(s.customer)} · ${esc(s.service)}</div><div class="helper">${s.status==='Booked'?'Arrives '+esc(s.from):'In '+esc(R.localDay(new Date(s.checkIn||s.from)))} → ${s.checkOut?'out '+esc(R.localDay(new Date(s.checkOut))):'planned '+esc(s.until)}${s.status!=='Booked'&&s.status!=='Cancelled'?' · '+n+' '+(s.type==='daycare'?(n===1?'day':'days'):(n===1?'night':'nights')):''}</div>${s.care?`<div class="helper">🍽 ${esc(s.care)}</div>`:''}${p?.allergies?`<div style="color:#8a1f1f;font-size:13px">⚠ ${esc(p.allergies)}</div>`:''}</div>${late?'<span class="badge" style="background:#f6e1e1;color:#8a1f1f">Past planned date</span>':''}${s.status==='Cancelled'?'<span class="badge">Cancelled</span>':''}${paid?'<span class="badge" style="background:#dff3e9;color:#155e48">Paid</span>':s.status==='Out'?'<span class="badge" style="background:#fdf0d8;color:#7a5200">Not paid</span>':''}
  <div class="actions" style="margin:0">${s.status==='Booked'?`<button class="primary" onclick="petShopStay('${esc(s.id)}','In')">Check in</button><button class="danger" onclick="petShopStay('${esc(s.id)}','Cancelled')">Cancel</button>`:''}${s.status==='In'?`<button class="primary" onclick="petShopStay('${esc(s.id)}','Out')">Check out · bill</button>`:''}${s.status==='Out'&&!paid?`<button class="primary" onclick="petShopStayBill('${esc(s.id)}')">Bill</button>`:''}${paid?`<button onclick="receipt('${esc(s.saleId)}')">Receipt</button>`:''}${['Booked','In'].includes(s.status)?`<button onclick="petShopStayEdit('${esc(s.id)}')">Edit</button>`:''}</div></div>`}).join('')||'<div class="empty">Nothing here.</div>'}</div>`;
 }
 function stayForm(petId=''){
  const svcs=services(['boarding','daycare']);if(!svcs.length){alert('Add a boarding or daycare service on Products → + Add service first.');return}if(!db.pets.length){alert('Add the pet first.');petForm();return}
  modal(`<h2>Boarding / daycare</h2><form id="pStay"><label for="psPet">Pet</label><select id="psPet">${petOptions(petId)}</select><label for="psSvc">Service</label><select id="psSvc">${svcs.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} · ${money(s.price)}</option>`).join('')}</select>
  <div class="business-grid"><div><label for="psFrom">Arrival</label><input id="psFrom" type="date" value="${today()}" required></div><div><label for="psUntil">Planned check-out</label><input id="psUntil" type="date" value="${addDays(today(),1)}" required></div></div>
  <label for="psKennel">Kennel / room</label><input id="psKennel" maxlength="40" placeholder="e.g. K3"><label for="psCare">Food, medicine, care notes</label><input id="psCare" maxlength="500" placeholder="e.g. own food twice a day, tablet at 8 pm">
  <div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button type="button" id="psBook">Book for later</button><button class="primary">Check in now</button></div></form>`);
  $('psSvc').onchange=()=>{const s=db.grocery_items.find(x=>x.id===$('psSvc').value);if(s?.serviceType==='daycare')$('psUntil').value=$('psFrom').value};
  const save=status=>{const p=pet($('psPet').value),s=db.grocery_items.find(x=>x.id===$('psSvc').value),from=$('psFrom').value,until=$('psUntil').value;if(!p||!s||!from||!until||until<from){alert('Check the pet and dates (check-out on or after arrival)');return}
   const v={id:uid(),petId:p.id,pet:p.name,species:p.species,customerId:p.customerId,customer:p.owner,serviceId:s.id,service:s.name,type:s.serviceType,status,from:status==='In'?today():from,until,kennel:$('psKennel').value.trim(),care:$('psCare').value.trim(),...(status==='In'?{checkIn:new Date().toISOString()}:{})};
   if(change(()=>db.pet_stays.push(v))){closeModal();stayView=status;toast(status==='In'?p.name+' checked in':'Stay booked');tab='Boarding';render()}};
  $('psBook').onclick=()=>save('Booked');$('pStay').onsubmit=e=>{e.preventDefault();save('In')};
 }
 function stayEdit(id){const s=db.pet_stays.find(x=>x.id===id);if(!s)return;
  modal(`<h2>${esc(s.pet)} · stay</h2><form id="pStayE"><label for="seUntil">Planned check-out</label><input id="seUntil" type="date" value="${esc(s.until)}" min="${esc(s.from)}" required><label for="seKennel">Kennel / room</label><input id="seKennel" maxlength="40" value="${esc(s.kennel)}"><label for="seCare">Care notes</label><input id="seCare" maxlength="500" value="${esc(s.care)}"><div class="actions"><button type="button" onclick="closeModal()">Cancel</button><button class="primary">Save</button></div></form>`);
  $('pStayE').onsubmit=e=>{e.preventDefault();const until=$('seUntil').value;if(!until||until<s.from){alert('Check-out must be on or after arrival');return}if(change(()=>{const x=db.pet_stays.find(y=>y.id===id);x.until=until;x.kennel=$('seKennel').value.trim();x.care=$('seCare').value.trim()})){closeModal();toast('Saved')}}}
 function setStay(id,status){const s=db.pet_stays.find(x=>x.id===id);if(!s)return;let reason='';
  if(status==='Cancelled'){reason=prompt('Reason for cancelling this booking:');if(reason===null)return}
  if(status==='Out'){const n=units({...s,checkOut:new Date().toISOString()});if(!confirm(`Check out ${s.pet}? ${n} ${s.type==='daycare'?'day(s)':'night(s)'} of ${s.service} go on the bill.`))return}
  if(change(()=>{const x=db.pet_stays.find(y=>y.id===id);x.status=status;if(status==='In'){x.checkIn=new Date().toISOString()}if(status==='Out')x.checkOut=new Date().toISOString();if(reason)x.cancelReason=reason.trim()})){if(status==='Out')stayBill(id);else toast(s.pet+': '+(status==='In'?'checked in':status.toLowerCase()))}}
 function stayBill(id){const s=db.pet_stays.find(x=>x.id===id);if(!s)return;if(!db.grocery_items.some(i=>i.id===s.serviceId)){alert('This service was removed from the price list.');return}
  const link={kind:'pet_stays',id};if(R.billed(link)){tab='Checkout';render();return}const n=units(s);
  R.bill({customerId:s.customerId,lines:[{id:s.serviceId,qty:n,link,note:s.pet+' · '+n+' '+(s.type==='daycare'?'day(s)':'night(s)')}]});toast('Added to bill')}

 // After checkout: mark the appointment completed / the stay as paid with this sale.
 EXT.onPaid=(sale,links)=>{for(const l of links){if(l.kind==='appointments'){const a=db.appointments.find(x=>x.id===l.id);if(a){a.saleId=sale.id;if(['Booked','Checked in'].includes(a.status))a.status='Completed'}}if(l.kind==='pet_stays'){const s=db.pet_stays.find(x=>x.id===l.id);if(s)s.saleId=sale.id}}};

 Object.assign(R.screens,{Pets:pets,Grooming:grooming,Boarding:boarding});
 Object.assign(window,{
  petShopFilter:f=>{petFilter=f;tab='Pets';render()},petShopSearch:v=>{petSearch=v;pets();const el=$('ppSearch');el.focus();el.setSelectionRange(v.length,v.length)},
  petShopPetForm:petForm,petShopPet:petCard,petShopRemind:remind,
  petShopArchive:id=>{if(change(()=>{const p=pet(id);p.active=p.active===false})){closeModal();toast('Saved')}},
  petShopVaxDel:(pid,vid)=>{if(!confirm('Remove this vaccination record?'))return;if(change(()=>{const p=pet(pid);p.vaccinations=(p.vaccinations||[]).filter(v=>v.id!==vid)}))petCard(pid)},
  petShopDay:n=>{groomDay=n?addDays(groomDay||today(),n):today();grooming()},petShopDate:d=>{if(d){groomDay=d;grooming()}},
  petShopBook:book,petShopGroomers:groomers,petShopGroomer:groomer,petShopAppt:setAppt,petShopGroomBill:groomBill,
  petShopStays:v=>{stayView=v;boarding()},petShopStayForm:stayForm,petShopStay:setStay,petShopStayBill:stayBill,petShopStayEdit:stayEdit
 });
})();
