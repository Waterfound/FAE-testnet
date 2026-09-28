import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CONTRACT_ID,AUTOPILOT_PROTOCOL_ID,TESTED_SOURCE_REVISION,TESTED_MINER_BLOB_SHA,NETWORK,
  validatePhysicalMode,buildSelectionLock,makeSourceProvenance,makeWorkerSource,leadingZeroBitsHex,percentile
} from '../autopilot-core.mjs';
import {createRehearsalPortfolio} from '../../representative-device-evidence-readiness/run-rehearsal.mjs';
import {prepareStaging} from '../../representative-device-evidence-readiness/prepare-staging.mjs';
import {collectEvidence} from '../../representative-device-evidence-readiness/collect-evidence.mjs';
import {verifyEvidenceBundle} from '../../representative-device-evidence-readiness/verify-evidence.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const root=join(here,'..');
const parentRoot=join(root,'..','representative-device-evidence-readiness');

test('physical mode refuses duration scaling while rehearsal mode remains isolated',()=>{
  assert.equal(validatePhysicalMode('PHYSICAL_EVIDENCE',1),true);
  assert.throws(()=>validatePhysicalMode('PHYSICAL_EVIDENCE',0.01),/physical_duration_scaling_forbidden/);
  assert.equal(validatePhysicalMode('REHEARSAL_ONLY',0.01),true);
  assert.throws(()=>validatePhysicalMode('HISTORICAL_REFERENCE',1),/unsupported_evidence_class/);
});

test('autopilot protocol exactly inherits frozen RDE durations and source binding',async()=>{
  const protocol=JSON.parse(await readFile(join(root,'protocol.json'),'utf8'));
  const contract=JSON.parse(await readFile(join(parentRoot,'acceptance-contract.json'),'utf8'));
  assert.equal(protocol.parent_contract_id,contract.contract_id);
  assert.equal(protocol.parent_contract_id,CONTRACT_ID);
  assert.equal(protocol.source_binding.tested_source_revision,contract.source_binding.baseline_source_revision);
  assert.equal(protocol.source_binding.tested_miner_blob_sha,contract.source_binding.miner_blob_sha);
  assert.equal(protocol.source_binding.network,contract.source_binding.network);
  assert.deepEqual(protocol.campaign.pure_mining_sustained,{
    repetitions:contract.workload_protocol.pure_mining_sustained.repetitions,
    warmup_seconds:contract.workload_protocol.pure_mining_sustained.warmup_seconds,
    measurement_seconds:contract.workload_protocol.pure_mining_sustained.measurement_seconds
  });
  assert.equal(protocol.campaign.normal_use_coexistence.repetitions,contract.workload_protocol.normal_use_coexistence.repetitions);
  assert.equal(protocol.campaign.normal_use_coexistence.warmup_seconds,contract.workload_protocol.normal_use_coexistence.warmup_seconds);
  assert.equal(protocol.campaign.normal_use_coexistence.measurement_seconds,contract.workload_protocol.normal_use_coexistence.measurement_seconds);
  assert.deepEqual(protocol.campaign.lifecycle_recovery.required_classes,contract.workload_protocol.lifecycle_recovery.required_for_classes);
  assert.equal(protocol.campaign.lifecycle_recovery.minimum_hidden_visible_cycles,contract.workload_protocol.lifecycle_recovery.minimum_transitions);
});

test('pre-result selection lock contains network-tip binding and no result fields',()=>{
  const lock=buildSelectionLock({
    deviceClass:'mobile_tablet_arm',manufacturer:'Example',model:'Example Tablet',
    candidates:[{manufacturer:'Example',model:'Example Tablet',eligible:true}],
    rationale:'pre-result selection',status:{height:123,tip_hash:'a'.repeat(64)},harnessRevision:'test'
  });
  assert.equal(lock.device_class,'mobile_tablet_arm');
  assert.equal(lock.network_lock.network,NETWORK);
  assert.equal(lock.network_lock.observed_height,123);
  assert.equal(lock.network_lock.observed_tip_hash,'a'.repeat(64));
  for(const forbidden of ['throughput','hashrate','result','measurements','work_per_watt'])assert.equal(Object.hasOwn(lock,forbidden),false);
});

test('source provenance remains bound to the frozen miner rather than the autopilot branch',()=>{
  const p=makeSourceProvenance('autopilot-candidate');
  assert.equal(p.source_revision,TESTED_SOURCE_REVISION);
  assert.equal(p.miner_blob_sha,TESTED_MINER_BLOB_SHA);
  assert.equal(p.workload_revision,CONTRACT_ID);
  assert.equal(p.autopilot_protocol_id,AUTOPILOT_PROTOCOL_ID);
  assert.equal(p.harness_revision,'autopilot-candidate');
});

test('worker source preserves canonical double SHA-256 and progress accounting',()=>{
  const src=makeWorkerSource();
  assert.match(src,/crypto\.subtle\.digest\('SHA-256'/);
  assert.ok((src.match(/crypto\.subtle\.digest\('SHA-256'/g)||[]).length>=2);
  assert.match(src,/kind:'progress'/);
  assert.match(src,/kind:'solution'/);
  assert.equal(leadingZeroBitsHex('000f'+'0'.repeat(60)),12);
  assert.equal(percentile([1,2,3,4,100],.95),100);
});

test('single-capture autopilot bridge still produces a canonical verifier PASS in rehearsal',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'fae-rpa-bridge-'));
  const portfolio=join(parent,'baseline');
  try{
    await createRehearsalPortfolio(portfolio);
    const base=join(portfolio,'run-00');
    const map={
      run:'run.json',selection_lock:'selection-lock.json',device:'device.json',environment:'environment.json',
      source_provenance:'source-provenance.json',workload:'workload.json',measurements:'measurements.json',
      energy:'energy.json',thermals:'thermals.json',system_events:'system-events.json',
      miner_events:'miner-events.json',operator_attestation:'operator-attestation.json'
    };
    const capture={schema:'FAE_RDE_OPERATOR_CAPTURE_V1',contract_id:CONTRACT_ID,template_only:false};
    for(const [key,file] of Object.entries(map))capture[key]=JSON.parse(await readFile(join(base,file),'utf8'));
    capture.miner_log=await readFile(join(base,'logs/miner.log'),'utf8');
    const capturePath=join(parent,'capture.json');await writeFile(capturePath,JSON.stringify(capture,null,2));
    const staging=join(parent,'staging'),bundle=join(parent,'bundle');
    await prepareStaging({capturePath,outDir:staging});
    await collectEvidence({inputDir:staging,outDir:bundle});
    const result=await verifyEvidenceBundle(bundle,{expectedSourceRevision:TESTED_SOURCE_REVISION,expectedEvidenceClass:'REHEARSAL_ONLY'});
    assert.equal(result.verdict,'PASS');
    assert.equal(result.physical_evidence_admitted,false);
  }finally{await rm(parent,{recursive:true,force:true})}
});

test('browser harness exposes explicit physical/rehearsal boundary and lifecycle truthfulness',async()=>{
  const html=await readFile(join(root,'index.html'),'utf8');
  const browser=await readFile(join(root,'autopilot-browser.mjs'),'utf8');
  assert.match(html,/Physical mode uses the full frozen durations/);
  assert.match(html,/five\s+<b>real<\/b>\s+hidden/);
  assert.match(browser,/PHYSICAL_EVIDENCE/);
  assert.match(browser,/document\.addEventListener\('visibilitychange'/);
  assert.doesNotMatch(browser,/dispatchEvent\(new Event\(['"]visibilitychange/);
});
