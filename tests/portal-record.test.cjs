'use strict';
// Phase 2 record builder: stage, fact mapping and the checks that keep a broken
// ClickUp agreement from reaching a client. Pure functions, no network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recordFrom,configFor,F}=require('../netlify/functions/_portal-record');
const EMAIL='3f38f15e-6aa4-4481-9365-d4a911d68195',TYPE='f36884b1-eb6a-40b4-b1eb-ab75d0370ebc';
function task({status='sent',email='client@example.invalid',date=Date.UTC(2026,11,9,12),total=400,deposit=200,balance=200,method='Credit / Debit Card',link='https://buy.stripe.com/test123',linkId='plink_test123',extra=[]}={}){
 const dd=(id,name)=>({id,type:'drop_down',value:0,type_config:{options:[{id:'o',name,orderindex:0}]}});
 return {id:'agreement-1',status:{status},custom_fields:[
  {id:F.slug,type:'short_text',value:'vessel-kitchen-herriman'},{id:F.organization,type:'short_text',value:'Vessel Kitchen'},{id:F.clientName,type:'short_text',value:'Aubrey'},
  {id:EMAIL,type:'email',value:email},{id:F.eventDate,type:'date',value:date==null?null:String(date)},dd(TYPE,'Other'),
  {id:F.start,type:'short_text',value:'5:00 PM'},{id:F.end,type:'short_text',value:'9:00 PM'},
  {id:F.venueName,type:'short_text',value:'Vessel Kitchen Herriman'},{id:F.venueAddress,type:'short_text',value:'13314 S Towne Cmns Dr'},
  {id:F.guests,type:'number',value:100},{id:F.services,type:'labels',value:['dj'],type_config:{options:[{id:'dj',label:'DJ / Sound Direction'}]}},
  {id:F.total,type:'currency',value:total},{id:F.deposit,type:'currency',value:deposit},{id:F.balance,type:'currency',value:balance},
  {id:F.balanceDueDate,type:'date',value:String(Date.UTC(2026,10,25,12))},dd(F.paymentMethod,method),
  {id:F.paymentLink,type:'url',value:link},{id:F.stripeLinkId,type:'short_text',value:linkId},...extra]};
}
test('a complete sent agreement becomes a clean client record',()=>{
 const r=recordFrom(task(),'vessel-kitchen-herriman');
 assert.deepEqual(r.issues,[]);
 assert.equal(r.stage,'awaiting-signature');
 assert.equal(r.client.name,'Vessel Kitchen');assert.equal(r.client.contacts,'Aubrey');
 assert.equal(r.client.primaryEmail,'client@example.invalid');
 assert.equal(r.client.eventDate,'2026-12-09');assert.equal(r.client.eventDateLong,'Wednesday, December 9, 2026');assert.equal(r.client.badge,'Dec 9, 2026');
 assert.equal(r.client.eventType,'Other');assert.deepEqual(r.client.services,['DJ / Sound Direction']);
 assert.equal(r.pricing.balanceDue,'November 25, 2026');assert.equal(r.paymentLink,'https://buy.stripe.com/test123');
});
test('missing email and mismatched money are reported, not shown to clients',()=>{
 const r=recordFrom(task({email:'',balance:150}));
 assert.ok(r.issues.includes('Client Email'));
 assert.ok(r.issues.some(i=>/does not equal Total Fee/.test(i)));
});
test('an evening time on the event date is caught before it shifts the day',()=>{
 // 8:15 PM Mountain on Sep 5 is Sep 6 in UTC: the Jaylin lookup bug.
 const r=recordFrom(task({date:Date.UTC(2026,8,6,2,15)}));
 assert.ok(r.issues.some(i=>/evening time/.test(i)));
});
test('agreement status sets the portal stage',()=>{
 assert.equal(recordFrom(task({status:'lost'})).stage,'closed');
 assert.equal(recordFrom(task({status:'signed'})).stage,'booked');
 assert.equal(recordFrom(task({status:'signed',deposit:400,balance:0})).stage,'paid');
 const d=recordFrom(task({status:'draft',link:'',linkId:''}));
 assert.equal(d.stage,'draft');assert.ok(d.issues.includes('Payment Link'));assert.ok(d.issues.includes('Stripe Link ID'));
});
test('bank-transfer clients need no Stripe link and verify against the total',()=>{
 const t=task({method:'ACH / Bank Transfer',link:'',linkId:''});
 assert.deepEqual(recordFrom(t).issues,[]);
 const c=configFor(t);
 assert.equal(c.paymentMethod,'external');assert.equal(c.amount,40000);assert.equal(c.email,'client@example.invalid');assert.equal(c.taskId,'agreement-1');
});
test('card clients verify against the deposit and their Stripe link',()=>{
 const c=configFor(task());
 assert.equal(c.amount,20000);assert.equal(c.linkId,'plink_test123');assert.equal(c.paymentMethod,undefined);
});
