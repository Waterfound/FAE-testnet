'use strict';
// V27 owner-bound original-node integration candidate: no signer, no submit.
// Native IPC mode stays explicitly disabled in ordinary Universal Client.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {fork}=require('node:child_process');
const {ProcessController}=require('../src/controller.cjs');
const ADDRESS='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
const root=path.resolve(__dirname,'..','..');
const ownerRoot=process.env.TS_V27_ORIGINAL_NODE_ROOT;
function forkWithNativePort(_exe,args,opts){
  return fork(args[0],args.slice(1),{
    cwd:opts.cwd,env:opts.env,windowsHide:true,
    stdio:['ignore','pipe','ignore','ipc']
  });
}
function disposable(){
  return fs.mkdtempSync(path.join(os.tmpdir(),'trium-v27-ipc-controller-'));
}
function clean(dir){fs.rmSync(dir,{recursive:true,force:true})}
test('native IPC is never silently enabled on an unmodified original node',async()=>{
  const dir=disposable();
  const c=new ProcessController({repoRoot:root,dataDir:dir,
    spawnFn:forkWithNativePort,nativeIpcCandidate:true});
  try{
    await assert.rejects(c.startNode(),/IPC|readiness|channel|timeout|not ready/i);
    assert.notEqual(c.snapshot().node,'running');
    assert.equal(c.nodeIpc,null,'failed channel cannot retain IPC authority');
  }finally{
    await c.dispose().catch(()=>{});
    clean(dir);
  }
});
test('original FAE PR #354 node + actual ProcessController reads and cold restarts using inherited IPC',
  {skip:!ownerRoot,timeout:45000},async()=>{
    const expected=path.join(ownerRoot,'sovereign-forge','node','fae-node.mjs');
    assert.ok(fs.existsSync(expected),'Source owner node exact path must exist');
    assert.ok(fs.existsSync(path.join(ownerRoot,'sovereign-forge','node','node-parent-port.mjs')));
    const dir=disposable();
    const c=new ProcessController({repoRoot:ownerRoot,dataDir:dir,
      spawnFn:forkWithNativePort,nativeIpcCandidate:true});
    try{
      const first=await c.startNode();
      assert.equal(first.node,'running');
      assert.equal(c.nodeIpc?.revoked,false);
      const child=c.node,oldIpc=c.nodeIpc;
      assert.equal((await c.readStatus()).network,'fairyelf-public-testnet-v4');
      const bal=await c.readBalance(ADDRESS);
      assert.equal(bal.balance_atoms,'0');
      assert.equal(bal.observed_tip_height,0);
      const candidates=await c.readFundingCandidates(ADDRESS);
      assert.equal(candidates.funding_authorization,'DENIED_UNVERIFIED');
      assert.equal(candidates.eligible_candidate_atoms,'0');
      assert.equal(candidates.observed_tip_height,0);
      // No signer/submission is present on the authenticated read-only channel.
      await assert.rejects(oldIpc.read('submit-tx',{tx:{}}),/Unsupported native IPC read/);
      await c.stopNode();
      assert.equal(oldIpc.revoked,true);
      await assert.rejects(oldIpc.read('status'),/unavailable/);
      assert.notEqual(c.node,child);
      const second=await c.startNode();
      assert.equal(second.node,'running');
      assert.notEqual(c.nodeIpc,oldIpc);
      assert.notEqual(c.nodeIpc.session,oldIpc.session);
      assert.equal((await c.readStatus()).height,0);
      await c.stopNode();
      assert.equal(c.nodeIpc,null);
      console.log('TS_V27_CONTROLLER_ORIGINAL_IPC_PASS '+JSON.stringify({
        original_node:true,owned_process:true,ipc_status:true,ipc_balance:true,
        ipc_funding:true,stop_revocation:true,cold_restart:true,
        fresh_session:true,signer:'DISABLED',submission:'DISABLED'
      }));
    }finally{await c.dispose().catch(()=>{});clean(dir)}
});
