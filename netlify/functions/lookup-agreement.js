'use strict';
const {api,listTasks,scalarField,semanticType,AGREEMENT_FIELDS,CLOSED_LOST}=require('./_integration');
const {receipts,signatureRecord}=require('./_payment-receipts');
const CLICKUP_API_TOKEN=process.env.CLICKUP_API_TOKEN;
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const STATIC={
 'ryan.nelson.jrn@gmail.com':{eventName:'Katie & Ryan Wedding',eventDate:'2026-10-09',eventType:'Wedding',venue:'Utah State Capitol',services:'DJ / Sound Direction, MC / Event Hosting, Audio / AV Production',totalFee:1912.5,deposit:965.25,portalUrl:'https://ampersoundmediagroup.com/partner-docs/katie-ryan',signed:true},
 'jesseradike1@gmail.com':{eventName:'Jesse & Zariah Wedding',eventDate:'2027-04-28',eventType:'Wedding',venue:'Grand Falls',services:'DJ / Sound Direction, MC / Event Hosting',totalFee:1912.5,deposit:478.13,portalUrl:'https://ampersoundmediagroup.com/partner-docs/jesse-zariah',signed:true,legacyPaidInstallments:2},
 'liffcakeparties@gmail.com':{eventName:'Angelica & Nathan Wedding',eventDate:'2026-09-05',eventType:'Wedding',venue:'Backyard',services:'DJ / Sound Direction, MC / Event Hosting',totalFee:900,deposit:900,portalUrl:'https://ampersoundmediagroup.com/partner-docs/angelica-nathan',signed:true},
 'jaylingoines131594@gmail.com':{eventName:'Delta Sigma Theta Farwest Regional After Party',eventDate:'2026-09-05',eventType:'Private Party',venue:'Drift Lounge',services:'DJ / Sound Direction',totalFee:400,deposit:400,portalUrl:'https://ampersoundmediagroup.com/partner-docs/jaylin-goines',signed:true},
 'rose.josh.home@gmail.com':{eventName:'Rose & Josh Wedding',eventDate:'2027-08-27',eventType:'Wedding',venue:'The Castle at Wadley Farms, Lindon, Utah',services:'MC / Event Hosting, DJ / Sound Direction, Timeline & Run-of-Show Coordination',totalFee:1350,deposit:675,portalUrl:'https://ampersoundmediagroup.com/partner-docs/rose-josh'},
 'angelahussain99@gmail.com':{eventName:'Angela & Joe Wedding',eventDate:'2027-05-28',eventType:'Wedding',venue:'Red Butte Garden, Salt Lake City, Utah',services:'MC / Event Hosting, DJ / Sound Direction, Ceremony Sound, Timeline & Run-of-Show Coordination',totalFee:1275,deposit:637.5,portalUrl:'https://ampersoundmediagroup.com/partner-docs/angela-joe',signed:true}
};
STATIC['kategeis@hotmail.com']=STATIC['ryan.nelson.jrn@gmail.com'];STATIC['ashleyveenendaal23@gmail.com']=STATIC['ryan.nelson.jrn@gmail.com'];STATIC['zlj7123@gmail.com']=STATIC['jesseradike1@gmail.com'];
function emailInTask(t){const e=String(scalarField(t,AGREEMENT_FIELDS.email)||'').trim().toLowerCase();return e||(t.description||'').match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i)||''}
function money(v){const n=Number(v);return Number.isFinite(n)?n:null}
async function formatTask(task,alias){const name=scalarField(task,AGREEMENT_FIELDS.eventName)||task.name,date=scalarField(task,AGREEMENT_FIELDS.eventDate)||'TBD',type=scalarField(task,AGREEMENT_FIELDS.eventType),deposit=money(scalarField(task,AGREEMENT_FIELDS.deposit)),total=money(scalarField(task,AGREEMENT_FIELDS.total)),statusName=String(task.status&&task.status.status||'').toLowerCase();if(CLOSED_LOST.has(statusName))return null;const signed=!!(await signatureRecord(task))||statusName==='signed',rs=await receipts(task.id),paid=!!(signed&&deposit>0&&rs.reduce((n,r)=>n+Number(r.amount||0),0)>=deposit*100),stage=signed?'agreement':(['sent','proposal','agreement sent','viewed'].includes(statusName)?'proposal':'proposal'),aliasMatches=!!(alias&&String(date)===String(alias.eventDate)&&semanticType(type)===semanticType(alias.eventType)),url=scalarField(task,AGREEMENT_FIELDS.agreementDoc)||(aliasMatches&&alias.portalUrl)||null;return{id:task.id,eventName:name,eventDate:date,eventType:type,venue:scalarField(task,'25f7eed6-37ba-49e7-918a-e6040531b58f'),services:scalarField(task,'605ff2b7-983f-43e1-8f78-fc684d140f80'),totalFee:total,deposit,stage,status:signed?'signed':(stage==='proposal'&&statusName!=='draft'?'awaiting_signature':'draft'),paymentStatus:paid?'paid':(alias&&alias.legacyPaidInstallments?'partial':'unpaid'),portalUrl:url,actions:url?'<a href="'+url+'">Open Client Portal</a>':'<a href="/agreement/sign?token='+task.id+'&view=true">View Agreement</a>'}}
function staticResult(email){const s=STATIC[email];if(!s)return null;const signed=!!s.signed,partial=Number(s.legacyPaidInstallments||0)>0;return{id:'static-'+email.split('@')[0],...s,stage:signed?'agreement':'proposal',status:signed?'signed':'awaiting_signature',paymentStatus:partial?'partial':'unpaid',actions:s.portalUrl?'<a href="'+s.portalUrl+'">Open Client Portal</a>':''}}
exports.handler=async event=>{
 if(event.httpMethod==='OPTIONS')return{statusCode:204,headers,body:''};
 if(event.httpMethod!=='POST')return{statusCode:405,headers,body:JSON.stringify({message:'Method not allowed'})};
 let body;try{body=JSON.parse(event.body||'{}')}catch(_){return{statusCode:400,headers,body:JSON.stringify({message:'Invalid request'})}}
 const email=String(body.email||'').trim().toLowerCase();
 if(!email||!email.includes('@'))return{statusCode:400,headers,body:JSON.stringify({message:'Valid email required'})};
 if(!CLICKUP_API_TOKEN)return{statusCode:500,headers,body:JSON.stringify({message:'Server configuration error'})};
 try{
  const active=await listTasks('901418268145'),alias=STATIC[email]||null;
  const emailTasks=active.filter(t=>String(emailInTask(t)).toLowerCase()===email),lost=emailTasks.some(t=>CLOSED_LOST.has(String(t.status&&t.status.status||'').toLowerCase())),tasks=emailTasks.filter(t=>!CLOSED_LOST.has(String(t.status&&t.status.status||'').toLowerCase()));
  if(!tasks.length&&lost)return{statusCode:404,headers,body:JSON.stringify({message:'No active agreement found for this email.'})};
  const live=[];for(const t of tasks){const f=await formatTask(t,alias);if(f)live.push(f)}
  if(live.length)return{statusCode:200,headers,body:JSON.stringify({agreements:live})};
  const legacyResult=staticResult(email);if(legacyResult)return{statusCode:200,headers,body:JSON.stringify({agreements:[legacyResult]})};
  return{statusCode:404,headers,body:JSON.stringify({message:'No agreements found for this email.'})}
 }catch(err){console.error('Lookup error:',err.message);return{statusCode:503,headers,body:JSON.stringify({message:'Agreement lookup temporarily unavailable'})}}
};
exports._test={STATIC,staticResult,formatTask};
