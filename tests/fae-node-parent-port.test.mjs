import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const SCRIPT=resolve('sovereign-forge/node/fae-node.mjs');
const TYPE='TRIUM_FAE_NODE_IPC_REQUEST_V1';
const REPLY='TRIUM_FAE_NODE_IPC_REPLY_V1';
const NETWORK='fairyelf-public-testnet-v4';
const A='a'.repeat(64),B='b'.repeat(64);
async function withNode(enabled,work){
  const dir=await mkdtemp(join(tmpdir(),'fae-v25-parent-ipc-'));
  const child=fork(SCRIPT,[],{cwd:process.cwd(),env:{
    ...process.env,FAE_TRIUM_IPC:enabled?'1':'0',FAE_SYNC:'0',
    FAE_UPSTREAM_API:'',FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:'',
    FAE_DATA_FILE:join(dir,'state.json'),FAE_PORT:'0',FAE_HOST:'127.0.0.1'
  },stdio:['ignore','ignore','pipe','ipc']});
  try{return await work(child)}
  finally{
    if(child.connected)child.disconnect();
    if(child.exitCode===null&&!child.killed)child.kill();
    await new Promise(resolve=>{
      if(child.exitCode!==null||child.signalCode!==null)return resolve();
      const t=setTimeout(resolve,3000);
      child.once('exit',()=>{clearTimeout(t);resolve()});
    });
    await rm(dir,{recursive:true,force:true});
  }
}
function call(child,packet,timeout=4500){
  return new Promise((resolve,reject)=>{
    let done=false;const finish=(err,data)=>{
      if(done)return;done=true;
      clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);
      if(err)reject(err);else resolve(data);
    };
    const onMessage=msg=>finish(null,msg);
    const onExit=()=>finish(Error('child_exited'));
    const timer=setTimeout(()=>finish(Error('no_original_node_ipc_response')),timeout);
    child.on('message',onMessage);child.on('exit',onExit);
    if(!child.connected)return finish(Error('no_inherited_parent_port'));
    child.send(packet,e=>{if(e)finish(e)});
  });
}
function req(session,request_id,op='status',params={}){
  return {type:TYPE,session,network:NETWORK,request_id,op,params};
}
test('real original FAE node answers over its own inherited OS IPC, not HTTP',async()=>{
  await withNode(true,async child=>{
    const status=await call(child,req(A,1));
    assert.equal(status.type,REPLY);
    assert.equal(status.session,A);
    assert.equal(status.network,NETWORK);
    assert.equal(status.ok,true);
    assert.equal(status.result.network,NETWORK);
    assert.equal(status.result.height,0);
    const next=await call(child,req(A,2));
    assert.equal(next.result.tip_hash,status.result.tip_hash);
  });
});
test('real original node refuses bogus address and revokes same process session',async()=>{
  await withNode(true,async child=>{
    const first=await call(child,req(A,1));
    assert.equal(first.result.height,0);
    await assert.rejects(call(child,req(A,2,'spendable',{address:'forged'}),250),/no_original_node_ipc_response/);
    await assert.rejects(call(child,req(A,3),250),/no_original_node_ipc_response/);
  });
});
test('original node rejects replay, changed session and wrong network',async()=>{
  for(const changed of [
    p=>({...p,request_id:1}),
    p=>({...p,session:B}),
    p=>({...p,network:'wrong-network'})
  ]){
    await withNode(true,async child=>{
      const one=await call(child,req(A,1));assert.equal(one.ok,true);
      await assert.rejects(call(child,changed(req(A,2)),300),/no_original_node_ipc_response/);
      await assert.rejects(call(child,req(A,3),200),/no_original_node_ipc_response/);
    });
  }
});
test('opt-in disabled standalone original node does not expose inherited IPC reads',async()=>{
  await withNode(false,async child=>{
    await assert.rejects(call(child,req(A,1),250),/no_original_node_ipc_response/);
  });
});
test('separate genuine node processes require independently owned IPC channels',async()=>{
  let former;
  await withNode(true,async child=>{
    former=child.pid;
    const a=await call(child,req(A,1));
    assert.equal(a.result.height,0);
  });
  await withNode(true,async child=>{
    assert.ok(child.pid>0);
    // Repeated PID values are possible on OSes; never use PID alone as a
    // session authenticator. Fresh process and fresh inherited channel matter.
    const b=await call(child,req(B,1));
    assert.equal(b.session,B);assert.equal(b.result.network,NETWORK);
    assert.ok(former>0);
  });
});
