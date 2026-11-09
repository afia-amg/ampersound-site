'use strict';
const crypto=require('crypto');
const {api,listTasks,scalarField,AGREEMENTS_LIST,AGREEMENT_FIELDS}=require('./_integration');
const PREFIX='AMG_STRIPE_RECEIPT_V1:',SIGNED_MARK='Agreement signed digitally',PAYMENTS_LIST='901422326497';
const PORTALS={
 'rose-josh':{email:'rose.josh.home@gmail.com',taskId:'86bct9jkz',linkId:'plink_1UVEajBKPpxdHQElGhLmUODv',amount:67500},
 'angela-joe':{email:'angelahussain99@gmail.com',taskId:'86bctjffd',linkId:'plink_1UVa9PBKPpxdHQEl78mAIESl',amount:63750},
 'acs-hope-gala':{email:'averiel.bailey@cancer.org',taskId:'86bcxhw1t',paymentMethod:'external',amount:165000},
 'jaylin-goines':{email:'jaylingoines131594@gmail.com',legacyBooked:true},'portal-test':{email:'signature-test@ampersoundmediagroup.com',taskId:'86bct9u1m',legacyBooked:true},
 'angelica-nathan':{email:'liffcakeparties@gmail.com',legacyBooked:true},'katie-ryan':{email:'ryan.nelson.jrn@gmail.com',legacyBooked:true},
 'jesse-zariah':{email:'jesseradike1@gmail.com',taskId:'86bb71btb',legacyBooked:true,installments:[{num:1,taskId:'86bb9b41r',amount:47813,legacyPaid:true},{num:2,taskId:'86bb9b41v',amount:47813,legacyPaid:true},{num:3,taskId:'86bb9b420',amount:47813},{num:4,taskId:'86bb9b426',amount:47811}]}
};
async function comments(taskId){let out=[];for(let page=0;page<50;page++){const d=await api('/task/'+encodeURIComponent(taskId)+'/comment'+(page?'?start='+encodeURIComponent(out[out.length-1].date)+'&start_id='+encodeURIComponent(out[out.length-1].id):'')),rows=d.comments||[];out.push(...rows);if(rows.length<25)return out;if(!rows[rows.length-1].id||!rows[rows.length-1].date)throw Error('Invalid comment pagination')}throw Error('Receipt history exceeded scan limit')}
function text(c){return c.comment_text||(c.comment||[]).map(x=>x.text||'').join('')}
function key(){if(!process.env.STRIPE_WEBHOOK_SECRET)throw Error('Missing webhook verification key');return process.env.STRIPE_WEBHOOK_SECRET}
function signature(v){return crypto.createHmac('sha256',key()).update(v).digest('hex')}
function seal(receipt){const d=Buffer.from(JSON.stringify(receipt)).toString('base64url');return PREFIX+d+'.'+signature(d)}
function unseal(v){try{if(typeof v!=='string'||!v.startsWith(PREFIX))return null;const p=v.slice(PREFIX.length).trim().split('.');if(p.length!==2||!/^[A-Za-z0-9_-]+$/.test(p[0])||!/^[a-f0-9]{64}$/.test(p[1]))return null;const a=Buffer.from(signature(p[0]),'hex'),b=Buffer.from(p[1],'hex');if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;const r=JSON.parse(Buffer.from(p[0],'base64url').toString());return r.v===1&&r.currency==='usd'&&Number.isInteger(r.amount)&&r.amount>0&&r.sessionId&&r.taskId?r:null}catch(_){return null}}
async function receipts(taskId){const u=new Map();for(const c of await comments(taskId)){const r=unseal(text(c));if(r&&r.taskId===taskId)u.set(r.sessionId,r)}return[...u.values()]}
async function receiptsForAgreement(agreementId,installmentIds=[]){const ids=[agreementId,...installmentIds].filter(Boolean),u=new Map();for(const id of ids)for(const r of await receipts(id))u.set(r.sessionId,r);return[...u.values()]}
function iso(v){const d=new Date(String(v||'').replace(/\s+at\s+/i,' ').replace(/\*/g,'').trim());return Number.isNaN(d.getTime())?null:d.toISOString()}
function isSignatureReset(value){
 const t=String(value||'').replace(/\r\n/g,'\n').trim();
 // Explicit control record only. Mentions or quotes in ordinary notes do not count.
 if(t==='AMG_SIGNATURE_RESET_V1')return true;
 // Compatibility with the historical Hope Gala reset record already on file.
 return /^Previous digital signature \(portal reset to unsigned at Afia's request on [A-Z][a-z]{2} \d{1,2}, \d{4}\)\nHistorical record only\. A new signature is required\.\nSigned by: [^\n]+\nDate: [^\n]+(?:\n|$)/.test(t);
}
async function signatureRecord(task){
 const status=String(task.status&&task.status.status||'').toLowerCase();
 if(task.archived||['lost','closed [lost]','cancelled','canceled','declined'].includes(status))return null;
 // Comments arrive newest first. A reset invalidates older signatures.
 for(const c of await comments(task.id)){
  const t=text(c);
  if(isSignatureReset(t))return null;
  if(t.includes(SIGNED_MARK)){
   const n=/Signed by:\**\s*([^\n*]+)/.exec(t),d=/Date:\**\s*([^\n]+)/.exec(t);
   const signedAt=(d&&iso(d[1]))||(c.date?iso(new Date(Number(c.date)).toISOString()):null);
   if(n&&signedAt)return{signedName:n[1].trim(),signedAt};
  }
 }
 return null;
}
async function findAgreement(c){if(c.taskId)return api('/task/'+encodeURIComponent(c.taskId));const e=String(c.email||'').trim().toLowerCase(),m=(await listTasks(AGREEMENTS_LIST)).filter(t=>String(scalarField(t,AGREEMENT_FIELDS.email)||'').toLowerCase()===e);if(m.length>1)throw Error('Ambiguous agreement email');return m[0]||null}
function validateInstallment(task,agreement,identity){
 const {taskIdentity,identitiesMatch,AGREEMENT_FIELDS}=require('./_integration');
 const expected=taskIdentity(agreement,AGREEMENT_FIELDS);
 if(!identitiesMatch(expected,{email:String(identity.email||'').toLowerCase(),date:String(identity.date||'').slice(0,10),type:require('./_integration').semanticType(identity.type)}))return false;
 if(task.archived||String(task.list&&task.list.id||task.list_id||'')!==PAYMENTS_LIST)return false;
 const number=Number(identity.installment);
 if(!Number.isInteger(number)||number<1)return false;
 const named=/\bPayment\s+(\d+)\b/i.exec(task.name||'');
 if(!named||Number(named[1])!==number)return false;
 // Missing event fields on a Payments task may inherit from a verified live
 // Agreement relationship or an exact server-owned mapping, never from amount alone.
 const own=taskIdentity(task,AGREEMENT_FIELDS);
 if((own.email&&own.email!==expected.email)||(own.date&&own.date!==expected.date)||(own.type&&own.type!==expected.type))return false;
 const mapped=Object.values(PORTALS).some(p=>p.taskId===agreement.id&&(p.installments||[]).some(i=>i.taskId===task.id&&i.num===number));
 const linked=(a,b)=>(a.linked_tasks||[]).some(x=>String(x.task_id||x.id||'')===b);
 return mapped||linked(task,agreement.id)||linked(agreement,task.id);
}
async function bookingState(config,task){
 if(!task)return{verified:false,unlocked:false,signed:false,source:'stripe-webhook'};
 const email=String(scalarField(task,AGREEMENT_FIELDS.email)||'').trim().toLowerCase();
 if(email!==config.email)throw Error('Agreement email mismatch');
 const status=String(task.status&&task.status.status||'').toLowerCase();
 if(task.archived||['lost','closed [lost]','cancelled','canceled','declined'].includes(status))return{verified:false,unlocked:false,signed:false,source:'stripe-webhook'};
 if(config.legacyBooked)return{verified:false,unlocked:true,signed:true,source:'existing-booking'};
 const sig=await signatureRecord(task);
 const signedFields={signed:!!sig,signedName:sig?sig.signedName:null,signedAt:sig?sig.signedAt:null};
 // ACH/Coupa is a human-verified external-payment exception, not Stripe.
 if(config.paymentMethod==='external')return{verified:false,unlocked:false,source:'external-payment',...signedFields};
 const expected=config.amount||Math.round(Number(scalarField(task,AGREEMENT_FIELDS.deposit))*100);
 if(!Number.isInteger(expected)||expected<=0)throw Error('Missing expected deposit');
 const rr=await receiptsForAgreement(task.id,(config.installments||[]).map(i=>i.taskId));
 const receipt=rr.find(r=>r.amount===expected&&(!config.linkId||r.paymentLink===config.linkId));
 return{verified:!!receipt,unlocked:!!sig&&!!receipt,source:'stripe-webhook',paidAt:receipt?receipt.paidAt:null,...signedFields};
}
module.exports={PORTALS,PAYMENTS_LIST,api,seal,unseal,receipts,receiptsForAgreement,findAgreement,signatureRecord,comments,text,validateInstallment,bookingState};
