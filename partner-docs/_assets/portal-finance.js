/* Supplement the signed portal without changing its executed agreement text. */
(function(){
'use strict';
var P=window.PORTAL,main=document.getElementById('main');
if(!P||P.slug!=='angela-joe'||!main)return;
var state=null,balance=null;
function render(){
 var old=document.getElementById('account-summary');
 if(old)old.remove();
 if(!state||!state.unlocked||!state.signed)return;
 var card=document.createElement('section');card.className='card';card.id='account-summary';
 var title=document.createElement('h2');title.className='sub';title.textContent='Your booking and payments';card.appendChild(title);
 var paid=balance&&balance.paid;
 var info=document.createElement('p');info.className='body';
 info.textContent=paid?'Paid in full. Total received: $1,275.00. Remaining balance: $0.00.':'Agreement signed. Deposit received: $637.50. Remaining balance: $637.50, due May 14, 2027.';
 card.appendChild(info);
 if(!paid){var link=document.createElement('a');link.className='btn';link.href='/client-portal/angela-joe/balance.html';link.textContent='Pay final balance $637.50';card.appendChild(link);}
 main.prepend(card);
 var label=main.querySelector('header > .label');if(label&&label.textContent==='Proposal for')label.textContent='Your confirmed booking';
 main.querySelectorAll('.total .split .k').forEach(function(p){if(p.textContent==='Deposit to hold the date'){p.textContent='Deposit received';var note=p.parentElement.querySelector('.n');if(note)note.textContent='Received October 28, 2026';}});
 main.querySelectorAll('p.body').forEach(function(p){
  if(p.textContent.indexOf('Talk it over together. When you are ready, sign and place the deposit')===0)p.textContent='Your signed agreement and deposit are on file. Use the payment summary above for your remaining balance. Your music and timeline tabs are ready for planning.';
 });
 var nav=document.querySelector('[data-tab="proposal"]');if(nav)nav.textContent='Agreement & Booking';
}
new MutationObserver(function(records){if(records.some(function(r){return r.target===main&&Array.from(r.addedNodes).some(function(n){return n.nodeType===1&&n.id!=='account-summary';});}))render();}).observe(main,{childList:true});
async function refresh(){try{var response=await fetch('/.netlify/functions/payment-status?slug=angela-joe',{cache:'no-store'});if(!response.ok)throw Error('Status unavailable');state=await response.json();var b=await fetch('/.netlify/functions/balance-checkout?slug=angela-joe',{cache:'no-store'});balance=b.ok?await b.json():null;render();}catch(_){/* Original portal keeps its fail-closed payment notice. */}}
refresh();window.addEventListener('focus',refresh);
})();
