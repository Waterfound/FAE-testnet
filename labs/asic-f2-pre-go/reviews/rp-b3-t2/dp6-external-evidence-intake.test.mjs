import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SOURCE} from './dp6-memory-economics-falsifier.mjs';
import {intakeDp6SpecialistEvidence as intake} from './dp6-external-evidence-intake.mjs';
const roles=['specialist_dependent_io_trace','specialist_ac_power_log',
  'specialist_installed_cost_quote','commodity_comparison_trace',
  'independent_replay_report'];
function fixture(){
  const rawArtifacts={},artifacts=[];
  for(const role of roles){
    // Explicitly SYNTHETIC bytes, not a real physical measurement or quote.
    const bytes=Buffer.from('SYNTHETIC_ONLY:'+role);
    rawArtifacts[role]=bytes;
    artifacts.push({role,bytes:bytes.length,
      sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  return {manifest:{
    schema:'FAE_DP6_EXTERNAL_ECONOMIC_EVIDENCE_V1',
    contextBytes:SOURCE.contextBytes,rw5Steps:SOURCE.rw5Steps,
    claimedMeasurements:{capacityBytes:SOURCE.contextBytes,
      observedDependentAccessNs:75,measuredWorkPerSecond:3,
      measuredAcPowerW:200,installedSpecialistCostUSD:50000,
      commodityCostUSDPerWork:0.001,measurementDurationSeconds:300},
    artifacts},rawArtifacts};
}
test('RP-B3-T3-E1: frozen DP6 external intake requires byte-bound evidence yet never claims ASIC security',()=>{
  const x=fixture(),v=intake(x.manifest,{rawArtifacts:x.rawArtifacts});
  assert.equal(v.sourceFrozenContextBytes,268435456);
  assert.equal(v.sourceFrozenRW5Steps,1048576);
  assert.equal(v.completeByteBinding,true);
  assert.deepEqual(v.digestBoundRoles,roles);
  assert.deepEqual(v.missingOrUnboundRoles,[]);
  assert.equal(v.verdict,'EXTERNAL_EVIDENCE_GATE');
  assert.equal(v.realIndependentWitnessVerified,false);
  assert.equal(v.realAsicAdvantageOrResistanceProven,false);
});
test('RP-B3-T3-E2: any missing raw measurement or quote stays an evidence gate',()=>{
  const x=fixture();delete x.rawArtifacts.specialist_installed_cost_quote;
  const v=intake(x.manifest,{rawArtifacts:x.rawArtifacts});
  assert.equal(v.completeByteBinding,false);
  assert.deepEqual(v.missingOrUnboundRoles,['specialist_installed_cost_quote']);
  assert.equal(v.externalQuoteAuthenticated,false);
  const absent=fixture();absent.manifest.artifacts=absent.manifest.artifacts.slice(0,3);
  assert.ok(intake(absent.manifest,{rawArtifacts:absent.rawArtifacts}).missingOrUnboundRoles.length>=2);
});
test('RP-B3-T3-E3: altered raw evidence with unchanged declared SHA fails closed',()=>{
  const x=fixture();x.rawArtifacts.specialist_dependent_io_trace=Buffer.from(
    'SYNTHETIC_ONLY:specialist_dependent_io_tracE');
  assert.throws(()=>intake(x.manifest,{rawArtifacts:x.rawArtifacts}),
    e=>e.code==='evidence_artifact_digest_mismatch');
});
test('RP-B3-T3-E4: forged source parameters and sub-context memory claims fail closed',()=>{
  const x=fixture();
  for(const delta of [{contextBytes:SOURCE.contextBytes-1},
    {rw5Steps:SOURCE.rw5Steps-1},{schema:'arbitrary'}]){
    assert.throws(()=>intake({...x.manifest,...delta},{rawArtifacts:x.rawArtifacts}),
      e=>e.code==='invalid_frozen_dp6_evidence_contract');
  }
  const m=structuredClone(x.manifest);
  m.claimedMeasurements.capacityBytes=SOURCE.contextBytes-1;
  assert.throws(()=>intake(m,{rawArtifacts:x.rawArtifacts}),
    e=>e.code==='unproven_or_invalid_claimed_economics');
});
test('RP-B3-T3-E5: duplicate roles, malformed digests and nonfinite claims cannot self-authenticate',()=>{
  const x=fixture();
  for(const artifacts of [[...x.manifest.artifacts,x.manifest.artifacts[0]],
    x.manifest.artifacts.map((a,i)=>i===0?{...a,sha256:'invalid'}:a),
    x.manifest.artifacts.map((a,i)=>i===0?{...a,bytes:0}:a)]){
    assert.throws(()=>intake({...x.manifest,artifacts},{rawArtifacts:x.rawArtifacts}),
      e=>e.code==='invalid_evidence_artifact_descriptor');
  }
  for(const price of [NaN,Infinity,0,-100]){
    const m=structuredClone(x.manifest);m.claimedMeasurements.installedSpecialistCostUSD=price;
    assert.throws(()=>intake(m,{rawArtifacts:x.rawArtifacts}),
      e=>e.code==='unproven_or_invalid_claimed_economics');
  }
});
