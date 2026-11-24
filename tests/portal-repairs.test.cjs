'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const integration=require('../netlify/functions/_integration');
function helper({signed=true,paid=false,reset=false}={}){
 const rows=[];
 if(reset)rows.push({comment_text:'AMG_SIGNATURE_RESET_V1'});
 if(signed)rows.push({comment_text:'Agreement signed digitally\nSigned by: Test Signer\nDate: 2026-11-23T00:00:00Z'});
 const c={module:{exports:{}},exports:{},Buffer,process:{env:{STRIPE_WEBHOOK_SECRET:'test-only'}},require:n=>n==='crypto'?crypto:{...integration,api:async()=>({comments:rows})}};
 vm.runInNewContext(read('netlify/functions/_payment-receipts.js'),c);
 const api=c.module.exports,config=api.PORTALS['acs-hope-gala'];
 const task={id:config.taskId,status:{status:'signed'},custom_fields:[
  {id:integration.AGREEMENT_FIELDS.email[0],value:config.email},
  {id:integration.AGREEMENT_FIELDS.total[0],value:1650},
  {id:'96105ecf-6396-4fb1-90aa-93b37c9dfc48',value:paid?'7601cdf4-5cee-49ef-a8bf-802350a5bdcc':'9a1bc76a-867d-4b41-9c07-1e1cbc060c04'}
 ]};return{api,config,task};
}
test('ACS opens only after operator confirms full ACH and current signature exists',async()=>{
 for(const options of [{signed:true,paid:false},{signed:false,paid:true},{signed:true,paid:true,reset:true}]){
  const h=helper(options),state=await h.api.bookingState(h.config,h.task);assert.equal(state.unlocked,false);
 }
 const h=helper({signed:true,paid:true}),state=await h.api.bookingState(h.config,h.task);
 assert.equal(state.unlocked,true);assert.equal(state.verified,false);assert.equal(state.source,'existing-booking');assert.equal(state.confirmationSource,'operator-confirmed-ach');
});
test('ACS confirmation rejects wrong total, identity, lost or archived record',async()=>{
 for(const change of [t=>{t.custom_fields[1].value=825;},t=>{t.custom_fields[0].value='other@example.invalid';},t=>{t.status.status='lost';},t=>{t.archived=true;}]){
  const h=helper({paid:true});change(h.task);assert.equal(h.api.externalPaymentConfirmed(h.task,h.config),false);
 }
});
function balanceHarness({unlocked=true,paid=false,amount=637.5,existing=null}={}){
 const writes=[],stripeCalls=[],cfg={email:'angelahussain99@gmail.com',taskId:'86bctjffd',installments:[{num:2,taskId:'86bd0phz5',amount:63750}]};
 const agreement={id:cfg.taskId,custom_fields:[{id:integration.AGREEMENT_FIELDS.email[0],value:cfg.email}]};
 const payment={id:'86bd0phz5',name:'Angela Hussain | Payment 2 | 2027-05-14',list:{id:'901422326497'},custom_fields:[{id:'8959bbca-2010-4fd4-b31d-c7c8c262fe3b',value:amount},{id:'959cae43-8c7a-43b4-b0ce-2513b311b227',value:existing}]};
 const deps={PORTALS:{'angela-joe':cfg},findAgreement:async()=>agreement,bookingState:async()=>({unlocked}),receiptsForAgreement:async()=>paid?[{amount:63750,installmentTaskId:payment.id}]:[]};
 const context={exports:{},URLSearchParams,console:{error(){}},process:{env:{CLICKUP_API_TOKEN:'test-only',STRIPE_WEBHOOK_SECRET:'test-only',STRIPE_SECRET_KEY:'test-only'}},require:n=>n==='./_integration'?{...integration,api:async(url,options)=>{if(options){writes.push({url,body:JSON.parse(options.body)});return{};}return payment;}}:deps,
 fetch:async(url,options)=>{stripeCalls.push({url,body:new URLSearchParams(options.body),headers:options.headers});return{ok:true,json:async()=>url.endsWith('/prices')?{id:'price_test'}:{id:'plink_test',url:'https://buy.stripe.com/test_only'}};}};
 vm.runInNewContext(read('netlify/functions/balance-checkout.js'),context);
 return{writes,stripeCalls,call:async(method='POST')=>{const r=await context.exports.handler({httpMethod:method,queryStringParameters:{slug:'angela-joe'},body:JSON.stringify({slug:'angela-joe',amount:1,taskId:'wrong-task'})});return{status:r.statusCode,...JSON.parse(r.body)};}};
}
test('balance creation ignores browser amounts and routes to exact agreement and Payment 2',async()=>{
 const h=balanceHarness(),r=await h.call();assert.equal(r.status,200);assert.equal(r.amount,637.5);assert.equal(r.paid,false);
 assert.equal(h.stripeCalls[0].body.get('unit_amount'),'63750');
 const md=h.stripeCalls[1].body;assert.equal(md.get('metadata[agreement_task_id]'),'86bctjffd');assert.equal(md.get('metadata[installment_task_id]'),'86bd0phz5');assert.equal(md.get('metadata[installment]'),'2');assert.equal(md.get('metadata[email]'),'angelahussain99@gmail.com');
 assert.equal(md.get('after_completion[redirect][url]'),'https://ampersoundmediagroup.com/client-portal/angela-joe/?installment=2');
 assert.equal(h.writes.length,1);assert.match(h.writes[0].url,/86bd0phz5\/field\/959cae43/);assert.equal(h.writes[0].body.value,'https://buy.stripe.com/test_only');
 assert.ok(h.stripeCalls.every(c=>c.headers['Idempotency-Key']));
});
test('balance GET never creates links; existing or paid balances cannot generate a new checkout',async()=>{
 const h=balanceHarness();assert.equal((await h.call('GET')).url,null);assert.equal(h.stripeCalls.length,0);assert.equal(h.writes.length,0);
 const e=balanceHarness({existing:'https://buy.stripe.com/existing'});assert.equal((await e.call()).url,'https://buy.stripe.com/existing');assert.equal(e.stripeCalls.length,0);
 const p=balanceHarness({paid:true});assert.equal((await p.call()).paid,true);assert.equal(p.stripeCalls.length,0);
});
test('balance checkout rejects unsigned/unconfirmed deposit and amount conflicts without writes',async()=>{
 for(const options of [{unlocked:false},{amount:1}]){const h=balanceHarness(options),r=await h.call();assert.ok([403,409].includes(r.status));assert.equal(h.writes.length,0);assert.equal(h.stripeCalls.length,0);}
});
function portal(slug){const context={window:{},AMG:{wedding:spec=>spec}};for(const m of read('partner-docs/'+slug+'/index.html').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(!/src=/.test(m[1])&&m[2].includes('window.PORTAL'))vm.runInNewContext(m[2],context);}return context.window.PORTAL;}
test('Katie is settled and Jesse first installment is August 15',()=>{
 const k=portal('katie-ryan');assert.equal(k.pricing.balance,0);assert.equal(k.pricing.balanceDue,null);assert.equal(k.paymentLink,'#');
 const j=portal('jesse-zariah');assert.equal(j.pricing.installments[0].due,'August 15, 2026');assert.equal(j.pricing.balance,956.24);
});
test('closed Rose/Josh page contains no signing engine or Stripe payment URL',()=>{
 const source=read('partner-docs/rose-josh/index.html');assert.match(source,/Inquiry closed/);assert.doesNotMatch(source,/buy\.stripe\.com|data-step|portal\.js/);
});
