import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const SOURCE=new URL('../hls/fae_dp6_hls.cpp',import.meta.url);

function stripComments(source){
  return source
    .replace(/\/\*[\s\S]*?\*\//g,'')
    .replace(/\/\/.*$/gm,'');
}

function bodyOf(source,signature){
  const start=source.indexOf(signature);
  assert.notEqual(start,-1,'missing function '+signature);
  const brace=source.indexOf('{',start);
  assert.notEqual(brace,-1,'missing opening brace for '+signature);
  let depth=0;
  for(let i=brace;i<source.length;i++){
    if(source[i]==='{')depth++;
    else if(source[i]==='}'){
      depth--;
      if(depth===0)return source.slice(brace+1,i);
    }
  }
  throw new Error('unterminated function '+signature);
}

function count(haystack,needle){
  let n=0,at=0;
  while((at=haystack.indexOf(needle,at))!==-1){n++;at+=needle.length}
  return n;
}

const raw=await readFile(SOURCE,'utf8');
const source=stripComments(raw);
const run=bodyOf(source,'static int dp6_run_bytes');
const rw5=bodyOf(source,'static void rw5');
const entry=bodyOf(source,'extern "C" void fae_dp6_hls');

const checks=[];
function check(id,predicate,detail){
  checks.push({id,pass:Boolean(predicate),detail});
  assert.ok(predicate,id+': '+detail);
}

for(const [name,value] of [
  ['PROGRAMS','8u'],
  ['PROGRAM_SIZE','256u'],
  ['STEPS','131072u'],
  ['ARGON_BLOCKS','262144u'],
  ['ARGON_BLOCK_BYTES','1024u'],
  ['FAE_DP6_INPUT_BYTES','112u'],
  ['FAE_DP6_OUTPUT_BYTES','160u']
]){
  check('CONST_'+name,source.includes('#define '+name+' '+value),name+' must remain frozen at '+value);
}

check('ARGON_MEMORY_256_MIB',source.includes('uint32_t vals[6]={1u,32u,262144u,1u,0x13u,0u}'),'Argon2d parameters must remain p=1,out=32,m=262144 KiB,t=1,v=0x13,type=d');
check('DP6_CALLS_ARGON_ONCE',count(run,'argon2d_fixed(')===1,'dp6_run_bytes must execute Argon2d exactly once');
check('DP6_CALLS_RW5_ONCE',count(run,'rw5(')===1,'dp6_run_bytes must execute RW5 exactly once');
check('DP6_NO_BRANCH_BYPASS',!/\b(if|switch|while|for)\s*\(/.test(run),'top-level DP6 path must have no conditional bypass/alternate work branch');
check('DP6_MH3_SALT_BINDING',run.includes('h3("FAE-DP6-MH3-SALT",prev,32,hb,8,task,32,saltfull)'),'MH3 salt must bind prev,height,task');
check('DP6_MH3_INPUT_BINDING',run.includes('h3("FAE-DP6-MH3-INPUT",hdr,32,nb,8,task,32,pwd)'),'MH3 input must bind header,nonce,task');
check('DP6_FINAL_BINDING',run.includes('h6("FAE-DP6-FINAL",hdr,32,nb,8,task,32,mh,32,tr,32,regbytes,64,inner)'),'final digest must bind header,nonce,task,MH3,RW5 transcript,register state');
check('RW5_SEED_BINDING',rw5.includes('h4("FAE-RW5-SEED",mh,32,hdr,32,nb,8,task,32,base)'),'RW5 seed must bind MH3,header,nonce,task');
check('RW5_PROGRAM_COUNT',rw5.includes('for(uint32_t pidx=0;pidx<PROGRAMS;pidx++)'),'all frozen RW5 programs must execute');
check('RW5_STEP_COUNT',rw5.includes('for(uint32_t step=0;step<STEPS;step++)'),'all frozen RW5 steps must execute per program');
check('RW5_PRIVATE_STATE_MASK',rw5.includes('const uint64_t mask=(256u*1024u*1024u/8u)-1u'),'mandatory state indexing must span frozen 256 MiB private state');
check('RW5_MANDATORY_READ',rw5.includes('uint64_t mv=s[mi]'),'every step must perform the mandatory memory-carried read');
check('RW5_NEXT_CHAIN_USES_MV',/chain\s*=\s*rotl64\(chain\^mv/.test(rw5),'next chain state must depend on the value returned by the current mandatory read');
check('RW5_MANDATORY_WRITE',rw5.includes('s[mi]=rotl64('),'every step must update the mandatory addressed state');
check('PUBLIC_ENTRYPOINT_SINGLE',count(source,'extern "C" void fae_dp6_hls')===1,'exactly one public HLS DP6 entrypoint is admitted in this source');
check('ENTRYPOINT_CALLS_FROZEN_PATH_ONCE',count(entry,'dp6_run_bytes(')===1,'public HLS entrypoint must call the frozen DP6 path exactly once');
check('ENTRYPOINT_NO_ALTERNATE_PATH',!/\b(if|switch)\s*\(/.test(entry),'public entrypoint must not choose an alternate/reduced work path');

const mandatorySteps=8*131072;
check('MANDATORY_EDGE_COUNT',mandatorySteps===1048576,'8 programs x 131072 steps must equal 1,048,576 mandatory memory-carried steps');

console.log(JSON.stringify({
  schema:'FAE_DP6_PATH_BINDING_AUDIT_V1',
  status:'PASS_IMPLEMENTATION_LOCAL_PATH_BINDING',
  source:'labs/asic-f2-pre-go/hls/fae_dp6_hls.cpp',
  checks,
  derived:{mandatory_memory_carried_steps:mandatorySteps,private_state_mib:256},
  non_claims:[
    'Does not prove a future mainnet verifier is wired only to this source.',
    'Does not prove cryptanalytic shortcut impossibility.',
    'Does not replace an independently implemented DP6 verifier.',
    'Does not authorize consensus, release or mainnet.'
  ]
},null,2));
