'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const path=require('node:path');
const http=require('node:http');
const {OwnedNodeIpc}=require('../src/owned-node-ipc.cjs');
const fixture=path.join(__dirname,'fixtures','owned-ipc-child.cjs');
function childFor(mode='good'){
  return fork(fixture,[],{env:{...process.env,IPC_FIXTURE_MODE:mode},
    stdio:['ignore','ignore','ignore','ipc']});
}
async function withChild(mode,callback){
  const child=childFor(mode);
  try{return await callback(child)}
  finally{
    if(child.connected)child.disconnect();
    if(child.exitCode===null)child.kill();
  }
}
test('actual separate OS child IPC succeeds without relying on an HTTP endpoint',async()=>{
  await withChild('good',async child=>{
    const attacker=http.createServer((req,res)=>{
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({ok:true,process_authenticated:true,network:'wrong-network'}));
    });
    await new Promise(resolve=>attacker.listen(0,'127.0.0.1',resolve));
    try{
      const ipc=new OwnedNodeIpc(child);
      assert.equal((await ipc.read('status')).source,'REAL_CHILD_OS_IPC_FIXTURE_ONLY');
      assert.equal((await ipc.read('status')).height,1);
      await assert.rejects(ipc.read('submit-signed'),/Unsupported native IPC read/);
      ipc.revoke();
      await assert.rejects(ipc.read('status'),/unavailable/);
    }finally{await new Promise(resolve=>attacker.close(resolve))}
  });
});
for(const [mode,pattern] of [
  ['wrong-session',/Unauthenticated/],
  ['wrong-network',/Unauthenticated/],
  ['replay',/Stale or replayed/]
]){
  test('rejects '+mode+' from the child rather than trusting claimed status',async()=>{
    await withChild(mode,async child=>{
      const ipc=new OwnedNodeIpc(child);
      await assert.rejects(ipc.read('status'),pattern);
      await assert.rejects(ipc.read('status'),/unavailable/);
    });
  });
}
test('process death revokes a pending IPC operation',async()=>{
  await withChild('die',async child=>{
    const ipc=new OwnedNodeIpc(child,{timeoutMs:800});
    await assert.rejects(ipc.read('status'),/exited or disconnected|send failed/);
    await assert.rejects(ipc.read('status'),/unavailable/);
  });
});
test('IPC timeout is fail-closed and never retries state-changing commands',async()=>{
  await withChild('hang',async child=>{
    const ipc=new OwnedNodeIpc(child,{timeoutMs:80});
    await assert.rejects(ipc.read('status'),/timeout/);
    await assert.rejects(ipc.read('status'),/unavailable/);
  });
});
