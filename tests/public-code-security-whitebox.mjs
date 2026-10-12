import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

import {emptyState} from '../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {verifyPersistedState} from '../sovereign-forge/node/authoritative/fae-v4-peer-node.mjs';
import {PeerGuard} from '../sovereign-forge/node/authoritative/peer-guard.mjs';

const root=new URL('../',import.meta.url);
const json=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const text=async path=>readFile(new URL(path,root),'utf8');

test('PSR-15 campaign covers every attack surface and every active baseline invariant',async()=>{
  const [campaign,matrix]=await Promise.all([
    json('docs/security/FAE_PSR15_WHITE_BOX_CAMPAIGN_V1.json'),
    json('docs/security/FAE_ATTACK_SURFACE_MATRIX_V1.json')
  ]);
  assert.equal(campaign.schema,'FAE_PSR15_WHITE_BOX_CAMPAIGN_V1');
  assert.equal(campaign.authority.authority,'NONE');
  assert.equal(campaign.authority.target_writes,false);
  assert.equal(campaign.authority.production_actions,false);
  assert.equal(campaign.method.target_pin_mutated,false);

  const knownSurfaces=new Set(matrix.surfaces.map(row=>row.id));
  const knownInvariants=new Set(matrix.invariant_registry.map(row=>row.id));
  const coveredSurfaces=new Set();
  const coveredInvariants=new Set();
  const ids=new Set();

  for(const attack of campaign.attacks){
    assert.match(attack.id,/^WB-\d{2}$/);
    assert.equal(ids.has(attack.id),false,'duplicate attack id '+attack.id);
    ids.add(attack.id);
    assert.ok(Array.isArray(attack.surfaces)&&attack.surfaces.length>0,attack.id+' missing surfaces');
    assert.ok(Array.isArray(attack.invariants)&&attack.invariants.length>0,attack.id+' missing invariants');
    assert.ok(Array.isArray(attack.command)&&attack.command.length>=2,attack.id+' missing executable command');
    assert.ok(Number.isSafeInteger(attack.timeout_ms)&&attack.timeout_ms>=10_000&&attack.timeout_ms<=300_000);
    assert.equal(attack.severity_on_failure,'baseline_blocking');
    for(const surface of attack.surfaces){
      assert.ok(knownSurfaces.has(surface),attack.id+' unknown surface '+surface);
      coveredSurfaces.add(surface);
    }
    for(const invariant of attack.invariants){
      assert.ok(knownInvariants.has(invariant),attack.id+' unknown invariant '+invariant);
      coveredInvariants.add(invariant);
    }
  }
  assert.deepEqual([...coveredSurfaces].sort(),[...knownSurfaces].sort());
  const active=matrix.invariant_registry.filter(row=>row.active_v4!==false).map(row=>row.id).sort();
  for(const invariant of active)assert.ok(coveredInvariants.has(invariant),'active invariant not attacked: '+invariant);

  for(const required of[
    'baseline_blocking_failure_creates_finding',
    'scanners_cannot_waive_findings',
    'missing_evidence_fails_closed',
    'feasible_fix_requires_regression',
    'automatic_finding_waiver'
  ]) assert.ok(Object.hasOwn(campaign.finding_policy,required),'missing finding policy '+required);
  assert.equal(campaign.finding_policy.automatic_finding_waiver,false);
});

test('PSR-15 semantic persisted-state corruption cannot materialize forged value',()=>{
  const raw=emptyState();
  raw.utxos['forged:0']={
    outpoint:'forged:0',
    address:'faet1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw2770k',
    amount_atoms:'999999999999999999999999',
    created_height:0,
    spent:false,
    spent_by:null
  };
  raw.mempoolOutputs['forged-pending:0']={
    outpoint:'forged-pending:0',
    txid:'f'.repeat(64),
    output_index:0,
    address:'faet1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw2770k',
    amount_atoms:'777'
  };
  raw.mempoolSpends['does-not-exist:0']='e'.repeat(64);
  raw.mempoolOrder.push('e'.repeat(64));
  raw.mempoolSeq=Number.MAX_SAFE_INTEGER;

  const verified=verifyPersistedState(raw,{activationHeight:null});
  assert.equal(verified.chain.length,0);
  assert.equal(Object.keys(verified.utxos).length,0,'forged confirmed value survived semantic replay');
  assert.equal(Object.keys(verified.mempoolOutputs).length,0,'forged pending value survived semantic replay');
  assert.equal(Object.keys(verified.mempoolSpends).length,0,'forged reservations survived semantic replay');
  assert.equal(verified.mempoolOrder.length,0);
  assert.equal(verified.mempoolSeq,0);
});

test('PSR-15 availability ceilings remain explicit at white-box ingress boundaries',async()=>{
  const [core,node,secure,directory]=await Promise.all([
    text('sovereign-forge/node/authoritative/fae-v4-core.mjs'),
    text('sovereign-forge/node/fae-node.mjs'),
    text('sovereign-forge/node/authoritative/secure-channel.mjs'),
    text('sovereign-forge/node/authoritative/peer-directory.mjs')
  ]);
  for(const required of[
    'export const MAX_TXS_PER_BLOCK=20',
    'export const MAX_INPUTS=64',
    'export const MAX_OUTPUTS=16'
  ]) assert.ok(core.includes(required),'active core lost resource ceiling '+required);
  assert.ok(node.includes("body.length>2_000_000"),'independent HTTP boundary lost request-body ceiling');
  assert.ok(secure.includes('DEFAULT_MAX_MESSAGE_BYTES=2*1024*1024'),'secure channel lost message-size ceiling');
  assert.ok(secure.includes('DEFAULT_MAX_SESSIONS=512'),'secure channel lost session ceiling');
  assert.ok(directory.includes('const MAX_RECORDS=512'),'peer directory lost record ceiling');
  assert.ok(directory.includes('const MAX_ENDPOINTS_PER_IDENTITY=4'),'peer directory lost identity endpoint ceiling');

  const guard=new PeerGuard({maxRecords:64,maxCostPerWindow:12,banScore:4});
  for(let i=0;i<1000;i++)guard.allow('whitebox-'+i,1,1_000+i);
  assert.ok(guard.records.size<=64,'peer guard record flood exceeded configured ceiling');
});

test('PSR-15 active authority cannot be acquired by PQ/MTS labs or shadow imports',async()=>{
  const [core,browser,pq,mts,registry,rehearsal,release]=await Promise.all([
    text('sovereign-forge/node/authoritative/fae-v4-core.mjs'),
    text('core.js'),
    json('lab/post-quantum-signatures/authority.json'),
    json('lab/mining-tip-sync/authority.json'),
    json('lab/integration/registry.json'),
    json('sovereign-forge/release/mainnet-rehearsal-template.json'),
    json('sovereign-forge/release/release-candidate-config.json')
  ]);

  for(const forbidden of['post-quantum-signatures','consensus-v3-shadow','lab/post-quantum','lab/mining-tip-sync']){
    assert.equal(core.includes(forbidden),false,'active core references non-authoritative surface '+forbidden);
    assert.equal(browser.includes(forbidden),false,'active browser core references non-authoritative surface '+forbidden);
  }
  for(const key of['activation_authorized','consensus_change_authorized','public_testnet_change_authorized','candidate_to_authoritative','mainnet_launch_authorized']){
    assert.equal(pq[key],false,'PQ authority flag changed: '+key);
  }
  assert.equal(mts.runtime_write_authorized??false,false,'MTS top-level runtime write authority unexpectedly enabled');
  assert.equal(registry.require_latest_main_ancestry_before_merge,true);
  assert.equal(rehearsal.authority.mainnet_launch_authorized,false);
  assert.equal(rehearsal.authority.candidate_to_authoritative,false);
  assert.equal(rehearsal.authority.automatic_go_path,false);
  assert.equal(release.authority.mainnet_launch_authorized,false);
  assert.equal(release.authority.candidate_to_authoritative,false);
  assert.equal(release.authority.live_activation_height,null);
});

test('PSR-15 supply-chain evidence remains source-bound and scanners cannot become authority',async()=>{
  const [lock,evidence,security]=await Promise.all([
    json('release/provenance/container-inputs-v1.json'),
    json('docs/security/FAE_PSR13_RELEASE_PROVENANCE_EVIDENCE_V1.json'),
    text('SECURITY.md')
  ]);
  assert.match(lock.index_digest,/^sha256:[0-9a-f]{64}$/);
  assert.equal(lock.policy.base_input_digest_pinned,true);
  assert.equal(lock.policy.oci_image_byte_reproducibility_claimed,false);
  assert.equal(lock.authority.release_authorized,false);
  assert.equal(lock.authority.mainnet_authorized,false);
  assert.equal(evidence.authority.release_authorized,false);
  assert.equal(evidence.authority.mainnet_authorized,false);
  assert.ok(evidence.limitations.some(x=>/authority/i.test(x)||/provenance/i.test(x)));
  assert.ok(security.includes('Do not include sensitive vulnerability details in a public message.'));
});

console.log(JSON.stringify({
  status:'PASS',
  psr:'PSR-15',
  method:'Project Assurance white-box composition',
  target_writes:false,
  production_actions:false,
  authority:'NONE'
}));
