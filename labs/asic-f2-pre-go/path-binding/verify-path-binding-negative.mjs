import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const sourcePath=resolve('labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp');
const verifierPath=resolve('labs/asic-f2-pre-go/path-binding/verify-path-binding.mjs');
const source=await readFile(sourcePath,'utf8');
const verifier=await readFile(verifierPath,'utf8');

async function runMutant(label,mutate){
  const root=await mkdtemp(join(tmpdir(),'fae-dp6-path-negative-'));
  const hls=join(root,'hls'),gate=join(root,'path-binding');
  await mkdir(hls,{recursive:true});
  await mkdir(gate,{recursive:true});
  const mutated=mutate(source);
  assert.notEqual(mutated,source,label+' mutation did not change source');
  await writeFile(join(hls,'fae_dp6_hls.cpp'),mutated);
  await writeFile(join(gate,'verify-path-binding.mjs'),verifier);
  try{
    return spawnSync(process.execPath,[join(gate,'verify-path-binding.mjs')],{encoding:'utf8'});
  }finally{
    await rm(root,{recursive:true,force:true});
  }
}

test('baseline frozen source passes the path-binding verifier',async()=>{
  const run=await runMutant('baseline marker',s=>s+'\n');
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.equal(result.status,'PASS_IMPLEMENTATION_LOCAL_PATH_BINDING');
  assert.ok(result.checks.every(row=>row.pass));
});

const mutants=[
  ['halve mandatory RW5 steps',s=>s.replace('#define STEPS 131072u','#define STEPS 65536u')],
  ['bypass Argon2d',s=>s.replace('argon2d_fixed(pwd,saltfull,mh,M);','fae_memset(mh,0,32);')],
  ['bypass RW5',s=>s.replace('rw5(mh,hdr,nonce,task,tr,regs,M);','fae_memset(tr,0,32);')],
  ['zero mandatory memory-carried read',s=>s.replace('uint64_t mv=s[mi];','uint64_t mv=0;')],
  ['remove mandatory state write',s=>s.replace('s[mi]=rotl64(mv+r[dst]+chain+step,(unsigned)(((chain>>59)+1)&63));','/* removed mandatory write */')],
  ['change final binding domain',s=>s.replace('"FAE-DP6-FINAL"','"FAE-DP6-FINAL-ALT"')],
  ['stop exposing final digest',s=>s.replace('fae_memcpy(out+128,final,32);','fae_memset(out+128,0,32);')],
  ['add public fallback path',s=>s.replace('dp6_run_bytes(in_local,out_local,M);','if(in_local[0]) dp6_run_bytes(in_local,out_local,M); else fae_memset(out_local,0,FAE_DP6_OUTPUT_BYTES);')],
  ['truncate public input copy',s=>s.replace('for (uint32_t i=0;i<FAE_DP6_INPUT_BYTES;i++) in_local[i]=input[i];','for (uint32_t i=0;i<32;i++) in_local[i]=input[i];')],
  ['truncate public output copy',s=>s.replace('for (uint32_t i=0;i<FAE_DP6_OUTPUT_BYTES;i++) output[i]=out_local[i];','for (uint32_t i=0;i<32;i++) output[i]=out_local[i];')]
];

for(const [label,mutate] of mutants){
  test('path-binding verifier rejects mutant: '+label,async()=>{
    const run=await runMutant(label,mutate);
    assert.notEqual(run.status,0,'mutant unexpectedly passed: '+label);
  });
}

console.log(JSON.stringify({
  status:'PASS_IF_NODE_TESTS_COMPLETE',
  scope:'DP6 path-binding negative structural corpus',
  mutants:mutants.length,
  authority:'ASSURANCE_ONLY'
}));
