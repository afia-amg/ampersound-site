'use strict';
// Every portal entry (songs, timeline, package choice) lives on the client's
// ClickUp agreement, so it follows them to any browser and Afia sees it live.
const {PORTALS,findAgreement,receipts,api}=require('./_payment-receipts');
const DATA_FIELD='eb1c1d22-4c8c-46aa-bf7b-d63a07b283b3';
const SUMMARY_FIELD='f42375bc-bf82-4914-88f7-c3a06e812c91';
const EMAIL_FIELD='3f38f15e-6aa4-4481-9365-d4a911d68195';
const DEPOSIT_FIELD='f18252f2-13c7-4b04-a8d3-2b38dc096791';
const SECTIONS=['songs','timeline','option'];
const headers={'Content-Type':'application/json','Cache-Control':'no-store, private, max-age=0','X-Content-Type-Options':'nosniff'};
const reply=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});

async function access(config){
 const task=await findAgreement(config.taskId?config:{email:config.email});
 if(!task)return {task:null,unlocked:false};
 const email=(task.custom_fields||[]).find(f=>f.id===EMAIL_FIELD);
 if(!email||String(email.value||'').toLowerCase()!==config.email)throw new Error('Agreement email mismatch');
 if(config.legacyBooked)return {task,unlocked:true};
 const deposit=(task.custom_fields||[]).find(f=>f.id===DEPOSIT_FIELD);
 const expected=config.amount||Math.round(Number(deposit&&deposit.value)*100);
 if(!Number.isInteger(expected)||expected<=0)return {task,unlocked:false};
 const rr=await receipts(task.id);
 return {task,unlocked:rr.some(r=>r.amount===expected&&(!config.linkId||r.paymentLink===config.linkId))};
}
function readData(task){
 const f=(task.custom_fields||[]).find(x=>x.id===DATA_FIELD);
 try{const d=f&&f.value?JSON.parse(f.value):{};return d&&typeof d==='object'?d:{};}catch(e){return {};}
}
function fmt(iso){try{return new Date(iso).toLocaleString('en-US',{timeZone:'America/Denver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MT';}catch(e){return '';}}
function clean(a){return (Array.isArray(a)?a:[]).map(x=>String(x||'').trim()).filter(Boolean);}
// Sort only the human-readable ClickUp copy. Preserve the client's row order
// in the stored JSON and portal. Unspecified or invalid times stay at the end.
function timelineMinutes(value){
 const t=String(value||'').trim().toLowerCase().replace(/\./g,'');
 const m=t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
 if(!m)return Infinity;
 let h=Number(m[1]),minutes=Number(m[2]||0);
 if(minutes>59)return Infinity;
 if(m[3]){if(h<1||h>12)return Infinity;h=h%12+(m[3]==='pm'?12:0);}
 else if(h>23)return Infinity;
 return h*60+minutes;
}
function summarize(d){
 const L=d.labels||{},out=[];
 if(d.option)out.push('Package option: '+((L.option&&L.option.name)||d.option));
 if(d.songs){
  const s=d.songs,ml=(L.songs&&L.songs.moments)||{};
  out.push('','SONGS (updated '+fmt(d.songsAt)+')');
  Object.keys(s.moments||{}).forEach(k=>{const v=String(s.moments[k]||'').trim();if(v)out.push((ml[k]||k)+': '+v);});
  const mp=clean(s.mustPlay),dp=clean(s.dontPlay);
  if(mp.length)out.push('Must play: '+mp.join('; '));
  if(dp.length)out.push('Do not play: '+dp.join('; '));
  if(s.playlist)out.push('Playlist: '+s.playlist);
  if(s.vibe)out.push('Vibe: '+((L.songs&&L.songs.vibe)||s.vibe));
  if(s.guestRequests)out.push('Guest requests: '+((L.songs&&L.songs.guestRequests)||s.guestRequests));
  if(s.notes)out.push('Notes: '+s.notes);
 }
 if(d.timeline){
  out.push('','TIMELINE (updated '+fmt(d.timelineAt)+')');
  (d.timeline.moments||[]).filter(Boolean).slice().sort((a,b)=>{const x=timelineMinutes(a.time),y=timelineMinutes(b.time);return x===y?0:x<y?-1:1;}).forEach(m=>{if(m.time||m.event)out.push((m.time||'TBD')+'  '+(m.event||''));});
  if(d.timeline.notes)out.push('Notes: '+d.timeline.notes);
 }
 return out.join('\n').trim();
}

exports.handler=async(event)=>{
 if(!process.env.CLICKUP_API_TOKEN||!process.env.STRIPE_WEBHOOK_SECRET)return reply(503,{ok:false,error:'Portal data unavailable'});
 try{
  if(event.httpMethod==='GET'){
   const config=PORTALS[(event.queryStringParameters||{}).slug];
   if(!config)return reply(404,{ok:false,error:'Portal not found'});
   const {task,unlocked}=await access(config);
   if(!task)return reply(200,{ok:true,unlocked:false,data:{}});
   const d=readData(task),data={option:d.option,optionAt:d.optionAt};
   // Planning tabs only open once a booking is verified, so their data does too.
   if(unlocked){data.songs=d.songs;data.songsAt=d.songsAt;data.timeline=d.timeline;data.timelineAt=d.timelineAt;data.review=d.review;data.reviewAt=d.reviewAt;}
   return reply(200,{ok:true,unlocked,data});
  }
  if(event.httpMethod!=='POST')return reply(405,{ok:false,error:'Method not allowed'});
  let p;try{p=JSON.parse(event.body||'{}');}catch(_){return reply(400,{ok:false,error:'Invalid JSON'});}
  const config=PORTALS[p.slug];
  if(!config)return reply(404,{ok:false,error:'Portal not found'});
  if(!SECTIONS.includes(p.section))return reply(400,{ok:false,error:'Invalid section'});
  const raw=JSON.stringify(p.value===undefined?null:p.value);
  if(raw.length>60000)return reply(413,{ok:false,error:'Too much data'});
  if(p.section==='option'&&(typeof p.value!=='string'||p.value.length>80))return reply(400,{ok:false,error:'Invalid option'});
  if(p.section!=='option'&&(!p.value||typeof p.value!=='object'))return reply(400,{ok:false,error:'Invalid value'});
  const {task,unlocked}=await access(config);
  if(!task)return reply(404,{ok:false,error:'No matching agreement'});
  if(p.section!=='option'&&!unlocked)return reply(403,{ok:false,error:'Planning opens once the booking is confirmed'});
  const d=readData(task),at=new Date().toISOString();
  d.v=1;d[p.section]=p.value;d[p.section+'At']=at;
  d.labels=d.labels||{};
  if(p.labels&&typeof p.labels==='object'&&JSON.stringify(p.labels).length<8000)d.labels[p.section]=p.labels;
  await api('/task/'+encodeURIComponent(task.id)+'/field/'+DATA_FIELD,{method:'POST',body:JSON.stringify({value:JSON.stringify(d)})});
  try{await api('/task/'+encodeURIComponent(task.id)+'/field/'+SUMMARY_FIELD,{method:'POST',body:JSON.stringify({value:summarize(d)})});}catch(e){console.error('Summary update failed:',e.message);}
  return reply(200,{ok:true,section:p.section,at});
 }catch(e){console.error('Portal data error:',e.message);return reply(503,{ok:false,error:'Portal data unavailable'});}
};
