import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const contract=JSON.parse(await readFile(new URL('../docs/security/FAE_PSR18_SECURITY_VERDICT_CONTRACT_V1.json',import.meta.url),'utf8'));
const result=JSON.parse(await readFile(new URL('../docs/security/FAE_PSR17_INTEGRATED_RESULT_V1.json',import.meta.url),'utf8'));
const workflow=await readFile(new URL('../.github/workflows/psr18-security-verdict.yml',import.meta.url),'utf8');

test('PSR-18 has exactly three fail-closed verdicts in required priority order',()=>{
  assert.deepEqual(contract.allowed_verdicts,[
    'BASELINE_READY_FOR_RECURRING_ASSURANCE',
    'BLOCKED_BY_SECURITY_FINDINGS',
    'BLOCKED_BY_MISSING_EVIDENCE'
  ]);
  assert.match(contract.decision_order[0],/SECURITY_FINDINGS/);
  assert.match(contract.decision_order[1],/MISSING_EVIDENCE/);
  assert.match(contract.decision_order[2],/BASELINE_READY_FOR_RECURRING_ASSURANCE/);
  assert.equal(contract.authority.mainnet_authority,false);
  assert.equal(contract.authority.release_authority,false);
});

test('PSR-17 integrated evidence is complete and authority-free',()=>{
  assert.equal(result.status,'GREEN_INTEGRATED');
  assert.equal(result.replay_report.status,'PASS_FULL_SECURITY_BASELINE_REPLAY');
  assert.equal(result.replay_report.planned_steps,17);
  assert.equal(result.replay_report.passed_steps,17);
  assert.equal(result.replay_report.failed_steps,0);
  assert.equal(result.replay_report.target_unchanged,true);
  assert.equal(result.replay_report.retry_violation,false);
  assert.equal(result.authority.mainnet_authority,false);
  assert.match(result.replay_report.artifact_zip_sha256,/^[0-9a-f]{64}$/);
});

test('PSR-18 workflow is read-only and preserves blocked verdict evidence',()=>{
  assert.ok(workflow.includes('permissions:\n  contents: read'));
  assert.equal(/continue-on-error\s*:\s*true/i.test(workflow),false);
  assert.ok(workflow.includes('if: always()'));
  assert.ok(workflow.includes('node scripts/psr18-security-verdict.mjs'));
});

console.log(JSON.stringify({
  status:'PASS',
  psr:'PSR-18',
  allowed_verdicts:contract.allowed_verdicts,
  mainnet_authority:false
}));
