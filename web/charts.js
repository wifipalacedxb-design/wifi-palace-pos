// Dashboard trend charts shared by every business type (salon, laundry, gym).
// Each chart is a single series: one hue, thin rounded bars, peak label, hover tooltip and a table view.
// Usage from a dashboard template:  ${TrendCharts.section([{id,title,value:day=>n,money:true}], 'redrawFn')}
// then call TrendCharts.wire() after the HTML is in the page.
(function(root){
 'use strict';
 const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const localDay=(d=new Date())=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
 const addDays=(day,n)=>new Date(Date.parse(day)+n*86400000).toISOString().slice(0,10);
 const aed=v=>(typeof money==='function'?money(v):'AED '+(v/100).toFixed(2));
 const axisMoney=v=>v>=100000?+(v/100000).toFixed(1)+'k':String(Math.round(v/100));
 let days=14;
 function rows(value){const out=[],today=localDay();for(let i=days-1;i>=0;i--){const d=addDays(today,-i),dt=new Date(d+'T12:00:00');out.push({day:d,label:dt.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}),short:dt.toLocaleDateString(undefined,{day:'numeric',month:'short'}),v:Math.max(0,value(d)||0)})}return out}
 function bar(id,title,data,fmt,axis){
  const W=560,H=190,L=40,R=22,T=16,B=26,n=data.length,top=Math.max(1,...data.map(r=>r.v)),mag=10**Math.floor(Math.log10(top)),max=[1,1.2,1.5,2,2.5,3,4,5,6,8,10].map(f=>f*mag).find(v=>v>=top),step=(W-L-R)/n,bw=Math.max(3,step-2),y=v=>T+(H-T-B)*(1-v/max);
  const peak=data.reduce((a,r,i)=>r.v>data[a].v?i:a,0);
  const bars=data.map((r,i)=>{const x=L+i*step+(step-bw)/2,h=Math.max(r.v?2:0,H-B-y(r.v)),t=H-B-h,rr=Math.min(4,bw/2,h);
   const path=h?`M${x},${H-B}V${t+rr}Q${x},${t} ${x+rr},${t}H${x+bw-rr}Q${x+bw},${t} ${x+bw},${t+rr}V${H-B}Z`:'';
   return `<g class="tbar" data-tip="${e(r.label+' · '+fmt(r.v))}"><rect x="${L+i*step}" y="${T}" width="${step}" height="${H-T-B}" fill="transparent"/>${path?`<path d="${path}" fill="#6755bc"/>`:''}</g>`}).join('');
  const ticks=[0,max/2,max].map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#e7e5ef" stroke-width="1"/><text x="${L-6}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="#77758a">${e(axis(v))}</text>`).join('');
  const every=n>16?5:2,xl=data.map((r,i)=>i%every===(n-1)%every?`<text x="${L+i*step+step/2}" y="${H-8}" text-anchor="middle" font-size="11" fill="#77758a">${e(r.short)}</text>`:'').join('');
  const peakLabel=data[peak].v?`<text x="${L+peak*step+step/2}" y="${y(data[peak].v)-5}" text-anchor="middle" font-size="11" font-weight="600" fill="#2b2940">${e(axis(data[peak].v))}</text>`:'';
  return `<section class="panel tchart"><div class="row"><h3 style="margin:0">${e(title)}</h3><span class="helper">Total ${e(fmt(data.reduce((n,r)=>n+r.v,0)))}</span></div>
  <div style="position:relative"><svg id="${e(id)}" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${e(title+', last '+n+' days')}">${ticks}${bars}${peakLabel}${xl}</svg><div class="ttip" hidden></div></div>
  <details><summary class="helper">Show as table</summary><table><tr><th>Day</th><th>${e(title)}</th></tr>${data.slice().reverse().map(r=>`<tr><td>${e(r.label)}</td><td>${e(fmt(r.v))}</td></tr>`).join('')}</table></details></section>`;
 }
 // Net collections per day: sales on their day, refunds subtracted on their refund day.
 // Credit (account) sales are not collected money; payments received on accounts are.
 function collections(sales,payments=[]){const m=new Map(),add=(d,v)=>m.set(d,(m.get(d)||0)+v);for(const s of sales||[]){if(s.method==='Credit (account)')continue;add(localDay(new Date(s.date)),s.total);if(s.status==='Refunded'&&s.refundDate)add(localDay(new Date(s.refundDate)),-s.total)}for(const p of payments||[])add(localDay(new Date(p.at)),p.amount);return d=>m.get(d)||0}
 function countBy(list,dateOf,keyOf){const m=new Map();for(const x of list||[]){const d=localDay(new Date(dateOf(x)));if(!m.has(d))m.set(d,new Set());m.get(d).add(keyOf?keyOf(x):m.get(d).size)}return d=>m.get(d)?.size||0}
 function section(charts,redraw){
  return `<div class="row" style="margin:6px 0 10px"><h3 style="margin:0">Trends</h3><div class="actions" style="margin:0">${[14,30].map(n=>`<button class="${days===n?'primary':''}" onclick="TrendCharts.days(${n},'${e(redraw)}')">${n} days</button>`).join('')}</div></div>
  <div class="tcharts">${charts.map(c=>bar(c.id,c.title,rows(c.value),c.money?aed:v=>String(v),c.money?axisMoney:v=>String(+v.toFixed(1)))).join('')}</div>`;
 }
 function wire(){document.querySelectorAll('.tchart').forEach(box=>{const tip=box.querySelector('.ttip'),svg=box.querySelector('svg');
  box.querySelectorAll('.tbar').forEach(g=>{g.onmouseenter=()=>{tip.textContent=g.dataset.tip;tip.hidden=false;const b=g.getBoundingClientRect(),o=svg.getBoundingClientRect();tip.style.left=Math.min(o.width-150,Math.max(0,b.left-o.left+b.width/2-75))+'px'};g.onmouseleave=()=>{tip.hidden=true}});
  svg.onmouseleave=()=>{tip.hidden=true}})}
 function setDays(n,redraw){days=n;const f=root[redraw];if(typeof f==='function')f()}
 if(typeof document!=='undefined'&&!document.getElementById('trendChartCss')){const st=document.createElement('style');st.id='trendChartCss';st.textContent='.tcharts{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}.tchart svg{display:block;margin-top:10px}.tbar:hover path{fill:#4f3fa3}.ttip{position:absolute;top:0;width:150px;background:#1f1d33;color:#fff;font-size:12px;padding:6px 8px;border-radius:8px;text-align:center;pointer-events:none}.tchart details{margin-top:8px}.tchart table{font-size:13px}@media(max-width:900px){.tcharts{grid-template-columns:1fr}}';document.head.appendChild(st)}
 root.TrendCharts={section,wire,days:setDays,collections,countBy};
})(globalThis);
