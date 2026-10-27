'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..','src');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const renderer=fs.readFileSync(path.join(root,'renderer.js'),'utf8');
const controller=fs.readFileSync(path.join(root,'controller.cjs'),'utf8');
test('TRIUM is explicit intended ticker, without presenting FAE testnet balance as TRIUM',()=>{
  assert.match(html,/TRIUM · OFFICIAL INTENDED TICKER/);
  assert.match(html,/OBSERVED FAE TESTNET BALANCE · NOT TRIUM/);
  assert.match(html,/Existing testnet unit: <strong>FAE<\/strong>/);
  assert.match(html,/— FAE/);
  assert.ok(renderer.includes("+' FAE'"));
  assert.ok(!renderer.includes("+' TRIUM'"));
  assert.doesNotMatch(html,/FATIMA/, 'legacy ticker cannot remain visible in the desktop UI');
  assert.doesNotMatch(renderer,/FATIMA/, 'runtime UI labels must not reintroduce the legacy ticker');
  assert.match(html,/Project: Triumph Sovereign · Intended ticker: <strong>TRIUM<\/strong>/);
  assert.match(html,/TRIUM is the intended monetary symbol\. Observed testnet balances remain FAE/);
});
test('display-only branding leaves FAE v4 network and node contract identifiers intact',()=>{
  assert.match(controller,/const \{NETWORK,validateRead\}/);
  assert.match(html,/fairyelf-public-testnet-v4/);
  assert.doesNotMatch(controller,/TRIUM|FATIMA|TRIUMPH|THS/);
});
