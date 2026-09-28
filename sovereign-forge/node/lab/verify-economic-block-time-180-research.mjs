import fs from 'node:fs';
import crypto from 'node:crypto';

const ROOT='sovereign-forge/research/180s';
const FILES=[
  'F180_01_EVIDENCE_INVENTORY.json',
  'F180_02_DETERMINISTIC_BASELINE.json',
  'F180_03_ACTIVE_V4_DAA_RESULT.json',
  'F180_04_TIMESTAMP_DAA_RESULT.json',
  'F180_05_PROPAGATION_STALE_RECONCILIATION.json',
  'F180_06_MINING_ECONOMICS_RESULT.json',
  'F180_07_DECENTRALIZATION_RESULT.json',
  'F180_08_OUTAGE_RECOVERY_RESULT.json',
  'F180_09_EXTERNAL_EVIDENCE_LEDGER.json',
  'F180_10_COMPARATIVE_SYNTHESIS.json',
  'F180_13_EXTERNAL_EVIDENCE_GATE.json'
];
function sha256(data){return 'sha256:'+crypto.createHash('sha256').update(data).digest('hex');}
function read(name){const raw=fs.readFileSync(`${ROOT}/${name}`);return {raw,json:JSON.parse(raw)};}
function assert(ok,msg){if(!ok)throw new Error(msg);}
export function verify(){
 const evidence={},checks=[];
 for(const name of FILES){
   const {raw,json}=read(name);
   evidence[name]={sha256:sha256(raw),schema:json.schema,status:json.status??null,frontier:json.frontier??null};
   assert(json.activationAuthorized===false || name==='F180_01_EVIDENCE_INVENTORY.json' || name==='F180_09_EXTERNAL_EVIDENCE_LEDGER.json' || name==='F180_10_COMPARATIVE_SYNTHESIS.json','activation fence missing: '+name);
   if('selectionAuthorized' in json)assert(json.selectionAuthorized===false,'selection fence violated: '+name);
 }
 const f01=read(FILES[0]).json,f02=read(FILES[1]).json,f03=read(FILES[2]).json,f04=read(FILES[3]).json,f05=read(FILES[4]).json;
 const f06=read(FILES[5]).json,f07=read(FILES[6]).json,f08=read(FILES[7]).json,f09=read(FILES[8]).json,f10=read(FILES[9]).json,f13=read(FILES[10]).json;
 assert(f02.constants.target_seconds===180 && f02.constants.initial_subsidy_fae===10 && f02.constants.halving_era_blocks===600000,'active economics mismatch');
 checks.push({id:'active-boundary',status:'PASS'});
 assert(f03.exact_source.workflow_conclusion==='success' && f03.frozen_gate_assessment.hard_failure_confirmed===false,'F180-03 verification mismatch');
 assert(f04.exact_source.workflow_conclusion==='success' && f04.frozen_gate_assessment.hard_failure_confirmed===false,'F180-04 verification mismatch');
 assert(f06.exact_source.workflow_conclusion==='success' && f06.frozen_gate_assessment.hard_failure_confirmed===false,'F180-06 verification mismatch');
 assert(f07.exact_source.workflow_conclusion==='success' && f07.frozen_gate_assessment.hard_failure_confirmed===false,'F180-07 verification mismatch');
 assert(f08.exact_source.workflow_conclusion==='success' && f08.frozen_gate_assessment.hard_failure_of_blocktime_itself_confirmed===false,'F180-08 verification mismatch');
 checks.push({id:'software-hard-failure-scan',status:'PASS_NONE_CONFIRMED'});
 assert(f05.frontier_disposition.includes('INSUFFICIENT_DIRECT_180'),'F180-05 insufficiency boundary missing');
 assert(f09.direct_fae_evidence_added===false,'external literature was incorrectly promoted to direct FAE evidence');
 assert(f10.synthesis_disposition==='NO_MATERIAL_RISK_PROVEN_BUT_180S_REMAINS_UNDER_EVIDENCED_FOR_MAINNET_GRADE_CLAIM','F180-10 disposition mismatch');
 assert(f13.status==='RESOLVED_MISSING_EXTERNAL_EVIDENCE_CURRENT_RUN' && f13.direct_180_evidence_available===false,'F180-13 missing-evidence resolution mismatch');
 checks.push({id:'external-evidence-boundary',status:'PASS_MISSING_DIRECT_EVIDENCE_RETAINED'});
 const provenanceGap=f01.gaps.some(x=>x.includes('Stability V1/V2'));
 assert(provenanceGap,'historical soak provenance gap disappeared');
 checks.push({id:'historical-failure-preservation',status:'PASS'});
 const terminalIfNoNewExternal=(f13.direct_180_evidence_available===false && !false)?'INSUFFICIENT_EVIDENCE':'SUPPORTED_WITHIN_CURRENT_EVIDENCE';
 return {
   schema:'fae-180s-independent-verification/1',
   verifier:'independent-file-and-invariant-checker',
   sourceFiles:evidence,
   checks,
   allPassed:true,
   hardFailureConfirmed:false,
   directExternalEvidenceStillMissing:true,
   terminalVerdictIfF180_13RemainsMissing:terminalIfNoNewExternal,
   researchConclusionDoesNotAuthorizeActivation:true
 };
}
if(import.meta.url===new URL(process.argv[1],'file:').href)process.stdout.write(JSON.stringify(verify(),null,2)+'\n');
