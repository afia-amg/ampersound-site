'use strict';
const {api,scalarField,AGREEMENT_FIELDS}=require('./_integration');
const {PORTALS,findAgreement,bookingState,receiptsForAgreement}=require('./_payment-receipts');
const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const FIELD='959cae43-8c7a-43b4-b0ce-2513b311b227';
const reply=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
function paidBalance(rows,id,amount){return rows.some(r=>r.amount===amount&&r.installmentTaskId===id);}
exports.handler=async event=>{
 if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'Method not allowed'});
 let slug=(event.queryStringParameters||{}).slug;
 if(event.httpMethod==='POST'){try{slug=JSON.parse(event.body||'{}').slug;}catch(_){return reply(400,{error:'Invalid JSON'});}}
 if(slug!=='angela-joe')return reply(404,{error:'Balance not configured'});
 if(!process.env.CLICKUP_API_TOKEN||!process.env.STRIPE_WEBHOOK_SECRET)return reply(503,{error:'Balance service unavailable'});
 const config=PORTALS[slug],part=(config.installments||[]).find(i=>i.num===2);
 if(!part)return reply(503,{error:'Balance configuration unavailable'});
 try{
  const agreement=await findAgreement(config),state=await bookingState(config,agreement);
  if(!state.unlocked)return reply(403,{error:'Your signed booking and deposit must be confirmed first'});
  const task=await api('/task/'+part.taskId);
  if(task.archived||String(task.list&&task.list.id||'')!=='901422326497'||!/^Angela Hussain \| Payment 2 \|/.test(task.name||''))return reply(409,{error:'Balance record mismatch'});
  const cents=Math.round(Number(scalarField(task,'8959bbca-2010-4fd4-b31d-c7c8c262fe3b'))*100);
  const email=String(scalarField(agreement,AGREEMENT_FIELDS.email)||'').toLowerCase();
  if(cents!==63750||cents!==part.amount||email!==config.email)return reply(409,{error:'Balance identity or amount mismatch'});
  const receipts=await receiptsForAgreement(agreement.id,[part.taskId]);
  if(paidBalance(receipts,part.taskId,cents))return reply(200,{paid:true,amount:cents/100});
  const existing=scalarField(task,FIELD);
  if(existing&&/^https:\/\/buy\.stripe\.com\//.test(existing))return reply(200,{paid:false,url:existing,amount:cents/100});
  if(event.httpMethod==='GET')return reply(200,{paid:false,url:null,amount:cents/100});
  if(!process.env.STRIPE_SECRET_KEY)return reply(503,{error:'Secure checkout unavailable'});
  async function stripe(path,body,key){const r=await fetch('https://api.stripe.com/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key},body});if(!r.ok)throw Error('Stripe checkout creation failed');return r.json();}
  const price=await stripe('prices',new URLSearchParams({unit_amount:String(cents),currency:'usd','product_data[name]':'Angela & Joe Wedding - Final Balance'}),'amg-angela-final-balance-price-v1');
  const metadata={client:'Angela Hussain & Joe Bianco',event:'Angela & Joe Wedding',event_date:'2027-05-28',event_type:'Wedding',email:config.email,taskId:part.taskId,agreement_task_id:agreement.id,installment_task_id:part.taskId,installment:'2'};
  const body=new URLSearchParams({'line_items[0][price]':price.id,'line_items[0][quantity]':'1','payment_method_types[0]':'card','payment_method_types[1]':'us_bank_account','after_completion[type]':'redirect','after_completion[redirect][url]':'https://ampersoundmediagroup.com/client-portal/angela-joe/?installment=2'});
  for(const [key,value] of Object.entries(metadata))body.set('metadata['+key+']',value);
  const link=await stripe('payment_links',body,'amg-angela-final-balance-link-v1');
  if(!/^https:\/\/buy\.stripe\.com\//.test(link.url||''))throw Error('Invalid checkout destination');
  await api('/task/'+part.taskId+'/field/'+FIELD,{method:'POST',body:JSON.stringify({value:link.url})});
  return reply(200,{paid:false,url:link.url,amount:cents/100});
 }catch(error){console.error('Balance checkout:',error.message);return reply(503,{error:'We could not prepare checkout. No payment was taken. Please try again or contact Afia.'});}
};
exports._test={paidBalance};
