import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename,dirname,resolve} from 'node:path';

const repoRoot=resolve(new URL('../',import.meta.url).pathname);
const args=process.argv.slice(2);
const value=name=>{
  const i=args.indexOf(name);
  if(i<0||!args[i+1])throw new Error(name.slice(2)+'_missing');
  return args[i+1];
};
const dockerfile=resolve(repoRoot,value('--dockerfile'));
const out=resolve(value('--out'));
const lockPath=resolve(repoRoot,args.includes('--lock')?value('--lock'):'release/provenance/container-inputs-v1.json');

const lock=JSON.parse(await readFile(lockPath,'utf8'));
if(lock.format!=='FAE_CONTAINER_INPUT_LOCK_V1')throw new Error('container_lock_format_invalid');
if(!/^sha256:[0-9a-f]{64}$/.test(lock.index_digest))throw new Error('container_index_digest_invalid');
if(lock.policy?.base_input_digest_pinned!==true)throw new Error('container_lock_not_pinned');

const source=await readFile(dockerfile,'utf8');
const lines=source.split(/\r?\n/);
const fromIndexes=[];
for(let i=0;i<lines.length;i++)if(/^\s*FROM\s+/i.test(lines[i]))fromIndexes.push(i);
if(fromIndexes.length!==1)throw new Error('dockerfile_must_have_exactly_one_from');
const index=fromIndexes[0];
const expected='FROM '+lock.image.replace('docker.io/library/','')+':'+lock.tag_at_freeze;
if(lines[index].trim()!==expected)throw new Error('dockerfile_base_drift:'+lines[index].trim());
const pinned=expected+'@'+lock.index_digest;
lines[index]=pinned;

await mkdir(dirname(out),{recursive:true});
const bytes=Buffer.from(lines.join('\n'));
await writeFile(out,bytes);
const sha256=x=>createHash('sha256').update(x).digest('hex');
console.log(JSON.stringify({
  status:'PASS',
  source_dockerfile:dockerfile.slice(repoRoot.length+1),
  output:out,
  base:pinned,
  source_sha256:sha256(Buffer.from(source)),
  generated_sha256:sha256(bytes),
  lock_sha256:sha256(await readFile(lockPath)),
  oci_image_byte_reproducibility_claimed:false
}));
