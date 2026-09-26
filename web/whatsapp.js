/* Manual click-to-chat: no messages are sent by Salon Desk. */
(function(root){
 function phone(value){let n=String(value||'').trim().replace(/[\s()-]/g,'');if(n.startsWith('00'))n='+'+n.slice(2);if(/^05\d{8}$/.test(n))n='+971'+n.slice(1);if(!/^\+?[1-9]\d{7,14}$/.test(n))throw Error('Enter a full international number, such as +971501234567. UAE mobile numbers starting 05 are also accepted.');return n.replace(/^\+/,'')}
 function message(a,shop,type){const when=a.when.replace('T',' ');return `Hello ${a.customer},\n\n${type==='reminder'?'A reminder about your appointment':type==='cancelled'?'Your appointment has been cancelled':'Your appointment is booked'} at ${shop.name}.\n\nService: ${a.service}\nDate & time: ${when} (salon local time)\nStylist: ${a.staff}\nDuration: ${a.duration} minutes${shop.address?'\nLocation: '+shop.address:''}${shop.phone?'\nSalon phone: '+shop.phone:''}\n\n${type==='cancelled'?'Please contact us if you would like to book another time.':'Please reply if you need to change your appointment. Thank you!'}`}
 root.SalonWhatsApp={phone,message,link:(n,text)=>'https://wa.me/'+phone(n)+'?text='+encodeURIComponent(text)};
})(globalThis);
function appointmentWhatsApp(id){
 const a=db.appointments.find(x=>x.id===id);if(!a||a.status==='Completed')return;
 const customer=a.customerId?db.customers.find(x=>x.id===a.customerId):null;
 const type=a.status==='Cancelled'?'cancelled':'confirmation';
 modal(`<h2>WhatsApp appointment</h2><p>Review the customer number and message. WhatsApp opens using the account signed in on this device. You must press Send there.</p><form id="waForm"><label for="waPhone">Customer WhatsApp number</label><input id="waPhone" type="tel" required maxlength="40" value="${esc(customer?.phone||'')}" placeholder="+971501234567"><p class="helper">${customer?'Check this is the correct customer number.':'Enter the customer’s number. This booking has no linked customer phone.'} UAE 05 numbers are converted to +971. For other countries include the country code.</p><label for="waType">Message type</label><select id="waType">${type==='cancelled'?'<option value="cancelled">Cancellation</option>':'<option value="confirmation">Confirmation</option><option value="reminder">Reminder</option>'}</select><label for="waMessage">Message</label><textarea id="waMessage" rows="12" maxlength="4000" required style="width:100%">${esc(SalonWhatsApp.message(a,db.settings,type))}</textarea><p id="waError" role="alert"></p><div class="actions"><button type="button" onclick="closeModal()">Close</button><button class="primary">Review WhatsApp link</button></div></form><div id="waLink"></div>`);
 $('waType').onchange=()=>{$('waMessage').value=SalonWhatsApp.message(a,db.settings,$('waType').value);$('waLink').innerHTML=''};
 for(const key of ['waPhone','waMessage'])$(key).oninput=()=>{$('waLink').innerHTML=''};
 $('waForm').onsubmit=e=>{e.preventDefault();$('waError').textContent='';$('waLink').innerHTML='';try{if(!$('waMessage').value.trim())throw Error('Enter an appointment message.');const n=SalonWhatsApp.phone($('waPhone').value),url=SalonWhatsApp.link(n,$('waMessage').value);$('waLink').innerHTML=`<p>Recipient: <strong>+${esc(n)}</strong></p><a class="primary" style="display:inline-block;padding:12px;border-radius:10px" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open WhatsApp →</a><p class="helper">Opening WhatsApp does not confirm delivery or change the booking status.</p>`}catch(err){$('waError').textContent=err.message}};
}

function birthdayToday(now=new Date()){return new Date(now.getTime()+4*3600000).toISOString().slice(0,10)}
function isBirthdayToday(c){return typeof c.dob==='string'&&!!c.dob&&c.dob.slice(5)===birthdayToday().slice(5)}
function birthdayMessage(c,shop){return `Happy Birthday, ${c.name}! 🎂\n\nWarm wishes from everyone at ${shop.name}. Enjoy 10% off your salon services today as our birthday gift to you!\n\nShow this message at checkout today (${birthdayToday()}). Please contact us to book your visit.${shop.phone?'\nSalon phone: '+shop.phone:''}\n\nHave a wonderful birthday!`}
function birthdayWhatsApp(id){
 const c=db.customers.find(x=>x.id===id);if(!c||!isBirthdayToday(c))return;
 modal(`<h2>Birthday wishes · 10% offer</h2><p>Review the message, then open WhatsApp and press Send. This offer does not automatically change a bill. The cashier must apply the agreed 10% discount at checkout.</p><form id="birthdayForm"><label>Customer WhatsApp number</label><input id="birthdayPhone" type="tel" required maxlength="40" value="${esc(c.phone||'')}"><label>Birthday message</label><textarea id="birthdayMessage" rows="10" required maxlength="4000" style="width:100%">${esc(birthdayMessage(c,db.settings))}</textarea><p id="birthdayError" role="alert"></p><div class="actions"><button type="button" onclick="closeModal()">Close</button><button class="primary">Review WhatsApp link</button></div></form><div id="birthdayLink"></div>`);
 for(const key of ['birthdayPhone','birthdayMessage'])$(key).oninput=()=>{$('birthdayLink').innerHTML=''};
 $('birthdayForm').onsubmit=e=>{e.preventDefault();$('birthdayError').textContent='';$('birthdayLink').innerHTML='';try{
 if(!isBirthdayToday(c))throw Error('This birthday offer is only available on the customer’s birthday.');
 const message=$('birthdayMessage').value.trim();if(!message)throw Error('Enter a birthday message.');
 const phone=SalonWhatsApp.phone($('birthdayPhone').value),url=SalonWhatsApp.link(phone,message);
 $('birthdayLink').innerHTML=`<p>Recipient: <strong>+${esc(phone)}</strong></p><a class="primary" style="display:inline-block;padding:12px;border-radius:10px" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open WhatsApp →</a><p class="helper">Delivery is not tracked. Check the WhatsApp conversation before sending again.</p>`;
 }catch(err){$('birthdayError').textContent=err.message}};
}
