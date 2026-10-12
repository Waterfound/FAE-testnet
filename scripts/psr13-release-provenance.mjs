import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildReproducibleRelease,repoRoot} from '../sovereign-forge/scripts/build-reproducible-release.mjs';

const args=process.argv.slice(2);
const i=args.indexOf('--out');
const out=resolve(i>=0&&args[i+1]?args[i+1]:'dist/psr13-evidence');
await mkdir(out,{recursive:true});
const sha256=b=>createHash('sha256').update(b).digest('hex');
const git=a=>execFileSync('git',a,{cwd:repoRoot,encoding:'utf8'}).trim();

const releaseDir=resolve(out,'release');
const built=await buildReproducibleRelease({outDir:releaseDir});
const lockPath=resolve(repoRoot,'release/provenance/container-inputs-v1.json');
const lockBytes=await readFile(lockPath);
const lock=JSON.parse(lockBytes);

const evidence={
  format:'FAE_PSR13_RUNTIME_EVIDENCE_V1',
  status:'PASS',
  candidate_only:true,
  source_commit:git(['rev-parse','HEAD']),
  source_tree:git(['rev-parse','HEAD^{tree}']),
  release:{
    format:'FAE_SOURCE_RELEASE_V2',
    artifact_sha256:built.artifact_sha256,
    manifest_sha256:built.manifest_sha256,
    file_count:built.file_count
  },
  container_input:{
    image:lock.image,
    tag_at_freeze:lock.tag_at_freeze,
    index_digest:lock.index_digest,
    lock_sha256:sha256(lockBytes),
    oci_image_byte_reproducibility_claimed:false
  },
  toolchain_observation:{
    node:process.version,
    git:git(['--version'])
  },
  authority:{
    release_authorized:false,
    mainnet_authorized:false,
    runtime_or_consensus_change:false
  }
};
if(evidence.source_commit!==built.source_commit||evidence.source_tree!==built.source_tree)throw new Error('release_source_binding_mismatch');
await writeFile(resolve(out,'psr13-runtime-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence));
