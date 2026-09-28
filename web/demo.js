// Demo shop launcher: signs this browser into a shared demo business (owner or staff) with one click.
(()=>{'use strict';
 const $=id=>document.getElementById(id);
 const ICONS={salon:'💇',laundry:'👔',gym:'🏋️',grocery:'🛒',restaurant:'🍽️',petshop:'🐾',perfume:'🧴',meat:'🥩'};
 const LABELS={salon:'Salon & spa',laundry:'Laundry',gym:'Gym & fitness',grocery:'Grocery & baqala',restaurant:'Restaurant & café',petshop:'Pet shop',perfume:'Perfume & oud',meat:'Meat shop'};
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const say=(text,error)=>{const m=$('message');m.hidden=!text;m.textContent=text||'';m.className='notice'+(error?' error':'')};
 // A real account with changes not yet uploaded must never be replaced by a demo on this device.
 function savedCache(){return new Promise(resolve=>{try{const r=indexedDB.open('wifi-palace-pos',1);r.onupgradeneeded=()=>{try{r.result.createObjectStore('kv')}catch{}};r.onerror=()=>resolve(null);r.onsuccess=()=>{try{const q=r.result.transaction('kv').objectStore('kv').get('wifi-palace-cloud-v2');q.onsuccess=()=>{r.result.close();resolve(q.result||null)};q.onerror=()=>{r.result.close();resolve(null)}}catch{r.result.close();resolve(null)}}}catch{resolve(null)}}).then(v=>{if(v)return v;try{const raw=localStorage.getItem('wifi-palace-cloud-v2');return raw?JSON.parse(raw):null}catch{return null}})}
 async function open(type,role,button){
  button.disabled=true;say('');
  try{
   const saved=await savedCache();
   if(saved?.pending?.length&&!saved.user?.demo){throw Error('This device has '+saved.pending.length+' change(s) for your own business that are not uploaded yet. Open WiFi Palace POS, connect to the internet and let it sync, then try the demo — or use another browser.')}
   const r=await fetch('/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,role}),credentials:'same-origin'});const data=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(data.error||'The demo could not be opened. Try again.');
   location.href='/';
  }catch(e){say(e.message,true);button.disabled=false}
 }
 fetch('/api/demo').then(r=>r.json()).then(({shops})=>{
  if(!shops?.length){$('shops').innerHTML='<p>Demo shops are being prepared. Please try again in a minute.</p>';return}
  $('shops').innerHTML=shops.map(s=>`<div class="card"><div class="icon" aria-hidden="true">${ICONS[s.type]||'🏪'}</div><div class="eyebrow">${esc(LABELS[s.type]||s.type).toUpperCase()}</div><h2>${esc(s.name)}</h2><p>${esc(s.blurb)}</p><div class="row"><button class="primary" data-type="${esc(s.type)}" data-role="owner">Open as owner</button><button data-type="${esc(s.type)}" data-role="cashier">As staff</button></div></div>`).join('');
  document.querySelectorAll('button[data-type]').forEach(b=>b.onclick=()=>open(b.dataset.type,b.dataset.role,b));
  // /demo#salon from the sales page: bring that shop to the top of the list and highlight it.
  const want=location.hash.slice(1),card=want&&document.querySelector(`button[data-type="${CSS.escape(want)}"]`)?.closest('.card');if(card){card.parentNode.prepend(card);card.style.outline='3px solid #6553bf';card.scrollIntoView({block:'center'})}
 }).catch(()=>{$('shops').innerHTML='<p>Could not load the demo shops. Check your internet connection.</p>'});
})();
