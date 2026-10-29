'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {makeUtilitySpawn}=require('../src/utility-process-adapter.cjs');
const {OwnedNodeIpc,REPLY,NETWORK}=require('../src/owned-node-ipc.cjs');
test('Electron utilityProcess port supports native parent-half IPC without HTTP',async()=>{
  const utility=new EventEmitter();
  utility.pid=77123;utility.stdout=null;utility.kill=()=>true;
  utility.postMessage=message=>queueMicrotask(()=>utility.emit('message',{
    type:REPLY,network:NETWORK,session:message.session,
    request_id:message.request_id,ok:true,
    result:{os_process_port:true,network:NETWORK}
  }));
  const child=makeUtilitySpawn(()=>utility)('/unused',['/trusted/fae-node.mjs'],{
    cwd:'/trusted',env:{},stdio:['ignore','pipe','ignore']
  });
  assert.equal(child.pid,77123);
  assert.equal(child.connected,true);
  const channel=new OwnedNodeIpc(child);
  assert.deepEqual(await channel.read('status'),{os_process_port:true,network:NETWORK});
  await assert.rejects(channel.read('submit-signed'),/Unsupported native IPC read/);
  utility.emit('exit',0);
  assert.equal(child.connected,false);
  await assert.rejects(channel.read('status'),/unavailable/);
});
test('mining process never gains the privileged node IPC sender',()=>{
  const utility=new EventEmitter();
  utility.pid=77124;utility.stdout=null;utility.kill=()=>true;
  utility.postMessage=()=>{throw Error('miner must not receive node IPC')};
  const miner=makeUtilitySpawn(()=>utility)('/unused',['/trusted/fae-miner.mjs'],{
    cwd:'/trusted',env:{},stdio:['ignore','pipe','ignore']
  });
  assert.equal(miner.send,undefined);
  assert.throws(()=>new OwnedNodeIpc(miner),/OS-owned connected child IPC channel required/);
  utility.emit('exit',0);
});
