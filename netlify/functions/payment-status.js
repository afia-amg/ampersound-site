'use strict';
const {PORTALS,findAgreement,receipts,receiptsForAgreement,bookingState}=require('./_payment-receipts');
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
  const task=await findAgreement(config);
  const state=await bookingState(config,task);
  return reply(200,{...state,installments});
 }catch(e){console.error('Payment status unavailable:',e.message);return reply(503,{verified:false,unlocked:false,error:'Payment verification unavailable'});}
};
