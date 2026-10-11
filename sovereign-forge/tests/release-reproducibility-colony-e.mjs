import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildReproducibleRelease,RELEASE_FORMAT,RELEASE_STATUS} from '../scripts/build-reproducible-release.mjs';
import {COIN,INITIAL_SUBSIDY,HALVING_ERA_BLOCKS,TARGET_SECONDS} from '../node/authoritative/fae-v4-core.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const a=await mkdtemp(join(tmpdir(),'fae-release-a-')),b=await mkdtemp(join(tmpdir(),'fae-release-b-'));
try{
  const buildA=await buildReproducibleRelease({outDir:a});
  const buildB=await buildReproducibleRelease({outDir:b});
  assert.equal(buildA.source_commit,buildB.source_commit);assert.equal(buildA.file_count,buildB.file_count);
  assert.equal(buildA.artifact_sha256,buildB.artifact_sha256);assert.equal(buildA.manifest_sha256,buildB.manifest_sha256);
  const bytesA=await readFile(buildA.artifact_path),bytesB=await readFile(buildB.artifact_path);assert.deepEqual(bytesA,bytesB);
  const artifact=JSON.parse(bytesA.toString('utf8'));
  assert.equal(artifact.format,RELEASE_FORMAT);assert.equal(artifact.status,RELEASE_STATUS);assert.equal(artifact.manifest.format,RELEASE_FORMAT);assert.equal(artifact.manifest.status,'candidate-package-only');
  assert.equal(artifact.manifest.file_count,artifact.files.length);assert.ok(artifact.files.length>0);
  const paths=artifact.files.map(row=>row.path);assert.deepEqual(paths,[...paths].sort());assert.equal(new Set(paths).size,paths.length);
  const metadata=new Map(artifact.manifest.files.map(row=>[row.path,row]));assert.equal(metadata.size,paths.length);
  for(const row of artifact.files){const meta=metadata.get(row.path);assert.ok(meta,`missing metadata for ${row.path}`);const content=Buffer.from(row.content_base64,'base64');assert.equal(content.length,meta.bytes);assert.equal(sha256(content),meta.sha256);assert.match(meta.git_mode,/^100[67]44$|^120000$/);}
  const configRow=artifact.files.find(row=>row.path===artifact.manifest.config_path);assert.ok(configRow);assert.equal(sha256(Buffer.from(configRow.content_base64,'base64')),artifact.manifest.config_sha256);
  const config=JSON.parse(Buffer.from(configRow.content_base64,'base64').toString('utf8'));
  assert.equal(config.status,'candidate-package-only');assert.equal(config.authority.candidate_to_authoritative,false);assert.equal(config.authority.mainnet_launch_authorized,false);assert.equal(config.authority.live_activation_height,null);
  assert.equal(config.canonical_public_testnet.target_seconds,180);assert.equal(config.canonical_public_testnet.initial_subsidy_fae,10);assert.equal(config.canonical_public_testnet.halving_era_blocks,600000);
  assert.equal(Object.hasOwn(config,'preferred_future_candidate'),false,'superseded parameter pack cannot remain the future authority');
  const f=config.future_tokenomics_design;
  assert.equal(f.status,'authoritative-future-design-not-active-consensus');
  assert.equal(f.initial_subsidy_fae,9);
  assert.equal(f.era_blocks,630000);
  assert.equal(f.reduction_percent,45);
  assert.equal(f.retention_percent,55);
  assert.equal(f.hard_maximum_supply_fae,12600000);
  assert.equal(f.atom_exact_scheduled_supply_fae,'12599999.81100000');
  assert.equal(f.activated,false);
  assert.equal(f.activation_height,null);
  assert.equal(f.authority_record_in_this_historical_release_tree,false,'historical branch is NOT canonical final source');
  assert.equal(config.future_block_time_research.incumbent_target_seconds,300);
  assert.equal(config.future_block_time_research.final_target_seconds,null);
  assert.equal(config.future_block_time_research.authoritative,false);
  assert.equal(config.future_coinbase_maturity.final_blocks,null);
  assert.equal(config.future_coinbase_maturity.authoritative,false);
  assert.equal(config.superseded_historical_candidate.status,'superseded-historical-only');
  assert.equal(config.superseded_historical_candidate.initial_subsidy_fae,14);
  assert.equal(config.superseded_historical_candidate.halving_era_blocks,430000);
  for(const gate of ['fee_security_budget_frozen','final_daa_timestamp_policy_frozen','production_genesis_frozen'])
    assert.equal(config.final_economic_security_gates[gate],false);
  assert.equal(config.final_economic_security_gates.release_candidate_must_rebind_to_current_canonical_source,true);
  assert.equal(INITIAL_SUBSIDY,10n*COIN);assert.equal(HALVING_ERA_BLOCKS,600000);assert.equal(TARGET_SECONDS,180);
  const checksum=await readFile(buildA.checksum_path,'utf8');assert.equal(checksum,`${buildA.artifact_sha256}  fae-source-release-v1.json\n`);
  console.log(JSON.stringify({status:'PASS',worker:'E',candidate_only:true,byte_reproducible:true,file_count:buildA.file_count,artifact_sha256:buildA.artifact_sha256,manifest_sha256:buildA.manifest_sha256,live_economics_unchanged:true}));
}finally{await rm(a,{recursive:true,force:true});await rm(b,{recursive:true,force:true});}
