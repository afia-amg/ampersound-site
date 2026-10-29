'use strict';
const {PORTALS,findAgreement,receipts,receiptsForAgreement,signatureRecord}=require('./_payment-receipts');
async function aggregate(taskId,ids){if(typeof receiptsForAgreement==='function')return receiptsForAgreement(taskId,ids);let out=[];for(const id of [taskId,...ids].filter(Boolean))out=out.concat(await receipts(id));return out;}
const headers={'Content-Type':'application/json','Cache-Control':'no-store, private, max-age=0','X-Content-Type-Options':'nosniff'};
exports.handler=async(event)=>{
 const reply=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
 if(event.httpMethod!=='GET')return reply(405,{error:'Method not allowed'});
 const config=PORTALS[(event.queryStringParameters||{}).slug];
 if(!config)return reply(404,{error:'Portal not found',verified:false,unlocked:false});
 if(!process.env.CLICKUP_API_TOKEN||!process.env.STRIPE_WEBHOOK_SECRET)return reply(503,{verified:false,unlocked:false,error:'Payment verification unavailable'});
 try{
  const installments=[];
  for(const i of config.installments||[]){
   if(i.legacyPaid){installments.push({num:i.num,paid:true,source:'existing-booking'});continue;}
   const rr=await aggregate(config.taskId||'', [i.taskId]);
   installments.push({num:i.num,paid:rr.some(r=>r.amount===i.amount&&(!r.installmentTaskId&&!r.taskId||r.installmentTaskId===i.taskId||r.taskId===i.taskId)),source:'stripe-webhook'});
  }
  if(config.legacyBooked)return reply(200,{verified:false,unlocked:true,source:'existing-booking',signed:true,installments});
  const task=await findAgreement(config);
  if(!task)return reply(200,{verified:false,unlocked:false,signed:false,installments});
  const email=(task.custom_fields||[]).find(f=>f.id==='3f38f15e-6aa4-4481-9365-d4a911d68195');
  if(!email||String(email.value||'').toLowerCase()!==config.email)throw new Error('Agreement email mismatch');
  let sig=null;
  try{sig=await signatureRecord(task);}catch(e){console.error('Signature lookup failed:',e.message);}
  const signedFields={signed:!!sig,signedName:sig?sig.signedName:null,signedAt:sig?sig.signedAt:null};
  const deposit=(task.custom_fields||[]).find(f=>f.id==='f18252f2-13c7-4b04-a8d3-2b38dc096791');
  const expected=config.amount||Math.round(Number(deposit&&deposit.value)*100);
  if(!Number.isInteger(expected)||expected<=0)throw new Error('Missing expected deposit');
  const rr=await aggregate(task.id,(config.installments||[]).map(i=>i.taskId));
  const receipt=rr.find(r=>r.amount===expected&&(!config.linkId||r.paymentLink===config.linkId));
  const total=Number((task.custom_fields||[]).find(f=>f.id==='a60f1fb7-4558-4cac-825c-abb9ea9a11e7')?.value||0)*100;
  return reply(200,{verified:!!receipt,unlocked:!!receipt,source:'stripe-webhook',paidAt:receipt?receipt.paidAt:null,installments,...signedFields});
 }catch(e){console.error('Payment status unavailable:',e.message);return reply(503,{verified:false,unlocked:false,error:'Payment verification unavailable'});}
};
