// V53 security-owner candidate: REAL original-node source, never product admission.
// Runs actual OS-forked node, authentic original Miner, original consensus and disk.
// Only disposable files, no public network or Wallet/user secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {runMiner,resolveOptions} from '../standalone/fae-miner.mjs';
import {buildSubmission} from '../standalone/mining-core.mjs';

const NODE=resolve('sovereign-forge/node/fae-node.mjs');
const NETWORK='fairyelf-public-testnet-v4';
const TYPE='TRIUM_FAE_NODE_IPC_REQUEST_V1';
const REPLY='TRIUM_FAE_NODE_IPC_REPLY_V1';
const ADDRESS='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
const S='7'.repeat(64);
async function port(){
  return new Promise((yes,no)=>{
    const server=createServer();
    server.once('error',no);
    server.listen(0,'127.0.0.1',()=>{
      const p=server.address().port;
      server.close(error=>error?no(error):yes(p));
    });
  });
}
async function start(dir,p,{block=false,managed=true}={}){
  const child=fork(NODE,[],{cwd:process.cwd(),execArgv:[],
    env:{...process.env,FAE_TRIUM_IPC:managed?'1':'0',
      FAE_TRIUM_BLOCK_IPC_CANDIDATE:block?'1':'0',
      FAE_TRIUM_SIGNED_TX_IPC_CANDIDATE:'0',
      FAE_HOST:'127.0.0.1',FAE_PORT:String(p),
      FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_PEERS:'',
      FAE_BOOTSTRAP_FEEDS:'',FAE_DATA_FILE:join(dir,'state.json')},
    stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  try{
    await new Promise((yes,no)=>{
      let done=false,b='';
      const finish=error=>{
        if(done)return;done=true;clearTimeout(timer);
        child.off('exit',onExit);child.stdout.off('data',onData);
        error?no(error):yes();
      };
      const onExit=()=>finish(Error('original_node_early_exit'));
      const onData=data=>{
        b=(b+String(data)).slice(-8192);
        if(b.includes(' listening on http://127.0.0.1:'+p+' height='))
          finish();
      };
      const timer=setTimeout(()=>finish(Error('original_node_start_timeout')),15000);
      child.once('exit',onExit);child.stdout.on('data',onData);
    });
    return child;
  }catch(error){child.kill();throw error}
}
async function stop(child){
  if(!child)return;
  if(child.connected)child.disconnect();
  if(child.exitCode!==null||child.signalCode!==null)return;
  child.kill();
  await Promise.race([
    new Promise(yes=>child.once('exit',yes)),
    new Promise(yes=>setTimeout(()=>{try{child.kill('SIGKILL')}catch{}yes()},2000))
  ]);
}
let seq=0;
async function ask(child,op,params={},ms=5000){
  const id=++seq;
  return new Promise((yes,no)=>{
    let done=false;
    const finish=(error,result)=>{
      if(done)return;done=true;clearTimeout(timer);
      child.off('message',onMessage);child.off('exit',onExit);
      error?no(error):yes(result);
    };
    const onExit=()=>finish(Error('owner_child_exited'));
    const onMessage=packet=>{
      if(packet?.type!==REPLY||packet.session!==S||
         packet.network!==NETWORK||packet.request_id!==id||
         packet.ok!==true)return finish(Error('forged_original_node_receipt'));
      finish(null,packet.result);
    };
    const timer=setTimeout(()=>finish(Error('original_node_ipc_no_reply')),ms);
    child.on('message',onMessage);child.once('exit',onExit);
    if(!child.connected)return finish(Error('owner_channel_disconnected'));
    child.send({type:TYPE,session:S,network:NETWORK,
      request_id:id,op,params},e=>{if(e)finish(e)});
  });
}
async function originalMine(url,submit){
  const opts=resolveOptions({node:url,address:ADDRESS,once:true,json:true,
    'chunk-size':'4096','yield-ms':'0'},{});
  return runMiner(opts,{emit:()=>{},
    submitMinedBlock:async proof=>{
      assert.deepEqual(buildSubmission({header:proof.header,txids:proof.txids},
        proof.nonce,proof.hash),proof,'must be original Miner work');
      return submit(proof);
    }
  });
}
test('V53 disabled original-node block opcode fails closed without an admission flag',
  {timeout:30000},async()=>{
    const dir=await mkdtemp(join(tmpdir(),'trium-v53-block-off-'));
    let child;
    try{
      child=await start(dir,await port(),{block:false});
      seq=0;
      assert.equal((await ask(child,'status')).height,0);
      await assert.rejects(ask(child,'submit-mined-block',{
        submission:{header:{network:NETWORK,height:1,tx_count:0},
          nonce:0,hash:'a'.repeat(64),txids:[]}
      },300),/original_node_ipc_no_reply/);
      await assert.rejects(ask(child,'status',{},250),/original_node_ipc_no_reply/);
    }finally{await stop(child);await rm(dir,{recursive:true,force:true})}
  });
test('V53 original Miner -> ORIGINAL source-owner node IPC block -> original consensus persistence, HTTP denied, restart',
  {timeout:120000},async()=>{
    const dir=await mkdtemp(join(tmpdir(),'trium-v53-real-node-'));
    let child=null;
    try{
      const p=await port(),url='http://127.0.0.1:'+p;
      child=await start(dir,p,{block:true});
      seq=0;
      assert.equal((await ask(child,'status')).height,0);
      let denied=await fetch(url+'/submit-block',{
        method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      assert.equal(denied.status,403,'no managed HTTP block mutation with IPC enabled');
      let proof=null,ack=null;
      const mined=await originalMine(url,async submission=>{
        proof=submission;
        ack=await ask(child,'submit-mined-block',{submission},8000);
        assert.equal(ack.durable,true);
        assert.equal(ack.ok,true);
        assert.equal(ack.network,NETWORK);
        assert.equal(ack.hash,submission.hash);
        return ack;
      });
      assert.equal(mined.accepted,1);
      assert.ok(mined.totalHashes>0);
      assert.equal(ack.height,1);
      const observed=await ask(child,'status');
      assert.equal(observed.height,1);
      assert.equal(observed.tip_hash,proof.hash);
      const saved=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));
      assert.equal(saved.chain.length,1);
      assert.equal(saved.chain[0].hash,proof.hash);
      // Original consensus denies replay/stale tip; parent channel revoked.
      await assert.rejects(ask(child,'submit-mined-block',{submission:proof},350),
        /original_node_ipc_no_reply/);
      await assert.rejects(ask(child,'status',{},250),
        /original_node_ipc_no_reply/);
      await stop(child);child=null;
      const nextPort=await port();
      child=await start(dir,nextPort,{block:true});
      seq=0;
      const recovered=await ask(child,'status');
      assert.equal(recovered.height,1);
      assert.equal(recovered.tip_hash,proof.hash);
      denied=await fetch('http://127.0.0.1:'+nextPort+'/submit-block',{
        method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      assert.equal(denied.status,403);
      console.log('TS_V53_ORIGINAL_OWNER_SOURCE_BLOCK_IPC_PASS '+JSON.stringify({
        original_miner:true,original_node_source:true,
        original_consensus:true,os_inherited_channel:true,
        durable_block:true,http_block_mutation_denied:true,
        duplicate_block_rejected:true,cold_restart:true,
        signed_wallet:false,protected_owner_admission:false,
        installed_native_mining:false
      }));
    }finally{await stop(child);await rm(dir,{recursive:true,force:true})}
  });
test('V53 block-only flag outside managed source mode rejects startup',
  {timeout:15000},async()=>{
    const dir=await mkdtemp(join(tmpdir(),'trium-v53-flag-'));
    const child=fork(NODE,[],{execArgv:[],cwd:process.cwd(),env:{
      ...process.env,FAE_TRIUM_IPC:'0',FAE_TRIUM_BLOCK_IPC_CANDIDATE:'1',
      FAE_SYNC:'0',FAE_HOST:'127.0.0.1',FAE_PORT:'0',
      FAE_DATA_FILE:join(dir,'state.json')
    },stdio:['ignore','pipe','pipe','ipc']});
    try{
      let stderr='';child.stderr.on('data',x=>stderr+=String(x));
      const code=await Promise.race([
        new Promise(yes=>child.once('exit',yes)),
        new Promise((_,no)=>setTimeout(()=>no(Error('unsafe_flag_did_not_exit')),5000))
      ]);
      assert.notEqual(code,0);
      assert.match(stderr,/requires managed mode/);
    }finally{await stop(child);await rm(dir,{recursive:true,force:true})}
  });
