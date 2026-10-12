import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReproducibleRelease,RELEASE_FORMAT,RELEASE_STATUS} from '../scripts/build-reproducible-release.mjs';
import {ACTIVATION_BOUNDARY_STATUS} from '../node/authoritative/activation-boundary-candidate.mjs';
import {ACTIVATION_STATE_TRANSITION_STATUS,CANDIDATE_COINBASE_MATURITY_BLOCKS} from '../node/authoritative/activation-state-transition-candidate.mjs';
import {COMPATIBILITY_REPLAY_STATUS} from '../node/authoritative/compatibility-replay-candidate.mjs';
import {ACTIVATION_NETWORK_COMPOSITION_STATUS} from '../node/authoritative/activation-network-composition-candidate.mjs';
import {COIN,INITIAL_SUBSIDY,HALVING_ERA_BLOCKS,TARGET_SECONDS,NETWORK} from '../node/authoritative/fae-v4-core.mjs';
import {
  MAINNET_REHEARSAL_STATUS,MAINNET_REHEARSAL_FORMAT,MAINNET_REHEARSAL_ECONOMICS,REQUIRED_EXTERNAL_EVIDENCE,
  verifyReleaseEvidence,createGenesisRehearsal,assessBootstrapSet,
  evaluateLaunchChecklist,buildMainnetRehearsalPackage
} from '../node/authoritative/mainnet-rehearsal-package-candidate.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const freeze=JSON.parse(await readFile(resolve(root,'release','software-only-ceiling-freeze.json'),'utf8'));
const releaseConfig=JSON.parse(await readFile(resolve(root,'release','release-candidate-config.json'),'utf8'));
const rehearsalTemplate=JSON.parse(await readFile(resolve(root,'release','mainnet-rehearsal-template.json'),'utf8'));

assert.equal(freeze.format,'FAE_SOFTWARE_ONLY_CEILING_FREEZE_V1');
assert.equal(freeze.status,'software-only-pre-mainnet-ceiling-reached');
assert.equal(freeze.scope,'pre-mainnet-software-only');
assert.deepEqual(freeze.milestones,{
  difficulty_timestamp_lab_gate:'e3e66f2ca43a4ff071a538cbeae6b9ddc68dc510',
  colony_a_d_g_h_integration:'02b68016815b3c9e7d2359a408826a790ae5608e',
  post_colony_differential_hardening:'cfd08a88f0f4f2e66560811cdd7eac6f8eec9cf9',
  release_reproducibility_e_v2:'92088ac1d60043f870b2e1eec06d7a0817325896',
  mainnet_rehearsal_f_v2:'20a37c26125c5a11ba4c6808c1b4e1d6a07afd88',
  independent_release_mainnet_verifier_g2:'bd5425e6245dee558422438fad7f56ad79b6721b'
});

const candidateStatuses={
  activation_boundary:ACTIVATION_BOUNDARY_STATUS,
  state_transition:ACTIVATION_STATE_TRANSITION_STATUS,
  compatibility_replay:COMPATIBILITY_REPLAY_STATUS,
  network_composition:ACTIVATION_NETWORK_COMPOSITION_STATUS
};
for(const[name,status]of Object.entries(candidateStatuses))assert.equal(status,'candidate-not-active-consensus',`${name} authority leak`);
assert.equal(MAINNET_REHEARSAL_STATUS,'candidate-not-authorized-mainnet');
assert.equal(MAINNET_REHEARSAL_FORMAT,'FAE_MAINNET_REHEARSAL_PACKAGE_V2');
assert.equal(RELEASE_FORMAT,'FAE_SOURCE_RELEASE_V2');
assert.equal(RELEASE_STATUS,'candidate-package-only');
assert.equal(CANDIDATE_COINBASE_MATURITY_BLOCKS,200);
assert.deepEqual(MAINNET_REHEARSAL_ECONOMICS,{
  target_seconds:300,initial_subsidy_fae:14,halving_era_blocks:430000,
  theoretical_max_supply_fae:12040000,coinbase_maturity_blocks:200,status:'not-authorized'
});

const ceilings=freeze.software_ceilings;
for(const name of[
  'A_activation_boundary','B_state_wallet_utxo_transition','C_compatibility_replay',
  'D_network_composition','E_release_reproducibility','F_mainnet_rehearsal_package',
  'G2_independent_release_mainnet_verifier'
])assert.equal(ceilings[name]?.status,'GREEN',`${name} not GREEN`);
assert.equal(ceilings.E_release_reproducibility.release_format,RELEASE_FORMAT);
assert.equal(ceilings.F_mainnet_rehearsal_package.rehearsal_format,MAINNET_REHEARSAL_FORMAT);
assert.equal(ceilings.G2_independent_release_mainnet_verifier.oracle,'git');
assert.equal(ceilings.H2_serialized_integration_freeze.status,'GATED_BY_THIS_FREEZE');
assert.equal(ceilings.H2_serialized_integration_freeze.authority,'integration-only');

// Freeze the still-authoritative public-testnet regime independently of release
// and rehearsal configuration files, then require every frozen view to agree.
assert.equal(NETWORK,'fairyelf-public-testnet-v4');
assert.equal(INITIAL_SUBSIDY,10n*COIN);
assert.equal(HALVING_ERA_BLOCKS,600000);
assert.equal(TARGET_SECONDS,180);
assert.deepEqual(freeze.canonical_public_testnet,{network:NETWORK,target_seconds:180,initial_subsidy_fae:10,halving_era_blocks:600000});
assert.deepEqual(releaseConfig.canonical_public_testnet,freeze.canonical_public_testnet);
assert.deepEqual(freeze.preferred_future_candidate,{
  target_seconds:300,initial_subsidy_fae:14,halving_era_blocks:430000,
  theoretical_max_supply_fae:12040000,coinbase_maturity_blocks:200,
  activation_height:null,status:'not-authorized'
});
assert.deepEqual(releaseConfig.preferred_future_candidate,freeze.preferred_future_candidate);

// H2 freezes authority as a negative capability: no checked-in evidence object,
// including a fully complete synthetic one, can manufacture consensus/mainnet authority.
for(const authority of[freeze.authority,releaseConfig.authority,rehearsalTemplate.authority]){
  assert.equal(authority.candidate_to_authoritative,false);
  assert.equal(authority.mainnet_launch_authorized,false);
}
assert.equal(freeze.authority.consensus_candidate_promoted,false);
assert.equal(freeze.authority.automatic_go_path,false);
assert.equal(freeze.authority.production_activation_height_selected,false);
assert.equal(rehearsalTemplate.authority.automatic_go_path,false);
assert.equal(releaseConfig.authority.live_activation_height,null);

const expectedExternal=['physical_hfb','representative_device','operational_soak','independent_operators'];
assert.deepEqual(REQUIRED_EXTERNAL_EVIDENCE,expectedExternal);
assert.deepEqual(freeze.unresolved_external_evidence,expectedExternal);
for(const key of expectedExternal)assert.equal(rehearsalTemplate.external_evidence_required[key],false);

const expectedFinalFreeze=[
  'genesis_timestamp_ms','initial_target_hex','genesis_miner_address',
  'release_artifact_sha256','release_manifest_sha256','release_source_commit','release_source_tree',
  'release_config_sha256','live_activation_height','bootstrap_requirements','bootstrap_nodes'
];
assert.deepEqual(freeze.unresolved_final_freeze,expectedFinalFreeze);
for(const key of expectedFinalFreeze){
  const value=rehearsalTemplate.final_freeze_required[key];
  if(key==='bootstrap_nodes')assert.deepEqual(value,[]);
  else assert.equal(value,null,`${key} unexpectedly frozen`);
}

// The freeze is evidence-backed: all earlier executable evidence programs must
// remain in the integrated tree before H2 can issue its software-ceiling verdict.
for(const path of[
  'tests/agent-build-colony-h-integration.mjs',
  'tests/full-target-genesis-body-replay-regression.mjs',
  'tests/activation-state-transition-core-differential.mjs',
  'tests/activation-network-composition-runtime-differential.mjs',
  'tests/release-reproducibility-colony-e-v2.mjs',
  'tests/mainnet-rehearsal-package-colony-f-v2.mjs',
  'tests/release-mainnet-independent-verifier-g2.mjs'
])await access(resolve(root,path));

const out=await mkdtemp(join(tmpdir(),'fae-h2-release-'));
try{
  // H2 begins from a freshly produced E-v2 source release, not a cached digest.
  const built=await buildReproducibleRelease({outDir:out});
  const artifactBytes=await readFile(built.artifact_path);
  const manifestBytes=await readFile(built.manifest_path);
  const checksumText=await readFile(built.checksum_path,'utf8');
  const binding=verifyReleaseEvidence({
    artifactBytes,manifestBytes,checksumText,
    expectedArtifactSha256:built.artifact_sha256,expectedManifestSha256:built.manifest_sha256,
    expectedSourceCommit:built.source_commit,expectedSourceTree:built.source_tree
  });
  assert.equal(binding.status,'verified-source-release-v2');
  assert.equal(binding.source_commit,built.source_commit);
  assert.equal(binding.source_tree,built.source_tree);

  const timestamp=1_920_000_000_000;
  const target='0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const miner='fae-h2-rehearsal-miner';
  const genesis=createGenesisRehearsal({timestampMs:timestamp,initialTargetHex:target,minerAddress:miner});
  const nodes=[
    {identity_id:'d'.repeat(64),endpoint:'https://h2-a.invalid',operator_id:'h2-a',network_group:'h2-group-a',pinned:true},
    {identity_id:'e'.repeat(64),endpoint:'https://h2-b.invalid',operator_id:'h2-b',network_group:'h2-group-b',pinned:false},
    {identity_id:'f'.repeat(64),endpoint:'https://h2-c.invalid',operator_id:'h2-c',network_group:'h2-group-c',pinned:false}
  ];
  const requirements={min_distinct_operators:3,min_distinct_network_groups:3,min_pinned_identities:1};
  const bootstrap=assessBootstrapSet(nodes,requirements);assert.equal(bootstrap.ready,true);
  const finalFreeze={
    genesis_timestamp_ms:timestamp,initial_target_hex:target,genesis_miner_address:miner,
    release_artifact_sha256:binding.artifact_sha256,release_manifest_sha256:binding.manifest_sha256,
    release_source_commit:binding.source_commit,release_source_tree:binding.source_tree,release_config_sha256:binding.config_sha256,
    live_activation_height:3_000_000,bootstrap_requirements:requirements,bootstrap_nodes:nodes
  };
  const software={release_reproducible:true,release_binding_verified:true,genesis_rehearsed:true,bootstrap_ready:true,peer_convergence:true,rollback_rehearsed:true};

  // All-true external evidence is only a negative authority control, not a claim
  // that the required physical/operational evidence has actually been obtained.
  const syntheticExternal=Object.fromEntries(REQUIRED_EXTERNAL_EVIDENCE.map(key=>[key,true]));
  const checklist=evaluateLaunchChecklist({software,externalEvidence:syntheticExternal,finalFreeze});
  assert.equal(checklist.software_ready,true);
  assert.equal(checklist.external_evidence_complete,true);
  assert.equal(checklist.final_freeze_complete,true);
  assert.equal(checklist.candidate_to_authoritative,false);
  assert.equal(checklist.mainnet_launch_authorized,false);
  assert.equal(checklist.automatic_go_path,false);
  assert.equal(checklist.decision,'HOLD_FINAL_EXPLICIT_AUTHORIZATION');

  const pkg=buildMainnetRehearsalPackage({releaseBinding:binding,config:finalFreeze,genesis,bootstrap,software,externalEvidence:syntheticExternal});
  assert.equal(pkg.authority.candidate_to_authoritative,false);
  assert.equal(pkg.authority.mainnet_launch_authorized,false);
  assert.equal(pkg.authority.automatic_go_path,false);
  assert.equal(pkg.checklist.decision,'HOLD_FINAL_EXPLICIT_AUTHORIZATION');
  assert.ok(pkg.startup_sequence.every(row=>row.dry_run===true&&row.authority==='rehearsal-only'));

  assert.deepEqual(freeze.ceiling_statement,{
    software_only_work_remaining_before_external_evidence:false,
    external_or_physical_evidence_still_required:true,
    final_explicit_authorization_still_required:true,
    mainnet_ready_claimed:false
  });

  console.log(JSON.stringify({
    status:'PASS',worker:'H2',verdict:'SOFTWARE_ONLY_PRE_MAINNET_CEILING_REACHED',
    source_commit:binding.source_commit,source_tree:binding.source_tree,
    candidate_statuses:candidateStatuses,software_ceilings_green:7,
    release_reproducible:true,release_binding_verified:true,mainnet_rehearsal_package_verified:true,
    preferred_candidate:{target_seconds:300,initial_subsidy_fae:14,halving_era_blocks:430000,coinbase_maturity_blocks:200,theoretical_max_supply_fae:12040000,authority:'not-authorized'},
    current_public_testnet:{target_seconds:180,initial_subsidy_fae:10,halving_era_blocks:600000,authority:'unchanged'},
    external_evidence_still_required:expectedExternal,
    unresolved_final_freeze:expectedFinalFreeze,
    external_evidence_claimed_present:false,
    production_activation_height_selected:false,production_bootstrap_selected:false,
    candidate_to_authoritative:false,mainnet_launch_authorized:false,automatic_go_path:false,
    mainnet_ready_claimed:false,decision:'HOLD_FINAL_EXPLICIT_AUTHORIZATION'
  }));
}finally{await rm(out,{recursive:true,force:true});}
