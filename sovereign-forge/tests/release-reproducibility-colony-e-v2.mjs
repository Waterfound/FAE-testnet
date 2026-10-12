import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  buildReproducibleRelease,RELEASE_FORMAT,RELEASE_STATUS
} from '../scripts/build-reproducible-release.mjs';
import {COIN,INITIAL_SUBSIDY,HALVING_ERA_BLOCKS,TARGET_SECONDS,NETWORK} from '../node/authoritative/fae-v4-core.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlobSha1=bytes=>createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
const a=await mkdtemp(join(tmpdir(),'fae-e-v2-a-')),b=await mkdtemp(join(tmpdir(),'fae-e-v2-b-'));

try{
  const buildA=await buildReproducibleRelease({outDir:a});
  const buildB=await buildReproducibleRelease({outDir:b});
  assert.equal(buildA.source_commit,buildB.source_commit);
  assert.equal(buildA.source_tree,buildB.source_tree);
  assert.equal(buildA.file_count,buildB.file_count);
  assert.equal(buildA.artifact_sha256,buildB.artifact_sha256);
  assert.equal(buildA.manifest_sha256,buildB.manifest_sha256);

  const bytesA=await readFile(buildA.artifact_path),bytesB=await readFile(buildB.artifact_path);
  assert.deepEqual(bytesA,bytesB);
  assert.equal(sha256(bytesA),buildA.artifact_sha256);
  const artifact=JSON.parse(bytesA.toString('utf8'));
  assert.equal(artifact.format,RELEASE_FORMAT);
  assert.equal(artifact.status,RELEASE_STATUS);
  assert.equal(artifact.manifest.format,RELEASE_FORMAT);
  assert.equal(artifact.manifest.status,'candidate-package-only');
  assert.equal(artifact.manifest.source_bytes,'git-commit-blobs-only');
  assert.equal(artifact.manifest.tracked_worktree_required,'clean');
  assert.match(artifact.manifest.source_commit,/^[0-9a-f]{40}$/);
  assert.match(artifact.manifest.source_tree,/^[0-9a-f]{40}$/);
  assert.equal(artifact.manifest.file_count,artifact.files.length);
  assert.ok(artifact.files.length>100,'release unexpectedly small');

  const paths=artifact.files.map(row=>row.path);
  assert.deepEqual(paths,[...paths].sort());
  assert.equal(new Set(paths).size,paths.length);
  const metadata=new Map(artifact.manifest.files.map(row=>[row.path,row]));
  assert.equal(metadata.size,paths.length);

  for(const row of artifact.files){
    const meta=metadata.get(row.path);assert.ok(meta,`missing metadata for ${row.path}`);
    const content=Buffer.from(row.content_base64,'base64');
    assert.equal(content.length,meta.bytes,`byte length mismatch: ${row.path}`);
    assert.equal(sha256(content),meta.sha256,`sha256 mismatch: ${row.path}`);
    assert.equal(gitBlobSha1(content),meta.git_object,`git blob mismatch: ${row.path}`);
    assert.match(meta.git_mode,/^(100644|100755|120000)$/);
  }

  const configRow=artifact.files.find(row=>row.path===artifact.manifest.config_path);assert.ok(configRow);
  assert.equal(sha256(Buffer.from(configRow.content_base64,'base64')),artifact.manifest.config_sha256);
  const config=JSON.parse(Buffer.from(configRow.content_base64,'base64').toString('utf8'));
  assert.equal(config.format,'FAE_RELEASE_CONFIG_FREEZE_V2');
  assert.equal(config.status,'candidate-package-only');
  assert.equal(config.authority.candidate_to_authoritative,false);
  assert.equal(config.authority.mainnet_launch_authorized,false);
  assert.equal(config.authority.live_activation_height,null);
  assert.equal(config.canonical_public_testnet.network,NETWORK);
  assert.equal(config.canonical_public_testnet.target_seconds,180);
  assert.equal(config.canonical_public_testnet.initial_subsidy_fae,10);
  assert.equal(config.canonical_public_testnet.halving_era_blocks,600000);
  assert.equal(config.preferred_future_candidate.target_seconds,300);
  assert.equal(config.preferred_future_candidate.initial_subsidy_fae,14);
  assert.equal(config.preferred_future_candidate.halving_era_blocks,430000);
  assert.equal(config.preferred_future_candidate.coinbase_maturity_blocks,200);
  assert.equal(config.preferred_future_candidate.activation_height,null);
  assert.equal(config.preferred_future_candidate.status,'not-authorized');
  assert.equal(config.release_rules.source_bytes_must_come_from_git_commit_blobs,true);
  assert.equal(config.release_rules.tracked_worktree_must_be_clean,true);

  // Live public-testnet authority is deliberately unchanged by packaging.
  assert.equal(INITIAL_SUBSIDY,10n*COIN);
  assert.equal(HALVING_ERA_BLOCKS,600000);
  assert.equal(TARGET_SECONDS,180);

  const checksum=await readFile(buildA.checksum_path,'utf8');
  assert.equal(checksum,`${buildA.artifact_sha256}  fae-source-release-v2.json\n`);
  await assert.rejects(()=>buildReproducibleRelease({outDir:a,artifactName:'../escape.json'}),/artifact_name_invalid/);

  console.log(JSON.stringify({
    status:'PASS',worker:'E-v2',candidate_only:true,
    source_commit:buildA.source_commit,source_tree:buildA.source_tree,
    file_count:buildA.file_count,artifact_sha256:buildA.artifact_sha256,
    manifest_sha256:buildA.manifest_sha256,git_blob_binding:true,
    byte_reproducible_same_checkout:true,live_economics_unchanged:true
  }));
}finally{
  await rm(a,{recursive:true,force:true});
  await rm(b,{recursive:true,force:true});
}
