'use strict';
const crypto=require('crypto');
const {api,listTasks,dateOnly,normalizeEmail,semanticType,LEAD_FIELDS}=require('./_integration');
const LIST_ID='901418578191';
const EVENT_ALIASES={Corporate:'Corporate Event',Conference:'Conference',Convention:'Conference',Community:'Community Event',Fundraiser:'Gala/Fundraiser',Private:'Private Party'};
// Only lossless range conversions. Ambiguous originals stay in the description.
const BUDGET_MAP={'$1K-$1.5K':'$1,000-$2,000','$2.5K-$4K':'$2,000-$5,000'};
const GUEST_MAP={};
const FIELDS=Object.freeze({
  contact:['52dedf32-a1d6-4b6f-ba98-c64ec7c25576','short_text'],
  email:['a32a6928-ba34-4d2f-8792-d2f63d739f90','email'],
  phone:['00eaca09-c0b9-443b-ad80-c753fe597e4a','phone'],
  eventDate:['4006b42c-6597-49ea-bbb6-beb6bcc323b8','date'],
  eventType:['786532a3-73ff-4ff5-8d78-f49a66670bea','drop_down'],
  source:['4700cff7-c6be-4412-a57b-dfcd7cf70010','drop_down'],
  venue:['a1b16a05-e8cf-48e0-b284-0695a9f88744','short_text'],
  services:['ddc78d20-86f4-48d8-90c7-d24c054a47f1','labels'],
  guests:['9f520eca-1eee-4e8a-a30b-eb017edcd9b9','drop_down'],
  budget:['91f8e05c-0b7e-4290-a8f2-b28c4a540825','drop_down'],
  vibe:['a7ca3056-77c6-4e7c-99cf-551296383c3f','text'],
  must_play:['f6f085c8-6d03-4b29-88ce-2c005d68b91f','text'],
  do_not_play:['a64d3333-7c86-4d16-8967-f8e6a569ac17','text'],
  business_name:['859f2865-375b-444b-a80e-88d941740249','short_text'],
  referral:['2cdd3842-f23c-4e3e-8d7e-39b2fd026e42','short_text']
});
const SERVICE_MAP={dj:['DJ/Sound Direction'],mc:['MC/Event Hosting'],both:['DJ/Sound Direction','MC/Event Hosting'],spoken:['Spoken Word'],equip:['Equipment Rental'],keynote:['Speaker/Keynote'],training:['Staff Training'],playlist:['Custom Playlist'],unsure:[]};
function optionName(f,v){const wanted=String(v||'').trim().toLowerCase();return(f.type_config&&f.type_config.options||[]).find(x=>String(x.name||x.label||'').trim().toLowerCase()===wanted)||null}
function phoneValue(v){
  const s=string(v),digits=s.replace(/\D/g,'');
  if(!s)return null;
  if(s.startsWith('+'))return /^[1-9]\d{7,14}$/.test(digits)?'+'+digits:null;
  if(digits.length===10)return '+1'+digits;
  if(digits.length===11&&digits.startsWith('1'))return '+'+digits;
  return null;
}
function inputDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v)&&dateOnly(v)===v?v:null}
function buildFields(fields,data){
  const customFields=[],warnings=[];
  function field(key){const [id,type]=FIELDS[key],f=fields.find(x=>x.id===id);if(!f||f.type!==type)throw Error('Canonical field missing or wrong type: '+key);return f}
  function put(key,value){if(value!==null&&value!==undefined&&value!==''&&(!Array.isArray(value)||value.length))customFields.push({id:field(key).id,value})}
  function dropdown(key,label){if(!label)return;const o=optionName(field(key),label);if(!o)throw Error('Canonical option missing: '+key);put(key,o.id)}
  put('contact',string(data.name,2048));put('email',normalizeEmail(data.email));
  const phone=phoneValue(data.phone);put('phone',phone);
  if(string(data.phone)&&!phone)warnings.push('Phone needs manual verification; original preserved below.');
  if(string(data.event_date))put('eventDate',new Date(data.event_date+'T00:00:00Z').getTime());
  dropdown('eventType',eventType(string(data.event_type)));
  // Source is attribution; website channel is recorded separately in description.
  const source=string(data.referral);
  dropdown('source',source?(optionName(field('source'),source)?source:'Other'):'Website Intake');
  for(const [key,input]of [['venue','venue'],['vibe','vibe'],['must_play','must_play'],['do_not_play','do_not_play'],['business_name','business_name'],['referral','referral']])put(key,string(data[input],FIELDS[key][1]==='short_text'?2048:5000));
  for(const [key,map]of [['budget',BUDGET_MAP],['guests',GUEST_MAP]]){
    const raw=string(data[key]);if(!raw)continue;
    const label=optionName(field(key),raw)?raw:map[raw];
    if(label)dropdown(key,label);else warnings.push(key+': original range/value needs review; no narrower dropdown value inferred.');
  }
  const labels=new Set();
  for(const svc of data.svc||[]){
    const mapped=SERVICE_MAP[string(svc)];
    if(!mapped){warnings.push('Unrecognized service retained in Raw Intake.');continue}
    if(svc==='unsure')warnings.push('Services need discovery confirmation.');
    for(const name of mapped){const o=optionName(field('services'),name);if(!o)throw Error('Canonical service option missing');labels.add(o.id)}
  }
  put('services',[...labels]);
  if(new Set(customFields.map(x=>x.id)).size!==customFields.length)throw Error('Duplicate canonical field write');
  return{customFields,warnings};
}
async function liveFields(){const d=await api('/list/'+LIST_ID+'/field');return d.fields||[]}
function choose(fields,name,type,value){const fs=fields.filter(f=>f.name===name&&(!type||f.type===type));if(!fs.length)throw Error('Live field missing: '+name);if(value!==undefined){const found=fs.find(f=>optionName(f,value));if(found)return found}return fs[0]}
function val(task,id){const f=(task.custom_fields||[]).find(x=>x.id===id);if(!f||f.value===null||f.value===undefined)return null;if(f.type==='drop_down'){const o=(f.type_config&&f.type_config.options||[]).find(x=>x.orderindex===f.value||x.id===f.value);return o?o.name:String(f.value)}if(f.type==='date')return dateOnly(f.value);if(f.value&&typeof f.value==='object')return f.value.email||'';return String(f.value)}
function eventType(v){return EVENT_ALIASES[v]||v}
function descriptionValue(desc,label){const m=new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+':\\s*(.+)$','mi').exec(desc||'');return m?m[1].trim():null}
function string(v,max=5000){return typeof v==='string'?v.trim().slice(0,max):''}
function payloadHash(data){const stable={name:string(data.name),email:normalizeEmail(data.email),phone:string(data.phone),event_type:string(data.event_type),event_date:string(data.event_date),venue:string(data.venue),guests:string(data.guests),budget:string(data.budget),svc:Array.isArray(data.svc)?data.svc.map(v=>string(v)):[],vibe:string(data.vibe),must_play:string(data.must_play),do_not_play:string(data.do_not_play),business_name:string(data.business_name),referral:string(data.referral),notes:string(data.notes)};return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex')}
function validPayload(data){return !!(data&&typeof data==='object'&&!Array.isArray(data)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(string(data.email))&&['name','phone','event_type','event_date','venue','guests','budget','vibe','must_play','do_not_play','business_name','referral','notes'].every(k=>data[k]===undefined||typeof data[k]==='string')&&(data.svc===undefined||(Array.isArray(data.svc)&&data.svc.every(v=>typeof v==='string'))))}
exports.handler=async event=>{const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};if(event.httpMethod==='OPTIONS')return{statusCode:200,headers,body:''};if(event.httpMethod!=='POST')return{statusCode:405,headers,body:'Method not allowed'};let data;try{data=JSON.parse(event.body||'')}catch(_){return{statusCode:400,headers,body:JSON.stringify({error:'Invalid JSON'})}}if(!validPayload(data))return{statusCode:400,headers,body:JSON.stringify({error:'Invalid intake payload'})};try{const email=normalizeEmail(data.email),rawType=string(data.event_type),etype=eventType(rawType),rawDate=string(data.event_date),eventDate=rawDate?inputDate(rawDate):null;if(!email.includes('@'))return{statusCode:400,headers,body:JSON.stringify({error:'Valid email required'})};if(rawDate&&!eventDate)return{statusCode:400,headers,body:JSON.stringify({error:'Invalid event date'})};const fields=await liveFields(),emailFs=fields.filter(f=>LEAD_FIELDS.email.includes(f.id)&&f.type==='email'),dateFs=fields.filter(f=>LEAD_FIELDS.eventDate.includes(f.id)&&f.type==='date'),typeFs=fields.filter(f=>LEAD_FIELDS.eventType.includes(f.id)&&f.type==='drop_down');const typeF=fields.find(f=>f.id===FIELDS.eventType[0]&&f.type===FIELDS.eventType[1]);if(!typeF)throw Error('Canonical event type field missing');if(rawType&&!optionName(typeF,etype))return{statusCode:400,headers,body:JSON.stringify({error:'Unsupported event type'})};const hash=payloadHash(data),all=await listTasks(LIST_ID),readValues=(task,fs,label)=>[...fs.map(f=>val(task,f.id)),descriptionValue(task.description,label)].filter(v=>v!==null&&v!==undefined&&v!==''),sameIdentity=etype?all.filter(t=>readValues(t,emailFs,'Email').some(v=>normalizeEmail(v)===email)&&readValues(t,typeFs,'Event Type').some(v=>semanticType(v)===semanticType(etype))&&(!eventDate||readValues(t,dateFs,'Event Date').some(v=>dateOnly(v)===eventDate))):[],duplicate=sameIdentity.find(t=>(t.description||'').includes('Intake fingerprint: '+hash));if(duplicate)return{statusCode:200,headers,body:JSON.stringify({success:true,duplicate:true,taskId:duplicate.id})};if(sameIdentity.length&&eventDate)return{statusCode:409,headers,body:JSON.stringify({error:'A lead already exists for this email, event date, and event type. Details changed; no update was made.',existingTaskId:sameIdentity[0].id})};const {customFields,warnings}=buildFields(fields,data);const services=Array.isArray(data.svc)?data.svc.map(v=>string(v)).filter(Boolean).join(', '):(string(data.svc)||'Not specified'),description=['Lead submitted via website intake form','Intake channel: Website Intake','Intake fingerprint: '+hash,'','## Contact','Name: '+(string(data.name)||'Not provided'),'Email: '+email,'Phone: '+(string(data.phone)||'Not provided'),'Event Type: '+(rawType||'Not specified'),'Event Date: '+(rawDate||'TBD'),'Venue: '+(string(data.venue)||'TBD'),'Guests: '+(string(data.guests)||'Not specified'),'Budget: '+(string(data.budget)||'Not specified'),'Services: '+services,'Vibe: '+(string(data.vibe)||'Not provided'),'Must-plays: '+(string(data.must_play)||'None'),'Do-not-plays: '+(string(data.do_not_play)||'None'),'Referral: '+(string(data.referral)||'Not specified'),'Notes: '+(string(data.notes)||'None'),...(warnings.length?['','## Data Quality Review',...warnings]:[]),'','## Raw Intake',JSON.stringify(data,null,2)].join('\n');if(new Set(customFields.map(x=>x.id)).size!==customFields.length)throw Error('Duplicate intake custom field IDs');const r=await api('/list/'+LIST_ID+'/task',{method:'POST',body:JSON.stringify({name:eventDate?[(string(data.name,300)||'New Intake'),(etype||'Event'),eventDate].join(' | '):(string(data.name,300)||'New Intake')+' | Event TBD',description,status:'new lead',custom_fields:customFields})});return{statusCode:200,headers,body:JSON.stringify({success:true,taskId:r.id})}}catch(err){console.error('Intake error:',err.message);return{statusCode:500,headers,body:JSON.stringify({error:'Server error'})}}};
exports._test={optionName,choose,dateOnly,eventType,payloadHash,BUDGET_MAP,GUEST_MAP,validPayload,FIELDS,SERVICE_MAP,buildFields,phoneValue,inputDate};
