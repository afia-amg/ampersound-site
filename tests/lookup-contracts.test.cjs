'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=path.resolve(__dirname,'../netlify/functions');
function load(file, integ, pays){const src=fs.readFileSync(path.join(P,file),'utf8'),c={exports:{},module:{exports:{}},process:{env:{CLICKUP_API_TOKEN:'x'}},console:{error(){}},require(n){if(n==='./_integration')return integ;if(n==='./_payment-receipts')return pays;throw Error(n)}};c.module.exports=c.exports;vm.runInNewContext(src,c,{filename:file});return c.module.exports}
const fields={email:'3f38f15e-6aa4-4481-9365-d4a911d68195',eventName:'4299965c-96e2-430e-947a-ac16e9068aee',eventDate:'4006b42c-6597-49ea-bbb6-beb6bcc323b8',eventType:'f36884b1-eb6a-40b4-b1eb-ab75d0370ebc'};
const scalar=(t,id)=>{const f=(t.custom_fields||[]).find(x=>x.id===id||Array.isArray(id)&&id.includes(x.id));return f&&f.value};
function agr(status='open',email='ryan.nelson.jrn@gmail.com'){return {id:'a',name:'A',status:{status},description:'',list:{id:'901418268145'},custom_fields:[{id:fields.email,value:email},{id:fields.eventName,value:'Katie & Ryan Wedding'},{id:fields.eventDate,value:'2026-10-09'},{id:fields.eventType,value:'Wedding'}]}}
const {test}=require('node:test'); test('lookup handler contracts (5 mocked flows)',async()=>{
 const pays={receipts:async()=>[],signatureRecord:async()=>null};
 let calls=0;const integ={AGREEMENTS_LIST:'901418268145',AGREEMENT_FIELDS:{email:[fields.email],eventName:[fields.eventName],eventDate:[fields.eventDate],eventType:[fields.eventType]},CLOSED_LOST:new Set(['closed [lost]']),listTasks:async()=>{calls++;throw Error('unavailable')},scalarField:scalar};
 let h=load('lookup-agreement.js',integ,pays);let r=await h.handler({httpMethod:'POST',body:JSON.stringify({email:'ryan.nelson.jrn@gmail.com'})});assert.equal(r.statusCode,503);assert.equal(calls,1);
 integ.listTasks=async()=>[agr('closed [lost]')];h=load('lookup-agreement.js',integ,pays);r=await h.handler({httpMethod:'POST',body:JSON.stringify({email:'ryan.nelson.jrn@gmail.com'})});assert.equal(r.statusCode,404);assert.ok(!r.body.includes('katie-ryan'));
 let lp={listTasks:async id=>id==='901418268145'?[agr('closed [lost]')]:[],scalarField:scalar,CLOSED_LOST:new Set(['closed [lost]'])};h=load('lookup-partner.js',lp,{});r=await h.handler({httpMethod:'POST',body:JSON.stringify({email:'ryan.nelson.jrn@gmail.com'})});assert.equal(r.statusCode,404);assert.ok(!r.body.includes('katie-ryan'));
 const legacyTask={id:'legacy',name:'Legacy Katie',status:{status:'signed'},description:'Email: ryan.nelson.jrn@gmail.com',list:{id:'901418180552'},custom_fields:[{id:'3f38f15e-6aa4-4481-9365-d4a911d68195',value:'ryan.nelson.jrn@gmail.com'},{id:'4299965c-96e2-430e-947a-ac16e9068aee',value:'Katie & Ryan Wedding'},{id:'4006b42c-6597-49ea-bbb6-beb6bcc323b8',value:'2026-10-09'},{id:'f36884b1-eb6a-40b4-b1eb-ab75d0370ebc',value:'Wedding'}]};const legacyLookup=load('lookup-agreement.js',{...lp,semanticType:v=>String(v||'').toLowerCase(),listTasks:async id=>id==='901418268145'?[]:[legacyTask]},pays);const legacyReply=await legacyLookup.handler({httpMethod:'POST',body:JSON.stringify({email:'ryan.nelson.jrn@gmail.com'})});assert.equal(legacyReply.statusCode,200);assert.equal(JSON.parse(legacyReply.body).agreements[0].id,'static-ryan.nelson.jrn');const la=load('lookup-agreement.js',{...lp,listTasks:async()=>[]},pays);const partial=la._test.staticResult('jesseradike1@gmail.com');assert.equal(partial.paymentStatus,'partial');assert.equal(partial.portalUrl,'https://ampersoundmediagroup.com/client-portal/jesse-zariah');assert.equal(la._test.staticResult('zlj7123@gmail.com').portalUrl,partial.portalUrl);
 const aliases=load('lookup-partner.js',lp,{});
 lp.listTasks=async()=>[];r=await aliases.handler({httpMethod:'POST',body:JSON.stringify({email:'jesseradike1@gmail.com'})});assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).partner.portalUrl,'/client-portal/jesse-zariah/');
 });

test('client URL normalization covers eight clients without changing partner/test/external links',()=>{
 const slugs=['acs-hope-gala','angela-joe','angelica-nathan','jaylin-goines','jesse-zariah','katie-ryan','rose-josh','vessel-kitchen-herriman'];
 for(const file of ['lookup-agreement.js','lookup-partner.js']){
  const h=load(file,{},{}),normalize=h._test.clientPortalUrl;
  for(const slug of slugs){
   assert.equal(normalize('/partner-docs/'+slug+'/'),'/client-portal/'+slug+'/');
   assert.equal(normalize('https://ampersoundmediagroup.com/partner-docs/'+slug+'?paid=true#review'),'https://ampersoundmediagroup.com/client-portal/'+slug+'?paid=true#review');
  }
  for(const unchanged of ['/partner-docs/donnielle/agreement.html','/partner-docs/portal-test/','/partner-docs/_assets/portal.js','/partner-docs/katie-ryan-extra/','https://example.invalid/partner-docs/katie-ryan/',null])assert.equal(normalize(unchanged),unchanged);
 }
});

test('all eight canonical client routes reuse their original pages and force legacy redirects',()=>{
 const config=fs.readFileSync(path.resolve(P,'../../netlify.toml'),'utf8');
 const rules=config.split('[[redirects]]').slice(1).map(block=>({from:(/from\s*=\s*"([^"]+)"/.exec(block)||[])[1],to:(/to\s*=\s*"([^"]+)"/.exec(block)||[])[1],status:Number((/status\s*=\s*(\d+)/.exec(block)||[])[1]),force:/force\s*=\s*true/.test(block)}));
 for(const slug of ['acs-hope-gala','angela-joe','angelica-nathan','jaylin-goines','jesse-zariah','katie-ryan','rose-josh','vessel-kitchen-herriman']){
  const old='/partner-docs/'+slug,newPath='/client-portal/'+slug;
  assert.ok(rules.some(r=>r.from===old&&r.to===newPath+'/'&&r.status===301&&r.force));
  assert.ok(rules.some(r=>r.from===old+'/*'&&r.to===newPath+'/:splat'&&r.status===301&&r.force));
  for(const suffix of ['','/'])assert.ok(rules.some(r=>r.from===newPath+suffix&&r.to===old+'/index.html'&&r.status===200&&r.force));
  assert.ok(fs.existsSync(path.resolve(P,'../../partner-docs',slug,'index.html')));
 }
 assert.ok(!rules.some(r=>r.from==='/partner-docs/*'||r.from.startsWith('/partner-docs/donnielle')||r.from.startsWith('/partner-docs/portal-test')));
 for(const suffix of ['sign','sign.html','quote','quote.html'])for(const prefix of ['/partner-docs/','/client-portal/']){
  const r=rules.find(x=>x.from===prefix+'angelica-nathan/'+suffix);
  assert.equal(r.to,'/client-portal/angelica-nathan/');assert.equal(r.status,301);
 }
});
