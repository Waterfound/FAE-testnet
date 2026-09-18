import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {classifyChangedFiles} from '../scripts/psr19-recurring-assurance.mjs';

const root=new URL('../',import.meta.url);
const json=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));

test('PSR-19 policy closes bounded project without creating a new security system',async()=>{
  const [policy,verdict]=await Promise.all([
    json('docs/security/FAE_PSR19_RECURRING_ASSURANCE_POLICY_V1.json'),
    json('docs/security/FAE_PSR18_PUBLIC_CODE_SECURITY_VERDICT_V1.json')
  ]);
  assert.equal(policy.schema,'FAE_PSR19_RECURRING_ASSURANCE_POLICY_V1');
  assert.equal(policy.psr,'PSR-19');
  assert.equal(verdict.verdict,'BASELINE_READY_FOR_RECURRING_ASSURANCE');
  assert.equal(policy.baseline_verdict.expected,verdict.verdict);
  assert.equal(policy.project_shape.bounded_hardening_project,'CLOSE_ON_SUCCESSFUL_PSR19_INTEGRATION');
  assert.equal(policy.project_shape.recurring_mode,'REUSE_EXISTING_PROJECT_ASSURANCE');
  assert.equal(policy.project_shape.create_new_security_system,false);
  assert.equal(policy.project_shape.future_changes_inherit_verdict_automatically,false);
  assert.equal(policy.authority.authority,'NONE');
  assert.equal(policy.authority.target_writes,false);
  assert.equal(policy.authority.production_actions,false);
});

test('PSR-19 mandatory deep-review categories remain complete',async()=>{
  const policy=await json('docs/security/FAE_PSR19_RECURRING_ASSURANCE_POLICY_V1.json');
  assert.deepEqual(
    [...policy.mandatory_deep_review_categories].sort(),
    [
      'authority_release_supply_chain',
      'consensus_economics',
      'critical_networking_mining',
      'cryptography_wallet',
      'security_controls'
    ].sort()
  );
  assert.equal(policy.deep_review.runner,'scripts/psr15-project-assurance.mjs');
  assert.equal(policy.deep_review.expected_status,'PASS_NO_BASELINE_BLOCKING_FINDINGS');
  assert.equal(policy.deep_review.expected_attack_count,17);
  assert.equal(policy.deep_review.expected_findings,0);
  assert.equal(policy.deep_review.failure_policy,'FAIL_CLOSED');
  assert.equal(policy.finding_policy.scanners_cannot_waive_findings,true);
  assert.equal(policy.finding_policy.automatic_finding_waiver,false);
});

test('PSR-19 classifier requires deep review for consensus, crypto, networking, release and security-control changes',async()=>{
  const policy=await json('docs/security/FAE_PSR19_RECURRING_ASSURANCE_POLICY_V1.json');
  const cases=[
    ['sovereign-forge/node/authoritative/fae-v4-core.mjs','consensus_economics'],
    ['wallet-crypto.js','cryptography_wallet'],
    ['sovereign-forge/node/authoritative/secure-channel.mjs','critical_networking_mining'],
    ['release/provenance/container-inputs-v1.json','authority_release_supply_chain'],
    ['.github/workflows/verify.yml','security_controls'],
    ['lab/post-quantum-signatures/authority.json','cryptography_wallet'],
    ['lab/mining-tip-sync/authority.json','critical_networking_mining']
  ];
  for(const [path,category] of cases){
    const result=classifyChangedFiles([path],policy);
    assert.equal(result.deep_review_required,true,path+' should require deep review');
    assert.ok(result.categories.includes(category),path+' missing '+category);
  }
});

test('PSR-19 classifier does not force full white-box campaign for unrelated documentation',async()=>{
  const policy=await json('docs/security/FAE_PSR19_RECURRING_ASSURANCE_POLICY_V1.json');
  const result=classifyChangedFiles(['README.md'],policy);
  assert.equal(result.deep_review_required,false);
  assert.deepEqual(result.categories,[]);
});

test('PSR-19 baseline verdict remains explicitly non-authoritative',async()=>{
  const verdict=await json('docs/security/FAE_PSR18_PUBLIC_CODE_SECURITY_VERDICT_V1.json');
  assert.equal(verdict.authority.mainnet_authority,false);
  assert.equal(verdict.authority.release_authority,false);
  assert.equal(verdict.authority.consensus_activation,false);
  assert.equal(verdict.authority.economic_activation,false);
  assert.ok(verdict.non_claims.some(x=>/Does not claim absence of all vulnerabilities/i.test(x)));
});

console.log(JSON.stringify({
  status:'PASS',
  psr:'PSR-19',
  bounded_project_closeout_contract:true,
  recurring_project_assurance:true,
  new_security_system:false,
  authority:'NONE'
}));
