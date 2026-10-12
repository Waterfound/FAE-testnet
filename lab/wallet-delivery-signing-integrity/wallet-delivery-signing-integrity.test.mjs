import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const contractUrl=new URL('./acceptance-contract.json',import.meta.url);
const walletUrl=new URL('../../wallet.js',import.meta.url);
const coreUrl=new URL('../../core.js',import.meta.url);
const threatUrl=new URL('../../docs/security/FAE_PUBLIC_CODE_THREAT_MODEL_V1.md',import.meta.url);

test('wallet delivered-code/signing-integrity gate binds to the real current signing path without overclaiming same-origin compromise protection',async()=>{
  const contract=JSON.parse(await readFile(contractUrl,'utf8'));
  const wallet=await readFile(walletUrl,'utf8');
  const core=await readFile(coreUrl,'utf8');
  const threat=await readFile(threatUrl,'utf8');
  assert.equal(contract.schema,'FAE_WALLET_DELIVERED_CODE_SIGNING_INTEGRITY_V1');
  assert.equal(contract.authority.consensus_change,false);
  assert.equal(contract.authority.economic_change,false);
  assert.equal(contract.authority.release,false);
  assert.match(wallet,/const destination=\$\('sendto'\)\.value\.trim\(\)/);
  assert.match(wallet,/transaction\.signature=b64\(await crypto\.subtle\.sign\('Ed25519',wallet\.priv,E\.encode\(stable\(txPayload\(transaction\)\)\)\)\)/);
  assert.match(core,/function txPayload\(transaction\)/);
  assert.match(threat,/I-KEY-01/);
  assert.match(threat,/I-SUPPLYCHAIN-01/);
  assert.ok(contract.non_claims.some(value=>/malicious same-origin JavaScript/i.test(value)));
  assert.match(contract.residual_after_contract,/independent verification/i);
});
