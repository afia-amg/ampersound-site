'use strict';
const STRIPE_SECRET_KEY=process.env.STRIPE_SECRET_KEY;
const SITE_URL=process.env.SITE_URL||'https://ampersoundmediagroup.com';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const PAYMENT_LINK_FIELD='959cae43-8c7a-43b4-b0ce-2513b311b227',STRIPE_LINK_ID_FIELD='0ad085ae-ef3b-4aaa-b251-895a5536a443';
// Phase 2: a new deposit link is written straight onto its ClickUp agreement, so the
// portal and payment checks read it from there. This endpoint is public, so it only
// fills empty fields and only when the amount is exactly the agreement's deposit.
async function saveToAgreement(agreementId,cents,link){
 if(!process.env.CLICKUP_API_TOKEN||!agreementId)return false;
 const {api,scalarField,AGREEMENTS_LIST,AGREEMENT_FIELDS}=require('./_integration');
 const t=await api('/task/'+encodeURIComponent(agreementId));
 if(String(t.list&&t.list.id||t.list_id||'')!==AGREEMENTS_LIST)return false;
 if(Math.round(Number(scalarField(t,AGREEMENT_FIELDS.deposit))*100)!==cents)return false;
 if(String(scalarField(t,STRIPE_LINK_ID_FIELD)||'').trim()||String(scalarField(t,PAYMENT_LINK_FIELD)||'').trim())return false;
 await api('/task/'+encodeURIComponent(t.id)+'/field/'+PAYMENT_LINK_FIELD,{method:'POST',body:JSON.stringify({value:link.url})});
 await api('/task/'+encodeURIComponent(t.id)+'/field/'+STRIPE_LINK_ID_FIELD,{method:'POST',body:JSON.stringify({value:link.id})});
 return true;
}
exports.handler=async event=>{
 if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
 if(event.httpMethod!=='POST')return{statusCode:405,headers,body:JSON.stringify({message:'Method not allowed'})};
 if(!STRIPE_SECRET_KEY)return{statusCode:500,headers,body:JSON.stringify({message:'Stripe not configured'})};
 let d;try{d=JSON.parse(event.body||'{}')}catch(_){return{statusCode:400,headers,body:JSON.stringify({message:'Invalid request'})}}
 const {clientName,eventName,eventDate,eventType,venue,services,amount,balance,taskId,agreementTaskId,installmentTaskId,installment,leadTaskId,email}=d;
 if(!amount||!clientName)return{statusCode:400,headers,body:JSON.stringify({message:'clientName and amount required'})};
 const cents=Math.round(Number(amount)*100);if(!Number.isFinite(cents)||cents<100)return{statusCode:400,headers,body:JSON.stringify({message:'Invalid amount (minimum $1)'})};
 const agreementId=agreementTaskId||(installmentTaskId?'':taskId||'');
 const installmentId=installmentTaskId||((installment!=null&&taskId&&agreementTaskId&&taskId!==agreementTaskId)?taskId:'');
 const metadata={client:clientName,event:eventName||'',event_date:eventDate||'',event_type:eventType||'',email:email||'',taskId:taskId||'',agreement_task_id:agreementId,installment_task_id:installmentId,installment:installment==null?'':String(installment),lead_task_id:leadTaskId||''};
 const name=clientName+' - '+(eventName||'Event')+' Deposit';
 const redirect=SITE_URL+'/booking-confirmed?'+new URLSearchParams({event:eventName||'',date:eventDate||'',venue:venue||'',services:services||'',paid:'$'+Number(amount).toLocaleString(),balance:balance?'$'+Number(balance).toLocaleString():'$0'}).toString();
 try{
  const priceBody=new URLSearchParams({unit_amount:String(cents),currency:'usd','product_data[name]':name});
  for(const[k,v]of Object.entries(metadata))priceBody.set('product_data[metadata]['+k+']',v);
  let r=await fetch('https://api.stripe.com/v1/prices',{method:'POST',headers:{Authorization:'Bearer '+STRIPE_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded'},body:priceBody});
  if(!r.ok)return{statusCode:502,headers,body:JSON.stringify({message:'Failed to create Stripe price'})};
  const price=await r.json();
  const linkBody=new URLSearchParams({'line_items[0][price]':price.id,'line_items[0][quantity]':'1','payment_method_types[0]':'card','payment_method_types[1]':'us_bank_account','after_completion[type]':'redirect','after_completion[redirect][url]':redirect});
  for(const[k,v]of Object.entries(metadata))linkBody.set('metadata['+k+']',v);
  r=await fetch('https://api.stripe.com/v1/payment_links',{method:'POST',headers:{Authorization:'Bearer '+STRIPE_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded'},body:linkBody});
  if(!r.ok)return{statusCode:502,headers,body:JSON.stringify({message:'Failed to create Stripe payment link'})};
  const link=await r.json();
  let savedToAgreement=false;
  if(!installmentId){try{savedToAgreement=await saveToAgreement(agreementId,cents,link);}catch(e){console.error('Agreement link save skipped:',e.message);}}
  return{statusCode:200,headers,body:JSON.stringify({url:link.url,id:link.id,amount:Number(amount),product:name,savedToAgreement})};
 }catch(err){console.error('Error:',err.message);return{statusCode:500,headers,body:JSON.stringify({message:'Internal error'})}}
};
