'use strict';
// Real Electron utilityProcess + actual ProcessController + source-pinned
// original FAE node. Ephemeral read-only CI candidate; no GUI signer or tx.
const {app,utilityProcess}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ProcessController}=require('../src/controller.cjs');
const {makeUtilitySpawn}=require('../src/utility-process-adapter.cjs');
const OWNER_PINS=require('../test/v29-original-node-owner-pins.cjs');
const root=process.env.TS_V27_ORIGINAL_NODE_ROOT;
if(!root||!path.isAbsolute(root))throw Error('Pinned owner source root required');
const original=path.join(root,'sovereign-forge','node','fae-node.mjs');
const handler=path.join(root,'sovereign-forge','node','node-parent-port.mjs');
if(!fs.existsSync(original)||!fs.existsSync(handler))
  throw Error('Original protected candidate source closure unavailable');
(async()=>{
  await app.whenReady();
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-v27-electron-controller-'));
  const controller=new ProcessController({
    repoRoot:root,dataDir:dir,
    spawnFn:makeUtilitySpawn(utilityProcess.fork.bind(utilityProcess)),
    nativeIpcCandidate:true,
    nativeNodeSourcePins:OWNER_PINS
  });
  const stopTimeout=setTimeout(()=>{
    console.error('TS_V27_ELECTRON_CONTROLLER_IPC_TIMEOUT');
    app.exit(3);
  },42000);
  let code=1;
  try{
    const first=await controller.startNode();
    assert.equal(first.node,'running');
    const firstIpc=controller.nodeIpc;
    assert.equal((await controller.readStatus()).network,'fairyelf-public-testnet-v4');
    // Managed original node V29: native OS IPC must coexist with browser-origin
    // rejection at its legacy HTTP surface. An unrelated local process is
    // still NOT authenticated by this check; signer/submit remain unavailable.
    const browserAttempt=await fetch(controller.endpoint+'/status',{
      headers:{Origin:'https://untrusted.invalid'},
      signal:AbortSignal.timeout(3000)
    });
    assert.equal(browserAttempt.status,403);
    assert.equal(browserAttempt.headers.get('access-control-allow-origin'),null);
    const address='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
    assert.equal((await controller.readBalance(address)).balance_atoms,'0');
    const funding=await controller.readFundingCandidates(address);
    assert.equal(funding.funding_authorization,'DENIED_UNVERIFIED');
    assert.equal(funding.eligible_candidate_count,0);
    await assert.rejects(controller.readExplorer('/explorer/status'),/HTTP fallback forbidden/);
    await assert.rejects(firstIpc.read('submit-tx'),/Unsupported native IPC read/);
    await controller.stopNode();
    assert.equal(firstIpc.revoked,true);
    const second=await controller.startNode();
    assert.equal(second.node,'running');
    assert.notEqual(controller.nodeIpc.session,firstIpc.session);
    assert.equal((await controller.readStatus()).height,0);
    console.log('TS_V27_ELECTRON_CONTROLLER_IPC_PASS '+JSON.stringify({
      node:'ORIGINAL_FAE_V4',transport:'ACTUAL_ELECTRON_UTILITY_PROCESS',
      status:true,balance:true,funding:true,session_revoked:true,
      cold_restart:true,managed_browser_origin:'DENIED',explorer_http_fallback:'DENIED',
      signer:'DISABLED',submission:'DISABLED'
    }));
    code=0;
  }catch(error){
    console.error('TS_V27_ELECTRON_CONTROLLER_IPC_FAIL '+error.message);
  }finally{
    clearTimeout(stopTimeout);
    try{await controller.dispose()}catch{code=1}
    fs.rmSync(dir,{recursive:true,force:true});
    app.exit(code);
  }
})().catch(error=>{console.error('TS_V27_ELECTRON_CONTROLLER_FATAL '+error.message);app.exit(1)});
