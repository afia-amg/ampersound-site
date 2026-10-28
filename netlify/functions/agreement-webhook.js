'use strict';
const {api,findAgreement,signatureRecord}=require('./_payment-receipts');
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://ampersoundmediagroup.com','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
exports.handler=async(event)=>{
 const reply=(status,data)=>({statusCode:status,headers,body:JSON.stringify(data)});
 if(event.httpMethod==='OPTIONS')return reply(204,{});
 if(event.httpMethod!=='POST')return reply(405,{error:'Method not allowed'});
 let p;try{p=JSON.parse(event.body);}catch(_){return reply(400,{error:'Invalid JSON'});}
 // URL flags, cached outboxes and public requests can never record payments.
 if(p.action==='paid'||p.action==='installment')return reply(403,{ok:false,error:'Payment confirmations require the verified Stripe webhook'});
 if(!['signed','viewed'].includes(p.action)||typeof p.email!=='string'||!p.email.trim())return reply(400,{error:'Invalid action or email'});
 if(!process.env.CLICKUP_API_TOKEN)return reply(503,{error:'Agreement service unavailable'});
 try{
  const task=await findAgreement({email:p.email.trim().toLowerCase()});
  if(!task)return reply(p.action==='signed'?404:200,{ok:p.action!=='signed',message:'No matching agreement'});
  const status=(task.status?.status||'').toLowerCase();
  if(p.action==='viewed'){
   if(status==='draft')await api('/task/'+task.id,{method:'PUT',body:JSON.stringify({status:'sent'})});
   return reply(200,{ok:true,taskId:task.id});
  }
  // One signature per agreement. A second device or a queued retry never files
  // a duplicate or moves the agreement's status backward.
  const prior=await signatureRecord(task);
  if(prior)return reply(200,{ok:true,taskId:task.id,alreadySigned:true,signedName:prior.signedName,signedAt:prior.signedAt});
  const m=/^data:(image\/png);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(p.signature||'');
  if(!m||!p.signerName||!p.signedAt||!Number.isFinite(new Date(p.signedAt).getTime()))return reply(400,{ok:false,error:'Signature, signer and timestamp required'});
  const bytes=Buffer.from(m[2],'base64');
  if(bytes.length>2*1024*1024||bytes.length<8||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return reply(400,{ok:false,error:'Invalid signature image'});
  let signatureSaved='attachment';
  try{
   const form=new FormData();
   const name='signature-'+String(p.signerName).toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40)+'-'+String(p.signedAt).slice(0,10)+'.png';
   form.append('attachment',new Blob([bytes],{type:'image/png'}),name);
   const r=await fetch('https://api.clickup.com/api/v2/task/'+task.id+'/attachment',{method:'POST',headers:{Authorization:process.env.CLICKUP_API_TOKEN},body:form});
   if(!r.ok)throw new Error('Signature attachment failed: '+r.status);
  }catch(err){
   signatureSaved='comment';
   await api('/task/'+task.id+'/comment',{method:'POST',body:JSON.stringify({comment_text:'Digital signature image fallback\nSigner: '+p.signerName+'\nTimestamp: '+p.signedAt+'\n'+p.signature})});
  }
  await api('/task/'+task.id+'/comment',{method:'POST',body:JSON.stringify({comment_text:'Agreement signed digitally\nSigned by: '+p.signerName+'\nDate: '+p.signedAt+'\nPackage: '+(p.package||'N/A')+'\nTotal: $'+Number(p.total_fee||0).toFixed(2)+'\nEvent: '+(p.event_date||'N/A')+'\nSignature: saved as '+signatureSaved})});
  await api('/task/'+task.id,{method:'PUT',body:JSON.stringify({status:'signed'})});
  return reply(200,{ok:true,taskId:task.id,newStatus:'signed',signatureSaved});
 }catch(err){console.error('Agreement submission failed:',err.message);return reply(500,{ok:false,error:'Agreement could not be recorded'});}
};
