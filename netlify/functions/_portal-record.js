'use strict';
// Phase 2: a client portal's facts come from its ClickUp agreement, found by the
// Portal Slug field. The page, payment checks and signature matching all read the
// same fields, so they cannot drift apart. Email, date and type use the exact same
// field lookup as agreement-webhook.js, so a signature always finds its agreement.
const {listTasks,field,scalarField,AGREEMENTS_LIST,AGREEMENT_FIELDS,CLOSED_LOST}=require('./_integration');
const F={
 slug:'09d1d129-cbae-4e16-99ef-83e41c8888fc',stripeLinkId:'0ad085ae-ef3b-4aaa-b251-895a5536a443',
 clientName:'01b694ba-6da6-4e4c-a3d3-af4b96a7a0c5',organization:'aeeee479-3136-47c0-b10e-a2512f92a065',
 eventName:'4299965c-96e2-430e-947a-ac16e9068aee',eventDate:'4006b42c-6597-49ea-bbb6-beb6bcc323b8',
 start:'c694927d-9f80-45bc-a99f-5ba5b2b1929c',end:'ac7880e0-051f-4208-a7b5-819243839076',
 venueName:'25f7eed6-37ba-49e7-918a-e6040531b58f',venueAddress:'bde68d62-d513-4406-b65b-23923f723c37',
 guests:'a0aae2d5-a1b1-4a81-aaa0-fdbbd0294d48',services:'605ff2b7-983f-43e1-8f78-fc684d140f80',
 total:'a60f1fb7-4558-4cac-825c-abb9ea9a11e7',deposit:'f18252f2-13c7-4b04-a8d3-2b38dc096791',
 balance:'61d4c0c8-2f98-46ba-9c6e-fec7ca31981c',balanceDueDate:'c74c04b1-9999-48b1-a885-819166b664ad',
 paymentLink:'959cae43-8c7a-43b4-b0ce-2513b311b227',paymentMethod:'81020cc8-bdad-4008-9507-db8c8a520b87'
};
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/,EMAIL=/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/,STRIPE=/^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/,PLINK=/^plink_[A-Za-z0-9]+$/;
function text(t,id){const v=scalarField(t,id);return v==null?'':String(v).trim();}
function num(t,id){const v=scalarField(t,id);if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
const cents=n=>Math.round(Number(n)*100);
function labels(t,id){const f=field(t,id);if(!f||!Array.isArray(f.value))return[];const o=(f.type_config&&f.type_config.options)||[];return f.value.map(v=>{const key=v&&typeof v==='object'?v.id:v,x=o.find(p=>p.id===key);return x?(x.label||x.name):null;}).filter(Boolean);}
function fmt(iso,opts){if(!iso)return'';const d=new Date(iso+'T12:00:00Z');return Number.isNaN(d.getTime())?'':d.toLocaleDateString('en-US',{...opts,timeZone:'UTC'});}
// The calendar day Afia sees in ClickUp (Mountain Time). Signature matching uses the
// UTC day, so a late-evening time on the date field would split the two.
function denverDay(t,id){const f=field(t,id);if(!f||f.value==null||f.value==='')return null;const n=Number(f.value);if(!Number.isFinite(n))return null;return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(n<1e11?n*1000:n));}
function stageOf(t){
 const s=String(t.status&&t.status.status||'').toLowerCase();
 if(t.archived||CLOSED_LOST.has(s))return'closed';
 if(s==='draft')return'draft';
 if(s==='signed'){const b=num(t,F.balance);return b!==null&&cents(b)<=0?'paid':'booked';}
 return'awaiting-signature';
}
function recordFrom(t,slug){
 const stage=stageOf(t),issues=[];
 const email=String(scalarField(t,AGREEMENT_FIELDS.email)||'').trim().toLowerCase();
 const date=String(scalarField(t,AGREEMENT_FIELDS.eventDate)||'').slice(0,10);
 const type=String(scalarField(t,AGREEMENT_FIELDS.eventType)||'').trim();
 const name=text(t,F.organization)||text(t,F.clientName),contact=text(t,F.clientName)||name;
 const start=text(t,F.start),end=text(t,F.end),window=start&&end?start+' to '+end:'';
 const total=num(t,F.total),deposit=num(t,F.deposit),balance=num(t,F.balance);
 const balanceDue=String(scalarField(t,F.balanceDueDate)||'').slice(0,10);
 const method=text(t,F.paymentMethod),external=/ach|bank|check/i.test(method);
 const link=text(t,F.paymentLink),linkId=text(t,F.stripeLinkId),guests=num(t,F.guests);
 const rec={slug:slug||text(t,F.slug).toLowerCase(),stage,updatedAt:t.date_updated?new Date(Number(t.date_updated)).toISOString():null,
  client:{name,contacts:contact,signerDefault:contact,primaryEmail:email,allEmails:email?[email]:[],eventDate:date,
   eventDateLong:fmt(date,{weekday:'long',month:'long',day:'numeric',year:'numeric'}),badge:fmt(date,{month:'short',day:'numeric',year:'numeric'}),
   eventName:text(t,F.eventName),eventType:type,venue:text(t,F.venueName),venueDetail:text(t,F.venueAddress),
   guests:guests==null?'':String(guests),start,end,coverageWindow:window,hours:window,services:labels(t,F.services)},
  pricing:{total,deposit,balance,balanceDue:fmt(balanceDue,{month:'long',day:'numeric',year:'numeric'})},
  paymentLink:STRIPE.test(link)?link:'#',payment:external?'external':'stripe',issues};
 if(stage==='closed')return rec;
 if(!EMAIL.test(email))issues.push('Client Email');
 if(!date)issues.push('Event Date');
 if(!type)issues.push('Event Type');
 if(!name)issues.push('Client Name or Organization');
 if(!rec.client.venue)issues.push('Venue Name');
 if(!start||!end)issues.push('Start Time and End Time');
 if(total==null||cents(total)<=0)issues.push('Total Fee');
 if(deposit==null)issues.push('Deposit Amount');
 if(balance==null)issues.push('Balance Due');
 if(total!=null&&deposit!=null&&balance!=null&&stage!=='paid'&&cents(deposit)+cents(balance)!==cents(total))issues.push('Deposit Amount plus Balance Due does not equal Total Fee');
 if(balance!=null&&cents(balance)>0&&!balanceDue)issues.push('Balance Due Date');
 const day=denverDay(t,F.eventDate);
 if(day&&date&&day!==date)issues.push('Event Date has an evening time saved. Set it as a date with no time');
 if((stage==='draft'||stage==='awaiting-signature')&&!external){
  if(!STRIPE.test(link))issues.push('Payment Link');
  if(!PLINK.test(linkId))issues.push('Stripe Link ID');
 }
 return rec;
}
// The payment identity payment-status and portal-data verify against.
function configFor(t){
 const r=recordFrom(t),linkId=text(t,F.stripeLinkId),p=r.pricing;
 const c={email:r.client.primaryEmail,taskId:t.id,source:'clickup'};
 if(r.payment==='external'){c.paymentMethod='external';c.amount=cents(p.total);}
 else{c.amount=cents(p.deposit);if(PLINK.test(linkId))c.linkId=linkId;}
 return c;
}
async function findBySlug(slug){
 slug=String(slug||'').toLowerCase();
 if(!SLUG.test(slug))return null;
 const matches=(await listTasks(AGREEMENTS_LIST)).filter(t=>text(t,F.slug).toLowerCase()===slug);
 const open=matches.filter(t=>stageOf(t)!=='closed');
 if(open.length>1)throw Error('Ambiguous portal slug');
 return open[0]||matches[0]||null;
}
module.exports={F,recordFrom,configFor,findBySlug,stageOf};
