'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {ProcessController,makeEnv,addressValid,explorerUrl,NETWORK}=require('../src/controller.cjs');
const root=path.resolve(__dirname,'..','..');
const ADDRESS='faet1'+'q'.repeat(38);
test('cannot dispatch privileged API routes or arbitrary address strings',()=>{
  assert.throws(()=>explorerUrl('/submit-block'),/Forbidden/);
  assert.throws(()=>explorerUrl('/explorer/blocks',{permission:'unsafe'}),/Forbidden/);
  assert.throws(()=>explorerUrl('/explorer/transaction',{txid:'not-a-digest'}),/digest/);
  assert.throws(()=>addressValid('--node /etc/shadow'),/Invalid public/);
  assert.equal(addressValid(ADDRESS),ADDRESS);
});
test('node/miner subprocess environment strips credential-bearing variables',()=>{
  process.env.TS_CANARY_SECRET='should-not-pass-through';
  const actual=makeEnv({FAE_SYNC:'0'});
  assert.equal(actual.TS_CANARY_SECRET,undefined);
  assert.equal(actual.FAE_SYNC,'0');
  delete process.env.TS_CANARY_SECRET;
});
test('miner telemetry only admits known typed state and nonnegative counters',()=>{
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir()});
  c.ingestMiner(JSON.stringify({state:'MINING',hashrate_hs:19,total_hashes:143,seed_phrase:'not-projected'}));
  assert.equal(c.snapshot().telemetry.hashrate_hs,19);
  assert.equal(c.snapshot().telemetry.seed_phrase,undefined);
  c.ingestMiner(JSON.stringify({state:'MINING',hashrate_hs:-2,accepted:'5'}));
  assert.equal(c.snapshot().telemetry.hashrate_hs,19);
  assert.equal(c.snapshot().telemetry.accepted,null);
  c.ingestMiner(JSON.stringify({state:'EXEC_SHELL',hashrate_hs:400}));
  assert.equal(c.snapshot().telemetry.state,'MINING');
});
test('independent validating node is real, loopback-only, read-only via Explorer, and stoppable',async t=>{
  const nodePath=path.join(root,'sovereign-forge','node','fae-node.mjs');
  if(!fs.existsSync(nodePath))return t.skip('FAE node source absent: standalone GUI-only archive');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-client-node-'));
  const c=new ProcessController({repoRoot:root,dataDir:dir,nodeExecutable:process.execPath,nodeMode:false});
  try{
    const a=await c.startNode();
    assert.equal(a.node,'running');
    const status=await c.readStatus();
    assert.equal(status.ok,true);assert.equal(status.network,NETWORK);
    assert.equal(status.height,0);
    const explorer=await c.readExplorer('/explorer/status');
    assert.equal(explorer.network,NETWORK);
    assert.equal(explorer.observed_tip_height,0);
    assert.match(explorer.observed_tip_hash,/^[0-9a-f]{64}$/);
    const rewardAddress='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
    const activity=await c.readExplorer('/explorer/address',{address:rewardAddress,limit:20});
    assert.equal(activity.address,rewardAddress);
    assert.equal(activity.network,NETWORK);
    assert.equal(activity.observed_tip_height,0);
    assert.equal(activity.balance_atoms,'0');
    assert.deepEqual(activity.events,[]);
    assert.equal(activity.total_events,0);
    await assert.rejects(()=>c.readBalance(ADDRESS),/HTTP 400|invalid/i);
    await c.stopNode();
    assert.equal(c.snapshot().node,'stopped');
    await assert.rejects(()=>c.readStatus(),/not ready or not owned/);
  }finally{
    await c.dispose().catch(()=>{});
    fs.rmSync(dir,{recursive:true,force:true});
  }
});


test('desktop controller starts real standalone miner, reports real hashrate and stops cleanly',
  {timeout:30000},async t=>{
  if(!fs.existsSync(path.join(root,'sovereign-forge','node','fae-node.mjs'))||
     !fs.existsSync(path.join(root,'standalone','fae-miner.mjs')))
    return t.skip('Canonical node or miner missing');
  // Public address from the existing standalone miner integration fixture. No seed or signer.
  const publicReward='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-client-miner-'));
  const c=new ProcessController({repoRoot:root,dataDir:dir,nodeExecutable:process.execPath});
  let timer;
  try{
    const node=await c.startNode();
    assert.equal(node.node,'running');
    const ready=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(Error('No authentic miner hashrate within bounded test interval')),17000);
      const observe=sample=>{
        const telemetry=sample?.telemetry;
        if(sample?.miner==='running'&&telemetry?.state==='MINING'&&
           Number.isSafeInteger(telemetry.hashrate_hs)&&telemetry.hashrate_hs>0){
          clearTimeout(timer);
          c.off('state',observe);
          resolve(telemetry);
        }
      };
      c.on('state',observe);
    });
    await c.startMiner(publicReward);
    const metrics=await ready;
    assert.ok(metrics.hashrate_hs>0);
    assert.ok(Number.isSafeInteger(metrics.total_hashes)&&metrics.total_hashes>0);
    assert.equal((await c.readStatus()).network,NETWORK);
    await c.stopMiner();
    assert.equal(c.snapshot().miner,'stopped');
    assert.equal(c.snapshot().telemetry.state,'STOPPED');
    assert.equal(c.snapshot().telemetry.hashrate_hs,null);
    assert.equal(c.snapshot().node,'running','Stopping miner cannot shut down node');
  }finally{
    clearTimeout(timer);
    await c.dispose().catch(()=>{});
    fs.rmSync(dir,{recursive:true,force:true});
  }
});


test('spontaneous miner exit invalidates stale operational hashrate immediately',()=>{
  const {EventEmitter}=require('node:events');
  const child=new EventEmitter();
  child.exitCode=null;child.killed=false;child._tsFailed=false;
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir(),spawnFn:()=>child});
  c.miner=c.spawnScript(path.join(root,'standalone','fae-miner.mjs'),[]);
  c.ingestMiner(JSON.stringify({state:'MINING',hashrate_hs:999,total_hashes:3000,accepted:2}));
  assert.equal(c.snapshot().telemetry.hashrate_hs,999);
  const before=c.snapshot().miner;
  assert.equal(before,'running');
  child.exitCode=1;child.emit('exit',1);
  assert.equal(c.snapshot().miner,'stopped');
  assert.equal(c.snapshot().telemetry.state,'STOPPED');
  assert.equal(c.snapshot().telemetry.hashrate_hs,null);
  assert.equal(c.snapshot().telemetry.accepted,2,'Do not erase observed accepted count');
});

test('per-session loopback port propagates to node instead of static port',async()=>{
  const {EventEmitter}=require('node:events');
  const {mkdtemp,rm}=require('node:fs/promises');
  const dir=await mkdtemp(path.join(os.tmpdir(),'ts-client-port-'));
  const attempts=[],child=new EventEmitter();child.exitCode=null;child.killed=false;child._tsFailed=false;
  child.kill=()=>{child.killed=true;setImmediate(()=>{child.exitCode=0;child.emit('exit',0)});return true};
  const c=new ProcessController({repoRoot:root,dataDir:dir,port:43179,
    portProbe:async p=>attempts.push(['port',p]),
    listenEvidence:async()=>attempts.push(['process-listening']),
    spawnFn:(_exec,args,opts)=>{attempts.push(['spawn',args,opts]);return child},
    readinessProbe:async()=>({ok:true,network:NETWORK,height:0,tip_hash:'0'.repeat(64)})});
  try{
    assert.equal(c.endpoint,'http://127.0.0.1:43179');
    assert.equal((await c.startNode()).node,'running');
    assert.deepEqual(attempts[0],['port',43179]);
    assert.equal(attempts[1][2].env.FAE_PORT,'43179');
    assert.equal(attempts[1][2].env.FAE_HOST,'127.0.0.1');
    assert.equal(new URL(explorerUrl('/explorer/status',{},c.endpoint)).port,'43179');
    assert.notEqual(c.endpoint,'http://127.0.0.1:8787');
  }finally{await c.dispose();await rm(dir,{recursive:true,force:true})}
});
test('invalid managed node ports reject early',()=>{
  for(const port of [0,-1,80,65536,1.2,NaN])
    assert.throws(()=>new ProcessController({repoRoot:root,dataDir:os.tmpdir(),port}),/Invalid managed node port/);
});


test('node crash revokes running miner and stale hashrate, without changing testnet source',async()=>{
  const {EventEmitter}=require('node:events');
  const makeChild=()=>{
    const child=new EventEmitter();
    child.exitCode=null;child.killed=false;child._tsFailed=false;child.killCalls=0;
    child.kill=()=>{
      child.killCalls++;child.killed=true;
      setImmediate(()=>{child.exitCode=0;child.emit('exit',0)});
      return true;
    };
    return child;
  };
  const spawned=[];
  const c=new ProcessController({
    repoRoot:root,dataDir:os.tmpdir(),
    spawnFn:()=>{const child=makeChild();spawned.push(child);return child}
  });
  c.node=c.spawnScript(path.join(root,'sovereign-forge','node','fae-node.mjs'),[]);
  c.miner=c.spawnScript(path.join(root,'standalone','fae-miner.mjs'),[]);
  const miner=spawned[1],node=spawned[0];
  c.ingestMiner(JSON.stringify({state:'MINING',hashrate_hs:125,total_hashes:300}));
  assert.equal(c.snapshot().miner,'running');
  assert.equal(c.snapshot().telemetry.hashrate_hs,125);
  node.exitCode=17;node.emit('exit',17);
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(c.snapshot().node,'stopped');
  assert.equal(c.snapshot().miner,'stopped');
  assert.equal(c.snapshot().telemetry.state,'STOPPED');
  assert.equal(c.snapshot().telemetry.hashrate_hs,null);
  assert.equal(miner.killCalls,1,'Owned dependent miner must be killed exactly once');
});

test('existing malformed node disk state fails before launch and remains unchanged',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-persisted-state-'));
  const nodeDir=path.join(dir,'node'),file=path.join(nodeDir,'state.json');
  fs.mkdirSync(nodeDir,{recursive:true});
  const corrupt='{"format": "FAE_NODE_STATE_V1", "chain": [';
  fs.writeFileSync(file,corrupt);
  let launches=0;
  const c=new ProcessController({repoRoot:root,dataDir:dir,spawnFn:()=>{launches++;throw Error('unsafe launch')}});
  try{
    await assert.rejects(()=>c.startNode(),/corrupt; refused empty-chain restart/);
    assert.equal(launches,0);
    assert.equal(fs.readFileSync(file,'utf8'),corrupt);
    assert.equal(c.snapshot().node,'stopped');
    fs.writeFileSync(file,JSON.stringify({format:'FAE_NODE_STATE_V1',network:'attacker',chain:[],transactions:{}}));
    await assert.rejects(()=>c.startNode(),/invalid format or network/);
    assert.equal(launches,0);
  }finally{await c.dispose();fs.rmSync(dir,{recursive:true,force:true})}
});


test('interrupted node write leaves evidence untouched and refuses automatic restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-partial-node-'));
  const nodeDir=path.join(dir,'node'),file=path.join(nodeDir,'state.json');
  fs.mkdirSync(nodeDir,{recursive:true});
  const prior={format:'FAE_NODE_STATE_V1',network:NETWORK,chain:[],transactions:{},
    mempoolOrder:[],mempoolSeq:0,utxos:{},mempoolSpends:{},mempoolOutputs:{}};
  fs.writeFileSync(file,JSON.stringify(prior));
  fs.writeFileSync(file+'.tmp','{"partial":');
  let called=0;
  const controller=new ProcessController({repoRoot:root,dataDir:dir,spawnFn:()=>{called++;throw Error('Must not launch')}});
  try{
    await assert.rejects(()=>controller.startNode(),/Unresolved FAE node temporary state/);
    assert.equal(called,0);
    assert.equal(fs.readFileSync(file+'.tmp','utf8'),'{"partial":');
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),prior);
    fs.rmSync(file+'.tmp');
    // Cold start from the unchanged, well-formed canonical FAE v4 state.
    const real=new ProcessController({repoRoot:root,dataDir:dir,nodeExecutable:process.execPath});
    try{
      const started=await real.startNode();
      assert.equal(started.node,'running');
      assert.equal((await real.readStatus()).height,0);
      await real.stopNode();
      assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),prior,'Read-only startup does not reset saved chain');
    }finally{await real.dispose()}
  }finally{await controller.dispose();fs.rmSync(dir,{recursive:true,force:true})}
});


test('actual forged loopback FAE listener cannot pass managed-child bound-port admission',async()=>{
  const http=require('node:http');
  const fsP=require('node:fs/promises');
  const dir=await fsP.mkdtemp(path.join(os.tmpdir(),'ts-node-prebind-'));
  // A hostile local socket returns a perfectly plausible FAE v4 status.
  // Even when the pre-spawn port check has passed, this port is NOT owned by
  // the process that the client starts and must fail closed.
  const rogue=http.createServer((req,res)=>{
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({ok:true,network:NETWORK,height:0,
      tip_hash:'0'.repeat(64),node_version:'independent-0.3.0'}));
  });
  await new Promise(resolve=>rogue.listen(0,'127.0.0.1',resolve));
  const port=rogue.address().port;
  const controller=new ProcessController({repoRoot:root,dataDir:dir,port,
    nodeExecutable:process.execPath,portProbe:async()=>{}});
  try{
    const fakeStatus=await (await fetch('http://127.0.0.1:'+port+'/status')).json();
    assert.equal(fakeStatus.network,NETWORK);
    // Canonical child fails to bind the stolen port; its stdout never emits
    // the exact bound-port event. The spoofed status MUST NOT be admitted.
    await assert.rejects(()=>controller.startNode(),
      /exited before bound-port evidence|failed before bound-port evidence|listener evidence timed out/);
    assert.equal(controller.snapshot().node,'stopped');
    assert.equal(controller.snapshot().miner,'stopped');
    assert.equal(controller.node,null);
    assert.equal((await(await fetch('http://127.0.0.1:'+port+'/status')).json()).height,0);
  }finally{
    await controller.dispose();
    await new Promise(resolve=>rogue.close(resolve));
    await fsP.rm(dir,{recursive:true,force:true});
  }
});
