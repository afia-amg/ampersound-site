'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const intake=require('../netlify/functions/intake-submit');
const {FIELDS,buildFields,phoneValue,inputDate}=intake._test;
const {LEAD_FIELDS}=require('../netlify/functions/_integration');
const OPTIONS={
  eventType:['Wedding','Corporate Event','Gala/Fundraiser','Conference','Community Event','Private Party','Other'],
  source:['WeddingPro','Bark','Google','Instagram','Referral','Venue','Website Intake','Other'],
  services:['DJ/Sound Direction','MC/Event Hosting','Spoken Word','Equipment Rental'],
  budget:['Under $500','$500-$1,000','$1,000-$2,000','$2,000-$5,000','$5,000+'],
  guests:['Under 25','25-50','51-100','101-200','201-500','500+']
};
function fields(){return Object.entries(FIELDS).map(([key,[id,type]])=>({id,type,name:'duplicate display name',type_config:{options:(OPTIONS[key]||[]).map((name,i)=>({id:key+'-'+i,...(type==='labels'?{label:name}:{name}),orderindex:i}))}}))}
function byKey(result,key){return result.customFields.find(f=>f.id===FIELDS[key][0])?.value}
const base={name:'Example Couple',email:' TEST@example.com ',phone:'(801) 555-0123',event_type:'Wedding',event_date:'2027-05-22',venue:'Example Venue',svc:['both','dj'],referral:'Google'};
test('writes only canonical IDs, even with duplicate/reordered field names',()=>{
  const fs=fields().reverse();fs.unshift({id:'legacy',name:'Email Address',type:'email'});
  const result=buildFields(fs,{...base,vibe:'Fun',must_play:'Song',do_not_play:'Song 2',business_name:'Biz',budget:'$1K-$1.5K',guests:'100-200'});
  assert.equal(new Set(result.customFields.map(f=>f.id)).size,result.customFields.length);
  assert.ok(result.customFields.every(f=>Object.values(FIELDS).some(([id])=>id===f.id)));
  assert.equal(byKey(result,'contact'),'Example Couple');
  assert.equal(byKey(result,'email'),'test@example.com');
  assert.equal(byKey(result,'phone'),'+18015550123');
  assert.deepEqual(byKey(result,'services'),['services-0','services-1']);
  assert.equal(byKey(result,'eventDate'),Date.parse('2027-05-22T00:00:00Z'));
});
test('attribution uses one dropdown while raw referral remains separate',()=>{
  for(const source of ['Google','Instagram','Venue','WeddingPro','Bark','Referral']){
    const result=buildFields(fields(),{...base,referral:source});
    assert.equal(byKey(result,'source'),'source-'+OPTIONS.source.indexOf(source));
    assert.equal(byKey(result,'referral'),source);
  }
  assert.equal(byKey(buildFields(fields(),{...base,referral:''}),'source'),'source-6');
  assert.equal(byKey(buildFields(fields(),{...base,referral:'Unknown partner'}),'source'),'source-7');
});
test('event aliases target canonical options only',()=>{
  for(const [input,expected]of [['Corporate','Corporate Event'],['Conference','Conference'],['Fundraiser','Gala/Fundraiser'],['Community','Community Event']]){
    assert.equal(byKey(buildFields(fields(),{...base,event_type:input}),'eventType'),'eventType-'+OPTIONS.eventType.indexOf(expected));
  }
});
test('ambiguous budget and guest ranges are preserved for review, not guessed',()=>{
  for(const budget of ['Flexible','Under $1K','$1.5K-$2.5K','$4K+']){
    const result=buildFields(fields(),{...base,budget});
    assert.equal(byKey(result,'budget'),undefined);assert.ok(result.warnings.length);
  }
  for(const guests of ['Under 50','50-100','200-400','400+']){
    const result=buildFields(fields(),{...base,guests});
    assert.equal(byKey(result,'guests'),undefined);assert.ok(result.warnings.length);
  }
  assert.equal(byKey(buildFields(fields(),{...base,budget:'$2.5K-$4K'}),'budget'),'budget-3');
  assert.equal(byKey(buildFields(fields(),{...base,guests:'101-200'}),'guests'),'guests-3');
});
test('missing canonical field or option never falls back to a duplicate',()=>{
  assert.throws(()=>buildFields(fields().filter(f=>f.id!==FIELDS.contact[0]),base),/Canonical field/);
  const fs=fields();fs.find(f=>f.id===FIELDS.services[0]).type_config.options=[];
  assert.throws(()=>buildFields(fs,base),/service option missing/);
});
test('phone normalization and invalid dates preserve uncertainty',()=>{
  assert.equal(phoneValue('8015550123'),'+18015550123');
  assert.equal(phoneValue('+44 20 7946 0958'),'+442079460958');
  assert.equal(phoneValue('123'),null);
  assert.equal(phoneValue(''),null);
  assert.equal(inputDate('2027-02-30'),null);
  assert.equal(inputDate('07/17'),null);
});
test('unsure and unknown services never invent a label',()=>{
  const result=buildFields(fields(),{...base,svc:['unsure','mystery']});
  assert.equal(byKey(result,'services'),undefined);assert.equal(result.warnings.length,2);
});
async function request(data,tasks=[],fs=fields()){
  const prior=global.fetch,calls=[];process.env.CLICKUP_API_TOKEN='test';
  global.fetch=async(url,opts={})=>{
    calls.push({url,opts});
    return{ok:true,json:async()=>opts.method==='POST'?{id:'new-task'}:url.endsWith('/field')?{fields:fs}:{tasks,last_page:true}};
  };
  try{return{response:await intake.handler({httpMethod:'POST',body:JSON.stringify(data)}),calls}}
  finally{global.fetch=prior}
}
test('handler creates one canonical task, preserves notes/raw intake, and uses new lead',async()=>{
  const {response,calls}=await request({...base,budget:'Flexible',notes:'Ask about setup'});
  assert.equal(response.statusCode,200);
  const payload=JSON.parse(calls.find(c=>c.opts.method==='POST').opts.body);
  assert.equal(payload.status,'new lead');
  assert.equal(payload.name,'Example Couple | Wedding | 2027-05-22');
  assert.match(payload.description,/Intake channel: Website Intake/);
  assert.match(payload.description,/Ask about setup/);
  assert.match(payload.description,/## Raw Intake/);
  assert.match(payload.description,/## Data Quality Review/);
  assert.ok(!payload.custom_fields.some(f=>f.id===FIELDS.budget[0]));
});
test('changed dated inquiry matches legacy inherited email/date/type and refuses duplicate',async()=>{
  const task={id:'legacy-task',custom_fields:[
    {id:LEAD_FIELDS.email[1],type:'email',value:'test@example.com'},
    {id:LEAD_FIELDS.eventDate[0],type:'date',value:Date.parse(base.event_date)},
    {id:LEAD_FIELDS.eventType[2],type:'drop_down',value:'w',type_config:{options:[{id:'w',name:'Wedding'}]}}
  ]};
  const fs=fields().concat(task.custom_fields);
  const {response,calls}=await request(base,[task],fs);
  assert.equal(response.statusCode,409);
  assert.equal(calls.filter(c=>c.opts.method==='POST').length,0);
});
test('exact replay remains idempotent',async()=>{
  const task={id:'existing',description:'Email: test@example.com\nEvent Type: Wedding\nEvent Date: 2027-05-22\nIntake fingerprint: '+intake._test.payloadHash(base)};
  const {response,calls}=await request(base,[task]);
  assert.equal(JSON.parse(response.body).duplicate,true);
  assert.equal(calls.filter(c=>c.opts.method==='POST').length,0);
});
test('invalid optional phone does not lose the lead or original phone',async()=>{
  const {response,calls}=await request({...base,phone:'ask planner'});
  assert.equal(response.statusCode,200);
  const payload=JSON.parse(calls.find(c=>c.opts.method==='POST').opts.body);
  assert.match(payload.description,/ask planner/);
  assert.ok(!payload.custom_fields.some(f=>f.id===FIELDS.phone[0]));
});
test('missing schema fails closed before creating a task',async()=>{
  const {response,calls}=await request(base,[],fields().filter(f=>f.id!==FIELDS.contact[0]));
  assert.equal(response.statusCode,500);
  assert.equal(calls.filter(c=>c.opts.method==='POST').length,0);
});
test('changing only the first requested service changes the fingerprint',()=>{
  assert.notEqual(intake._test.payloadHash({...base,svc:['dj']}),intake._test.payloadHash({...base,svc:['mc']}));
});
test('public form guest and budget options map exactly to canonical options',()=>{
  const html=require('node:fs').readFileSync(require('node:path').join(__dirname,'../intake.html'),'utf8');
  for(const key of ['guests','budget']){
    const select=new RegExp('<select name="'+key+'">([\\s\\S]*?)</select>').exec(html)[1];
    const labels=[...select.matchAll(/<option>([^<]+)<\/option>/g)].map(m=>m[1]);
    for(const label of labels){
      const result=buildFields(fields(),{...base,[key]:label});
      if(label==='Flexible')assert.equal(byKey(result,key),undefined);
      else assert.equal(byKey(result,key),key+'-'+OPTIONS[key].indexOf(label));
    }
  }
});
