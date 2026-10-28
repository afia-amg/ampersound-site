'use strict';
const crypto = require('crypto');
const BASE = 'https://api.clickup.com/api/v2';
const PREFIX = 'AMG_STRIPE_RECEIPT_V1:';
const SIGNED_MARK = 'Agreement signed digitally';
// Server-owned configuration, never take agreement ids or paid flags from a browser.
const PORTALS = {
 'rose-josh': {email:'rose.josh.home@gmail.com', taskId:'86bct9jkz', linkId:'plink_1UVEajBKPpxdHQElGhLmUODv', amount:67500},
 'angela-joe': {email:'angelahussain99@gmail.com', taskId:'86bctjffd', linkId:'plink_1UVa9PBKPpxdHQEl78mAIESl', amount:63750},
 // Paid outside Stripe (Apple Cash), confirmed by Afia 2026-10-28.
 'jaylin-goines': {email:'jaylingoines131594@gmail.com', legacyBooked:true},
 // Internal test record (TEST | Portal signature check). Not a client.
 'portal-test': {email:'signature-test@ampersoundmediagroup.com', taskId:'86bct9u1m', legacyBooked:true},
 // Existing booked planning portals are grandfathered explicitly on the server.
 // These grants are not evidence of a new Stripe payment.
 'angelica-nathan': {email:'liffcakeparties@gmail.com', legacyBooked:true},
 'katie-ryan': {email:'ryan.nelson.jrn@gmail.com', legacyBooked:true},
 'jesse-zariah': {email:'jesseradike1@gmail.com', legacyBooked:true, installments:[
  {num:1,taskId:'86bb9b41r',amount:47813,legacyPaid:true},
  {num:2,taskId:'86bb9b41v',amount:47813,legacyPaid:true},
  {num:3,taskId:'86bb9b420',amount:47813},
  {num:4,taskId:'86bb9b426',amount:47811}
 ]}
};
async function api(path, opts={}) {
 const r=await fetch(BASE+path,{...opts,headers:{Authorization:process.env.CLICKUP_API_TOKEN,'Content-Type':'application/json'}});
 if(!r.ok) throw new Error('ClickUp request failed: '+r.status);
 return r.json();
}
async function comments(taskId) {
 let out=[], cursor='';
 for(let page=0;page<50;page++) {
  const data=await api('/task/'+encodeURIComponent(taskId)+'/comment'+cursor);
  const rows=data.comments||[]; out=out.concat(rows);
  if(rows.length<25) return out;
  const last=rows[rows.length-1];
  if(!last.id||!last.date) throw new Error('Invalid comment pagination');
  cursor='?start='+encodeURIComponent(last.date)+'&start_id='+encodeURIComponent(last.id);
 }
 throw new Error('Receipt history exceeded scan limit');
}
function text(c) {return c.comment_text || (c.comment||[]).map(x=>x.text||'').join('');}
function key(){const k=process.env.STRIPE_WEBHOOK_SECRET;if(!k)throw new Error('Missing webhook verification key');return k;}
function signature(encoded){return crypto.createHmac('sha256',key()).update(encoded).digest('hex');}
function seal(receipt){const data=Buffer.from(JSON.stringify(receipt)).toString('base64url');return PREFIX+data+'.'+signature(data);}
function unseal(value){
 try {
  if(!value.startsWith(PREFIX))return null;
  const parts=value.slice(PREFIX.length).trim().split('.');if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||!/^[a-f0-9]{64}$/.test(parts[1]))return null;
  const expected=Buffer.from(signature(parts[0]),'hex'), actual=Buffer.from(parts[1],'hex');
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;
  const r=JSON.parse(Buffer.from(parts[0],'base64url').toString());
  return r.v===1&&r.currency==='usd'&&Number.isInteger(r.amount)&&r.amount>0&&r.sessionId&&r.taskId?r:null;
 } catch(e){return null;}
}
async function receipts(taskId){
 const rows=await comments(taskId), unique=new Map();
 for(const c of rows){const r=unseal(text(c));if(r&&r.taskId===taskId)unique.set(r.sessionId,r);}
 return [...unique.values()];
}
// The signature on the ClickUp agreement is the record of truth, so a client who
// signed on one device is never asked to sign again on another. Reads both the
// current plain note and the older bold-formatted note.
function isoOrNull(v){const t=new Date(String(v||'').replace(/\s+at\s+/i,' ').replace(/\*/g,'').trim());return isNaN(t.getTime())?null:t.toISOString();}
async function signatureRecord(task){
 const rows=await comments(task.id);
 for(const c of rows){
  const t=text(c);
  if(t.indexOf(SIGNED_MARK)!==-1){
   const n=/Signed by:\**\s*([^\n*]+)/.exec(t), d=/Date:\**\s*([^\n]+)/.exec(t);
   const when=(d&&isoOrNull(d[1]))||(c.date?new Date(Number(c.date)).toISOString():null);
   return {signedName:n?n[1].trim():null, signedAt:when};
  }
 }
 const st=String((task.status&&task.status.status)||'').toLowerCase(), ty=String((task.status&&task.status.type)||'');
 if(st==='signed'||ty==='done'||ty==='closed')return {signedName:null,signedAt:null};
 return null;
}
async function findAgreement(config){
 if(config.taskId)return api('/task/'+config.taskId);
 for(let page=0;page<100;page++){
  const d=await api('/list/901418268145/task?include_closed=true&subtasks=false&page='+page);
  const rows=d.tasks||[];
  const matches=rows.filter(t=>(t.custom_fields||[]).some(f=>f.id==='3f38f15e-6aa4-4481-9365-d4a911d68195'&&String(f.value||'').toLowerCase()===config.email));
  if(matches.length>1)throw new Error('Ambiguous agreement email');
  if(matches.length)return matches[0];
  if(d.last_page||!rows.length)return null;
 }
 throw new Error('Agreement scan limit');
}
exports.PORTALS=PORTALS;exports.api=api;exports.seal=seal;exports.unseal=unseal;exports.receipts=receipts;exports.findAgreement=findAgreement;exports.signatureRecord=signatureRecord;
