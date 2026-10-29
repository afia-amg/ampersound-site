'use strict';
const crypto=require('crypto');
const {api,listTasks,scalarField,AGREEMENTS_LIST,AGREEMENT_FIELDS}=require('./_integration');
const PREFIX='AMG_STRIPE_RECEIPT_V1:',SIGNED_MARK='Agreement signed digitally',PAYMENTS_LIST='901422326497';
const PORTALS={
 'rose-josh':{email:'rose.josh.home@gmail.com',taskId:'86bct9jkz',linkId:'plink_1UVEajBKPpxdHQElGhLmUODv',amount:67500},
 'angela-joe':{email:'angelahussain99@gmail.com',taskId:'86bctjffd',linkId:'plink_1UVa9PBKPpxdHQEl78mAIESl',amount:63750},
 'jaylin-goines':{email:'jaylingoines131594@gmail.com',legacyBooked:true},'portal-test':{email:'signature-test@ampersoundmediagroup.com',taskId:'86bct9u1m',legacyBooked:true},
 'angelica-nathan':{email:'liffcakeparties@gmail.com',legacyBooked:true},'katie-ryan':{email:'ryan.nelson.jrn@gmail.com',legacyBooked:true},
 'jesse-zariah':{email:'jesseradike1@gmail.com',legacyBooked:true,installments:[{num:1,taskId:'86bb9b41r',amount:47813,legacyPaid:true},{num:2,taskId:'86bb9b41v',amount:47813,legacyPaid:true},{num:3,taskId:'86bb9b420',amount:47813},{num:4,taskId:'86bb9b426',amount:47811}]}
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
async function signatureRecord(task){for(const c of await comments(task.id)){const t=text(c);if(t.includes(SIGNED_MARK)){const n=/Signed by:\**\s*([^\n*]+)/.exec(t),d=/Date:\**\s*([^\n]+)/.exec(t);return{signedName:n?n[1].trim():null,signedAt:(d&&iso(d[1]))||(c.date?new Date(Number(c.date)).toISOString():null)}}}const st=String(task.status&&task.status.status||'').toLowerCase();return st==='signed'?{signedName:null,signedAt:null}:null}
async function findAgreement(c){if(c.taskId)return api('/task/'+encodeURIComponent(c.taskId));const e=String(c.email||'').trim().toLowerCase(),m=(await listTasks(AGREEMENTS_LIST)).filter(t=>String(scalarField(t,AGREEMENT_FIELDS.email)||'').toLowerCase()===e);if(m.length>1)throw Error('Ambiguous agreement email');return m[0]||null}
module.exports={PORTALS,PAYMENTS_LIST,api,seal,unseal,receipts,receiptsForAgreement,findAgreement,signatureRecord,comments,text};
