'use strict';
// Prospect pitch pages are public leave-behinds: no portal engine, forms, scripts, or pricing.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const DIR=path.join(ROOT,'pitch');
const pages=fs.existsSync(DIR)?fs.readdirSync(DIR,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join('pitch',e.name,'index.html')).filter(p=>fs.existsSync(path.join(ROOT,p))):[];
test('pitch pages exist',()=>assert.ok(pages.length>0));
for(const p of pages){
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
