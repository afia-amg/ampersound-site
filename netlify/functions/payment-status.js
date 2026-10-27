'use strict';
const {PORTALS,findAgreement,receipts}=require('./_payment-receipts');
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
   const rr=await receipts(i.taskId);
   installments.push({num:i.num,paid:rr.some(r=>r.amount===i.amount),source:'stripe-webhook'});
  }
  if(config.legacyBooked)return reply(200,{verified:false,unlocked:true,source:'existing-booking',installments});
  const task=await findAgreement(config);
  if(!task)return reply(200,{verified:false,unlocked:false,installments});
  const email=(task.custom_fields||[]).find(f=>f.id==='3f38f15e-6aa4-4481-9365-d4a911d68195');
  if(!email||String(email.value||'').toLowerCase()!==config.email)throw new Error('Agreement email mismatch');
  const deposit=(task.custom_fields||[]).find(f=>f.id==='f18252f2-13c7-4b04-a8d3-2b38dc096791');
  const expected=config.amount||Math.round(Number(deposit&&deposit.value)*100);
  if(!Number.isInteger(expected)||expected<=0)throw new Error('Missing expected deposit');
  const rr=await receipts(task.id);
  const receipt=rr.find(r=>r.amount===expected&&(!config.linkId||r.paymentLink===config.linkId));
  return reply(200,{verified:!!receipt,unlocked:!!receipt,source:'stripe-webhook',paidAt:receipt?receipt.paidAt:null,installments});
 }catch(e){console.error('Payment status unavailable:',e.message);return reply(503,{verified:false,unlocked:false,error:'Payment verification unavailable'});}
};
