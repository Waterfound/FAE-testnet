import assert from 'node:assert/strict';
import test from 'node:test';
import {access,readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const json=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const text=async path=>readFile(new URL(path,root),'utf8');

function executablePath(command){
  if(!Array.isArray(command)||command[0]!=='node')return null;
  if(command[1]==='--test')return command[2]??null;
  return command[1]??null;
}

test('PSR-16 closes the admitted PSR-15 finding set without inventing risk acceptance',async()=>{
  const ledger=await json('docs/security/FAE_PSR16_FINDING_CLOSURE_V1.json');
  assert.equal(ledger.schema,'FAE_PSR16_FINDING_CLOSURE_V1');
  assert.equal(ledger.psr,'PSR-16');
  assert.equal(ledger.prerequisite.psr15,'GREEN');
  assert.equal(ledger.prerequisite.dedicated_run.status,'SUCCESS');
  assert.equal(ledger.prerequisite.canonical_run.status,'SUCCESS');
  assert.equal(ledger.prerequisite.cross_lab_run.status,'SUCCESS');
  assert.equal(ledger.prerequisite.report_summary.status,'PASS_NO_BASELINE_BLOCKING_FINDINGS');
  assert.equal(ledger.prerequisite.report_summary.planned,17);
  assert.equal(ledger.prerequisite.report_summary.executed,17);
  assert.equal(ledger.prerequisite.report_summary.passed,17);
  assert.equal(ledger.prerequisite.report_summary.failed,0);
  assert.equal(ledger.prerequisite.report_summary.findings,0);
  assert.equal(ledger.prerequisite.report_summary.target_unchanged,true);
  assert.equal(ledger.prerequisite.report_summary.authority,'NONE');

  for(const key of['admitted_findings','fixed_findings','residual_risk_acceptances','open_blockers']){
    assert.deepEqual(ledger.closure[key],[],key+' must remain empty in zero-finding closure');
  }
  assert.equal(ledger.closure.fix_regressions_required,0);
  assert.equal(ledger.authority.target_writes,false);
  assert.equal(ledger.authority.production_actions,false);
  assert.equal(ledger.authority.consensus_change,false);
  assert.equal(ledger.authority.runtime_change,false);
  assert.equal(ledger.authority.release_authority,false);
  assert.equal(ledger.authority.mainnet_authority,false);
});

test('PSR-16 promotes every PSR-15 attack as an executable permanent regression',async()=>{
  const [ledger,campaign,workflow]=await Promise.all([
    json('docs/security/FAE_PSR16_FINDING_CLOSURE_V1.json'),
    json('docs/security/FAE_PSR15_WHITE_BOX_CAMPAIGN_V1.json'),
    text('.github/workflows/psr15-project-assurance.yml')
  ]);
  assert.equal(campaign.attacks.length,17);
  assert.equal(ledger.regression_promotion.promoted_count,campaign.attacks.length);
  assert.equal(ledger.regression_promotion.dedicated_workflow,'.github/workflows/psr15-project-assurance.yml');
  assert.ok(workflow.includes('node scripts/psr15-project-assurance.mjs'));
  assert.ok(workflow.includes('fae-psr15-project-assurance'));

  const promoted=new Map(ledger.regression_promotion.attacks.map(row=>[row.attack_id,row]));
  assert.equal(promoted.size,campaign.attacks.length);
  for(const attack of campaign.attacks){
    const row=promoted.get(attack.id);
    assert.ok(row,'missing promoted regression '+attack.id);
    assert.deepEqual(row.command,attack.command,attack.id+' command drifted after promotion');
    assert.equal(row.severity,'baseline_blocking');
    assert.equal(row.regression_status,'PROMOTED_PERMANENT_CAMPAIGN_CASE');
    assert.equal(row.owner_workflow,'.github/workflows/psr15-project-assurance.yml');
    const path=executablePath(row.command);
    assert.ok(path,attack.id+' has no executable JS path');
    await access(new URL('../'+path,import.meta.url));
  }
});

test('PSR-16 closure remains fail-closed and cannot be satisfied by scanner signals',async()=>{
  const ledger=await json('docs/security/FAE_PSR16_FINDING_CLOSURE_V1.json');
  assert.match(ledger.regression_promotion.failure_policy,/blocks PSR-16/);
  assert.equal(ledger.exit_binding.dynamic_psr15_rerun,'required');
  assert.equal(ledger.exit_binding.canonical_verification,'required');
  assert.equal(ledger.exit_binding.cross_lab_integration,'required');
  assert.equal(ledger.exit_binding.exact_source_binding,'required before merge');
  assert.ok(!JSON.stringify(ledger.closure).includes('"waived":true'));
});

console.log(JSON.stringify({
  status:'PASS',
  psr:'PSR-16',
  closure:'ZERO_FINDING_VERIFIED',
  promoted_regressions:17,
  residual_risk_acceptances:0,
  open_blockers:0,
  authority:'NONE'
}));
