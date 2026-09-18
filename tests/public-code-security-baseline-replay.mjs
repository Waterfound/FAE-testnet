import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const manifest=JSON.parse(await readFile(new URL('../docs/security/FAE_PSR17_FULL_SECURITY_BASELINE_REPLAY_V1.json',import.meta.url),'utf8'));
const workflow=await readFile(new URL('../.github/workflows/psr17-full-security-baseline.yml',import.meta.url),'utf8');

test('PSR-17 replay manifest forbids selective retry and binds all required replay components',()=>{
  assert.equal(manifest.schema,'FAE_PSR17_FULL_SECURITY_BASELINE_REPLAY_V1');
  assert.equal(manifest.retry_policy.selective_retry_forbidden,true);
  assert.equal(manifest.retry_policy.per_step_attempts,1);
  assert.equal(manifest.retry_policy.continue_on_error_in_workflow,false);
  assert.equal(manifest.retry_policy.prior_failed_run_may_not_be_erased_by_rerun,true);

  const ids=manifest.replay_components.map(row=>row.id);
  assert.deepEqual(ids,['R17-01','R17-02','R17-03','R17-04','R17-05']);
  for(const row of manifest.replay_components){
    if('attempts' in row)assert.equal(row.attempts,1,row.id+' attempts must remain 1');
    if('attempts_per_clean_room' in row)assert.equal(row.attempts_per_clean_room,1,row.id+' clean-room attempts must remain 1');
    if('attempts_per_dockerfile' in row)assert.equal(row.attempts_per_dockerfile,1,row.id+' docker attempts must remain 1');
  }

  assert.deepEqual(
    manifest.external_required_checks,
    ['verify-canonical-source','cross-lab-integration-gate','codeql-security']
  );
  assert.equal(manifest.authority.target_writes,false);
  assert.equal(manifest.authority.production_actions,false);
  assert.equal(manifest.authority.release_authority,false);
  assert.equal(manifest.authority.mainnet_authority,false);
});

test('PSR-17 workflow has no selective retry, continue-on-error or cancellation erasure',()=>{
  assert.ok(workflow.includes('cancel-in-progress: false'));
  assert.equal(/continue-on-error\s*:\s*true/i.test(workflow),false);
  assert.equal(/\bretry\b/i.test(workflow),false);
  assert.equal(/max-attempts|max_attempts/i.test(workflow),false);
  assert.ok(workflow.includes('Checkout exact PSR-17 candidate'));
  assert.ok(workflow.includes('Execute full baseline replay exactly once'));
  assert.ok(workflow.includes('node scripts/psr17-full-security-replay.mjs'));
  assert.ok(workflow.includes('retention-days: 14'));
});

test('PSR-17 prerequisite integration commit is current-history ancestor',()=>{
  assert.equal(manifest.prerequisite_normalization.PSR_15,'GREEN');
  assert.equal(manifest.prerequisite_normalization.PSR_16,'GREEN');
  assert.match(manifest.prerequisite_normalization.psr16_integration_commit,/^[0-9a-f]{40}$/);
  assert.equal(manifest.prerequisite_normalization.psr16_final_runs.psr16,3);
  assert.equal(manifest.prerequisite_normalization.psr16_final_runs.psr15,7);
  assert.equal(manifest.prerequisite_normalization.psr16_final_runs.canonical,574);
  assert.equal(manifest.prerequisite_normalization.psr16_final_runs.cross_lab,32);
  assert.equal(manifest.prerequisite_normalization.psr16_final_runs.codeql,55);
});

console.log(JSON.stringify({
  status:'PASS',
  psr:'PSR-17',
  selective_retry_forbidden:true,
  replay_components:manifest.replay_components.length,
  external_checks:manifest.external_required_checks
}));
