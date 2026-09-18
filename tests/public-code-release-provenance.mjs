import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const root=resolve(new URL('../',import.meta.url).pathname);
const lockPath=join(root,'release','provenance','container-inputs-v1.json');
const dockerfiles=[
  'sovereign-forge/node/Dockerfile',
  'sovereign-forge/node/Dockerfile.v6-candidate',
  'sovereign-forge/node/Dockerfile.coordinator-candidate',
  'sovereign-forge/node/Dockerfile.full-target-shadow-validation'
];

test('PSR-13 immutable container inputs cover every protected Dockerfile without modifying snapshots',async()=>{
  const lock=JSON.parse(await readFile(lockPath,'utf8'));
  assert.equal(lock.format,'FAE_CONTAINER_INPUT_LOCK_V1');
  assert.equal(lock.status,'candidate-provenance-only');
  assert.match(lock.index_digest,/^sha256:[0-9a-f]{64}$/);
  assert.match(lock.platform_manifests['linux/amd64'],/^sha256:[0-9a-f]{64}$/);
  assert.equal(lock.policy.base_input_digest_pinned,true);
  assert.equal(lock.policy.oci_image_byte_reproducibility_claimed,false);
  assert.equal(lock.authority.runtime_change,false);
  assert.equal(lock.authority.consensus_change,false);
  assert.equal(lock.authority.release_authorized,false);
  assert.equal(lock.authority.mainnet_authorized,false);
  assert.deepEqual(lock.protected_dockerfiles,dockerfiles);

  const expected='FROM node:22-bookworm-slim';
  const pinned=expected+'@'+lock.index_digest;
  const dir=await mkdtemp(join(tmpdir(),'fae-psr13-pin-'));
  try{
    for(const path of dockerfiles){
      const original=await readFile(join(root,path),'utf8');
      assert.equal(original.split(/\r?\n/).filter(line=>/^\s*FROM\s+/i.test(line)).length,1);
      assert.equal(original.split(/\r?\n/).find(line=>/^\s*FROM\s+/i.test(line)).trim(),expected);

      const out=join(dir,path.replaceAll('/','__'));
      const stdout=execFileSync(process.execPath,[
        join(root,'scripts','psr13-pinned-dockerfile.mjs'),
        '--dockerfile',path,'--out',out
      ],{cwd:root,encoding:'utf8'});
      const result=JSON.parse(stdout.trim());
      assert.equal(result.status,'PASS');
      assert.equal(result.base,pinned);
      const generated=await readFile(out,'utf8');
      assert.equal(generated.split(/\r?\n/).find(line=>/^\s*FROM\s+/i.test(line)).trim(),pinned);
      assert.equal(original.includes('@sha256:'),false,'protected Dockerfile unexpectedly mutated in-place');
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('PSR-13 pinned Dockerfile generator fails closed on base drift',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-psr13-drift-'));
  try{
    const fake=join(dir,'Dockerfile');
    await writeFile(fake,'FROM node:23-bookworm-slim\nCMD ["node","--version"]\n');
    assert.throws(()=>execFileSync(process.execPath,[
      join(root,'scripts','psr13-pinned-dockerfile.mjs'),
      '--dockerfile',fake,'--out',join(dir,'out')
    ],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}),/Command failed/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('PSR-13 runtime provenance binds release hashes to current Git commit and preserves authority fences',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-psr13-evidence-'));
  try{
    execFileSync(process.execPath,[join(root,'scripts','psr13-release-provenance.mjs'),'--out',dir],{
      cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:256*1024*1024
    });
    const evidence=JSON.parse(await readFile(join(dir,'psr13-runtime-evidence.json'),'utf8'));
    const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    const tree=execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim();
    assert.equal(evidence.format,'FAE_PSR13_RUNTIME_EVIDENCE_V1');
    assert.equal(evidence.status,'PASS');
    assert.equal(evidence.source_commit,head);
    assert.equal(evidence.source_tree,tree);
    assert.match(evidence.release.artifact_sha256,/^[0-9a-f]{64}$/);
    assert.match(evidence.release.manifest_sha256,/^[0-9a-f]{64}$/);
    assert.ok(evidence.release.file_count>100);
    assert.match(evidence.container_input.index_digest,/^sha256:[0-9a-f]{64}$/);
    assert.equal(evidence.container_input.oci_image_byte_reproducibility_claimed,false);
    assert.equal(evidence.authority.release_authorized,false);
    assert.equal(evidence.authority.mainnet_authorized,false);
    assert.equal(evidence.authority.runtime_or_consensus_change,false);

    const config=JSON.parse(await readFile(join(root,'sovereign-forge','release','release-candidate-config.json'),'utf8'));
    assert.equal(config.authority.candidate_to_authoritative,false);
    assert.equal(config.authority.mainnet_launch_authorized,false);
    const rehearsal=JSON.parse(await readFile(join(root,'sovereign-forge','release','mainnet-rehearsal-template.json'),'utf8'));
    assert.equal(rehearsal.authority.mainnet_launch_authorized,false);
    assert.equal(rehearsal.authority.automatic_go_path,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

console.log(JSON.stringify({
  status:'PASS',
  psr:'PSR-13',
  source_release_byte_reproducibility:'tested_by_colony_e_and_clean_room_workflow',
  independent_git_oracle:'tested_by_g2_workflow',
  container_base_input_pinned:true,
  oci_image_byte_reproducibility_claimed:false,
  authority_change:false
}));
