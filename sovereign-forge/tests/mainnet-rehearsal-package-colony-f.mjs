import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {COIN,INITIAL_SUBSIDY,HALVING_ERA_BLOCKS,TARGET_SECONDS} from '../node/authoritative/fae-v4-core.mjs';
import {
  MAINNET_REHEARSAL_STATUS,MAINNET_REHEARSAL_ECONOMICS,MAINNET_STARTUP_SEQUENCE,
  createGenesisRehearsal,assessBootstrapSet,buildStartupPlan,abortRehearsal,
  evaluateLaunchChecklist,buildMainnetRehearsalPackage
} from '../node/authoritative/mainnet-rehearsal-package-candidate.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const template=JSON.parse(await readFile(resolve(here,'..','release','mainnet-rehearsal-template.json'),'utf8'));
assert.equal(template.status,MAINNET_REHEARSAL_STATUS);assert.equal(template.authority.mainnet_launch_authorized,false);assert.equal(template.authority.candidate_to_authoritative,false);assert.equal(template.authority.automatic_go_path,false);
for(const value of ['genesis_timestamp_ms','initial_target_hex','genesis_miner_address','release_artifact_sha256','live_activation_height','bootstrap_requirements'])assert.equal(template.final_freeze_required[value],null);
assert.deepEqual(template.final_freeze_required.bootstrap_nodes,[]);

const timestamp=1_900_000_000_000,target='0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',miner='fae-mainnet-rehearsal-miner-placeholder';
const genesis=createGenesisRehearsal({timestampMs:timestamp,initialTargetHex:target,minerAddress:miner});
const genesisAgain=createGenesisRehearsal({timestampMs:timestamp,initialTargetHex:target,minerAddress:miner});
assert.deepEqual(genesisAgain,genesis);assert.equal(genesis.height,1);assert.equal(genesis.previous_hash,'0'.repeat(64));assert.equal(genesis.reward_atoms,(14n*COIN).toString());assert.equal(genesis.target_seconds,300);assert.equal(genesis.halving_era_blocks,430000);assert.equal(genesis.coinbase_maturity_blocks,200);assert.match(genesis.genesis_commitment,/^[0-9a-f]{64}$/);
assert.notEqual(createGenesisRehearsal({timestampMs:timestamp+1,initialTargetHex:target,minerAddress:miner}).genesis_commitment,genesis.genesis_commitment);

const nodes=[
  {identity_id:'1'.repeat(64),endpoint:'https://bootstrap-a.invalid',operator_id:'operator-a',network_group:'group-a',pinned:true},
  {identity_id:'2'.repeat(64),endpoint:'https://bootstrap-b.invalid',operator_id:'operator-b',network_group:'group-b',pinned:false},
  {identity_id:'3'.repeat(64),endpoint:'https://bootstrap-c.invalid',operator_id:'operator-c',network_group:'group-c',pinned:false}
];
const requirements={min_distinct_operators:3,min_distinct_network_groups:3,min_pinned_identities:1};
const bootstrap=assessBootstrapSet(nodes,requirements);assert.equal(bootstrap.ready,true);assert.equal(bootstrap.distinct_operators,3);assert.equal(bootstrap.distinct_network_groups,3);assert.equal(bootstrap.pinned_identities,1);
const weak=assessBootstrapSet(nodes.map((row,index)=>({...row,operator_id:index===2?'operator-b':row.operator_id})),requirements);assert.equal(weak.ready,false);assert.equal(weak.distinct_operators,2);
assert.throws(()=>assessBootstrapSet([...nodes,{...nodes[2],endpoint:'https://bootstrap-d.invalid'}],requirements),/duplicate_bootstrap_identity/);

const releaseSha='a'.repeat(64),config={genesis_timestamp_ms:timestamp,initial_target_hex:target,genesis_miner_address:miner,bootstrap_requirements:requirements,bootstrap_nodes:nodes};
const startup=buildStartupPlan({releaseArtifactSha256:releaseSha,configDigest:'b'.repeat(64),genesisCommitment:genesis.genesis_commitment});
assert.deepEqual(startup.map(row=>row.step),MAINNET_STARTUP_SEQUENCE);assert.ok(startup.every(row=>row.dry_run===true&&row.authority==='rehearsal-only'));

const preGenesisAbort=abortRehearsal({genesisPublished:false,reason:'preflight_failed'});assert.equal(preGenesisAbort.safe_to_restart_same_rehearsal_network,true);assert.equal(preGenesisAbort.action,'discard_ephemeral_state_and_recheck_from_step_1');
const postGenesisAbort=abortRehearsal({genesisPublished:true,reason:'post_genesis_invariant_failed'});assert.equal(postGenesisAbort.safe_to_restart_same_rehearsal_network,false);assert.match(postGenesisAbort.action,/do_not_rewrite_genesis/);

const software={release_reproducible:true,genesis_rehearsed:true,bootstrap_ready:true,peer_convergence:true,rollback_rehearsed:true};
const noExternal=evaluateLaunchChecklist({software,externalEvidence:{},finalFreeze:config});assert.equal(noExternal.software_ready,true);assert.equal(noExternal.external_evidence_complete,false);assert.equal(noExternal.mainnet_launch_authorized,false);assert.equal(noExternal.decision,'HOLD_FINAL_EXPLICIT_AUTHORIZATION');
const allExternal={physical_hfb:true,representative_device:true,operational_soak:true,independent_operators:true};
const completeEvidence=evaluateLaunchChecklist({software,externalEvidence:allExternal,finalFreeze:config});assert.equal(completeEvidence.software_ready,true);assert.equal(completeEvidence.external_evidence_complete,true);assert.equal(completeEvidence.final_freeze_complete,true);assert.equal(completeEvidence.candidate_to_authoritative,false);assert.equal(completeEvidence.mainnet_launch_authorized,false);assert.equal(completeEvidence.automatic_go_path,false);

const packageA=buildMainnetRehearsalPackage({releaseArtifactSha256:releaseSha,config,genesis,bootstrap,software,externalEvidence:allExternal});
const packageB=buildMainnetRehearsalPackage({releaseArtifactSha256:releaseSha,config:structuredClone(config),genesis:createGenesisRehearsal({timestampMs:timestamp,initialTargetHex:target,minerAddress:miner}),bootstrap:assessBootstrapSet(structuredClone(nodes),requirements),software:structuredClone(software),externalEvidence:structuredClone(allExternal)});
assert.deepEqual(packageB,packageA);assert.match(packageA.package_digest,/^[0-9a-f]{64}$/);assert.equal(packageA.status,MAINNET_REHEARSAL_STATUS);assert.equal(packageA.checklist.mainnet_launch_authorized,false);assert.equal(packageA.economics_candidate.status,'not-authorized');
assert.notEqual(buildMainnetRehearsalPackage({releaseArtifactSha256:'c'.repeat(64),config,genesis,bootstrap,software,externalEvidence:allExternal}).package_digest,packageA.package_digest);

assert.deepEqual(MAINNET_REHEARSAL_ECONOMICS,{target_seconds:300,initial_subsidy_fae:14,halving_era_blocks:430000,theoretical_max_supply_fae:12040000,coinbase_maturity_blocks:200,status:'not-authorized'});
assert.equal(INITIAL_SUBSIDY,10n*COIN);assert.equal(HALVING_ERA_BLOCKS,600000);assert.equal(TARGET_SECONDS,180);

console.log(JSON.stringify({status:'PASS',worker:'F',candidate_only:true,genesis_rehearsal:true,deterministic_genesis_commitment:true,bootstrap_diversity:true,startup_sequence:true,pre_and_post_genesis_abort:true,external_gates_modeled:true,automatic_go_path:false,mainnet_launch_authorized:false,package_digest:packageA.package_digest,live_economics_unchanged:true}));
