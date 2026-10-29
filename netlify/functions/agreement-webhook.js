'use strict';
const {api,findAgreement,signatureRecord,receiptsForAgreement,PORTALS}=require('./_payment-receipts');
const {syncLeadStage,findAgreementByIdentity,listTasks,AGREEMENTS_LIST,CLOSED_LOST,scalarField,semanticType,AGREEMENT_FIELDS}=require('./_integration');
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://ampersoundmediagroup.com','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(status,data)=>({statusCode:status,headers,body:JSON.stringify(data)});
function retryable(err){return !/Ambiguous|mismatch|No unambiguous|not in Leads/i.test(String(err&&err.message||err))}
function listId(t){return String(t&&t.list&&t.list.id||t&&t.list_id||'')}
async function resolvePublicAgreement(p){
 const email=p.email.trim().toLowerCase(),date=String(p.event_date||p.eventDate||'').slice(0,10),type=p.event_type||p.eventType||'';
 if(p.taskId){
  const task=await findAgreement({taskId:p.taskId});
  if(!task||listId(task)!==AGREEMENTS_LIST)return null;
  const actualEmail=String(scalarField(task,AGREEMENT_FIELDS.email)||'').trim().toLowerCase(),actualDate=String(scalarField(task,AGREEMENT_FIELDS.eventDate)||'').slice(0,10),actualType=semanticType(scalarField(task,AGREEMENT_FIELDS.eventType));
  if(!date||!type||!actualEmail||actualEmail!==email||!actualDate||actualDate!==date||!actualType||actualType!==semanticType(type))return 'mismatch';
  return task;
 }
 if(!date)return null;
 const matches=(await listTasks(AGREEMENTS_LIST)).filter(task=>{
  const status=String(task.status&&task.status.status||'').toLowerCase();
  if(CLOSED_LOST.has(status))return false;
  const actualEmail=String(scalarField(task,AGREEMENT_FIELDS.email)||'').trim().toLowerCase(),actualDate=String(scalarField(task,AGREEMENT_FIELDS.eventDate)||'').slice(0,10),actualType=semanticType(scalarField(task,AGREEMENT_FIELDS.eventType));
  return actualEmail===email&&actualDate===date&&(!type||actualType===semanticType(type));
 });
 if(matches.length>1)throw Error('Ambiguous agreement identity');
 return matches[0]||null;
}
async function syncAfterSignature(task,p){
 const portal=Object.values(PORTALS).find(x=>x.taskId===task.id),ids=(portal&&portal.installments||[]).map(x=>x.taskId),rs=await receiptsForAgreement(task.id,ids),deposit=Number(scalarField(task,AGREEMENT_FIELDS.deposit)||0)*100,satisfied=deposit>0&&rs.reduce((n,r)=>n+Number(r.amount||0),0)>=deposit;
 if(!satisfied)return syncLeadStage(task,'signed',p);
 return syncLeadStage(task,'deposit',p);
}
exports.handler=async event=>{
 if(event.httpMethod==='OPTIONS')return reply(204,{});if(event.httpMethod!=='POST')return reply(405,{error:'Method not allowed'});
 let p;try{p=JSON.parse(event.body||'')}catch(_){return reply(400,{error:'Invalid JSON'})}
 if(p.action==='paid'||p.action==='installment')return reply(403,{ok:false,error:'Payment confirmations require verified Stripe webhook'});
 if(!['signed','viewed'].includes(p.action)||typeof p.email!=='string'||!p.email.trim())return reply(400,{error:'Invalid action or email'});
 if(!process.env.CLICKUP_API_TOKEN)return reply(503,{error:'Agreement service unavailable'});
 try{
  const task=await resolvePublicAgreement(p);if(task==='mismatch')return reply(409,{ok:false,error:'Agreement identity mismatch'});if(!task)return reply(p.action==='signed'?404:200,{ok:p.action!=='signed',message:'No matching agreement'});
  const status=String(task.status&&task.status.status||'').toLowerCase();if(p.action==='viewed'){if(status==='draft')await api('/task/'+task.id,{method:'PUT',body:JSON.stringify({status:'sent'})});return reply(200,{ok:true,taskId:task.id})}
  const prior=await signatureRecord(task);
  if(prior){let leadSync;try{leadSync=await syncAfterSignature(task,p)}catch(err){if(retryable(err))return reply(503,{ok:false,error:'Lead stage sync temporarily unavailable; retry required'});leadSync={updated:false,reason:'ambiguous-or-unavailable'}}return reply(200,{ok:true,taskId:task.id,alreadySigned:true,signedName:prior.signedName,signedAt:prior.signedAt,leadSync})}
  const m=/^data:(image\/png);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(p.signature||'');if(!m||!p.signerName||!p.signedAt||!Number.isFinite(new Date(p.signedAt).getTime()))return reply(400,{ok:false,error:'Signature, signer and timestamp required'});
  const bytes=Buffer.from(m[2],'base64');if(bytes.length>2*1024*1024||bytes.length<8||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')return reply(400,{ok:false,error:'Invalid signature image'});
  let signatureSaved='attachment';try{const form=new FormData(),name='signature-'+String(p.signerName).toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40)+'-'+String(p.signedAt).slice(0,10)+'.png';form.append('attachment',new Blob([bytes],{type:'image/png'}),name);const r=await fetch('https://api.clickup.com/api/v2/task/'+task.id+'/attachment',{method:'POST',headers:{Authorization:process.env.CLICKUP_API_TOKEN},body:form});if(!r.ok)throw Error('Signature attachment failed: '+r.status)}catch(_){signatureSaved='comment';await api('/task/'+task.id+'/comment',{method:'POST',body:JSON.stringify({comment_text:'Digital signature image fallback\nSigner: '+p.signerName+'\nTimestamp: '+p.signedAt+'\n'+p.signature})})}
  await api('/task/'+task.id+'/comment',{method:'POST',body:JSON.stringify({comment_text:'Agreement signed digitally\nSigned by: '+p.signerName+'\nDate: '+p.signedAt+'\nPackage: '+(p.package||'N/A')+'\nTotal: $'+Number(p.total_fee||0).toFixed(2)+'\nEvent: '+(p.event_date||'N/A')+'\nSignature: saved as '+signatureSaved})});await api('/task/'+task.id,{method:'PUT',body:JSON.stringify({status:'signed'})});let leadSync;try{leadSync=await syncAfterSignature(task,p)}catch(err){if(retryable(err))return reply(503,{ok:false,error:'Lead stage sync temporarily unavailable; retry required'});leadSync={updated:false,reason:'ambiguous-or-unavailable'}}return reply(200,{ok:true,taskId:task.id,newStatus:'signed',signatureSaved,leadSync});
 }catch(err){console.error('Agreement submission failed:',err.message);return reply(503,{ok:false,error:'Agreement service temporarily unavailable; retry required'})}
};
