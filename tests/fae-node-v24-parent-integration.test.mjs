import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const require=createRequire(import.meta.url);
const parentSource=process.env.TS_EXACT_CLIENT_PARENT_FILE;
if(!parentSource||!parentSource.endsWith('/owned-node-ipc.cjs')&&!parentSource.endsWith('\\owned-node-ipc.cjs'))
  throw Error('Source-pinned V24 parent IPC module is mandatory for real integration');
const {OwnedNodeIpc}=require(resolve(parentSource));
const nodeSource=resolve('sovereign-forge/node/fae-node.mjs');
const address='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
async function withActualNode(work){
 const dir=await mkdtemp(join(tmpdir(),'fae-original-v25-client-parent-'));
 const child=fork(nodeSource,[],{cwd:process.cwd(),env:{
   ...process.env,FAE_TRIUM_IPC:'1',FAE_SYNC:'0',FAE_UPSTREAM_API:'',
   FAE_BOOTSTRAP_FEEDS:'',FAE_PEERS:'',FAE_PORT:'0',
   FAE_HOST:'127.0.0.1',FAE_DATA_FILE:join(dir,'state.json')
 },stdio:['ignore','pipe','pipe','ipc']});
 try{
   await new Promise((resolveReady,rejectReady)=>{
      let buffer='',done=false;
      const timer=setTimeout(()=>finish(Error('node_start_timeout')),6000);
      const onExit=()=>finish(Error('node_exited'));
      const onData=data=>{
        buffer+=String(data);
        if(buffer.length>8192)buffer=buffer.slice(-8192);
        if(buffer.includes(' listening on http://127.0.0.1:0 height='))finish();
      };
      function finish(error){
        if(done)return;done=true;clearTimeout(timer);
        child.stdout.off('data',onData);child.off('exit',onExit);
        if(error)rejectReady(error);else resolveReady();
      }
      child.on('exit',onExit);child.stdout.on('data',onData);
   });
   return await work(child);
 }finally{
   if(child.connected)child.disconnect();
   if(child.exitCode===null&&!child.killed)child.kill();
   await new Promise(done=>{
     if(child.exitCode!==null||child.signalCode!==null)return done();
     const timer=setTimeout(done,3000);
     child.once('exit',()=>{clearTimeout(timer);done()});
   });
   await rm(dir,{recursive:true,force:true});
 }
}
test('source-exact V24 parent authenticates real original FAE child status and funding over inherited IPC',async()=>{
 await withActualNode(async child=>{
   const ipc=new OwnedNodeIpc(child,{timeoutMs:3000});
   try{
     const status=await ipc.read('status');
     assert.equal(status.network,'fairyelf-public-testnet-v4');
     assert.equal(status.height,0);
     const funds=await ipc.read('spendable',{address});
     assert.equal(funds.address,address);
     assert.equal(funds.spendable_atoms,'0');
     const balance=await ipc.read('balance',{address});
     assert.equal(balance.balance_atoms,'0');
     await assert.rejects(ipc.read('submit-tx',{tx:{}}),/Unsupported native IPC read/);
   }finally{ipc.revoke()}
 });
});
test('source-exact parent revokes actual original-node session after child exit',async()=>{
 await withActualNode(async child=>{
   const ipc=new OwnedNodeIpc(child,{timeoutMs:3000});
   const first=await ipc.read('status');assert.equal(first.height,0);
   child.kill();
   await new Promise(resolve=>child.once('exit',resolve));
   await assert.rejects(ipc.read('status'),/unavailable/);
 });
});
