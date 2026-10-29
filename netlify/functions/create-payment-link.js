'use strict';
const STRIPE_SECRET_KEY=process.env.STRIPE_SECRET_KEY;
const SITE_URL=process.env.SITE_URL||'https://ampersoundmediagroup.com';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
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
  const link=await r.json();return{statusCode:200,headers,body:JSON.stringify({url:link.url,id:link.id,amount:Number(amount),product:name})};
 }catch(err){console.error('Error:',err.message);return{statusCode:500,headers,body:JSON.stringify({message:'Internal error'})}}
};
