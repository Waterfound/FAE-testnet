'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..','src');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const renderer=fs.readFileSync(path.join(root,'renderer.js'),'utf8');
const controller=fs.readFileSync(path.join(root,'controller.cjs'),'utf8');
test('FATIMA is explicit intended ticker, without presenting FAE testnet balance as FATIMA',()=>{
  assert.match(html,/FATIMA · OFFICIAL INTENDED TICKER/);
  assert.match(html,/OBSERVED FAE TESTNET BALANCE · NOT FATIMA/);
  assert.match(html,/Existing testnet unit: <strong>FAE<\/strong>/);
  assert.match(html,/— FAE/);
  assert.ok(renderer.includes("+' FAE'"));
  assert.ok(!renderer.includes("+' FATIMA'"));
});
test('display-only branding leaves FAE v4 network and node contract identifiers intact',()=>{
  assert.match(controller,/const \{NETWORK,validateRead\}/);
  assert.match(html,/fairyelf-public-testnet-v4/);
  assert.doesNotMatch(controller,/FATIMA|TRIUMPH|THS/);
});
