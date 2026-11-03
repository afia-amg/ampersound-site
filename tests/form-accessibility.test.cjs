const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname,'..'), read = p => fs.readFileSync(path.join(root,p),'utf8');
const api = require('../form-accessibility.js');
test('typed signature requires deliberate name and consent, never a default', () => {
  for (const [name,consent,ok] of [['',true,false],['A',true,false],['  ',true,false],['Sample Signer',false,false],['Sample Signer',true,true]]) assert.equal(api.validTyped(name,consent),ok);
});
test('typed signature uses a separate PNG, does not mutate drawing or call a server', () => {
  let focused = false, text = [], drawingRead = false;
  const c = {typed:()=>true,name:{value:'Sample Signer',setAttribute(){},removeAttribute(){},focus(){focused=true;}},consent:{checked:false,focus(){focused=true;}},error:{textContent:''}};
  const cv = {_amgSignature:c,toDataURL(){drawingRead=true;return 'drawn';},ownerDocument:{createElement(){return {getContext(){return {fillRect(){},fillText(v){text.push(v);}};},toDataURL(){return 'data:image/png;base64,TEST';}};}}};
  assert.equal(api.signature(cv,false).ok,false);assert.ok(focused);assert.equal(drawingRead,false);
  c.consent.checked=true;
  const result=api.signature(cv,false);
  assert.equal(result.ok,true);assert.equal(result.method,'typed');assert.equal(result.name,'Sample Signer');assert.ok(result.image.startsWith('data:image/png;'));
  assert.equal(drawingRead,false);assert.ok(text.includes('Sample Signer'));assert.ok(text.some(t=>t.includes('explicit consent')));
});
test('drawn signature retains original image and still requires ink', () => {
  let focused=false;const cv={_amgSignature:{typed:()=>false,error:{},box:{querySelector(){return {focus(){focused=true;}};}}},toDataURL:()=> 'existing-drawing'};
  assert.equal(api.signature(cv,false).ok,false);assert.ok(focused);
  assert.deepEqual(api.signature(cv,true),{ok:true,method:'drawn',name:'',image:'existing-drawing'});
});
test('all signing entry points use the adapter and preserve their term consent checks', () => {
  for(const p of ['agreement/sign/index.html','partner-docs/angelica-nathan/sign.html','partner-docs/donnielle/agreement.html']) {
    const src=read(p);assert.ok(src.includes('/form-accessibility.js'));assert.ok(src.includes('AMGForms.signature(canvas,'));assert.ok(src.includes('signature.image'));assert.ok(src.includes('signatureMethod:signature.method'));
  }
  assert.match(read('agreement/sign/index.html'),/agreeTerms'\)\.checked/);
  assert.match(read('partner-docs/_assets/portal.js'),/AMGForms.signature\(el\('sig'\),sigDirty\)/);
  assert.match(read('partner-docs/_assets/portal.js'),/!signature.ok\|\|name.length<2\|\|!agreed/);
});
test('shared portal startup waits for accessibility support before rendering controls', () => {
  const src=read('partner-docs/_assets/portal.js');
  assert.match(src,/function startPortal/);
  assert.match(src,/support.src='\/form-accessibility.js'/);
  assert.match(src,/support.onload=startPortal/);
  assert.match(src,/document.head.appendChild\(support\);return;/);
});
test('labels, focus, live feedback and staffing navigation are provided without network effects', () => {
  const src=read('form-accessibility.js');new vm.Script(src);
  assert.match(src,/label.htmlFor = ensureId\(field\)/);
  assert.match(src,/svc-check input:focus-visible\+label/);
  assert.match(src,/aria-describedby/);assert.match(src,/aria-invalid/);assert.match(src,/aria-live/);
  assert.match(src,/ArrowRight.*ArrowDown.*ArrowLeft.*ArrowUp.*Home.*End/);
  assert.doesNotMatch(src,/fetch\(|XMLHttpRequest|\.submit\(/);
  for (const file of ['intake.html','testimonials.html','client-portal/index.html','partner-portal/index.html']) assert.ok(read(file).includes('/form-accessibility.js'));
});
test('client lookup no longer trusts paid query flags', () => {
  assert.doesNotMatch(read('client-portal/index.html'),/Payment received! Thank you. Your booking is confirmed/);
  assert.doesNotMatch(read('client-portal/index.html'),/get\('paid'\)/);
});
test('legacy signature forms do not display success on rejected submissions', () => {
  for(const p of ['partner-docs/angelica-nathan/sign.html','partner-docs/donnielle/agreement.html']) {
    const src=read(p);assert.match(src,/if\(!response.ok\)throw/);assert.match(src,/btn.disabled=false;btn.textContent='Try signing again';return;/);
  }
});
test('vendor dialog preserves background state, contains focus and returns to opener', () => {
  const src=read('cue/_assets/vendor.js');new vm.Script(src);
  assert.match(src,/sheetOpener = document.activeElement/);
  assert.match(src,/node.hasAttribute\('inert'\)/);
  assert.match(src,/if \(!wasInert\) node.removeAttribute\('inert'\)/);
  assert.match(src,/e.shiftKey && document.activeElement === first/);
  assert.match(src,/!e.shiftKey && document.activeElement === last/);
  assert.match(src,/sheetOpener.isConnected\) sheetOpener.focus\(\)/);
  assert.match(src,/clearTimeout\(sheetFocusTimer\)/);
});
