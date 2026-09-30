import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const contractUrl=new URL('./acceptance-contract.json',import.meta.url);
const browserReadmeUrl=new URL('../../sovereign-forge/browser/README.md',import.meta.url);
const threatUrl=new URL('../../docs/security/FAE_PUBLIC_CODE_THREAT_MODEL_V1.md',import.meta.url);

test('wallet delivered-code/signing-integrity gate remains fail-closed until browser source is canonical',async()=>{
  const contract=JSON.parse(await readFile(contractUrl,'utf8'));
  const browserReadme=await readFile(browserReadmeUrl,'utf8');
  const threat=await readFile(threatUrl,'utf8');
  assert.equal(contract.schema,'FAE_WALLET_DELIVERED_CODE_SIGNING_INTEGRITY_V1');
  assert.equal(contract.authority.consensus_change,false);
  assert.equal(contract.authority.economic_change,false);
  assert.equal(contract.authority.release,false);
  assert.match(browserReadme,/wallet-crypto\.js/);
  assert.match(browserReadme,/wallet\.js/);
  assert.match(browserReadme,/still need to be moved from the deployment artifact into Git history/i);
  assert.match(threat,/I-KEY-01/);
  assert.match(threat,/I-SUPPLYCHAIN-01/);
  assert.match(contract.current_blocker.disposition,/Do not claim .* closed/i);
});
