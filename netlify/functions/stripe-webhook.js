'use strict';
// Only this signature-verified endpoint can issue portal-unlock receipts.
const crypto=require('crypto');
const {PORTALS,api,seal,receipts}=require('./_payment-receipts');
const FIELD='96105ecf-6396-4fb1-90aa-93b37c9dfc48';
const RECEIVED='7601cdf4-5cee-49ef-a8bf-802350a5bdcc';
const headers={'Content-Type':'application/json'};
function validSignature(body,header){
 const secret=process.env.STRIPE_WEBHOOK_SECRET;if(!secret||!header)return false;
 const entries=header.split(',').map(x=>x.split('='));
 const timestamp=(entries.find(x=>x[0]==='t')||[])[1];
 if(!/^\d+$/.test(timestamp||'')||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
 const expected=crypto.createHmac('sha256',secret).update(timestamp+'.'+body).digest();
 return entries.filter(x=>x[0]==='v1').some(x=>{const b=Buffer.from(x[1]||'','hex');return b.length===expected.length&&crypto.timingSafeEqual(b,expected);});
}
exports.handler=async(event)=>{
 const reply=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
 if(event.httpMethod!=='POST')return reply(405,{error:'Method not allowed'});
 if(!process.env.STRIPE_WEBHOOK_SECRET||!process.env.CLICKUP_API_TOKEN)return reply(503,{error:'Webhook unavailable'});
 const body=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):event.body||'';
 if(!validSignature(body,(event.headers||{})['stripe-signature']||(event.headers||{})['Stripe-Signature']))return reply(401,{error:'Invalid signature'});
 let e;try{e=JSON.parse(body);}catch(_){return reply(400,{error:'Invalid JSON'});}
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(e.type))return reply(200,{ignored:true});
 const s=e.data&&e.data.object;
 if(!s||s.payment_status!=='paid')return reply(200,{pending:true});
 const md=s.metadata||{};
 const known=Object.values(PORTALS).find(p=>p.linkId&&p.linkId===s.payment_link);
 const taskId=known?known.taskId:(md.clickup_task_id||md.taskId);
 if(!taskId){console.error('Paid Stripe session has no agreement routing:',s.id);return reply(422,{error:'Missing agreement routing'});}
 if(known&&((md.clickup_task_id||md.taskId)&&taskId!==(md.clickup_task_id||md.taskId)))return reply(422,{error:'Agreement routing mismatch'});
 if(s.currency!=='usd'||!Number.isInteger(s.amount_total)||s.amount_total<=0)return reply(422,{error:'Unexpected payment currency or amount'});
 if(known&&s.amount_total!==known.amount)return reply(422,{error:'Deposit amount mismatch'});
 try{
  const task=await api('/task/'+encodeURIComponent(taskId));
  if(known){const email=(task.custom_fields||[]).find(f=>f.id==='3f38f15e-6aa4-4481-9365-d4a911d68195');if(!email||String(email.value||'').toLowerCase()!==known.email)throw new Error('Agreement email mismatch');}
  const existing=await receipts(taskId);
  if(!existing.some(r=>r.sessionId===s.id)){
   const receipt={v:1,eventId:e.id,sessionId:s.id,taskId,paymentLink:s.payment_link||null,currency:s.currency,amount:s.amount_total,paidAt:new Date(e.created*1000).toISOString()};
   await api('/task/'+encodeURIComponent(taskId)+'/comment',{method:'POST',body:JSON.stringify({comment_text:seal(receipt)})});
   const label=md.installment?'Installment '+md.installment:'Deposit / payment';
   const text=label+' received via Stripe\nAmount: $'+(s.amount_total/100).toFixed(2)+'\nClient: '+(md.client||s.customer_details?.email||'Client')+'\nStripe payment: '+(s.payment_intent||s.id)+'\nVerified receipt saved. Remaining balance, if any, is still due.';
   await api('/task/'+encodeURIComponent(taskId)+'/comment',{method:'POST',body:JSON.stringify({comment_text:text})});
   if(md.deal_task_id)await api('/task/'+encodeURIComponent(md.deal_task_id)+'/comment',{method:'POST',body:JSON.stringify({comment_text:text})});
   if(process.env.CLICKUP_CHAT_CHANNEL_ID){try{await fetch('https://api.clickup.com/api/v3/chat/'+process.env.CLICKUP_CHAT_CHANNEL_ID+'/message',{method:'POST',headers:{Authorization:process.env.CLICKUP_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({content:text})});}catch(err){console.error('Chat notification failed',err.message);}}
  }
  // Retrying an event repairs field updates without issuing another receipt.
  await api('/task/'+encodeURIComponent(taskId)+'/field/'+FIELD,{method:'POST',body:JSON.stringify({value:RECEIVED})});
  // A deposit must not close the main agreement. Only installment tasks close.
  if(md.installment&&!known)await api('/task/'+encodeURIComponent(taskId),{method:'PUT',body:JSON.stringify({status:'completed'})});
  return reply(200,{received:true});
 }catch(err){console.error('Stripe receipt failed:',err.message);return reply(500,{error:'Payment recording failed; retry required'});}
};
