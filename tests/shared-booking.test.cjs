'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto');
process.env.CLICKUP_API_TOKEN='mock-only';
process.env.STRIPE_WEBHOOK_SECRET='mock-only-secret';
const root='../netlify/functions/';
const R=require(root+'_payment-receipts'),I=require(root+'_integration');
let records={},commentRows={},writes=[];
global.fetch=async(url,opts={})=>{
 const path=String(url).replace('https://api.clickup.com/api/v2','');
 const method=opts.method||'GET';
 if(method!=='GET'){
  writes.push({path,method,body:JSON.parse(opts.body||'{}')});
  if(path.endsWith('/comment')){
   const id=path.split('/')[2];
   (commentRows[id]??=[]).unshift({comment_text:JSON.parse(opts.body).comment_text});
  }
  return{ok:true,json:async()=>({})};
 }
 const m=/^\/task\/([^/?]+)(\/comment)?/.exec(path);
 if(!m)throw Error('Unexpected mock GET '+path);
 return{ok:true,json:async()=>structuredClone(m[2]?{comments:commentRows[m[1]]||[]}:records[m[1]])};
};
function agreement(id='86bctjffd',email='angelahussain99@gmail.com'){
 return{id,list:{id:I.AGREEMENTS_LIST},status:{status:'signed'},custom_fields:[
  {id:I.AGREEMENT_FIELDS.email[0],value:email},
  {id:I.AGREEMENT_FIELDS.eventDate[0],value:'2027-05-28'},
  {id:I.AGREEMENT_FIELDS.eventType[0],value:'Wedding'},
  {id:I.AGREEMENT_FIELDS.deposit[0],value:637.5}
 ]};
}
const sig={comment_text:'Agreement signed digitally\nSigned by: Angela Hussain\nDate: 2026-10-28T01:22:04.638Z'};
function reset(){
 records={};commentRows={};writes=[];
 const a=agreement();records[a.id]=a;commentRows[a.id]=[sig];return a;
}
function receipt(a,extra={}){
 return{comment_text:R.seal({v:1,currency:'usd',amount:63750,sessionId:'cs_mock',taskId:a.id,paymentLink:R.PORTALS['angela-joe'].linkId,paidAt:'2026-10-28T22:56:12Z',...extra})};
}
function payment(id='86bd0phz5',num=2){
 return{id,name:'Angela Hussain | Payment '+num+' | 2027-05-14',list:{id:R.PAYMENTS_LIST},linked_tasks:[{task_id:'86bctjffd'}],custom_fields:[{id:'8959bbca-2010-4fd4-b31d-c7c8c262fe3b',value:637.5}]};
}
function identity(a,num=2){
 const i=I.taskIdentity(a,I.AGREEMENT_FIELDS);return{...i,agreement:a.id,installment:String(num)};
}
test('Angela: current signature plus authenticated receipt unlocks',async()=>{
 const a=reset();commentRows[a.id].unshift(receipt(a));
 const state=await R.bookingState(R.PORTALS['angela-joe'],a);
 assert.equal(state.verified,true);assert.equal(state.signed,true);assert.equal(state.unlocked,true);
});
test('receipt alone does not unlock',async()=>{
 const a=reset();commentRows[a.id]=[receipt(a)];
 const state=await R.bookingState(R.PORTALS['angela-joe'],a);
 assert.equal(state.verified,true);assert.equal(state.unlocked,false);
});
test('signature alone and forged receipt stay locked',async()=>{
 const a=reset();commentRows[a.id].push({comment_text:'AMG_STRIPE_RECEIPT_V1:fake.bad'});
 assert.equal((await R.bookingState(R.PORTALS['angela-joe'],a)).unlocked,false);
});
test('reset blocks older signature; a new signature after reset works',async()=>{
 const a=reset();commentRows[a.id]=[{comment_text:'Previous digital signature (portal reset to unsigned)\nHistorical record only. A new signature is required.'},sig];
 assert.equal(await R.signatureRecord(a),null);
 commentRows[a.id].unshift(sig);assert.equal((await R.signatureRecord(a)).signedName,'Angela Hussain');
});
test('signed status without a signature record is not signature evidence',async()=>{
 const a=reset();commentRows[a.id]=[];assert.equal(await R.signatureRecord(a),null);
});
test('lost or archived agreement cannot unlock',async()=>{
 const a=reset();commentRows[a.id].unshift(receipt(a));a.status.status='lost';
 assert.equal((await R.bookingState(R.PORTALS['angela-joe'],a)).unlocked,false);
 a.status.status='signed';a.archived=true;
 assert.equal((await R.bookingState(R.PORTALS['angela-joe'],a)).unlocked,false);
});
test('Hope Gala uses external $1650 terms, no obsolete Stripe gate',async()=>{
 const a=reset();const c=R.PORTALS['acs-hope-gala'];a.id=c.taskId;a.custom_fields[0].value=c.email;commentRows[a.id]=[sig];
 assert.equal(c.amount,165000);assert.equal(c.linkId,undefined);
 const state=await R.bookingState(c,a);
 assert.equal(state.source,'external-payment');assert.equal(state.unlocked,false);assert.equal(state.verified,false);
});
test('explicit legacy booking preserved, but email mismatch rejected',async()=>{
 const a=reset();const c={email:'angelahussain99@gmail.com',legacyBooked:true};
 assert.equal((await R.bookingState(c,a)).source,'existing-booking');
 await assert.rejects(R.bookingState({...c,email:'wrong@example.com'},a),/email mismatch/);
});
test('Angela balance inherits identity only through live Agreement relationship',()=>{
 const a=reset(),p=payment();assert.equal(R.validateInstallment(p,a,identity(a)),true);
 p.linked_tasks=[];assert.equal(R.validateInstallment(p,a,identity(a)),false);
 a.linked_tasks=[{task_id:p.id}];assert.equal(R.validateInstallment(p,a,identity(a)),true);
});
test('reject conflicting email/date/type, wrong list, installment, archive and arbitrary link',()=>{
 const a=reset();
 for(const f of [{id:I.AGREEMENT_FIELDS.email[0],value:'wrong@example.com'},{id:I.AGREEMENT_FIELDS.eventDate[0],value:'2027-05-29'},{id:I.AGREEMENT_FIELDS.eventType[0],value:'Corporate'}]){
  const p=payment();p.custom_fields.push(f);assert.equal(R.validateInstallment(p,a,identity(a)),false);
 }
 const p=payment();assert.equal(R.validateInstallment(p,a,{...identity(a),email:'wrong@example.com'}),false);
 assert.equal(R.validateInstallment(p,a,identity(a,3)),false);
 p.archived=true;assert.equal(R.validateInstallment(p,a,identity(a)),false);
 p.archived=false;p.list.id='wrong';assert.equal(R.validateInstallment(p,a,identity(a)),false);
});
test('Jesse final installment has exact server mapping; unrelated installment does not',()=>{
 const a=reset();a.id='86bb71btb';a.custom_fields[0].value='jesseradike1@gmail.com';a.custom_fields[1].value='2027-04-28';
 const p=payment('86bb9b426',4);p.name='Jesse Radike | Payment 4 | 2027-03-28';p.linked_tasks=[];
 assert.equal(R.validateInstallment(p,a,identity(a,4)),true);
 p.id='arbitrary';assert.equal(R.validateInstallment(p,a,identity(a,4)),false);
});
function event(a,p,amount=63750,session='cs_installment'){
 const now=Math.floor(Date.now()/1000);
 const body=JSON.stringify({id:'evt_mock',type:'checkout.session.completed',created:now,data:{object:{
  id:session,payment_status:'paid',currency:'usd',amount_total:amount,customer_details:{email:'angelahussain99@gmail.com'},
  metadata:{agreement_task_id:a.id,installment_task_id:p.id,installment:'2',email:'angelahussain99@gmail.com',event_date:'2027-05-28',event_type:'Wedding'}
 }}});
 const h=crypto.createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(now+'.'+body).digest('hex');
 return{httpMethod:'POST',headers:{'stripe-signature':`t=${now},v1=${h}`},body};
}
test('real webhook handler completes linked Angela installment once, replay does not duplicate receipt',async()=>{
 const a=reset(),p=payment();a.status.status='lost';records[p.id]=p;commentRows[a.id]=[];
 // Lost status suppresses commercial stage changes, not recording actual money received.
 const handler=require(root+'stripe-webhook').handler;
 assert.equal((await handler(event(a,p))).statusCode,200);
 assert(writes.some(w=>w.path==='/task/'+p.id&&w.body.status==='completed'));
 const count=writes.filter(w=>w.path.endsWith('/comment')).length;
 assert.equal((await handler(event(a,p))).statusCode,200);
 assert.equal(writes.filter(w=>w.path.endsWith('/comment')).length,count);
});
test('webhook rejects wrong amount and unlinked payment without writes',async()=>{
 const a=reset(),p=payment();records[p.id]=p;
 const handler=require(root+'stripe-webhook').handler;
 assert.equal((await handler(event(a,p,100))).statusCode,422);assert.equal(writes.length,0);
 p.linked_tasks=[];assert.equal((await handler(event(a,p))).statusCode,422);assert.equal(writes.length,0);
});
test('payment-status and planning GET agree on signature gate',async()=>{
 const a=reset();commentRows[a.id]=[receipt(a)];
 const status=await require(root+'payment-status').handler({httpMethod:'GET',queryStringParameters:{slug:'angela-joe'}});
 const planning=await require(root+'portal-data').handler({httpMethod:'GET',queryStringParameters:{slug:'angela-joe'}});
 assert.equal(status.statusCode,200);assert.equal(planning.statusCode,200);
 assert.equal(JSON.parse(status.body).unlocked,false);assert.equal(JSON.parse(planning.body).unlocked,false);
});
test('Jesse Payment 4 completes through actual webhook with $478.11',async()=>{
 const a=reset();delete records[a.id];a.id='86bb71btb';a.status.status='lost';
 a.custom_fields[0].value='jesseradike1@gmail.com';a.custom_fields[1].value='2027-04-28';records[a.id]=a;
 const p=payment('86bb9b426',4);p.name='Jesse Radike | Payment 4 | 2027-03-28';p.linked_tasks=[];p.custom_fields=[];
 records[p.id]=p;commentRows[a.id]=[];
 const e=event(a,p,47811),body=JSON.parse(e.body),s=body.data.object;
 s.customer_details.email='jesseradike1@gmail.com';
 Object.assign(s.metadata,{email:'jesseradike1@gmail.com',event_date:'2027-04-28',installment:'4'});
 e.body=JSON.stringify(body);const t=Math.floor(Date.now()/1000);
 e.headers['stripe-signature']=`t=${t},v1=`+crypto.createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(t+'.'+e.body).digest('hex');
 assert.equal((await require(root+'stripe-webhook').handler(e)).statusCode,200);
 assert(writes.some(w=>w.path==='/task/'+p.id&&w.body.status==='completed'));
});
test('pending bank payment does not write receipts or complete installment',async()=>{
 const a=reset(),p=payment();records[p.id]=p;
 const e=event(a,p),body=JSON.parse(e.body);body.data.object.payment_status='unpaid';
 e.body=JSON.stringify(body);const t=Math.floor(Date.now()/1000);
 e.headers['stripe-signature']=`t=${t},v1=`+crypto.createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(t+'.'+e.body).digest('hex');
 const res=await require(root+'stripe-webhook').handler(e);
 assert.equal(res.statusCode,200);assert.equal(JSON.parse(res.body).pending,true);assert.equal(writes.length,0);
});
