import { readFile, writeFile } from 'node:fs/promises';

const gate=JSON.parse(await readFile('lab/post-quantum-signatures/gate-status.json','utf8'));
const waveG=JSON.parse(await readFile('lab/post-quantum-signatures/wave-g/admission.json','utf8'));
const waveH=JSON.parse(await readFile('lab/post-quantum-signatures/wave-h/manifest.json','utf8'));
const freeze=JSON.parse(await readFile('lab/post-quantum-signatures/wave-i/manifest.json','utf8'));

const required=['PQ-03','PQ-04','PQ-05','PQ-06','PQ-07','PQ-08','PQ-09','PQ-10'];
const blockers=[];
const ledger={};

function requireField(obj,path,label){
  let cur=obj;
  for(const p of path.split('.'))cur=cur?.[p];
  if(cur===undefined||cur===null||cur==='')blockers.push('missing_binding:'+label);
  return cur;
}
function pass(name,condition){
  if(!condition)blockers.push(name);
}
for(const id of Object.keys(gate.gates).sort()){
  const g=gate.gates[id];
  ledger[id]={
    status:g.status,
    authority:g.authority??null,
    depends_on:g.depends_on??[],
    evidence:g.evidence??null,
    frozen_manifest:g.frozen_manifest??null
  };
}
for(const id of required) pass('gate_not_green:'+id,gate.gates[id]?.status==='GREEN');
pass('activation_authorized_must_be_false',gate.activation_authorized===false);
pass('wave_g_activation_authorized_must_be_false',waveG.activation_authorized===false);
pass('wave_h_activation_authorized_must_be_false',waveH.activation_authorized===false);
pass('wave_i_activation_authorized_must_be_false',freeze.activation_authorized===false);

// Binding completeness — exact evidence already admitted in canonical state.
requireField(gate,'gates.PQ-03.evidence.primitive_artifact_id','PQ03.artifact');
requireField(gate,'gates.PQ-03.evidence.pq_workflow_run_id','PQ03.run');
requireField(gate,'gates.PQ-04.evidence.primitive_artifact_id','PQ04.artifact');
requireField(gate,'gates.PQ-05.evidence.integrated_commit','PQ05.commit');
requireField(gate,'gates.PQ-05.evidence.artifact_id','PQ05.artifact');
requireField(gate,'gates.PQ-06.evidence.integrated_commit','PQ06.commit');
requireField(gate,'gates.PQ-06.evidence.artifact_id','PQ06.artifact');
requireField(gate,'gates.PQ-07.evidence.integrated_commit','PQ07.commit');
requireField(gate,'gates.PQ-07.evidence.artifact_id','PQ07.artifact');
requireField(gate,'gates.PQ-08.evidence.integrated_commit','PQ08.commit');
requireField(gate,'gates.PQ-08.evidence.artifact_id','PQ08.artifact');
requireField(gate,'gates.PQ-09.evidence.integrated_commit','PQ09.commit');
requireField(gate,'gates.PQ-09.evidence.artifact_id','PQ09.artifact');
requireField(gate,'gates.PQ-10.evidence.integrated_commit','PQ10.commit');
requireField(gate,'gates.PQ-10.evidence.artifact_id','PQ10.artifact');

// Required semantic closure checks.
pass('pq07_failed_cases_nonzero',(gate.gates['PQ-07']?.evidence?.failed_case_ids?.length??-1)===0);
pass('pq07_unauthorized_dual_acceptance_nonzero',gate.gates['PQ-07']?.evidence?.unauthorized_dual_acceptance===0);
pass('pq07_unauthorized_downgrade_acceptance_nonzero',gate.gates['PQ-07']?.evidence?.unauthorized_downgrade_acceptance===0);
pass('pq08_unexplained_disagreements_nonzero',gate.gates['PQ-08']?.evidence?.unexplained_disagreements===0);
pass('pq08_shared_verdict_cache',gate.gates['PQ-08']?.evidence?.no_shared_verdict_cache===true);
pass('pq09_physical_device_claim',gate.gates['PQ-09']?.evidence?.physical_device_claims===false);
pass('pq09_automatic_winner_promotion',gate.gates['PQ-09']?.evidence?.operational_winner_promoted===false);
pass('pq10_regression_replay_not_pass',gate.gates['PQ-10']?.evidence?.pq07_regression_replay?.result==='PASS');
pass('pq10_rpc_used',gate.gates['PQ-10']?.evidence?.rpc_used===false);
pass('pq10_active_state_mutated',gate.gates['PQ-10']?.evidence?.active_state_mutated===false);
pass('pq10_private_material_emitted',gate.gates['PQ-10']?.evidence?.private_material_emitted===false);

// Cross-check Wave G admitted evidence against canonical gate status.
pass('pq08_wave_g_artifact_mismatch',waveG.gates?.['PQ-08']?.artifact_id===gate.gates['PQ-08']?.evidence?.artifact_id);
pass('pq09_wave_g_artifact_mismatch',waveG.gates?.['PQ-09']?.artifact_id===gate.gates['PQ-09']?.evidence?.artifact_id);

const txBytes=gate.gates['PQ-09'].evidence.transaction_bytes;
const inc=gate.gates['PQ-09'].evidence.incremental_bytes_vs_v2;
const candidateComparison={
  policy:'DESCRIPTIVE_ONLY_NO_WINNER_SELECTION',
  rows:[
    {candidate:'Ed25519 / active Transaction v2 baseline',serialized_transaction_bytes:txBytes.ed25519_v2,incremental_bytes_vs_v2:0,authority:'ACTIVE_REFERENCE_ONLY'},
    {candidate:'Ed25519 + ML-DSA-44 shadow',serialized_transaction_bytes:txBytes.hybrid_ml_dsa_44,incremental_bytes_vs_v2:inc.ml_dsa_44,authority:'SHADOW_ONLY'},
    {candidate:'Ed25519 + ML-DSA-65 shadow',serialized_transaction_bytes:txBytes.hybrid_ml_dsa_65,incremental_bytes_vs_v2:inc.ml_dsa_65,authority:'SHADOW_ONLY'},
    {candidate:'Ed25519 + ML-DSA-87 shadow',serialized_transaction_bytes:txBytes.hybrid_ml_dsa_87,incremental_bytes_vs_v2:inc.ml_dsa_87,authority:'SHADOW_ONLY'}
  ],
  slh_dsa:'DIVERSITY_OPTION_MEASURED_IN_PQ09_NO_FROZEN_FAE_TX_FORMAT',
  winner_selected:false
};

const migrationRisks=[
  {
    id:'RISK-TX-SIZE',
    state:'MEASURED_NOT_BLOCKING_SHADOW_VIABILITY',
    basis:'PQ-09 measured substantial transaction-size growth for every hybrid ML-DSA variant.',
    disposition:'Operational/production tradeoff remains for later explicit authority decision.'
  },
  {
    id:'RISK-SLH-COST',
    state:'MEASURED_NOT_BLOCKING_SHADOW_VIABILITY',
    basis:'PQ-09 measured materially larger signing latency/signature sizes for frozen SLH-DSA diversity candidates.',
    disposition:'SLH-DSA remains diversity research; no operational promotion.'
  },
  {
    id:'RISK-PARAMETER-SELECTION',
    state:'INTENTIONALLY_UNSELECTED',
    basis:'Frozen rules prohibit selecting a winning ML-DSA set without an already-defined criterion.',
    disposition:'All three ML-DSA variants remain technically viable in shadow evidence.'
  },
  {
    id:'RISK-ACTIVATION-MIGRATION',
    state:'OUTSIDE_PQ11_AUTHORITY',
    basis:'Active Ed25519, Transaction v2, faet wallet/address formats and public-testnet consensus are unchanged.',
    disposition:'Requires a separate explicit future authority/activation process.'
  },
  {
    id:'RISK-PHYSICAL-DEVICE',
    state:'OPTIONAL_EXTERNAL_EVIDENCE',
    basis:'PQ-09 explicitly makes no iPhone/iPad physical-performance claim.',
    disposition:'PQ-12 only if decision-relevant.'
  }
];

const externalEvidenceBoundaries=[
  'PQ-12 optional physical-device measurements on iPhone/iPad if decision-relevant',
  'production consensus/economic activation authority',
  'final production network/release/genesis decisions',
  'any future explicit governance/authority decision'
];

const unresolvedSoftwareBoundaries=[...blockers];
const technicallyViable=unresolvedSoftwareBoundaries.length===0;
const softwareOnlyVerdict=technicallyViable
  ? 'MIGRATION_PATH_TECHNICALLY_VIABLE_IN_SHADOW'
  : 'BLOCKED_BY_UNRESOLVED_EVIDENCE';

const result={
  schema:'FAE_PQ11_SOFTWARE_ONLY_CEILING_VERDICT_V1',
  evaluated_at:'2026-09-18',
  source_gate_registry:'lab/post-quantum-signatures/gate-status.json',
  frozen_contract:'lab/post-quantum-signatures/wave-i/manifest.json',
  authority:'RESEARCH_SHADOW_ONLY',
  evidence_ledger:ledger,
  evidence_binding_complete:technicallyViable,
  unresolved_software_boundaries:unresolvedSoftwareBoundaries,
  external_evidence_boundaries:externalEvidenceBoundaries,
  candidate_comparison:candidateComparison,
  migration_risks:migrationRisks,
  software_only_verdict:softwareOnlyVerdict,
  activation_disposition:'INSUFFICIENT_JUSTIFICATION_FOR_ACTIVATION',
  activation_authorized:false,
  private_material_emitted:false,
  active_runtime_change_authorized:false,
  mainnet_launch_authorized:false,
  next_state: technicallyViable
    ? 'SOFTWARE_ONLY_POST_QUANTUM_RESEARCH_CEILING_REACHED'
    : 'PQ11_BLOCKED'
};
await writeFile('lab/post-quantum-signatures/wave-i/verdict.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({
  result:technicallyViable?'PASS':'FAIL',
  software_only_verdict:softwareOnlyVerdict,
  activation_disposition:result.activation_disposition,
  unresolved_software_boundaries:unresolvedSoftwareBoundaries,
  evidence_binding_complete:technicallyViable
},null,2));
if(!technicallyViable)process.exitCode=1;
