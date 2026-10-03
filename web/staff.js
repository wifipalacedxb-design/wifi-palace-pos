'use strict';
// Switch user with a PIN on a device that is already signed in (shared till, waiter phones and tablets).
// Staff with a PIN are listed; owners always use their password. Unsent changes are uploaded first so
// nothing from the previous user is left behind.
let pinStaff=[],pinStaffFor='';
async function loadPinStaff(){if(!cloudReady)return;try{pinStaff=await api('pin-users');pinStaffFor=cloudUser.businessId}catch{}paintStatus()}
const paintBeforeStaff=paintStatus;
paintStatus=function(){paintBeforeStaff();const node=$('cloudStatus');if(!node||!cloudReady||pinStaffFor!==cloudUser?.businessId||!pinStaff.length||$('switchUser'))return;const b=document.createElement('button');b.id='switchUser';b.textContent='Switch user';b.onclick=switchUser;node.appendChild(b)};
const enterBeforeStaff=enterSalon;
enterSalon=async function(session){await enterBeforeStaff(session);if(cloudReady)loadPinStaff()};
const teamBeforeStaff=teamScreen;
teamScreen=async function(){await teamBeforeStaff();loadPinStaff()};
async function switchUser(){
 if(syncing){toast('Syncing… try again in a moment');return}
 if(cache?.pending.length){await syncNow();if(cache.pending.length){alert('This device still has '+cache.pending.length+' unsent change(s). Connect to the internet and press Sync now before switching user.');return}}
 try{pinStaff=await api('pin-users')}catch(e){alert(e.status?e.message:'Switching user needs the internet.');return}
 const others=pinStaff.filter(p=>p.id!==cloudUser.id);
 modal(`<h2>Switch user</h2>${others.length?`<p class="helper">Tap your name, then enter your PIN.${cloudUser.demo?' <b>Demo PIN: 1234</b>':''}</p><div class="grid">${others.map(p=>`<button class="service" data-pin-pick="${esc(p.id)}"><span>${esc(p.role==='waiter'?'Waiter':'Cashier')}</span><strong>${esc(p.name)}</strong></button>`).join('')}</div>`:'<p>No other staff have a PIN yet. The owner can set PINs in <b>Team</b>.</p>'}<p class="helper">Owners sign in with their password: use Account → Sign out.</p><div class="actions"><button onclick="closeModal()">Cancel</button></div>`);
 document.querySelectorAll('[data-pin-pick]').forEach(b=>b.onclick=()=>pinPad(pinStaff.find(p=>p.id===b.dataset.pinPick)));
}
function pinPad(person){let pin='';
 const draw=(msg='')=>{modal(`<h2>${esc(person.name)}</h2><p class="helper">Enter your PIN</p><div id="pinDots" aria-live="polite" style="font-size:34px;letter-spacing:10px;min-height:44px;text-align:center">${'●'.repeat(pin.length)||'<span style="opacity:.25">○○○○</span>'}</div>${msg?`<p class="pending-note" role="alert">${esc(msg)}</p>`:''}<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:300px;margin:10px auto">${[1,2,3,4,5,6,7,8,9,'⌫',0,'OK'].map(k=>`<button data-pin-key="${k}" class="${k==='OK'?'primary':''}" style="font-size:22px;padding:16px 0">${k}</button>`).join('')}</div><div class="actions"><button onclick="closeModal()">Cancel</button></div>`);
  document.querySelectorAll('[data-pin-key]').forEach(b=>b.onclick=()=>press(b.dataset.pinKey))};
 const press=async k=>{if(k==='⌫'){pin=pin.slice(0,-1);draw();return}if(k!=='OK'){if(pin.length<6){pin+=k;draw()}return}
  if(pin.length<4){draw('A PIN has 4 to 6 digits.');return}
  let session;try{session=await api('pin-login','POST',{userId:person.id,pin})}catch(e){pin='';draw(e.status?e.message:'Could not reach the server.');return}
  closeModal();try{tab=session.user.role==='owner'?'Dashboard':'Checkout';await enterSalon(session);toast('Signed in as '+session.user.name)}catch(e){alert('Could not open the workspace for '+person.name+': '+e.message);location.reload()}};
 draw()}
document.addEventListener('keydown',e=>{if(!$('modal')?.open||!document.querySelector('[data-pin-key]'))return;const k=/^\d$/.test(e.key)?e.key:e.key==='Backspace'?'⌫':e.key==='Enter'?'OK':'';if(k){e.preventDefault();document.querySelector(`[data-pin-key="${k}"]`)?.click()}});
