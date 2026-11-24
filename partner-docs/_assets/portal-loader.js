/* Phase 2 portals: the page holds design and copy; every client fact (names,
 * email, date, venue, prices, payment link) comes from the client's ClickUp
 * agreement. Tokens like {{deposit}} in page copy are filled from that record.
 * The shared engine only starts once the record has loaded. */
(function(){
'use strict';
var P=window.PORTAL;if(!P||P.source!=='clickup')return;
var main=document.getElementById('main');
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(n){n=Number(n);return '$'+n.toLocaleString('en-US',n%1?{minimumFractionDigits:2,maximumFractionDigits:2}:{maximumFractionDigits:0});}
function fill(v,t){if(typeof v==='string')return v.replace(/\{\{(\w+)\}\}/g,function(m,k){return Object.prototype.hasOwnProperty.call(t,k)?t[k]:m;});if(Array.isArray(v))return v.map(function(x){return fill(x,t);});if(v&&typeof v==='object'){var o={};Object.keys(v).forEach(function(k){o[k]=fill(v[k],t);});return o;}return v;}
function card(label,body){if(main)main.innerHTML='<header style="margin-bottom:1.6rem"><span class="label">'+esc(label)+'</span></header><div class="card"><p class="body" style="margin:0">'+body+'</p></div>';}
function closed(){document.title='Ampersound Media Group';if(main)main.innerHTML='<header><span class="label">Inquiry closed</span><h1 class="page">'+esc(P.client&&P.client.name||'This proposal')+'</h1><p class="body">This proposal is no longer active. No booking is confirmed through this page.</p></header><section class="card"><h2 class="sub">Want to reconnect?</h2><p class="body">Email Afia to check current availability and request a new proposal.</p><a class="btn" href="mailto:afia@ampersoundmediagroup.com">Contact Afia</a></section>';}
// When the agreement has no balance, the one payment is the whole fee, so the
// engine's deposit wording would mislead. Rewrite it everywhere except the
// contract text, which the page already words for full payment.
function onePaymentWording(){
 if(!main||!window.MutationObserver||!document.createTreeWalker)return;
 var skip=/^(TEXTAREA|INPUT|SCRIPT|STYLE)$/;
 function fix(){
  var w=document.createTreeWalker(main,4,null),n,list=[];while((n=w.nextNode()))list.push(n);
  list.forEach(function(t){var el=t.parentNode;if(!el||skip.test(el.nodeName)||(el.closest&&el.closest('ol.clauses')))return;
   var v=t.nodeValue,o=v.replace(/\bthe deposit\b/g,'your payment').replace(/\bThe deposit\b/g,'Your payment').replace(/\bDeposit\b/g,'Payment').replace(/\bdeposit\b/g,'payment');
   if(o!==v)t.nodeValue=o;});
 }
 fix();new MutationObserver(fix).observe(main,{childList:true,subtree:true,characterData:true});
}
function start(rec){
 if(rec.stage==='closed'){closed();return;}
 var c=rec.client,p=rec.pricing,agreement=P.agreement;
 var tokens={total:money(p.total),deposit:money(p.deposit),balance:money(p.balance),balanceDue:p.balanceDue||'',date:c.eventDateLong,dateShort:c.badge,start:c.start,end:c.end,guests:c.guests,venue:c.venue,client:c.name,contact:c.contacts};
 var page={};Object.keys(P).forEach(function(k){if(k!=='agreement')page[k]=fill(P[k],tokens);});
 var client=page.client||{};Object.keys(c).forEach(function(k){var v=c[k];if(v!==''&&v!=null&&!(Array.isArray(v)&&!v.length))client[k]=v;});
 client.services=client.services||[];client.inclusions=client.inclusions||[];
 var pricing=page.pricing||{};pricing.total=p.total;pricing.deposit=p.deposit;pricing.balance=p.balance;pricing.balanceDue=p.balanceDue;pricing.serviceSubtotal=p.total;delete pricing.travel;
 page.client=client;page.pricing=pricing;page.paymentLink=rec.paymentLink||'#';
 page.agreement=typeof agreement==='function'?agreement(page):agreement;
 window.PORTAL=page;
 if(rec.stage==='draft'){
  // Opening a preview must not mark the agreement as sent to the client.
  try{var key='amg-portal-'+page.slug+'-v1',s=JSON.parse(localStorage.getItem(key)||'{}');s.booking=s.booking||{};if(!s.booking.viewedAt){s.booking.viewedAt='preview';localStorage.setItem(key,JSON.stringify(s));}}catch(e){}
  var bar=document.createElement('div');bar.className='banner';bar.setAttribute('role','status');bar.style.margin='0 auto 1rem';bar.style.maxWidth='860px';
  bar.textContent='Preview: not sent to the client yet.'+(rec.issues&&rec.issues.length?' Still needed in ClickUp: '+rec.issues.join(', ')+'.':' Ready to send once you move the agreement to sent.');
  if(main&&main.parentNode)main.parentNode.insertBefore(bar,main);
 }
 if(Math.round(Number(p.balance)*100)===0&&Number(p.total)>0)onePaymentWording();
 var engine=document.createElement('script');engine.src='/partner-docs/_assets/portal.js';document.body.appendChild(engine);
}
if(main)main.innerHTML='<p class="body" style="text-align:center;color:var(--faint)">Loading your portal\u2026</p>';
fetch('/.netlify/functions/portal-record?slug='+encodeURIComponent(P.slug),{cache:'no-store'}).then(function(r){if(r.status===404)throw new Error('missing');if(!r.ok)throw new Error('down');return r.json();}).then(start).catch(function(e){
 if(e&&e.message==='missing')card('Portal not found','We could not find this portal. Check the link, or find yours at <a href="https://ampersoundmediagroup.com/client-portal/">ampersoundmediagroup.com</a> by entering your email.');
 else card('One moment','Your portal is being updated. Refresh in a minute, or email <a href="mailto:afia@ampersoundmediagroup.com">afia@ampersoundmediagroup.com</a>.');
});
})();
