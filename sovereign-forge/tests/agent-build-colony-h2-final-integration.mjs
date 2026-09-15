import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildReproducibleRelease} from '../scripts/build-reproducible-release.mjs';
import {ACTIVATION_BOUNDARY_STATUS} from '../node/authoritative/activation-boundary-candidate.mjs';
import {ACTIVATION_STATE_TRANSITION_STATUS,CANDIDATE_COINBASE_MATURITY_BLOCKS} from '../node/authoritative/activation-state-transition-candidate.mjs';
import {COMPATIBILITY_REPLAY_STATUS} from '../node/authoritative/compatibility-replay-candidate.mjs';
import {ACTIVATION_NETWORK_COMPOSITION_STATUS} from '../node/authoritative/activation-network-composition-candidate.mjs';
import {COIN,INITIAL_SUBSIDY,HALVING_ERA_BLOCKS,TARGET_SECONDS,NETWORK} from '../node/authoritative/fae-v4-core.mjs';
import {
  MAINNET_REHEARSAL_STATUS,MAINNET_REHEARSAL_ECONOMICS,REQUIRED_EXTERNAL_EVIDENCE,
  verifyReleaseEvidence,createGenesisRehearsal,assessBootstrapSet,
  evaluateLaunchChecklist,buildMainnetRehearsalPackage
} from '../node/authoritative/mainnet-rehearsal-package-candidate.mjs';

const candidateStatuses={
  activation_boundary:ACTIVATION_BOUNDARY_STATUS,
  state_transition:ACTIVATION_STATE_TRANSITION_STATUS,
  compatibility_replay:COMPATIBILITY_REPLAY_STATUS,
  network_composition:ACTIVATION_NETWORK_COMPOSITION_STATUS
};
for(const[name,status]of Object.entries(candidateStatuses))assert.equal(status,'candidate-not-active-consensus',`${name} authority leak`);
assert.equal(MAINNET_REHEARSAL_STATUS,'candidate-not-authorized-mainnet');
assert.equal(CANDIDATE_COINBASE_MATURITY_BLOCKS,200);
assert.deepEqual(MAINNET_REHEARSAL_ECONOMICS,{
  target_seconds:300,initial_subsidy_fae:14,halving_era_blocks:430000,
  theoretical_max_supply_fae:12040000,coinbase_maturity_blocks:200,status:'not-authorized'
});

// Freeze the still-authoritative public-testnet regime independently of release
// and rehearsal configuration files.
assert.equal(NETWORK,'fairyelf-public-testnet-v4');
assert.equal(INITIAL_SUBSIDY,10n*COIN);
assert.equal(HALVING_ERA_BLOCKS,600000);
assert.equal(TARGET_SECONDS,180);

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

  // This all-true evidence object is a negative authority control, not a claim that
  // the physical/operational evidence exists. Even maximal caller assertions must
  // be unable to authorize mainnet automatically.
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

  console.log(JSON.stringify({
    status:'PASS',worker:'H-v2',verdict:'SOFTWARE_CEILING_REACHED_WITH_EXTERNAL_EVIDENCE_REMAINING',
    source_commit:binding.source_commit,source_tree:binding.source_tree,
    candidate_statuses:candidateStatuses,
    release_reproducible:true,release_binding_verified:true,mainnet_rehearsal_package_verified:true,
    preferred_candidate:{target_seconds:300,initial_subsidy_fae:14,halving_era_blocks:430000,coinbase_maturity_blocks:200,theoretical_max_supply_fae:12040000,authority:'not-authorized'},
    current_public_testnet:{target_seconds:180,initial_subsidy_fae:10,halving_era_blocks:600000,authority:'unchanged'},
    external_evidence_still_required:[...REQUIRED_EXTERNAL_EVIDENCE],
    external_evidence_claimed_present:false,
    production_activation_height_selected:false,
    production_bootstrap_selected:false,
    candidate_to_authoritative:false,mainnet_launch_authorized:false,automatic_go_path:false,
    decision:'HOLD_FINAL_EXPLICIT_AUTHORIZATION'
  }));
}finally{await rm(out,{recursive:true,force:true});}
