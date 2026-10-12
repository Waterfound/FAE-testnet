import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const peerNodeUrl=new URL('../../sovereign-forge/node/authoritative/fae-v4-peer-node.mjs',import.meta.url);
const contractUrl=new URL('./acceptance-contract.json',import.meta.url);

test('authoritative peer sync exposes the current 50k branch ceiling as evidence, not a survivability PASS',async()=>{
  const source=await readFile(peerNodeUrl,'utf8');
  const contract=JSON.parse(await readFile(contractUrl,'utf8'));
  assert.match(source,/const MAX_BRANCH_BLOCKS=50_000;/);
  assert.match(source,/headers\.length>MAX_BRANCH_BLOCKS/);
  assert.match(source,/peer_branch_exceeds_sync_ceiling/);
  assert.match(source,/blocks\.length>MAX_BRANCH_BLOCKS/);
  assert.equal(contract.schema,'FAE_LONG_HORIZON_NODE_SURVIVABILITY_V1');
  assert.equal(contract.authority.consensus_change,false);
  assert.ok(contract.required_scenarios.includes('fresh state with chain-distance 50001 or greater'));
});
