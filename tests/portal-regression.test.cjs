'use strict';
// Dependency-free deploy gate. All ClickUp/Stripe traffic is mocked.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const DATA_FIELD='eb1c1d22-4c8c-46aa-bf7b-d63a07b283b3';
const SUMMARY_FIELD='f42375bc-bf82-4914-88f7-c3a06e812c91';
const EMAIL_FIELD='3f38f15e-6aa4-4481-9365-d4a911d68195';
const DEPOSIT_FIELD='f18252f2-13c7-4b04-a8d3-2b38dc096791';
const quiet={error(){},log(){}};
const config={email:'test@example.invalid',taskId:'test-only',amount:63750,linkId:'plink_test'};
function backend(file,{paid=false,signed=false,legacy=false,data={},email=config.email,amount=63750,link='plink_test',missing=false,fail=false}={}){
 const writes=[];
 const task={id:'test-only',custom_fields:[
  {id:EMAIL_FIELD,value:email},{id:DEPOSIT_FIELD,value:637.50},
  {id:DATA_FIELD,value:JSON.stringify(data)}
 ]};
 const deps={
  PORTALS:{test:{...config,legacyBooked:legacy}},
  findAgreement:async()=>{if(fail)throw Error('mock outage');return missing?null:task;},
  receipts:async()=>paid?[{amount,paymentLink:link,paidAt:'2026-10-28T12:00:00Z'}]:[],
  signatureRecord:async()=>signed?{signedName:'Test Signer',signedAt:'2026-10-27T12:00:00Z'}:null,
  api:async(url,options)=>{writes.push({url,value:JSON.parse(options.body).value});return {};},
 };
 const context={exports:{},require:name=>{assert.equal(name,'./_payment-receipts');return deps;},
  process:{env:{CLICKUP_API_TOKEN:'mock',STRIPE_WEBHOOK_SECRET:'mock'}},console:quiet};
 vm.runInNewContext(read('netlify/functions/'+file),context,{filename:file});
 return {writes,call:async(method='GET',body)=>{const r=await context.exports.handler({
  httpMethod:method,queryStringParameters:{slug:'test'},body:JSON.stringify(body)
 });return {status:r.statusCode,...JSON.parse(r.body)};}};
}
function browser(saved={}){
 let local=JSON.stringify(saved),now=0,next=0;
 const timers=new Map(),requests=[];
 const context={
  window:{PORTAL:{slug:'test',mode:'overview',client:{name:'Test',contacts:'Test',primaryEmail:config.email},
   songSeed:{moments:{firstDance:''},mustPlay:[''],dontPlay:[''],notes:''},
   timelineSeed:{moments:[],notes:''},vibes:[],requests:[],momentFields:[]},
   addEventListener(){}},
  document:{getElementById:()=>null,addEventListener(){}},
  localStorage:{getItem:()=>local,setItem:(_k,v)=>{local=v;}},
  location:{search:'',pathname:'/partner-docs/test/',hash:''},history:{replaceState(){}},
  URLSearchParams,console:quiet,
  setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:now+delay});return id;},
  clearTimeout(id){timers.delete(id);},
  fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({at:new Date().toISOString()})};},
 };
 context.window.window=context.window;
 const src=read('partner-docs/_assets/portal.js');
 assert.match(src,/\}\)\(\);\s*$/);
 const expose=`
 window.__test={queueSave,scheduleSync,pushSection,pendingSections,pullData,
 applyServerSignature,verifyPayment,readStore,
 get songs(){return songs;},get timeline(){return timeline;},
 get booking(){return booking;},get unlocked(){return unlocked;},
 unlock(){unlocked=true;}};
 `;
 vm.runInNewContext(src.replace(/\}\)\(\);\s*$/,expose+'\n})();'),context,{filename:'portal.js'});
 return {api:context.window.__test,requests,context,
  local:()=>JSON.parse(local),
  async settle(){for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));},
  tick(ms){const end=now+ms;while(true){let selected;for(const [id,t] of timers)
   if(t.at<=end&&(!selected||t.at<selected[1].at))selected=[id,t];
   if(!selected)break;now=selected[1].at;timers.delete(selected[0]);selected[1].fn();}
   now=end;},
 };
}
test('shared portal and Netlify function JavaScript parses',()=>{
 for(const dir of ['partner-docs/_assets','netlify/functions'])
  for(const name of fs.readdirSync(path.join(ROOT,dir)).filter(n=>n.endsWith('.js')))
   new vm.Script(read(dir+'/'+name),{filename:dir+'/'+name});
});
test('every portal inline script parses',()=>{
 let count=0;
 for(const entry of fs.readdirSync(path.join(ROOT,'partner-docs'),{withFileTypes:true})){
  if(!entry.isDirectory()||entry.name==='_assets')continue;
  const p='partner-docs/'+entry.name+'/index.html';
  if(!fs.existsSync(path.join(ROOT,p)))continue;
  for(const match of read(p).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
   if(/\bsrc\s*=|\btype\s*=\s*["']application\/ld\+json/i.test(match[1]))continue;
   new vm.Script(match[2],{filename:p});count++;
  }
 }
 assert.ok(count>0,'No portal inline scripts found');
});
test('timeline summary sorts times, keeps ties stable and puts TBD last',async()=>{
 const b=backend('portal-data.js',{legacy:true});
 const moments=[{time:'9:45 PM',event:'Exit'},{time:'',event:'TBD'},
  {time:'6:00 PM',event:'Entrance'},{time:'4:30 PM',event:'Ceremony'},
  {time:'6:00 PM',event:'Dinner'},{time:'12:00 PM',event:'Noon'},
  {time:'12:00 AM',event:'Midnight'}];
 assert.equal((await b.call('POST',{slug:'test',section:'timeline',value:{moments,notes:'Keep me'}})).status,200);
 const summary=b.writes.find(w=>w.url.endsWith(SUMMARY_FIELD)).value;
 const expected=['Midnight','Noon','Ceremony','Entrance','Dinner','Exit','TBD'];
 for(let i=1;i<expected.length;i++)assert.ok(summary.indexOf(expected[i-1])<summary.indexOf(expected[i]));
 const stored=JSON.parse(b.writes.find(w=>w.url.endsWith(DATA_FIELD)).value);
 assert.deepEqual(stored.timeline.moments,moments);
 assert.equal(stored.timeline.notes,'Keep me');
});
test('saving one section preserves other sections',async()=>{
 const b=backend('portal-data.js',{legacy:true,data:{songs:{notes:'Keep songs'},option:'solo'}});
 await b.call('POST',{slug:'test',section:'timeline',value:{moments:[],notes:'New'}});
 const d=JSON.parse(b.writes.find(w=>w.url.endsWith(DATA_FIELD)).value);
 assert.equal(d.songs.notes,'Keep songs');assert.equal(d.option,'solo');
});
test('unpaid clients cannot read planning data or write planning',async()=>{
 const b=backend('portal-data.js',{data:{songs:{notes:'Private'},timeline:{notes:'Private'},option:'solo'}});
 const got=await b.call();assert.equal(got.unlocked,false);
 assert.equal(got.data.songs,undefined);assert.equal(got.data.timeline,undefined);
 assert.equal((await b.call('POST',{slug:'test',section:'timeline',value:{moments:[]}})).status,403);
 assert.equal(b.writes.length,0);
});
test('invalid sections and oversized data are rejected without writes',async()=>{
 const b=backend('portal-data.js',{legacy:true});
 assert.equal((await b.call('POST',{slug:'test',section:'bad',value:{}})).status,400);
 assert.equal((await b.call('POST',{slug:'test',section:'songs',value:{notes:'x'.repeat(61000)}})).status,413);
 assert.equal(b.writes.length,0);
});
test('payment only unlocks for matching amount and Stripe link',async()=>{
 for(const options of [{paid:false},{paid:true,amount:1},{paid:true,link:'wrong'}]){
  const r=await backend('payment-status.js',options).call();
  assert.equal(r.unlocked,false);assert.equal(r.verified,false);
 }
 const r=await backend('payment-status.js',{paid:true}).call();
 assert.equal(r.unlocked,true);assert.equal(r.verified,true);
});
test('server signature is returned even before deposit payment',async()=>{
 const r=await backend('payment-status.js',{signed:true}).call();
 assert.equal(r.signed,true);assert.equal(r.signedName,'Test Signer');assert.equal(r.unlocked,false);
});
test('payment verification fails closed on mismatched email or outage',async()=>{
 for(const opts of [{email:'wrong@example.invalid'},{fail:true}]){
  const r=await backend('payment-status.js',opts).call();
  assert.equal(r.status,503);assert.equal(r.unlocked,false);assert.equal(r.verified,false);
 }
});
test('local drafts save quickly; cloud waits for a longer typing pause',async()=>{
 const b=browser();b.api.unlock();b.api.timeline.notes='first';
 b.api.queueSave('timeline',b.api.timeline);b.tick(400);
 assert.equal(b.local().timeline.notes,'first');assert.equal(b.requests.length,0);
 b.tick(3000);assert.equal(b.requests.length,0);
 b.api.timeline.notes='second';b.api.queueSave('timeline',b.api.timeline);
 b.tick(400);b.tick(3000);assert.equal(b.requests.length,0);
 b.tick(500);await b.settle();assert.equal(b.requests.length,1);
 assert.equal(JSON.parse(b.requests[0].options.body).value.notes,'second');
});
test('explicit save cancels the scheduled duplicate autosave',async()=>{
 const b=browser();b.api.unlock();b.api.queueSave('timeline',b.api.timeline);
 b.tick(400);b.api.pushSection('timeline');await b.settle();b.tick(10000);await b.settle();
 assert.equal(b.requests.length,1);
});
test('a failed cloud save preserves the local draft and pending state',async()=>{
 const b=browser();b.api.unlock();b.context.fetch=async()=>{throw Error('mock outage');};
 b.api.timeline.notes='Do not lose';b.api.queueSave('timeline',b.api.timeline);
 b.tick(400);b.tick(3500);await b.settle();
 assert.equal(b.local().timeline.notes,'Do not lose');
 assert.ok(b.api.pendingSections().includes('timeline'));
});
test('fresh browser loads cloud timeline including notes and row order',async()=>{
 const b=browser(),moments=[{time:'9 PM',event:'Exit'},{time:'5 PM',event:'Start'}];
 b.context.fetch=async()=>({ok:true,json:async()=>({data:{
  timeline:{moments,notes:'From another browser'},timelineAt:'2026-10-28T12:00:00Z'}})});
 await b.api.pullData();
 assert.deepEqual(JSON.parse(JSON.stringify(b.api.timeline.moments)),moments);
 assert.equal(b.api.timeline.notes,'From another browser');
});
test('cloud pull does not overwrite a newer local edit',async()=>{
 const b=browser({timeline:{moments:[],notes:'Newer local'},editedAt:{timeline:'2026-10-29T12:00:00Z'}});
 b.context.fetch=async()=>({ok:true,json:async()=>({data:{
  timeline:{moments:[],notes:'Older cloud'},timelineAt:'2026-10-28T12:00:00Z'}})});
 await b.api.pullData();assert.equal(b.api.timeline.notes,'Newer local');
});
test('recorded signature clears duplicate signature retries',()=>{
 const b=browser({outbox:[{kind:'signature',payload:{action:'signed'}},{kind:'songs',payload:{type:'songs'}}]});
 b.api.applyServerSignature({signedName:'Test Signer',signedAt:'2026-10-27T12:00:00Z'});
 assert.equal(b.api.booking.signedName,'Test Signer');assert.equal(b.api.booking.serverSigned,true);
 assert.equal(b.local().outbox.some(i=>i.kind==='signature'),false);
 assert.equal(b.local().outbox.some(i=>i.kind==='songs'),true);
});
test('browser payment claims are discarded and cannot unlock planning',()=>{
 const b=browser({booking:{paidAt:'forged'},installmentsPaid:[1],
  outbox:[{kind:'paid',payload:{action:'paid'}}]});
 assert.equal(b.api.unlocked,false);assert.equal(b.local().booking.paidAt,undefined);
 assert.equal(b.local().installmentsPaid,undefined);assert.equal(b.local().outbox.length,0);
});
