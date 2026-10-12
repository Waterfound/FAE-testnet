import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReproducibleRelease,repoRoot} from '../scripts/build-reproducible-release.mjs';
import {
  MAINNET_REHEARSAL_STATUS,verifyReleaseEvidence,createGenesisRehearsal,
  assessBootstrapSet,evaluateLaunchChecklist,buildMainnetRehearsalPackage
} from '../node/authoritative/mainnet-rehearsal-package-candidate.mjs';
import {COIN,INITIAL_SUBSIDY,HALVING_ERA_BLOCKS,TARGET_SECONDS} from '../node/authoritative/fae-v4-core.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object'&&!Buffer.isBuffer(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
const stable=value=>JSON.stringify(canonical(value));
function git(args,{encoding='utf8'}={}){return execFileSync('git',args,{cwd:repoRoot,encoding,maxBuffer:256*1024*1024,stdio:['ignore','pipe','pipe']});}
function gitEntries(){
  const raw=git(['ls-tree','-r','-z','--full-tree','HEAD'],{encoding:null}).toString('utf8');
  return raw.split('\0').filter(Boolean).map(record=>{
    const tab=record.indexOf('\t');assert.ok(tab>0,'invalid git tree row');
    const[mode,type,oid]=record.slice(0,tab).split(' '),path=record.slice(tab+1);
    assert.equal(type,'blob');return{mode,oid,path};
  });
}

const out=await mkdtemp(join(tmpdir(),'fae-g2-release-'));
try{
  // Produce the artifact using Worker E, then verify it independently with Git as
  // the source oracle. This verifier does not reuse F's tree-reconstruction logic.
  const built=await buildReproducibleRelease({outDir:out});
  const artifactBytes=await readFile(built.artifact_path);
  const manifestBytes=await readFile(built.manifest_path);
  const checksumText=await readFile(built.checksum_path,'utf8');
  assert.equal(sha256(artifactBytes),built.artifact_sha256);
  assert.equal(sha256(manifestBytes),built.manifest_sha256);
  assert.equal(checksumText,`${built.artifact_sha256}  fae-source-release-v2.json\n`);

  const artifact=JSON.parse(artifactBytes.toString('utf8'));
  const manifest=JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(artifact.format,'FAE_SOURCE_RELEASE_V2');
  assert.equal(artifact.status,'candidate-package-only');
  assert.deepEqual(artifact.manifest,manifest);

  const head=git(['rev-parse','HEAD']).trim(),tree=git(['rev-parse','HEAD^{tree}']).trim();
  assert.equal(built.source_commit,head);assert.equal(built.source_tree,tree);
  assert.equal(manifest.source_commit,head);assert.equal(manifest.source_tree,tree);
  assert.equal(manifest.source_bytes,'git-commit-blobs-only');
  assert.equal(manifest.tracked_worktree_required,'clean');

  const committed=gitEntries();
  assert.equal(committed.length,manifest.file_count);
  assert.equal(committed.length,artifact.files.length);
  const metaByPath=new Map(manifest.files.map(row=>[row.path,row]));
  const contentByPath=new Map(artifact.files.map(row=>[row.path,row]));
  assert.equal(metaByPath.size,committed.length);assert.equal(contentByPath.size,committed.length);
  for(const entry of committed){
    const meta=metaByPath.get(entry.path),row=contentByPath.get(entry.path);
    assert.ok(meta,`manifest missing ${entry.path}`);assert.ok(row,`artifact missing ${entry.path}`);
    assert.equal(meta.git_mode,entry.mode,`mode mismatch ${entry.path}`);
    assert.equal(meta.git_object,entry.oid,`oid mismatch ${entry.path}`);
    const artifactContent=Buffer.from(row.content_base64,'base64');
    const committedContent=git(['cat-file','blob',entry.oid],{encoding:null});
    assert.deepEqual(artifactContent,committedContent,`blob bytes mismatch ${entry.path}`);
    assert.equal(meta.bytes,artifactContent.length,`length mismatch ${entry.path}`);
    assert.equal(meta.sha256,sha256(artifactContent),`sha256 mismatch ${entry.path}`);
  }

  const configRow=contentByPath.get(manifest.config_path);assert.ok(configRow);
  const configBytes=Buffer.from(configRow.content_base64,'base64');
  assert.equal(sha256(configBytes),manifest.config_sha256);
  const releaseConfig=JSON.parse(configBytes.toString('utf8'));
  assert.equal(releaseConfig.format,'FAE_RELEASE_CONFIG_FREEZE_V2');
  assert.equal(releaseConfig.authority.candidate_to_authoritative,false);
  assert.equal(releaseConfig.authority.mainnet_launch_authorized,false);
  assert.equal(releaseConfig.authority.live_activation_height,null);
  assert.deepEqual(releaseConfig.canonical_public_testnet,{network:'fairyelf-public-testnet-v4',target_seconds:180,initial_subsidy_fae:10,halving_era_blocks:600000});
  assert.equal(releaseConfig.preferred_future_candidate.target_seconds,300);
  assert.equal(releaseConfig.preferred_future_candidate.initial_subsidy_fae,14);
  assert.equal(releaseConfig.preferred_future_candidate.halving_era_blocks,430000);
  assert.equal(releaseConfig.preferred_future_candidate.coinbase_maturity_blocks,200);
  assert.equal(releaseConfig.preferred_future_candidate.status,'not-authorized');

  // Cross-check F's verifier against the independent Git oracle above.
  const binding=verifyReleaseEvidence({
    artifactBytes,manifestBytes,checksumText,
    expectedArtifactSha256:built.artifact_sha256,expectedManifestSha256:built.manifest_sha256,
    expectedSourceCommit:head,expectedSourceTree:tree
  });
  assert.deepEqual(binding,{
    status:'verified-source-release-v2',release_format:'FAE_SOURCE_RELEASE_V2',
    artifact_sha256:built.artifact_sha256,manifest_sha256:built.manifest_sha256,
    source_commit:head,source_tree:tree,config_sha256:manifest.config_sha256,file_count:committed.length
  });

  const template=JSON.parse(await readFile(resolve(here,'..','release','mainnet-rehearsal-template.json'),'utf8'));
  assert.equal(template.status,MAINNET_REHEARSAL_STATUS);
  assert.equal(template.authority.mainnet_launch_authorized,false);
  assert.equal(template.authority.candidate_to_authoritative,false);
  assert.equal(template.authority.automatic_go_path,false);
  for(const key of ['genesis_timestamp_ms','initial_target_hex','genesis_miner_address','release_artifact_sha256','release_manifest_sha256','release_source_commit','release_source_tree','release_config_sha256','live_activation_height','bootstrap_requirements'])assert.equal(template.final_freeze_required[key],null);
  assert.deepEqual(template.final_freeze_required.bootstrap_nodes,[]);

  const timestamp=1_910_000_000_000,target='0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',miner='fae-g2-rehearsal-miner';
  const genesis=createGenesisRehearsal({timestampMs:timestamp,initialTargetHex:target,minerAddress:miner});
  const nodes=[
    {identity_id:'a'.repeat(64),endpoint:'https://g2-a.invalid',operator_id:'g2-a',network_group:'g2-group-a',pinned:true},
    {identity_id:'b'.repeat(64),endpoint:'https://g2-b.invalid',operator_id:'g2-b',network_group:'g2-group-b',pinned:false},
    {identity_id:'c'.repeat(64),endpoint:'https://g2-c.invalid',operator_id:'g2-c',network_group:'g2-group-c',pinned:false}
  ];
  const requirements={min_distinct_operators:3,min_distinct_network_groups:3,min_pinned_identities:1};
  const bootstrap=assessBootstrapSet(nodes,requirements);assert.equal(bootstrap.ready,true);
  const finalFreeze={
    genesis_timestamp_ms:timestamp,initial_target_hex:target,genesis_miner_address:miner,
    release_artifact_sha256:binding.artifact_sha256,release_manifest_sha256:binding.manifest_sha256,
    release_source_commit:binding.source_commit,release_source_tree:binding.source_tree,release_config_sha256:binding.config_sha256,
    live_activation_height:2_000_000,bootstrap_requirements:requirements,bootstrap_nodes:nodes
  };
  const software={release_reproducible:true,release_binding_verified:true,genesis_rehearsed:true,bootstrap_ready:true,peer_convergence:true,rollback_rehearsed:true};
  const externalEvidence={physical_hfb:true,representative_device:true,operational_soak:true,independent_operators:true};
  const checklist=evaluateLaunchChecklist({software,externalEvidence,finalFreeze});
  assert.equal(checklist.software_ready,true);assert.equal(checklist.external_evidence_complete,true);assert.equal(checklist.final_freeze_complete,true);
  assert.equal(checklist.mainnet_launch_authorized,false);assert.equal(checklist.candidate_to_authoritative,false);assert.equal(checklist.automatic_go_path,false);
  assert.equal(checklist.decision,'HOLD_FINAL_EXPLICIT_AUTHORIZATION');
  const missingHeight=evaluateLaunchChecklist({software,externalEvidence,finalFreeze:{...finalFreeze,live_activation_height:null}});
  assert.equal(missingHeight.final_freeze_complete,false);assert.ok(missingHeight.final_freeze_missing.includes('live_activation_height'));

  const pkg=buildMainnetRehearsalPackage({releaseBinding:binding,config:finalFreeze,genesis,bootstrap,software,externalEvidence});
  const{package_digest,...body}=pkg;
  assert.equal(package_digest,sha256(Buffer.from(stable(body))));
  assert.equal(pkg.authority.mainnet_launch_authorized,false);
  assert.equal(pkg.authority.candidate_to_authoritative,false);
  assert.equal(pkg.authority.automatic_go_path,false);
  assert.deepEqual(pkg.release_binding,binding);
  assert.ok(pkg.startup_sequence.every(row=>row.dry_run===true&&row.authority==='rehearsal-only'));
  assert.ok(pkg.startup_sequence.every(row=>row.release_source_commit===head&&row.release_source_tree===tree));

  // The verifier itself also freezes current live authority independently.
  assert.equal(INITIAL_SUBSIDY,10n*COIN);assert.equal(HALVING_ERA_BLOCKS,600000);assert.equal(TARGET_SECONDS,180);

  console.log(JSON.stringify({
    status:'PASS',worker:'G-v2',independent_oracle:'git',candidate_only:true,
    source_commit:head,source_tree:tree,file_count:committed.length,
    release_artifact_sha256:built.artifact_sha256,release_manifest_sha256:built.manifest_sha256,
    e_binding_matches_git_oracle:true,f_package_digest_independently_recomputed:true,
    live_activation_height_gate_verified:true,permanent_hold_verified:true,live_economics_unchanged:true
  }));
}finally{await rm(out,{recursive:true,force:true});}
