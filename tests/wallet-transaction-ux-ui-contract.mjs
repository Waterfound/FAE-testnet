import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');

const requiredIds=[
  'openhistory',
  'history-panel',
  'history-title',
  'historystate',
  'retryhistory',
  'txhist',
  'transaction-detail',
  'txdetailtitle',
  'txdetailstatus',
  'txdetailid',
  'copytxid',
  'txcopyfeedback',
  'txdetaildirection',
  'txdetailamount',
  'txdetailfrom',
  'txdetailblock',
  'txdetailtime',
  'txdetailoutputs',
  'sendreceipt',
  'sendtxstatus',
  'sendtxid',
  'copysendtx',
  'opensendtxdetails',
  'sendcopyfeedback'
];

for(const id of requiredIds){
  assert.match(html,new RegExp(`id=[\"']${id}[\"']`),'missing #'+id);
}

assert.match(
  html,
  /<script\s+src=["']\/wallet-transaction-ux\.js["']><\/script>/,
  'wallet transaction contract must be loaded by the real wallet document'
);

const uxScriptIndex=html.indexOf('/wallet-transaction-ux.js');
const coreScriptIndex=html.indexOf('/core.js');
const walletScriptIndex=html.indexOf('/wallet.js');
assert.ok(uxScriptIndex>=0&&coreScriptIndex>=0&&walletScriptIndex>=0);
assert.ok(uxScriptIndex<coreScriptIndex,'transaction contract must load before core.js');
assert.ok(coreScriptIndex<walletScriptIndex,'core.js must load before wallet.js');

assert.match(
  html,
  /id=["']openhistory["'][^>]*aria-controls=["']history-panel["']/,
  'primary history action must point to the history panel'
);
assert.match(
  html,
  /id=["']historystate["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/,
  'history lifecycle state must be announced accessibly'
);
assert.match(
  html,
  /id=["']sendcopyfeedback["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/,
  'send TXID copy feedback must be announced'
);
assert.match(
  html,
  /id=["']txcopyfeedback["'][^>]*role=["']status["'][^>]*aria-live=["']polite["']/,
  'detail TXID copy feedback must be announced'
);

assert.match(
  html,
  /\.txid-full\{[^}]*overflow-wrap:anywhere[^}]*word-break:break-all[^}]*user-select:all[^}]*\}/,
  'complete TXID must remain visible/selectable on narrow screens'
);
const mobileMediaStart=html.indexOf('@media(max-width:760px){');
const mobileDetailRule=html.indexOf('.transaction-detail-grid{grid-template-columns:1fr}',mobileMediaStart);
const nextMedia=html.indexOf('@media(',mobileMediaStart+1);
assert.ok(
  mobileMediaStart>=0&&
  mobileDetailRule>mobileMediaStart&&
  (nextMedia<0||mobileDetailRule<nextMedia),
  'transaction detail layout must collapse to one column inside the <=760px media block'
);

assert.match(
  html,
  /id=["']sendreceipt["'][^>]*hidden/,
  'send receipt must not claim a transaction exists before an accepted submit'
);
assert.match(
  html,
  /id=["']transaction-detail["'][^>]*hidden/,
  'transaction detail panel must begin closed'
);

assert.doesNotMatch(
  html,
  /id=["']sendtxid["'][^>]*value=/,
  'TXID must be rendered dynamically from the accepted transaction, not baked into HTML'
);

console.log('FAE Wallet Transaction UX WTX-05 real-document UI contract passed.');
