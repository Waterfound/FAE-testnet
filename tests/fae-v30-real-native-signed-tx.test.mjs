// V30 candidate tests use ACTUAL original FAE v4 OS node processes.
// No wallet secrets, accepted spend, HTTP mutation, or product activation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const SCRIPT=resolve('sovereign-forge/node/fae-node.mjs');
const NETWORK='fairyelf-public-testnet-v4';
const TYPE='TRIUM_FAE_NODE_IPC_REQUEST_V1';
const REPLY='TRIUM_FAE_NODE_IPC_REPLY_V1';
const SESSION='a'.repeat(64),TXID='b'.repeat(64);
const RECIPIENT='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
const badSignedTx=Object.freeze({
  version:2,network:NETWORK,inputs:['unfunded:0'],
  outputs:[{address:RECIPIENT,amount_atoms:'1'}],
  public_key_spki:'invalid_test_key',signature:'invalid_test_signature'
});
async function withNode(nativeTx,fn){
  const dir=await mkdtemp(join(tmpdir(),'fae-v30-real-native-signed-'));
  const child=fork(SCRIPT,[],{cwd:process.cwd(),
    env:{...process.env,FAE_TRIUM_IPC:'1',
      FAE_TRIUM_SIGNED_TX_IPC_CANDIDATE:nativeTx?'1':'0',
      FAE_SYNC:'0',FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:'',
      FAE_DATA_FILE:join(dir,'state.json'),
      FAE_PORT:'0',FAE_HOST:'127.0.0.1'},
    stdio:['ignore','pipe','pipe','ipc']});
  try{
    await new Promise((yes,no)=>{
      let buff='',done=false;const finish=e=>{
        if(done)return;done=true;clearTimeout(timer);child.stdout.off('data',onData);
        child.off('exit',onExit);e?no(e):yes();
      };
      const onData=x=>{
        buff+=String(x);if(buff.length>8192)buff=buff.slice(-8192);
        if(buff.includes(' listening on http://127.0.0.1:0 height='))finish();
      };
      const onExit=()=>finish(Error('original_fae_node_exited_before_ready'));
      const timer=setTimeout(()=>finish(Error('original_fae_node_startup_timeout')),7000);
      child.stdout.on('data',onData);child.once('exit',onExit);
    });
    return await fn(child,dir);
  }finally{
    if(child.connected)child.disconnect();
    if(child.exitCode===null&&!child.killed)child.kill();
    await new Promise(done=>{
      if(child.exitCode!==null||child.signalCode!==null)return done();
      const timer=setTimeout(done,2500);
      child.once('exit',()=>{clearTimeout(timer);done()});
    });
    await rm(dir,{recursive:true,force:true});
  }
}
function ask(child,seq,op,params={},timeout=600){
  return new Promise((resolveAnswer,rejectAnswer)=>{
    let done=false;const finish=(e,r)=>{
      if(done)return;done=true;clearTimeout(timer);
      child.off('message',reply);child.off('exit',gone);
      e?rejectAnswer(e):resolveAnswer(r);
    };
    const reply=data=>finish(null,data);
    const gone=()=>finish(Error('original_node_exited'));
    const timer=setTimeout(()=>finish(Error('native_ipc_no_response')),timeout);
    child.on('message',reply);child.once('exit',gone);
    if(!child.connected)return finish(Error('original_node_port_disconnected'));
    child.send({type:TYPE,session:SESSION,network:NETWORK,request_id:seq,op,params},
      err=>{if(err)finish(err)});
  });
}
test('real original node exposes TXID lookup on inherited OS IPC without signing',async()=>{
  await withNode(false,async child=>{
    const status=await ask(child,1,'status');
    assert.equal(status.type,REPLY);assert.equal(status.result.network,NETWORK);
    const unknown=await ask(child,2,'transaction-lookup',{txid:TXID});
    assert.equal(unknown.ok,true);
    assert.deepEqual(unknown.result,{
      ok:true,network:NETWORK,txid:TXID,found:false,
      status:null,confirmed_height:null,tip_height:0,
      tip_hash:'0'.repeat(64)
    });
    const again=await ask(child,3,'status');
    assert.equal(again.result.mempool_size,0);
  });
});
test('real original node denies native signed submission without independent explicit mutation opt-in',async()=>{
  await withNode(false,async child=>{
    assert.equal((await ask(child,1,'status')).ok,true);
    await assert.rejects(ask(child,2,'submit-signed-tx',{tx:badSignedTx},250),
      /native_ipc_no_response/);
    await assert.rejects(ask(child,3,'status',{},250),/native_ipc_no_response/);
  });
});
test('real original node validates signed mutation using original FAE consensus before ACK',async()=>{
  await withNode(true,async child=>{
    assert.equal((await ask(child,1,'status')).result.mempool_size,0);
    // Valid envelope but intentionally invalid cryptographic signature.
    // Rejection must not grant an accepted-spend acknowledgement.
    await assert.rejects(ask(child,2,'submit-signed-tx',{tx:badSignedTx},300),
      /native_ipc_no_response/);
    await assert.rejects(ask(child,3,'transaction-lookup',{txid:TXID},200),
      /native_ipc_no_response/);
  });
});
test('native signed mutation requires opt-in managed-mode original FAE node',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fae-v30-dual-flag-'));
  const child=fork(SCRIPT,[],{cwd:process.cwd(),env:{
    ...process.env,FAE_TRIUM_IPC:'0',FAE_TRIUM_SIGNED_TX_IPC_CANDIDATE:'1',
    FAE_SYNC:'0',FAE_HOST:'127.0.0.1',FAE_PORT:'0',
    FAE_DATA_FILE:join(dir,'state.json')
  },stdio:['ignore','pipe','pipe','ipc']});
  try{
    let stderr='';child.stderr.on('data',x=>{stderr+=String(x)});
    const code=await Promise.race([
      new Promise(yes=>child.once('exit',yes)),
      new Promise((_,no)=>setTimeout(()=>no(Error('original_node_failed_to_exit')),6000))
    ]);
    assert.notEqual(code,0);
    assert.match(stderr,/requires managed mode/);
  }finally{
    if(child.exitCode===null&&!child.killed)child.kill();
    await rm(dir,{recursive:true,force:true});
  }
});
