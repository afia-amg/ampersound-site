'use strict';
// Serves a ClickUp-sourced portal its client facts. If the agreement is missing a
// required field, or the numbers do not add up, clients keep seeing the last correct
// version and the agreement gets a comment naming what to fix.
const {findBySlug,recordFrom}=require('./_portal-record');
const {api}=require('./_integration');
let blobs=null;try{blobs=require('@netlify/blobs');}catch(_){blobs=null;}
const headers={'Content-Type':'application/json','Cache-Control':'no-store, private, max-age=0','X-Content-Type-Options':'nosniff'};
const reply=(status,body)=>({statusCode:status,headers,body:JSON.stringify(body)});
const memo=new Map(),alerted=new Map();
function connect(event){if(!blobs||!event||!event.blobs)return null;try{blobs.connectLambda(event);return blobs.getStore({name:'portal-records',consistency:'strong'});}catch(_){return null;}}
async function lastGood(store,slug){if(memo.has(slug))return memo.get(slug);if(!store)return null;try{return await store.get('good/'+slug,{type:'json'});}catch(_){return null;}}
async function alert(store,task,slug,issues){
 const key=issues.join('|');
 if(alerted.get(slug)===key)return;
 try{if(store&&(await store.get('alert/'+slug))===key){alerted.set(slug,key);return;}}catch(_){}
 alerted.set(slug,key);
 try{
  await api('/task/'+encodeURIComponent(task.id)+'/comment',{method:'POST',body:JSON.stringify({notify_all:true,comment_text:'Portal check: the client portal for '+slug+' is showing its last correct version because this agreement needs: '+issues.join('; ')+'. Fix these fields and the portal updates on its own.'})});
  if(store)await store.set('alert/'+slug,key);
 }catch(e){console.error('Portal alert failed:',e.message);}
}
exports.handler=async event=>{
 if(event.httpMethod!=='GET')return reply(405,{error:'Method not allowed'});
 const slug=String((event.queryStringParameters||{}).slug||'').toLowerCase();
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return reply(400,{error:'Invalid portal'});
 const store=connect(event);
 const fallback=async()=>{const g=await lastGood(store,slug);return g?reply(200,{...g,stale:true}):reply(503,{error:'Portal temporarily unavailable'});};
 if(!process.env.CLICKUP_API_TOKEN)return fallback();
 try{
  const task=await findBySlug(slug);
  if(!task)return reply(404,{error:'Portal not found'});
  const rec=recordFrom(task,slug);
  if(rec.stage==='closed')return reply(200,{slug,stage:'closed'});
  // A draft is Afia's preview, so it shows its own checklist instead of hiding it.
  if(rec.stage==='draft')return reply(200,rec);
  if(rec.issues.length){console.error('Portal record incomplete:',slug,rec.issues.join('; '));await alert(store,task,slug,rec.issues);return fallback();}
  memo.set(slug,rec);
  if(store){try{await store.setJSON('good/'+slug,rec);await store.delete('alert/'+slug);}catch(_){}}
  alerted.delete(slug);
  return reply(200,rec);
 }catch(e){console.error('Portal record error:',e.message);return fallback();}
};
