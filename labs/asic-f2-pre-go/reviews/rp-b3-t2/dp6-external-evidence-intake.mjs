/**
 * RP-B3-T3 EXTERNAL_EVIDENCE_GATE intake only.
 * Bind evidence blobs to the frozen DP6 parameters and declared measurements.
 * Hash equality authenticates BYTES, never the submitter, laboratory, or economics.
 * No evidence in this candidate can self-promote to actual ASIC resistance PASS.
 */
import {createHash} from 'node:crypto';
import {SOURCE} from './dp6-memory-economics-falsifier.mjs';
const mandatory=[
  'specialist_dependent_io_trace',
  'specialist_ac_power_log',
  'specialist_installed_cost_quote',
  'commodity_comparison_trace',
  'independent_replay_report'
];
const error=(code)=>{throw Object.assign(new Error(code),{code})};
const pos=(v)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function intakeDp6SpecialistEvidence(manifest,{rawArtifacts={}}={}){
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||
     manifest.schema!=='FAE_DP6_EXTERNAL_ECONOMIC_EVIDENCE_V1'||
     manifest.contextBytes!==SOURCE.contextBytes||
     manifest.rw5Steps!==SOURCE.rw5Steps)error('invalid_frozen_dp6_evidence_contract');
  const metrics=manifest.claimedMeasurements;
  if(!metrics||!Number.isSafeInteger(metrics.capacityBytes)||
     metrics.capacityBytes<SOURCE.contextBytes||
     !pos(metrics.observedDependentAccessNs)||!pos(metrics.measuredWorkPerSecond)||
     !pos(metrics.measuredAcPowerW)||!pos(metrics.installedSpecialistCostUSD)||
     !pos(metrics.commodityCostUSDPerWork)||
     !pos(metrics.measurementDurationSeconds))error('unproven_or_invalid_claimed_economics');
  if(!Array.isArray(manifest.artifacts)||manifest.artifacts.length>32)
    error('invalid_evidence_artifact_inventory');
  const seen=new Set(),accepted=[],missing=[];
  for(const a of manifest.artifacts){
    if(!a||typeof a.role!=='string'||seen.has(a.role)||
       !mandatory.includes(a.role)||typeof a.sha256!=='string'||
       !/^[0-9a-f]{64}$/.test(a.sha256)||!Number.isSafeInteger(a.bytes)||
       a.bytes<1||a.bytes>1_000_000_000)
      error('invalid_evidence_artifact_descriptor');
    seen.add(a.role);
    const buf=rawArtifacts[a.role];
    if(buf===undefined){missing.push(a.role);continue}
    if(!Buffer.isBuffer(buf)&&!(buf instanceof Uint8Array))
      error('invalid_raw_evidence_bytes');
    if(buf.byteLength!==a.bytes||
       createHash('sha256').update(buf).digest('hex')!==a.sha256)
      error('evidence_artifact_digest_mismatch');
    accepted.push(a.role);
  }
  for(const role of mandatory)if(!seen.has(role))missing.push(role);
  return {
    verdict:'EXTERNAL_EVIDENCE_GATE',
    sourceFrozenContextBytes:SOURCE.contextBytes,
    sourceFrozenRW5Steps:SOURCE.rw5Steps,
    requiredRoles:mandatory,
    digestBoundRoles:accepted,
    missingOrUnboundRoles:missing,
    completeByteBinding:missing.length===0,
    realIndependentWitnessVerified:false,
    externalQuoteAuthenticated:false,
    deviceAndTraceProvenanceVerified:false,
    realAsicAdvantageOrResistanceProven:false,
    // Admission remains external even when synthetic bytes match every hash.
    reason:'DIGESTS_ARE_NOT_INDEPENDENT_ATTESTATION_OR_VALIDATED_HW_MEASUREMENTS'
  };
}
