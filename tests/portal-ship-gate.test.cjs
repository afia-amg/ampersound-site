'use strict';
// Portal ship gate. Runs in the Netlify build, so a failure here keeps the
// previous deploy live instead of publishing an inconsistent portal.
// Static checks only: no ClickUp or Stripe traffic.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const MANIFEST=JSON.parse(read('tests/portal-manifest.json')).portals;
const LIVE=new Set(['awaiting-signature','booked','paid']);
const STAGES=new Set(['draft','closed',...LIVE]);
const PAYMENTS=new Set(['stripe','installments','external','legacy']);
const EMAIL=/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const STRIPE=/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/;
const cents=v=>Math.round(Number(v)*100);
const {PORTALS}=require('../netlify/functions/_payment-receipts');
const lookup=require('../netlify/functions/lookup-agreement')._test;
const toml=read('netlify.toml');
const slugs=kind=>Object.keys(MANIFEST).filter(s=>MANIFEST[s].kind===kind);
const clients=stages=>slugs('client').filter(s=>stages.has(MANIFEST[s].stage));
const slugOf=url=>{const m=/\/client-portal\/([a-z0-9-]+)/.exec(String(url||''));return m&&m[1];};

// Evaluate the page's own data script against the real shared defaults.
const cache=new Map();
function load(slug){
 if(cache.has(slug))return cache.get(slug);
 const html=read('partner-docs/'+slug+'/index.html');
 const sandbox={console:{log(){},warn(){},error(){}}};sandbox.window=sandbox;
 vm.createContext(sandbox);
 vm.runInContext(read('partner-docs/_assets/defaults.js'),sandbox,{filename:'defaults.js'});
 let found=false;
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
  if(/\bsrc\s*=/i.test(m[1])||!/window\.PORTAL\s*=/.test(m[2]))continue;
  vm.runInContext(m[2],sandbox,{filename:slug+'/index.html'});found=true;
 }
 const portal=found&&sandbox.PORTAL?JSON.parse(JSON.stringify(sandbox.PORTAL)):null;
 const out={html,portal};cache.set(slug,out);return out;
}
function pricing(p){
 if(p.pricing)return p.pricing;
 const opts=p.staffingOptions||[];
 const o=opts.find(x=>x.recommended)||opts[0];
 return o&&o.pricing;
}
const emailsOf=p=>[p.client.primaryEmail,...(p.client.allEmails||[])].filter(Boolean).map(e=>String(e).trim().toLowerCase());

test('every portal folder is registered with a valid stage',()=>{
 const dirs=fs.readdirSync(path.join(ROOT,'partner-docs'),{withFileTypes:true})
  .filter(d=>d.isDirectory()&&!d.name.startsWith('_')).map(d=>d.name);
 for(const d of dirs)assert.ok(MANIFEST[d],'Portal folder "'+d+'" is not in tests/portal-manifest.json. Register it with its kind and stage before deploying.');
 for(const s of Object.keys(MANIFEST)){
  assert.ok(dirs.includes(s),'Manifest lists "'+s+'" but partner-docs/'+s+' does not exist.');
  const m=MANIFEST[s];
  assert.ok(['client','partner','test'].includes(m.kind),s+': unknown kind '+m.kind);
  if(m.kind!=='client')continue;
  assert.ok(STAGES.has(m.stage),s+': unknown stage '+m.stage);
  if(m.stage!=='closed')assert.ok(PAYMENTS.has(m.payment),s+': payment must be one of '+[...PAYMENTS].join(', '));
 }
 for(const s of Object.keys(PORTALS))assert.ok(MANIFEST[s],'Payment registry has "'+s+'" but it is not in the portal manifest.');
});

test('client portals use client-friendly URLs and old links redirect',()=>{
 for(const s of slugs('client')){
  assert.ok(toml.includes('from = "/client-portal/'+s+'/"'),s+': missing /client-portal/ route in netlify.toml');
  assert.ok(toml.includes('from = "/partner-docs/'+s+'"'),s+': missing redirect from the old /partner-docs/ link');
  assert.equal(lookup.clientPortalUrl('/partner-docs/'+s),'/client-portal/'+s,s+': website lookup does not rewrite this portal to /client-portal/');
 }
});

test('closed inquiries cannot take a signature or payment',()=>{
 for(const s of clients(new Set(['closed']))){
  const {html}=load(s);
  assert.ok(!html.includes('_assets/portal.js'),s+': closed page still loads the signing and payment engine');
  assert.ok(!html.includes('buy.stripe.com'),s+': closed page still contains a payment link');
  assert.ok(!/window\.PORTAL\s*=/.test(html),s+': closed page still defines portal data');
  for(const [email,r] of Object.entries(lookup.STATIC))assert.notEqual(slugOf(r.portalUrl),s,s+': website lookup still returns the closed portal for '+email);
 }
});

test('draft portals stay out of the website lookup and report what blocks sending',t=>{
 for(const s of clients(new Set(['draft']))){
  for(const [email,r] of Object.entries(lookup.STATIC))assert.notEqual(slugOf(r.portalUrl),s,s+': draft portal is discoverable through lookup for '+email);
  const {portal}=load(s),missing=[];
  if(!portal)missing.push('portal data');
  else{
   if(!EMAIL.test(String(portal.client.primaryEmail||'')))missing.push('client email');
   if(MANIFEST[s].payment==='stripe'&&!STRIPE.test(String(portal.paymentLink||'')))missing.push('Stripe deposit link');
  }
  if(!PORTALS[s])missing.push('payment registry entry');
  if(!MANIFEST[s].agreementTaskId)missing.push('ClickUp agreement record');
  t.diagnostic(s+' is a draft, not ready to send. Missing: '+(missing.join(', ')||'nothing, promote it to awaiting-signature'));
 }
});

test('live portals match the payment registry and their own email',()=>{
 for(const s of clients(LIVE)){
  const m=MANIFEST[s],{portal}=load(s);
  assert.ok(portal,s+': no portal data found on the page');
  assert.equal(portal.slug,s,s+': page slug does not match its folder');
  const email=String(portal.client.primaryEmail||'').trim().toLowerCase();
  assert.match(email,EMAIL,s+': client email is missing, so signatures and payments cannot save');
  const all=(portal.client.allEmails||[]).map(e=>String(e).toLowerCase());
  if(all.length)assert.ok(all.includes(email),s+': primary email is not in allEmails');
  const c=PORTALS[s];
  assert.ok(c,s+': not in the payment registry, so payment status cannot be verified');
  assert.equal(c.email,email,s+': page email and payment registry email differ');
  if(m.agreementTaskId&&c.taskId)assert.equal(c.taskId,m.agreementTaskId,s+': payment registry points at a different ClickUp agreement');
  const pr=pricing(portal);
  assert.ok(pr,s+': no pricing on the page');
  if(m.payment==='legacy')assert.equal(c.legacyBooked,true,s+': legacy booking is not marked legacyBooked');
  if(m.payment==='external'){
   assert.equal(c.paymentMethod,'external',s+': external payment is not registered as external');
   assert.equal(c.amount,cents(pr.total),s+': external payment amount differs from the page total');
  }
  if(m.payment==='stripe'){
   assert.ok(c.linkId,s+': Stripe portal has no registered payment link id');
   assert.equal(c.amount,cents(pr.deposit),s+': registered deposit differs from the page deposit');
  }
  if(m.payment==='installments'){
   const page=(pr.installments||[]).map(i=>[i.num,cents(i.amount)]);
   const reg=(c.installments||[]).map(i=>[i.num,i.amount]);
   assert.deepEqual(reg,page,s+': installment schedule differs between page and payment registry');
  }
  if(m.stage==='awaiting-signature'){
   assert.equal(portal.mode,'proposal',s+': unsigned portal is not in proposal mode');
   assert.ok(portal.agreement&&(portal.agreement.clauses||[]).length,s+': unsigned portal has no agreement to sign');
  }
 }
});

test('live portal pricing adds up and matches its stage',()=>{
 for(const s of clients(LIVE)){
  const m=MANIFEST[s],pr=pricing(load(s).portal);
  assert.ok(cents(pr.total)>0,s+': total must be positive');
  const inst=pr.installments||[];
  if(inst.length){
   assert.equal(inst.reduce((n,i)=>n+cents(i.amount),0),cents(pr.total),s+': installments do not add up to the total');
   const unpaid=inst.filter(i=>!/^paid$/i.test(String(i.status||'')));
   assert.equal(cents(pr.balance),unpaid.reduce((n,i)=>n+cents(i.amount),0),s+': balance differs from the unpaid installments');
   if(m.stage==='paid')assert.equal(unpaid.length,0,s+': marked paid but installments are still open');
  }else if(m.stage==='paid'){
   assert.equal(cents(pr.balance),0,s+': marked paid but the page still shows a balance');
  }else{
   assert.equal(cents(pr.deposit)+cents(pr.balance),cents(pr.total),s+': deposit plus balance does not equal the total');
  }
 }
});

test('clients have a working way to pay what the portal asks for',()=>{
 for(const s of clients(LIVE)){
  const m=MANIFEST[s],{portal}=load(s),pr=pricing(portal);
  if(m.stage==='awaiting-signature'&&m.payment==='stripe')assert.match(String(portal.paymentLink||''),STRIPE,s+': unsigned Stripe portal has no deposit link');
  if(m.payment==='installments'&&m.stage!=='paid'){
   const next=(pr.installments||[]).find(i=>!/^paid$/i.test(String(i.status||'')));
   if(next)assert.match(String(next.link||''),STRIPE,s+': next installment '+next.num+' has no payment link');
  }
  if(STRIPE.test(String(portal.paymentLink||''))&&m.stage==='paid')assert.equal(PORTALS[s].legacyBooked,true,s+': paid portal still exposes a deposit link');
 }
});

test('website lookup fallback matches the portal it opens',()=>{
 for(const [email,r] of Object.entries(lookup.STATIC)){
  const s=slugOf(r.portalUrl);
  assert.ok(s&&MANIFEST[s],email+': lookup points at an unregistered portal');
  assert.ok(LIVE.has(MANIFEST[s].stage),email+': lookup returns '+s+', which is '+MANIFEST[s].stage);
  const {portal}=load(s),pr=pricing(portal);
  assert.ok(emailsOf(portal).includes(email),email+': not listed on the '+s+' page, so that client cannot sign or save');
  assert.equal(r.eventDate,portal.client.eventDate,email+': lookup date differs from the '+s+' page');
  assert.equal(cents(r.totalFee),cents(pr.total),email+': lookup total differs from the '+s+' page');
  assert.equal(cents(r.deposit),cents(pr.deposit),email+': lookup deposit differs from the '+s+' page');
 }
});
