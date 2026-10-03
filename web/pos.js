// Sales page: WhatsApp buttons. Put the sales WhatsApp number here (country code, digits only, e.g. 971501234567).
const WHATSAPP_NUMBER='971585823467'; // 058 582 3467 (UAE)
(()=>{'use strict';
 const y=document.getElementById('year');if(y)y.textContent=new Date().getFullYear();
 const n=WHATSAPP_NUMBER.replace(/\D/g,'');
 for(const a of document.querySelectorAll('[data-wa]')){
  const plan=a.dataset.plan,text=plan==='Package'?'Hello WiFi Palace, I am interested in the complete counter package (AED 3,850: POS machine, printer, cash drawer, scanner, 1 year software, installation).':plan==='Hardware'?'Hello WiFi Palace, I need a quote for POS hardware (printer / scanner / cash drawer).':plan?`Hello WiFi Palace, I'm interested in the ${plan} plan of Palace POS.`:'Hello WiFi Palace, I want to know more about Palace POS for my business.';
  if(n.length>=9){a.href='https://wa.me/'+n+'?text='+encodeURIComponent(text);a.target='_blank';a.rel='noopener'}
  else a.addEventListener('click',()=>{const m=document.getElementById('waMissing');if(m)m.hidden=false});
 }
})();
