import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {hashHeaderNonce,workMeetsTarget,buildSubmission} from '../standalone/mining-core.mjs';
const require=createRequire(import.meta.url);
const {runDeniedOriginalMiner,verifyOriginalMinerSource,assertOriginalMinerProposal,SOURCE_BLOBS}=
  require('../universal-client/src/v34-original-miner-owner.cjs');
const ROOT=resolve('.');
const NODE=resolve('sovereign-forge/node/fae-node.mjs');
const ADDRESS='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
async function port(){
  return await new Promise((resolve,reject)=>{
    const s=createServer();s.once('error',reject);
    s.listen(0,'127.0.0.1',()=>{const n=s.address().port;
      s.close(e=>e?reject(e):resolve(n))});
  });
}
async function originalNode(state,p,fn){
  const child=fork(NODE,[],{cwd:ROOT,stdio:['ignore','pipe','pipe','ipc'],env:{
    ...process.env,FAE_TRIUM_IPC:'0',FAE_TRIUM_MINER_IPC_CANDIDATE:'0',
    FAE_SYNC:'0',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:'',FAE_UPSTREAM_API:'',
    FAE_HOST:'127.0.0.1',FAE_PORT:String(p),FAE_DATA_FILE:state
  }});
  try{
    await new Promise((resolve,reject)=>{
      let buffer='',closed=false;
      const finish=err=>{if(closed)return;closed=true;clearTimeout(t);
        child.stdout.off('data',onData);child.off('exit',onExit);
        err?reject(err):resolve()};
      const onData=chunk=>{buffer+=String(chunk);
        if(buffer.includes(' listening on http://127.0.0.1:'+p+' height='))
          finish()};
      const onExit=()=>finish(Error('Original node exited before listening'));
      const t=setTimeout(()=>finish(Error('Original node readiness timeout')),12000);
      child.stdout.on('data',onData);child.once('exit',onExit);
    });
    return await fn('http://127.0.0.1:'+p);
  }finally{
    if(child.connected)child.disconnect();
    if(child.exitCode===null&&!child.killed)child.kill();
    await new Promise(resolve=>{
      if(child.exitCode!==null||child.signalCode!==null)return resolve();
      const t=setTimeout(resolve,2000);child.once('exit',()=>{clearTimeout(t);resolve()});
    });
  }
}
async function status(base){
  const r=await fetch(base+'/status',{signal:AbortSignal.timeout(10000)});
  assert.equal(r.status,200);return await r.json();
}
test('V34 genuine ORIGINAL miner child finds valid PoW but OS parent denies mutation without HTTP fallback', {timeout:130000},async()=>{
  const scratch=await mkdtemp(join(tmpdir(),'fae-v34-real-child-'));
  const state=join(scratch,'node-state.json');
  try{
    const p=await port(),childUrl='http://127.0.0.1:'+p;
    await originalNode(state,p,async base=>{
      const start=await status(base);assert.equal(start.height,0);
      const result=await runDeniedOriginalMiner({
        repoRoot:ROOT,node:childUrl,address:ADDRESS,timeoutMs:85000});
      assert.equal(result.type,'REAL_ORIGINAL_MINER_OS_CHILD_DENIED');
      assert.equal(result.native_node_mutation,'NOT_ADMITTED');
      assert.equal(result.http_fallback,'NEVER_CALLED');
      assert.equal(result.original_network,'fairyelf-public-testnet-v4');
      assert.equal(result.result,'FAIL_CLOSED');
      assert.equal(result.request_count,1,'only one original-miner OS IPC proposal');
      assert.equal(result.block_height,1);
      assert.equal(hashHeaderNonce(result.header,result.nonce),result.block_hash);
      assert.equal(workMeetsTarget(result.block_hash,result.header.difficulty_bits),true);
      // The SAME original mining-core validates the parent-side boundary.
      // A valid original OS child block is admitted only as proof, never as
      // an original-node state mutation without owner authorization.
      const proposed={header:result.header,nonce:result.nonce,
        hash:result.block_hash,txids:result.txids};
      assert.equal(assertOriginalMinerProposal(proposed,buildSubmission),true);
      const tampered=[
        {...proposed,hash:'f'.repeat(64)},
        {...proposed,txids:['a'.repeat(64)]},
        {...proposed,header:{...proposed.header,network:'untrusted-mainnet'}},
        {...proposed,header:{...proposed.header,tx_root:'b'.repeat(64)}},
        {...proposed,unauthorized_mutation:true}
      ];
      for(const forged of tampered)
        assert.throws(()=>assertOriginalMinerProposal(forged,buildSubmission),
          /Original miner proposal proof rejected/);
      const after=await status(base);
      assert.equal(after.height,0,'rejected owner cannot mutate original chain');
      assert.equal(after.tip_hash,start.tip_hash);
    });
    const restartPort=await port();
    await originalNode(state,restartPort,async base=>{
      const observed=await status(base);
      assert.equal(observed.height,0,'cold restart sees no unauthorized mining mutation');
    });
  }finally{await rm(scratch,{force:true,recursive:true})}
});
test('V34 original worker and original miner source are exact-owner pinned',async()=>{
  const script=await verifyOriginalMinerSource(ROOT);
  assert.ok(script.endsWith('v34-original-miner-owned-worker.mjs'));
  assert.equal(Object.keys(SOURCE_BLOBS).length,3);
});
test('V34 tampered miner source is denied BEFORE any OS child starts',async()=>{
  const original=await mkdtemp(join(tmpdir(),'fae-v34-bad-source-'));
  try{
    const root=await realpath(original);
    for(const relative of Object.keys(SOURCE_BLOBS)){
      const source=join(ROOT,...relative.split('/'));
      const dest=join(root,...relative.split('/'));
      await mkdir(dirname(dest),{recursive:true});await copyFile(source,dest);
    }
    await verifyOriginalMinerSource(root);
    const miner=join(root,'standalone','fae-miner.mjs');
    await writeFile(miner,(await readFile(miner,'utf8'))+'\n// tampered binary source\n');
    await assert.rejects(runDeniedOriginalMiner({
      repoRoot:root,node:'http://127.0.0.1:37243',address:ADDRESS}),
      /Original miner source pin mismatch/);
  }finally{await rm(original,{force:true,recursive:true})}
});
test('V34 malformed or nonlocal miner input cannot create a child process',async()=>{
  for(const node of ['http://evil.example:45454',
    'https://127.0.0.1:45454','http://127.0.0.1:45454/path',
    'http://127.0.0.1:99999']){
    await assert.rejects(runDeniedOriginalMiner({
      repoRoot:ROOT,node,address:ADDRESS}),/not admitted/);
  }
});
