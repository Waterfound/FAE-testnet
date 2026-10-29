'use strict';
// Disposable real Electron utilityProcess -> original FAE node IPC acceptance.
// No GUI renderer, private wallet secrets, public funds or HTTP trust shortcut.
const {app,utilityProcess}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const node=process.env.TS_V25_ORIGINAL_NODE;
const parent=process.env.TS_EXACT_CLIENT_PARENT_FILE;
const adapter=process.env.TS_EXACT_CLIENT_ADAPTER_FILE;
if(![node,parent,adapter].every(v=>typeof v==='string'&&path.isAbsolute(v)))
  throw Error('Pinned original node and V24 client source paths required');
const {OwnedNodeIpc}=require(parent);
const {makeUtilitySpawn}=require(adapter);
(async()=>{
  await app.whenReady();
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ts-v25-electron-real-node-'));
  let child,ipc,exitCode=0;
  const fail=setTimeout(()=>{console.error('TS_V25_ELECTRON_ORIGINAL_NODE_IPC_TIMEOUT');app.exit(2)},20000);
  try{
    const spawn=makeUtilitySpawn(utilityProcess.fork.bind(utilityProcess));
    child=spawn(process.execPath,[node],{
      cwd:path.dirname(node),stdio:['ignore','pipe','ignore'],env:{
        ...process.env,FAE_TRIUM_IPC:'1',FAE_SYNC:'0',FAE_UPSTREAM_API:'',
        FAE_PEERS:'',FAE_BOOTSTRAP_FEEDS:'',FAE_HOST:'127.0.0.1',
        FAE_PORT:'0',FAE_DATA_FILE:path.join(temp,'state.json')
      }
    });
    await new Promise((resolve,reject)=>{
      let ready=false,buffer='';
      const timer=setTimeout(()=>end(Error('Real original node did not bind')),9000);
      const onExit=()=>end(Error('Original node exited before readiness'));
      const onData=data=>{
        buffer+=String(data);
        if(buffer.length>8192)buffer=buffer.slice(-8192);
        if(buffer.includes(' listening on http://127.0.0.1:0 height='))end();
      };
      function end(error){
        if(ready)return;ready=true;clearTimeout(timer);
        child.stdout?.off('data',onData);child.off('exit',onExit);
        if(error)reject(error);else resolve();
      }
      child.on('exit',onExit);child.stdout?.on('data',onData);
    });
    assert.ok(Number.isSafeInteger(child.pid)&&child.pid>0);
    assert.equal(child.connected,true);
    ipc=new OwnedNodeIpc(child,{timeoutMs:4500});
    const status=await ipc.read('status');
    assert.equal(status.network,'fairyelf-public-testnet-v4');
    assert.equal(status.height,0);
    const address='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
    const funding=await ipc.read('spendable',{address});
    assert.equal(funding.spendable_atoms,'0');
    assert.equal(funding.address,address);
    await assert.rejects(ipc.read('submit-tx',{tx:{}}),/Unsupported native IPC read/);
    console.log('TS_V25_ELECTRON_ORIGINAL_NODE_IPC_PASS '+JSON.stringify({
      original_node:true,os_process_pid:child.pid>0,inherited_port:true,
      status_ipc:true,spendable_ipc:true,tx_submission:'DISABLED',
      network:status.network
    }));
  }catch(e){
    console.error('TS_V25_ELECTRON_ORIGINAL_NODE_IPC_FAIL '+e.message);
    exitCode=1;
  }finally{
    clearTimeout(fail);ipc?.revoke();
    try{child?.kill()}catch{}
    try{fs.rmSync(temp,{recursive:true,force:true})}catch{}
    app.exit(exitCode);
  }
})().catch(e=>{console.error('TS_V25_ELECTRON_ORIGINAL_NODE_IPC_FATAL '+e.message);app.exit(1)});
