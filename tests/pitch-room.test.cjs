'use strict';
// Pitch Room: email lookup routes prospects to their deck. Pitch pages stay static leave-behinds.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const FN='netlify/functions/pitch-room-lookup.js';
const lookup=require(path.join(ROOT,FN));
const call=async(body,method='POST')=>{const r=await lookup.handler({httpMethod:method,body:typeof body==='string'?body:JSON.stringify(body)});return {status:r.statusCode,headers:r.headers,...JSON.parse(r.body)};};
const T=lookup._test;
T.PITCHES['test-only']={title:'Test Pitch',org:'Test Org',url:'/pitch-room/test-only/',emails:[T.hash('prospect@example.invalid')]};

test('a listed email routes to its pitch, case and spaces ignored',async()=>{
 const r=await call({email:'  Prospect@Example.INVALID '});
 assert.equal(r.status,200);
 assert.deepEqual(r.pitches,[{title:'Test Pitch',org:'Test Org',url:'/pitch-room/test-only/'}]);
 assert.equal(r.headers['Cache-Control'],'no-store');
});
test('Afia can preview the Kilby pitch',async()=>{
 const r=await call({email:'afia@ampersoundmediagroup.com'});
 assert.equal(r.status,200);
 assert.ok(r.pitches.some(p=>p.url==='/pitch-room/kilby-block-party/'));
});
test('unknown emails get one generic answer that never echoes the email',async()=>{
 const r=await call({email:'stranger@example.invalid'});
 assert.equal(r.status,404);
 assert.equal(r.message,T.NOT_FOUND);
 assert.ok(!JSON.stringify(r).includes('stranger'));
});
test('bad input and methods are rejected',async()=>{
 assert.equal((await call({email:'not-an-email'})).status,400);
 assert.equal((await call('{bad json')).status,400);
 assert.equal((await call({email:'a@b.co'},'GET')).status,405);
 assert.equal((await call({email:'x'.repeat(250)+'@b.co'})).status,400);
});
test('the public repo never lists a prospect email in plain text',()=>{
 const src=fs.readFileSync(path.join(ROOT,FN),'utf8');
 const emails=(src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)||[]).filter(e=>e!=='afia@ampersoundmediagroup.com'&&e!=='name@org.com');
 assert.deepEqual(emails,[]);
 for(const p of Object.values(T.PITCHES))for(const h of p.emails)assert.match(h,/^[a-f0-9]{64}$/);
});
test('every pitch the lookup returns exists as a static page',()=>{
 for(const [slug,p] of Object.entries(T.PITCHES)){
  if(slug==='test-only')continue;
  assert.equal(p.url,'/pitch-room/'+slug+'/');
  assert.ok(fs.existsSync(path.join(ROOT,'pitch-room',slug,'index.html')),slug+' page missing');
 }
});
const DIR=path.join(ROOT,'pitch-room');
for(const e of fs.readdirSync(DIR,{withFileTypes:true}).filter(e=>e.isDirectory())){
 const p=path.join('pitch-room',e.name,'index.html');
 if(!fs.existsSync(path.join(ROOT,p)))continue;
 const html=fs.readFileSync(path.join(ROOT,p),'utf8');
 test(p+' stays a static leave-behind',()=>{
  assert.match(html,/<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(html,/<script\b/i,'no scripts');
  assert.doesNotMatch(html,/<form\b|<input\b/i,'no data collection');
  assert.doesNotMatch(html,/partner-docs\/_assets|window\.PORTAL/,'not wired to the client portal engine');
  assert.doesNotMatch(html,/\$\s?\d/,'no unapproved pricing');
  assert.match(html,/26 S Rio Grande St, Suite 2072/);
 });
}
test('the Pitch Room entry page only opens same-site pitch paths',()=>{
 const html=fs.readFileSync(path.join(DIR,'index.html'),'utf8');
 assert.match(html,/<meta name="robots" content="noindex, nofollow">/);
 assert.match(html,/pitch-room-lookup/);
 assert.match(html,/\^\\\/pitch-room\\\/\[a-z0-9-\]\+\\\/\$/);
 assert.doesNotMatch(html,/innerHTML/);
 assert.doesNotMatch(html,/localStorage|sessionStorage|document\.cookie/);
});
