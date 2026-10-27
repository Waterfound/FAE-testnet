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
