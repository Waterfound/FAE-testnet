import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReproducibleRelease} from '../scripts/build-reproducible-release.mjs';
import {COIN,INITIAL_SUBSIDY,HALVING_ERA_BLOCKS,TARGET_SECONDS} from '../node/authoritative/fae-v4-core.mjs';
import {
  MAINNET_REHEARSAL_STATUS,MAINNET_REHEARSAL_FORMAT,MAINNET_REHEARSAL_ECONOMICS,MAINNET_STARTUP_SEQUENCE,
  verifyReleaseEvidence,createGenesisRehearsal,assessBootstrapSet,buildStartupPlan,abortRehearsal,
  evaluateLaunchChecklist,buildMainnetRehearsalPackage
} from '../node/authoritative/mainnet-rehearsal-package-candidate.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const template=JSON.parse(await readFile(resolve(here,'..','release','mainnet-rehearsal-template.json'),'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
const releaseDir=await mkdtemp(join(tmpdir(),'fae-f-v2-release-'));

try{
  assert.equal(template.format,'FAE_MAINNET_REHEARSAL_TEMPLATE_V2');
  assert.equal(template.status,MAINNET_REHEARSAL_STATUS);
  assert.equal(template.authority.mainnet_launch_authorized,false);
  assert.equal(template.authority.candidate_to_authoritative,false);
  assert.equal(template.authority.automatic_go_path,false);
  assert.equal(template.release_binding.required_format,'FAE_SOURCE_RELEASE_V2');
  for(const key of [
    'genesis_timestamp_ms','initial_target_hex','genesis_miner_address','release_artifact_sha256','release_manifest_sha256',
    'release_source_commit','release_source_tree','release_config_sha256','live_activation_height','bootstrap_requirements'
  ])assert.equal(template.final_freeze_required[key],null,`${key} must remain unresolved in checked-in template`);
  assert.deepEqual(template.final_freeze_required.bootstrap_nodes,[]);

  // Build an actual Colony-E-v2 artifact from this exact clean F-v2 commit, then
  // verify artifact, separate manifest, checksum, commit, tree and every Git blob.
  const built=await buildReproducibleRelease({outDir:releaseDir});
  const artifactBytes=await readFile(built.artifact_path);
  const manifestBytes=await readFile(built.manifest_path);
  const checksumText=await readFile(built.checksum_path,'utf8');
  const binding=verifyReleaseEvidence({
    artifactBytes,manifestBytes,checksumText,
    expectedArtifactSha256:built.artifact_sha256,
    expectedManifestSha256:built.manifest_sha256,
    expectedSourceCommit:built.source_commit,
    expectedSourceTree:built.source_tree
  });
  assert.equal(binding.status,'verified-source-release-v2');
  assert.equal(binding.artifact_sha256,built.artifact_sha256);
  assert.equal(binding.manifest_sha256,built.manifest_sha256);
  assert.equal(binding.source_commit,built.source_commit);
  assert.equal(binding.source_tree,built.source_tree);
  assert.ok(binding.file_count>100);

  // A copied object is not a verified capability. Package/startup APIs require
  // the exact binding returned by the verifier, not caller-asserted booleans.
  assert.throws(
    ()=>buildStartupPlan({releaseBinding:{...binding},configDigest:'a'.repeat(64),genesisCommitment:'b'.repeat(64)}),
    /verified_release_binding_required/
  );

  // Tamper with one source blob and make artifact+manifest locally self-consistent.
  // Even with recomputed file SHA/Git blob and outer digests, the locked source-tree
  // expectation must reject it: the commit tree is the external immutable anchor.
  const tamperedArtifact=JSON.parse(artifactBytes.toString('utf8'));
  const tamperedManifest=structuredClone(tamperedArtifact.manifest);
  const targetRow=tamperedArtifact.files.find(row=>row.path==='README.md')??tamperedArtifact.files[0];
  const targetMeta=tamperedManifest.files.find(row=>row.path===targetRow.path);
  const changed=Buffer.concat([Buffer.from(targetRow.content_base64,'base64'),Buffer.from('\nF2_TREE_TAMPER\n')]);
  targetRow.content_base64=changed.toString('base64');
  targetMeta.bytes=changed.length;targetMeta.sha256=sha256(changed);targetMeta.git_object=gitBlob(changed);
  tamperedArtifact.manifest=tamperedManifest;
  const tamperedArtifactBytes=Buffer.from(JSON.stringify(tamperedArtifact));
  const tamperedManifestBytes=Buffer.from(JSON.stringify(tamperedManifest));
  const tamperedArtifactSha=sha256(tamperedArtifactBytes),tamperedManifestSha=sha256(tamperedManifestBytes);
  assert.throws(()=>verifyReleaseEvidence({
    artifactBytes:tamperedArtifactBytes,manifestBytes:tamperedManifestBytes,
    checksumText:`${tamperedArtifactSha}  fae-source-release-v2.json\n`,
    expectedArtifactSha256:tamperedArtifactSha,expectedManifestSha256:tamperedManifestSha,
    expectedSourceCommit:built.source_commit,expectedSourceTree:built.source_tree
  }),/release_source_tree_mismatch/);

  const timestamp=1_900_000_000_000;
  const target='0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  const miner='fae-mainnet-rehearsal-miner-placeholder';
  const genesis=createGenesisRehearsal({timestampMs:timestamp,initialTargetHex:target,minerAddress:miner});
  const genesisAgain=createGenesisRehearsal({timestampMs:timestamp,initialTargetHex:target,minerAddress:miner});
  assert.deepEqual(genesisAgain,genesis);
  assert.equal(genesis.height,1);assert.equal(genesis.previous_hash,'0'.repeat(64));
  assert.equal(genesis.reward_atoms,(14n*COIN).toString());
  assert.equal(genesis.target_seconds,300);assert.equal(genesis.halving_era_blocks,430000);assert.equal(genesis.coinbase_maturity_blocks,200);
  assert.match(genesis.genesis_commitment,/^[0-9a-f]{64}$/);
  assert.notEqual(createGenesisRehearsal({timestampMs:timestamp+1,initialTargetHex:target,minerAddress:miner}).genesis_commitment,genesis.genesis_commitment);

  const nodes=[
    {identity_id:'1'.repeat(64),endpoint:'https://bootstrap-a.invalid',operator_id:'operator-a',network_group:'group-a',pinned:true},
    {identity_id:'2'.repeat(64),endpoint:'https://bootstrap-b.invalid',operator_id:'operator-b',network_group:'group-b',pinned:false},
    {identity_id:'3'.repeat(64),endpoint:'https://bootstrap-c.invalid',operator_id:'operator-c',network_group:'group-c',pinned:false}
  ];
  const requirements={min_distinct_operators:3,min_distinct_network_groups:3,min_pinned_identities:1};
  const bootstrap=assessBootstrapSet(nodes,requirements);
  assert.equal(bootstrap.ready,true);assert.equal(bootstrap.distinct_operators,3);assert.equal(bootstrap.distinct_network_groups,3);assert.equal(bootstrap.pinned_identities,1);
  const weak=assessBootstrapSet(nodes.map((row,index)=>({...row,operator_id:index===2?'operator-b':row.operator_id})),requirements);
  assert.equal(weak.ready,false);assert.equal(weak.distinct_operators,2);
  assert.throws(()=>assessBootstrapSet([...nodes,{...nodes[2],endpoint:'https://bootstrap-d.invalid'}],requirements),/duplicate_bootstrap_identity/);

  const config={
    genesis_timestamp_ms:timestamp,initial_target_hex:target,genesis_miner_address:miner,
    release_artifact_sha256:binding.artifact_sha256,release_manifest_sha256:binding.manifest_sha256,
    release_source_commit:binding.source_commit,release_source_tree:binding.source_tree,release_config_sha256:binding.config_sha256,
    live_activation_height:1_000_000,bootstrap_requirements:requirements,bootstrap_nodes:nodes
  };
  const configDigest=sha256(Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(config).sort().map(key=>[key,config[key]])))));
  const startup=buildStartupPlan({releaseBinding:binding,configDigest,genesisCommitment:genesis.genesis_commitment});
  assert.deepEqual(startup.map(row=>row.step),MAINNET_STARTUP_SEQUENCE);
  assert.ok(startup.every(row=>row.dry_run===true&&row.authority==='rehearsal-only'));
  assert.ok(startup.every(row=>row.release_artifact_sha256===binding.artifact_sha256&&row.release_source_tree===binding.source_tree));

  const preGenesisAbort=abortRehearsal({genesisPublished:false,reason:'preflight_failed'});
  assert.equal(preGenesisAbort.safe_to_restart_same_rehearsal_network,true);
  assert.equal(preGenesisAbort.action,'discard_ephemeral_state_and_recheck_from_step_1');
  const postGenesisAbort=abortRehearsal({genesisPublished:true,reason:'post_genesis_invariant_failed'});
  assert.equal(postGenesisAbort.safe_to_restart_same_rehearsal_network,false);
  assert.match(postGenesisAbort.action,/do_not_rewrite_genesis/);

  const software={release_reproducible:true,release_binding_verified:true,genesis_rehearsed:true,bootstrap_ready:true,peer_convergence:true,rollback_rehearsed:true};
  const missingActivation={...config,live_activation_height:null};
  const activationGate=evaluateLaunchChecklist({software,externalEvidence:{},finalFreeze:missingActivation});
  assert.equal(activationGate.software_ready,true);
  assert.equal(activationGate.final_freeze_complete,false);
  assert.ok(activationGate.final_freeze_missing.includes('live_activation_height'));
  assert.equal(activationGate.mainnet_launch_authorized,false);

  const noExternal=evaluateLaunchChecklist({software,externalEvidence:{},finalFreeze:config});
  assert.equal(noExternal.software_ready,true);assert.equal(noExternal.final_freeze_complete,true);
  assert.equal(noExternal.external_evidence_complete,false);assert.equal(noExternal.mainnet_launch_authorized,false);
  const allExternal={physical_hfb:true,representative_device:true,operational_soak:true,independent_operators:true};
  const complete=evaluateLaunchChecklist({software,externalEvidence:allExternal,finalFreeze:config});
  assert.equal(complete.software_ready,true);assert.equal(complete.external_evidence_complete,true);assert.equal(complete.final_freeze_complete,true);
  assert.equal(complete.candidate_to_authoritative,false);assert.equal(complete.mainnet_launch_authorized,false);assert.equal(complete.automatic_go_path,false);
  assert.equal(complete.decision,'HOLD_FINAL_EXPLICIT_AUTHORIZATION');

  const packageA=buildMainnetRehearsalPackage({releaseBinding:binding,config,genesis,bootstrap,software,externalEvidence:allExternal});
  assert.equal(packageA.format,MAINNET_REHEARSAL_FORMAT);assert.equal(packageA.status,MAINNET_REHEARSAL_STATUS);
  assert.deepEqual(packageA.release_binding,binding);assert.match(packageA.package_digest,/^[0-9a-f]{64}$/);
  assert.equal(packageA.checklist.mainnet_launch_authorized,false);assert.equal(packageA.authority.mainnet_launch_authorized,false);
  assert.equal(packageA.economics_candidate.status,'not-authorized');
  assert.throws(()=>buildMainnetRehearsalPackage({releaseBinding:binding,config:{...config,release_artifact_sha256:'f'.repeat(64)},genesis,bootstrap,software,externalEvidence:allExternal}),/release_artifact_sha256_does_not_match_verified_release/);
  const packageB=buildMainnetRehearsalPackage({releaseBinding:binding,config:{...config,live_activation_height:1_000_001},genesis,bootstrap,software,externalEvidence:allExternal});
  assert.notEqual(packageB.package_digest,packageA.package_digest);
  assert.equal(packageB.checklist.mainnet_launch_authorized,false);

  assert.deepEqual(MAINNET_REHEARSAL_ECONOMICS,{target_seconds:300,initial_subsidy_fae:14,halving_era_blocks:430000,theoretical_max_supply_fae:12040000,coinbase_maturity_blocks:200,status:'not-authorized'});
  assert.equal(INITIAL_SUBSIDY,10n*COIN);assert.equal(HALVING_ERA_BLOCKS,600000);assert.equal(TARGET_SECONDS,180);

  console.log(JSON.stringify({
    status:'PASS',worker:'F-v2',candidate_only:true,
    release_artifact_verified:true,manifest_verified:true,git_tree_reconstructed:true,
    source_commit:binding.source_commit,source_tree:binding.source_tree,
    release_artifact_sha256:binding.artifact_sha256,release_manifest_sha256:binding.manifest_sha256,
    deterministic_genesis_commitment:true,bootstrap_diversity:true,startup_sequence:true,
    pre_and_post_genesis_abort:true,live_activation_height_required:true,
    external_gates_modeled:true,automatic_go_path:false,mainnet_launch_authorized:false,
    package_digest:packageA.package_digest,live_economics_unchanged:true
  }));
}finally{
  await rm(releaseDir,{recursive:true,force:true});
}
