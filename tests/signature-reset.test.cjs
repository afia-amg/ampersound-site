'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const integration=require('../netlify/functions/_integration');
const source=fs.readFileSync(path.join(__dirname,'../netlify/functions/_payment-receipts.js'),'utf8');
const valid={comment_text:'Agreement signed digitally\nSigned by: Angela Hussain\nDate: 2026-10-28T01:22:04.638Z'};
const marker={comment_text:'AMG_SIGNATURE_RESET_V1'};
const legacy={comment_text:"Previous digital signature (portal reset to unsigned at Afia's request on Nov 4, 2026)\nHistorical record only. A new signature is required.\nSigned by: Averiel Bailey\nDate: 2026-11-05T01:51:31.785Z\nPackage: Gala DJ\nTotal: $1650.00\nEvent: 2027-02-20\nSignature: saved as attachment"};
function load(rows){
 const c={module:{exports:{}},exports:{},Buffer,process:{env:{STRIPE_WEBHOOK_SECRET:'mock'}},
  require:n=>n==='crypto'?crypto:n==='./_integration'?{...integration,api:async()=>({comments:rows})}:(()=>{throw Error(n)})()};
 vm.runInNewContext(source,c);return c.module.exports;
}
const task={id:'mock-agreement',status:{status:'signed'}};
test('ordinary signature/reset discussion never revokes a valid signature',async()=>{
 for(const note of [
  'Client asked whether the signature was reset. It was not; no change required.',
  'The signature was not reset.',
  'No new signature is required.',
  'Historical record only is wording from a previous note.',
  'Please review the unsigned signature question with Afia.',
  'Discuss AMG_SIGNATURE_RESET_V1 before making a change.',
  '> AMG_SIGNATURE_RESET_V1',
  'AMG_SIGNATURE_RESET_V1 is not applied.',
  'Example:\nAMG_SIGNATURE_RESET_V1'
 ]){
  const r=await load([{comment_text:note},valid]).signatureRecord(task);
  assert.equal(r?.signedName,'Angela Hussain',note);
 }
});
test('explicit standalone reset marker invalidates older signatures',async()=>{
 assert.equal(await load([marker,valid]).signatureRecord(task),null);
});
test('new signature after explicit reset is current',async()=>{
 assert.equal((await load([valid,marker]).signatureRecord(task))?.signedName,'Angela Hussain');
});
test('actual legacy Hope Gala reset record invalidates older signatures',async()=>{
 assert.equal(await load([legacy,valid]).signatureRecord(task),null);
});
test('new signature after historical Hope Gala reset is current',async()=>{
 assert.equal((await load([valid,legacy]).signatureRecord(task))?.signedName,'Angela Hussain');
});
test('quoted or incomplete legacy reset wording is not a control record',async()=>{
 for(const t of ['Quoted record:\n'+legacy.comment_text,legacy.comment_text.split('\n').slice(0,2).join('\n')]){
  assert.equal((await load([{comment_text:t},valid]).signatureRecord(task))?.signedName,'Angela Hussain');
 }
});
test('reset controls accept normalized whitespace and Windows line endings',async()=>{
 assert.equal(await load([{comment_text:' \r\nAMG_SIGNATURE_RESET_V1\r\n '},valid]).signatureRecord(task),null);
 assert.equal(await load([{comment_text:legacy.comment_text.replace(/\n/g,'\r\n')},valid]).signatureRecord(task),null);
});
test('newer reset still wins over a later-listed valid signature and prior reset',async()=>{
 assert.equal(await load([marker,valid,legacy]).signatureRecord(task),null);
});
test('signed status alone stays insufficient evidence',async()=>{
 assert.equal(await load([]).signatureRecord(task),null);
});
