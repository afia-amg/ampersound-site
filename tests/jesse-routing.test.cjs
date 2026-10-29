'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../netlify/functions');
const real=require('../netlify/functions/_integration');
const agr={id:'86bb71btb',list:{id:'901418268145'},status:{status:'signed'},custom_fields:[
 {id:'3f38f15e-6aa4-4481-9365-d4a911d68195',value:'jesseradike1@gmail.com'},
 {id:'4006b42c-6597-49ea-bbb6-beb6bcc323b8',type:'date',value:String(Date.parse('2027-04-28T10:00:00Z'))},
 {id:'f36884b1-eb6a-40b4-b1eb-ab75d0370ebc',type:'drop_down',value:0,type_config:{options:[{orderindex:0,name:'Wedding'}]}},
 {id:'f18252f2-13c7-4b04-a8d3-2b38dc096791',value:478.13}
]};
async function run({amount=47813,email='jesseradike1@gmail.com',installmentId='86bb9b420',eventDate='2027-04-28',list='901422326497',conflict=false}={}){
 const writes=[],rr=new Map();let stage;
 const installment={id:installmentId,list:{id:list},description:'Payment 3 of 4 ($478.13)',custom_fields:conflict?[{id:'6662e48d-f76c-4bf4-aa23-1d56037dd61c',value:'other@example.invalid'}]:[]};
 const api=async(url,opts={})=>{
  if(!opts.method)return url==='/task/86bb71btb'?agr:installment;
  const body=JSON.parse(opts.body);writes.push({url,body,method:opts.method});
  if(url.endsWith('/comment')&&body.comment_text.startsWith('RECEIPT:')){const r=JSON.parse(body.comment_text.slice(8));rr.set(r.taskId,[r]);}
  return {};
 };
 const pay={PORTALS:{jesse:{installments:[{num:3,taskId:'86bb9b420',amount:47813}]}},PAYMENTS_LIST:'901422326497',api,receipts:async id=>rr.get(id)||[],receiptsForAgreement:async(id,ids=[])=>[...new Map([id,...ids].flatMap(x=>rr.get(x)||[]).map(r=>[r.sessionId,r])).values()],signatureRecord:async()=>({}),seal:r=>'RECEIPT:'+JSON.stringify(r)};
 const c={exports:{},Buffer,console:{error(){}},process:{env:{CLICKUP_API_TOKEN:'mock',STRIPE_WEBHOOK_SECRET:'mock'}},require:n=>n==='crypto'?crypto:n==='./_payment-receipts'?pay:{...real,syncLeadStage:async(t,s)=>{stage=s;return{updated:true}}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'stripe-webhook.js'),'utf8'),c);
 const md={agreement_task_id:'86bb71btb',installment_task_id:installmentId,clickup_task_id:'86bb9b420',client_email:email,event_type:'Wedding',event:'Wedding',event_date:eventDate,installment:'3',deal_task_id:'86bb71bqg'};
 const body=JSON.stringify({id:'evt_mock',created:Math.floor(Date.now()/1000),type:'checkout.session.completed',data:{object:{id:'cs_mock',payment_status:'paid',currency:'usd',amount_total:amount,metadata:md}}});
 const t=Math.floor(Date.now()/1000),sig=crypto.createHmac('sha256','mock').update(t+'.'+body).digest('hex');
 const call=()=>c.exports.handler({httpMethod:'POST',body,headers:{'stripe-signature':`t=${t},v1=${sig}`}});
 return{r:await call(),writes,rr,call,get stage(){return stage}};
}
test('Jesse Payment 3 routes verified receipt to Agreement and installment without duplicate receipts',async()=>{
 const b=await run();assert.equal(b.r.statusCode,200);assert.equal(b.stage,'deposit');
 assert.ok(b.writes.some(w=>w.url==='/task/86bb9b420'&&w.body.status==='completed'));
 assert.equal(b.rr.get('86bb9b420')[0].amount,47813);
 assert.equal(b.rr.get('86bb71btb')[0].installmentTaskId,'86bb9b420');
 const before=b.writes.filter(w=>w.body.comment_text?.startsWith('RECEIPT:')).length;
 assert.equal((await b.call()).statusCode,200);
 assert.equal(b.writes.filter(w=>w.body.comment_text?.startsWith('RECEIPT:')).length,before);
});
test('Jesse mapped installment rejects wrong amount, identity, task, list and stored contradictions before writes',async()=>{
 for(const opts of [{amount:100},{email:'other@example.invalid'},{eventDate:'2027-05-28'},{installmentId:'arbitrary'},{list:'other-list'},{conflict:true}]){
  const b=await run(opts);assert.equal(b.r.statusCode,422,JSON.stringify(opts));assert.equal(b.writes.length,0);
 }
});
