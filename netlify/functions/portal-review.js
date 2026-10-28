'use strict';
// Client reviews from the portal. The review is filed on the client's Post-Event
// task (created if Rex has not made one yet) and mirrored on their agreement so
// the portal shows it on any device. Only booked clients whose event has passed
// can submit, and the server decides both from ClickUp, never from the browser.
const {PORTALS,findAgreement,receipts,api}=require('./_payment-receipts');
const POST_EVENT_LIST='901418578200';
const A={email:'3f38f15e-6aa4-4481-9365-d4a911d68195',deposit:'f18252f2-13c7-4b04-a8d3-2b38dc096791',data:'eb1c1d22-4c8c-46aa-bf7b-d63a07b283b3',eventName:'4299965c-96e2-430e-947a-ac16e9068aee',eventDate:'4006b42c-6597-49ea-bbb6-beb6bcc323b8'};
const R={clientName:'01b694ba-6da6-4e4c-a3d3-af4b96a7a0c5',eventName:'4299965c-96e2-430e-947a-ac16e9068aee',eventDate:'4006b42c-6597-49ea-bbb6-beb6bcc323b8',email:'6662e48d-f76c-4bf4-aa23-1d56037dd61c',rating:'6bee26d1-b86e-46ef-b523-50f6261f702e',text:'39d4731e-5ae4-41be-8c3f-bb8701814691',highlight:'b9310261-4733-4541-9ee6-854397abc11a',permission:'fdedaddf-03ff-4a31-8872-480a88ef5b69',share:'cf7545e5-fb80-4fb1-9ec9-44f82f084930',publish:'f39956bc-e153-47f8-a47e-413a0eb347b6',status:'46af20f3-ccab-4340-84c2-cf1d41482949'};
const PERMISSION={'Yes':'a892395c-654d-43dd-ab95-f688a04d2940','Yes but anonymously':'9e30aed4-d01d-46a0-ae82-9a0ab1da37e4','No':'1ea8743c-0932-4396-975e-4bf543cdb5fd'};
const PUBLISH_RECEIVED='d05fc3dd-ad80-4c17-ae08-5b81397ded24',STATUS_RECEIVED='1547b5ce-0cd0-4f31-9ba6-307e181c4d91';
// Reviews open the evening of the event (about 20 hours after the date field's midnight-ish stamp).
const OPEN_AFTER_MS=20*36e5;
const headers={'Content-Type':'application/json','Cache-Control':'no-store, private, max-age=0','X-Content-Type-Options':'nosniff'};
const reply=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
const field=(task,id)=>(task.custom_fields||[]).find(f=>f.id===id);
const str=(v,max)=>String(v==null?'':v).trim().slice(0,max);

async function booked(config,task){
 if(config.legacyBooked)return true;
 const deposit=field(task,A.deposit);
 const expected=config.amount||Math.round(Number(deposit&&deposit.value)*100);
 if(!Number.isInteger(expected)||expected<=0)return false;
 const rr=await receipts(task.id);
 return rr.some(r=>r.amount===expected&&(!config.linkId||r.paymentLink===config.linkId));
}
async function findPostEvent(email,eventName){
 for(let page=0;page<20;page++){
  const d=await api('/list/'+POST_EVENT_LIST+'/task?include_closed=true&subtasks=false&page='+page);
  const rows=d.tasks||[];
  const hit=rows.find(t=>{const e=field(t,R.email),n=field(t,R.eventName);return (e&&String(e.value||'').toLowerCase()===email)||(eventName&&n&&String(n.value||'').trim().toLowerCase()===eventName.toLowerCase());});
  if(hit)return hit;
  if(d.last_page||!rows.length)return null;
 }
 return null;
}
async function setField(taskId,id,value){
 try{await api('/task/'+encodeURIComponent(taskId)+'/field/'+id,{method:'POST',body:JSON.stringify({value})});}
 catch(e){console.error('Review field '+id+' failed:',e.message);}
}

exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return reply(405,{ok:false,error:'Method not allowed'});
 if(!process.env.CLICKUP_API_TOKEN||!process.env.STRIPE_WEBHOOK_SECRET)return reply(503,{ok:false,error:'Reviews unavailable'});
 let p;try{p=JSON.parse(event.body||'{}');}catch(_){return reply(400,{ok:false,error:'Invalid JSON'});}
 const config=PORTALS[p.slug];
 if(!config)return reply(404,{ok:false,error:'Portal not found'});
 const rating=Number(p.rating),testimonial=str(p.testimonial,3000),highlight=str(p.highlight,300),name=str(p.name,120),permission=PERMISSION[p.permission]?p.permission:'No';
 if(!Number.isInteger(rating)||rating<1||rating>5)return reply(400,{ok:false,error:'Rating must be 1 to 5'});
 if(testimonial.length<10)return reply(400,{ok:false,error:'Review is too short'});
 try{
  const task=await findAgreement(config.taskId?config:{email:config.email});
  if(!task)return reply(404,{ok:false,error:'No matching agreement'});
  const email=field(task,A.email);
  if(!email||String(email.value||'').toLowerCase()!==config.email)return reply(403,{ok:false,error:'Agreement mismatch'});
  if(!(await booked(config,task)))return reply(403,{ok:false,error:'Reviews open for confirmed bookings'});
  const dateF=field(task,A.eventDate),eventMs=Number(dateF&&dateF.value);
  if(!eventMs||Date.now()<eventMs+OPEN_AFTER_MS)return reply(403,{ok:false,error:'Reviews open after your event'});
  const nameF=field(task,A.eventName),eventName=str(nameF&&nameF.value,200);
  let post=await findPostEvent(config.email,eventName);
  if(!post){
   post=await api('/list/'+POST_EVENT_LIST+'/task',{method:'POST',body:JSON.stringify({name:task.name,status:'received',custom_fields:[
    {id:R.clientName,value:name||task.name},{id:R.email,value:config.email},{id:R.eventDate,value:eventMs},...(eventName?[{id:R.eventName,value:eventName}]:[])
   ]})});
  }
  const at=new Date().toISOString();
  await setField(post.id,R.rating,rating);
  await setField(post.id,R.text,testimonial);
  if(highlight)await setField(post.id,R.highlight,highlight);
  await setField(post.id,R.permission,PERMISSION[permission]);
  await setField(post.id,R.share,permission!=='No');
  await setField(post.id,R.publish,PUBLISH_RECEIVED);
  await setField(post.id,R.status,STATUS_RECEIVED);
  try{await api('/task/'+encodeURIComponent(post.id),{method:'PUT',body:JSON.stringify({status:'received'})});}catch(e){console.error('Review status failed:',e.message);}
  try{await api('/task/'+encodeURIComponent(post.id)+'/comment',{method:'POST',body:JSON.stringify({comment_text:'Review received through the client portal\n'+'\u2605'.repeat(rating)+' ('+rating+'/5)\n\n'+testimonial+(highlight?'\n\nBest part: '+highlight:'')+'\n\nName to show: '+(name||'(none)')+'\nPermission: '+permission,notify_all:true})});}catch(e){console.error('Review comment failed:',e.message);}
  // Mirror on the agreement so the portal can show "thank you" on any device.
  try{
   const df=field(task,A.data);let d={};try{d=df&&df.value?JSON.parse(df.value):{};}catch(_){d={};}
   d.v=1;d.review={rating,testimonial,highlight,name,permission};d.reviewAt=at;
   await api('/task/'+encodeURIComponent(task.id)+'/field/'+A.data,{method:'POST',body:JSON.stringify({value:JSON.stringify(d)})});
  }catch(e){console.error('Review mirror failed:',e.message);}
  return reply(200,{ok:true,at,postEventTaskId:post.id});
 }catch(e){console.error('Portal review error:',e.message);return reply(503,{ok:false,error:'Reviews unavailable'});}
};
