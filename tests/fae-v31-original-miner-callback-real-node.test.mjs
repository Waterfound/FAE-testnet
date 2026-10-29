// Candidate-only original standalone miner callback integration.
// This test uses the ordinary standalone node HTTP route deliberately: it
// validates existing miner + original consensus, NOT authenticated native
// block ingress. Protected V31 native owner admission remains OPEN.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import net from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {runMiner} from '../standalone/fae-miner.mjs';
import {hashHeaderNonce,workMeetsTarget} from '../standalone/mining-core.mjs';
const ADDRESS='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
const SCRIPT=resolve('sovereign-forge/node/fae-node.mjs');
async function port(){return await new Promise((yes,no)=>{
  const srv=net.createServer();srv.once('error',no);
  srv.listen(0,'127.0.0.1',()=>{const p=srv.address().port;
    srv.close(e=>e?no(e):yes(p));});
})}
async function originalNode(data,port,fn){
  const child=fork(SCRIPT,[],{cwd:process.cwd(),env:{...process.env,
    FAE_TRIUM_IPC:'0',FAE_TRIUM_MINER_IPC_CANDIDATE:'0',FAE_SYNC:'0',
    FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:'',
    FAE_DATA_FILE:join(data,'state.json'),FAE_HOST:'127.0.0.1',
    FAE_PORT:String(port)},stdio:['ignore','pipe','pipe','ipc']});
  try{
    await new Promise((yes,no)=>{
      let output='',done=false;const finish=error=>{
        if(done)return;done=true;clearTimeout(timer);
        child.stdout.off('data',onData);child.off('exit',onExit);
        error?no(error):yes();
      };
      const onExit=()=>finish(Error('original_node_exited_before_ready'));
      const onData=b=>{output+=String(b);if(output.length>8000)output=output.slice(-8000);
        if(output.includes(' listening on http://127.0.0.1:'+port+' height='))finish();};
      const timer=setTimeout(()=>finish(Error('original_node_readiness_timeout')),10000);
      child.stdout.on('data',onData);child.once('exit',onExit);
    });
    return await fn('http://127.0.0.1:'+port);
  }finally{
    if(child.connected)child.disconnect();
    if(child.exitCode===null&&!child.killed)child.kill();
    await new Promise(done=>{
      if(child.exitCode!==null||child.signalCode!==null)return done();
      const t=setTimeout(done,3000);child.once('exit',()=>{clearTimeout(t);done()});
    });
  }
}
async function json(base,route,opts){
  const response=await fetch(base+route,{...opts,signal:AbortSignal.timeout(10000)});
  const body=await response.json();
  if(!response.ok)throw Error('original_node_request_failed:'+response.status);
  return body;
}
test('original miner mines REAL PoW and callback relays one original-node accepted block',
 {timeout:180000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-v31-original-miner-callback-'));
  try{
    const p=await port();let acceptedHash=null,acceptedHeight=null,invocations=0;
    await originalNode(dir,p,async base=>{
      const minerOpts={node:base,address:ADDRESS,chunkSize:4096,
        tipPollMs:500,reconnectMinMs:100,reconnectMaxMs:1000,
        rateIntervalMs:500,yieldMs:0,nonceStart:0,once:true,json:false};
      const result=await runMiner(minerOpts,{emit:()=>{},
        submitMinedBlock:async submission=>{
          invocations++;
          assert.equal(submission.header.network,'fairyelf-public-testnet-v4');
          assert.equal(submission.hash,
            hashHeaderNonce(submission.header,submission.nonce));
          assert.equal(workMeetsTarget(submission.hash,
            submission.header.difficulty_bits),true);
          const receipt=await json(base,'/submit-block',{
            method:'POST',headers:{'content-type':'application/json'},
            body:JSON.stringify(submission)});
          acceptedHash=receipt.hash;acceptedHeight=receipt.height;
          return receipt;
        }});
      assert.equal(result.accepted,1);
      assert.equal(result.rejected,0);
      assert.equal(invocations,1,'no implicit second block submission');
      assert.equal(acceptedHeight,1);
      const observed=await json(base,'/status');
      assert.equal(observed.height,1);
      assert.equal(observed.tip_hash,acceptedHash);
    });
    const restartPort=await port();
    await originalNode(dir,restartPort,async base=>{
      const persisted=await json(base,'/status');
      assert.equal(persisted.height,1,'original node reloaded mined block');
      assert.equal(persisted.tip_hash,acceptedHash);
    });
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('native callback failure is fail-closed: one call, no automatic HTTP block fallback',
 {timeout:180000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-v31-miner-denied-'));
  try{
    const p=await port();
    await originalNode(dir,p,async base=>{
      const minerOpts={node:base,address:ADDRESS,chunkSize:4096,
        tipPollMs:500,reconnectMinMs:100,reconnectMaxMs:1000,
        rateIntervalMs:500,yieldMs:0,nonceStart:0,once:true,json:false};
      let callbackCalls=0;
      await assert.rejects(runMiner(minerOpts,{emit:()=>{},
        submitMinedBlock:async submission=>{
          callbackCalls++;
          assert.equal(submission.header.network,'fairyelf-public-testnet-v4');
          // No permission to mutate original node; simulate native owner gate.
          throw Error('native_owner_mutation_gate_closed');
        }}),/Non-stale block rejection/);
      assert.equal(callbackCalls,1,'no implicit retry of unknown outcome');
      const observed=await json(base,'/status');
      assert.equal(observed.height,0,'HTTP fallback never occurs');
      assert.equal(observed.mempool_size,0);
    });
  }finally{await rm(dir,{recursive:true,force:true})}
});
test('original miner refuses malformed callback before any mining begins',
 async()=>{
  await assert.rejects(runMiner({json:false},{emit:()=>{},submitMinedBlock:'not-owned'}),
    /Native miner submission callback must be a function/);
});
