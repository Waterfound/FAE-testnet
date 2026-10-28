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


test('read-only Wallet and Explorer refuse chain-tip changes during one real HTTP observation',async()=>{
  const http=require('node:http');
  const portServer=http.createServer();
  const origin='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
  const zeros='0'.repeat(64),ones='1'.repeat(64);
  let statuses=0;
  portServer.on('request',(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/status'){
      statuses++;
      return res.end(JSON.stringify({ok:true,network:NETWORK,height:statuses%2===1?0:1,
        tip_hash:statuses%2===1?zeros:ones}));
    }
    if(req.url?.startsWith('/balance?'))
      return res.end(JSON.stringify({ok:true,address:origin,balance_atoms:'999999999'}));
    if(req.url?.startsWith('/explorer/status'))
      return res.end(JSON.stringify({ok:true,network:NETWORK,observed_tip_height:0,
        observed_tip_hash:zeros}));
    res.statusCode=404;res.end('{}');
  });
  await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-tip-race-'));
  const c=new ProcessController({repoRoot:root,dataDir:dir,port:portServer.address().port});
  c.node={exitCode:null,killed:false,_tsFailed:false};
  try{
    await assert.rejects(()=>c.readBalance(origin),/chain tip changed/);
    await assert.rejects(()=>c.readExplorer('/explorer/status',{}),/chain tip changed/);
  }finally{c.node=null;await new Promise(resolve=>portServer.close(resolve));fs.rmSync(dir,{recursive:true,force:true})}
});
test('local read client caps response bytes even when peer lies about Content-Length',async()=>{
  const http=require('node:http');
  const {fetchRead}=require('../src/controller.cjs');
  const server=http.createServer((_req,res)=>{
    res.setHeader('content-type','application/json');
    res.write(JSON.stringify({ok:true,network:NETWORK,height:0,tip_hash:'0'.repeat(64),extra:''}));
    res.end('a'.repeat(2*1024*1024+16)+'"}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await assert.rejects(()=>fetchRead(new URL('http://127.0.0.1:'+server.address().port+'/status')),/response limit/)}
  finally{await new Promise(resolve=>server.close(resolve))}
});


test('late HTTP status and mining startup are revoked when owned child exits during fetch',async()=>{
  const http=require('node:http');
  const fsP=require('node:fs/promises');
  const dir=await fsP.mkdtemp(path.join(os.tmpdir(),'ts-status-revoke-'));
  const requests=[];
  let wake=null;
  const served=new Promise(resolve=>wake=resolve);
  const server=http.createServer((req,res)=>{
    requests.push({req,res});
    if(wake)wake();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let spawns=0;
  const c=new ProcessController({repoRoot:root,dataDir:dir,port:server.address().port,
    spawnFn:()=>{spawns++;throw Error('No miner may spawn from a dead node')}});
  const live=()=>({exitCode:null,killed:false,_tsFailed:false});
  const payload=JSON.stringify({ok:true,network:NETWORK,height:0,tip_hash:'0'.repeat(64)});
  try{
    c.node=live();
    const first=c.readStatus();
    await served;
    c.node.exitCode=1;
    requests[0].res.writeHead(200,{'content-type':'application/json'});requests[0].res.end(payload);
    await assert.rejects(()=>first,/not ready or not owned/);
    let deliver;
    const next=new Promise(resolve=>deliver=resolve);
    wake=deliver;
    c.node=live();
    const starting=c.startMiner(ADDRESS);
    await next;
    c.node.exitCode=1;
    requests[1].res.writeHead(200,{'content-type':'application/json'});requests[1].res.end(payload);
    await assert.rejects(()=>starting,/not ready or not owned/);
    assert.equal(spawns,0);
    assert.equal(c.miner,null);
  }finally{
    c.node=null;await c.dispose();
    await new Promise(resolve=>server.close(resolve));
    await fsP.rm(dir,{recursive:true,force:true});
  }
});

test('status fetch refuses child replacement despite plausible same-tip HTTP response',async()=>{
  const http=require('node:http');
  let answer;
  const ready=new Promise(resolve=>answer=resolve);
  let held;
  const server=http.createServer((_req,res)=>{held=res;answer()});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir(),port:server.address().port});
  c.node={exitCode:null,killed:false,_tsFailed:false};
  try{
    const old=c.readStatus();await ready;
    c.node={exitCode:null,killed:false,_tsFailed:false};
    held.writeHead(200,{'content-type':'application/json'});
    held.end(JSON.stringify({ok:true,network:NETWORK,height:0,tip_hash:'0'.repeat(64)}));
    await assert.rejects(()=>old,/changed during status observation/);
  }finally{c.node=null;await new Promise(resolve=>server.close(resolve))}
});


test('node shutdown revokes API/miner authority before first await and concurrent stops are idempotent',async()=>{
  const {EventEmitter}=require('node:events');
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir(),
    spawnFn:()=>{throw Error('A miner or node must not start during shutdown')}});
  const child=new EventEmitter();
  child.exitCode=null;child.killed=false;child._tsFailed=false;child.killCount=0;
  child.kill=()=>{
    child.killCount++;child.killed=true;
    setImmediate(()=>{child.exitCode=0;child.emit('exit',0)});
    return true;
  };
  c.node=child;
  const first=c.stopNode();
  assert.equal(c.nodeStopping,true,'shutdown gate must close synchronously');
  await assert.rejects(()=>c.startNode(),/shutdown pending/);
  await assert.rejects(()=>c.startMiner(ADDRESS),/not ready or not owned/);
  await assert.rejects(()=>c.readStatus(),/not ready or not owned/);
  const second=c.stopNode();
  const [one,two]=await Promise.all([first,second]);
  assert.equal(one.node,'stopped');
  assert.equal(two.node,'stopped');
  assert.equal(child.killCount,1,'concurrent stop requests never signal child twice');
  assert.equal(c.nodeStopping,false);
  assert.equal(c.nodeStopPromise,null);
  assert.equal(c.node,null);
});


test('simultaneous Start Mining requests cannot spawn an unowned second miner',async()=>{
  const {EventEmitter}=require('node:events');
  const fakeChild=()=>{
    const child=new EventEmitter();
    child.exitCode=null;child.killed=false;child._tsFailed=false;
    child.kill=()=>{child.killed=true;setImmediate(()=>{child.exitCode=0;child.emit('exit',0)});return true};
    return child;
  };
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir()});
  c.node=fakeChild();
  let releaseStatus,launches=0;
  c.readStatus=()=>new Promise(resolve=>{releaseStatus=resolve});
  c.spawnScript=()=>{launches++;return fakeChild()};
  const first=c.startMiner(ADDRESS);
  assert.equal(c.snapshot().miner,'starting');
  await assert.rejects(()=>c.startMiner(ADDRESS),/Miner startup pending/);
  releaseStatus({ok:true,network:NETWORK,height:0,tip_hash:'0'.repeat(64)});
  assert.equal((await first).miner,'running');
  assert.equal(launches,1,'Only one tracked standalone miner can exist');
  await c.stopMiner();
  assert.equal(c.snapshot().miner,'stopped');
});

test('Stop Mining cancels a pending launch before any subprocess is spawned',async()=>{
  const {EventEmitter}=require('node:events');
  const node=new EventEmitter();node.exitCode=null;node.killed=false;node._tsFailed=false;
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir()});
  c.node=node;
  let releaseStatus,launches=0;
  c.readStatus=()=>new Promise(resolve=>{releaseStatus=resolve});
  c.spawnScript=()=>{launches++;throw Error('Stale miner spawned after stop')};
  const opening=c.startMiner(ADDRESS);
  assert.equal(c.snapshot().miner,'starting');
  const stopping=c.stopMiner();
  assert.equal(c.snapshot().miner,'stopping');
  releaseStatus({ok:true,network:NETWORK,height:0,tip_hash:'0'.repeat(64)});
  await assert.rejects(()=>opening,/Miner launch canceled by Stop Mining/);
  await stopping;
  assert.equal(launches,0);
  assert.equal(c.snapshot().miner,'stopped');
  assert.equal(c.snapshot().telemetry.hashrate_hs,null);
});

test('Start Mining is refused during asynchronous Stop Mining, then permits a new session',async()=>{
  const {EventEmitter}=require('node:events');
  const fake=()=>{
    const p=new EventEmitter();p.exitCode=null;p.killed=false;p._tsFailed=false;return p;
  };
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir()});
  c.node=fake();c.miner=fake();
  let finishStop,launches=0;
  c.stop=()=>new Promise(resolve=>{finishStop=resolve});
  c.readStatus=async()=>({ok:true,network:NETWORK,height:0,tip_hash:'0'.repeat(64)});
  c.spawnScript=()=>{launches++;return fake()};
  const stopping=c.stopMiner();
  assert.equal(c.snapshot().miner,'stopping');
  await assert.rejects(()=>c.startMiner(ADDRESS),/Miner shutdown pending/);
  assert.equal(launches,0);
  finishStop();
  await stopping;
  assert.equal(c.snapshot().miner,'stopped');
  assert.equal((await c.startMiner(ADDRESS)).miner,'running');
  assert.equal(launches,1);
});


test('Stop Node revokes pre-spawn startup even when prior port probe completes afterwards',async()=>{
  const {mkdtemp,rm}=require('node:fs/promises');
  const dir=await mkdtemp(path.join(os.tmpdir(),'ts-node-preflight-stop-'));
  let finishProbe,spawns=0;
  const c=new ProcessController({repoRoot:root,dataDir:dir,
    portProbe:()=>new Promise(resolve=>{finishProbe=resolve}),
    spawnFn:()=>{spawns++;throw Error('Canceled startup spawned a node')}});
  try{
    const starting=c.startNode();
    assert.equal(c.snapshot().node,'starting');
    const stopping=c.stopNode();
    assert.equal(c.snapshot().node,'stopping');
    assert.equal((await stopping).node,'stopping','Cancellation remains pending until preflight settles');
    finishProbe();
    await assert.rejects(()=>starting,/startup canceled by Stop Node/);
    assert.equal(spawns,0,'No process can be launched after successful Stop Node');
    assert.equal(c.node,null);
    assert.equal(c.snapshot().node,'stopped');
  }finally{await c.dispose();await rm(dir,{recursive:true,force:true})}
});

test('Stop Node rejects stale post-spawn listener success and permits fresh restart',async()=>{
  const {EventEmitter}=require('node:events');
  const {mkdtemp,rm}=require('node:fs/promises');
  const dir=await mkdtemp(path.join(os.tmpdir(),'ts-node-listener-stop-'));
  const children=[];
  const makeChild=()=>{
    const child=new EventEmitter();
    child.exitCode=null;child.killed=false;child._tsFailed=false;
    child.kill=()=>{child.killed=true;setImmediate(()=>{child.exitCode=0;child.emit('exit',0)});return true};
    children.push(child);return child;
  };
  let notifyListen,releaseListen;
  const listenReached=new Promise(resolve=>{notifyListen=resolve});
  let holdFirst=true;
  const c=new ProcessController({repoRoot:root,dataDir:dir,portProbe:async()=>{},
    spawnFn:()=>makeChild(),
    listenEvidence:()=>{
      if(!holdFirst)return Promise.resolve({owned_process_log:true});
      notifyListen();
      return new Promise(resolve=>{releaseListen=resolve});
    },
    readinessProbe:async()=>({ok:true,network:NETWORK,height:0,tip_hash:'0'.repeat(64)})
  });
  try{
    const pending=c.startNode();
    await listenReached;
    assert.equal(children.length,1);
    await c.stopNode();
    assert.equal(children[0].killed,true);
    assert.equal(c.snapshot().node,'stopping','The stale startup remains cancellation-pending');
    releaseListen({owned_process_log:true});
    await assert.rejects(()=>pending,/startup canceled by Stop Node/);
    assert.equal(c.snapshot().node,'stopped');
    assert.equal(c.node,null);
    holdFirst=false;
    assert.equal((await c.startNode()).node,'running');
    assert.equal(children.length,2,'New authenticated startup needs a fresh child');
    await c.stopNode();
    assert.equal(children[1].killed,true);
  }finally{await c.dispose();await rm(dir,{recursive:true,force:true})}
});


test('process shutdown requires observed exit, not merely a successful kill signal',async()=>{
  const {EventEmitter}=require('node:events');
  const child=new EventEmitter();
  child.exitCode=null;child.killed=false;child._tsFailed=false;
  const signals=[];
  child.kill=signal=>{signals.push(signal);child.killed=true;return true};
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir()});
  await assert.rejects(()=>c.stop(child,{graceMs:12,killMs:12}),
    /termination not confirmed/);
  assert.deepEqual(signals,['SIGTERM','SIGKILL']);
  assert.equal(child.exitCode,null,'Signal sent is not evidence of process exit');
});

test('observed child exit after forced kill closes process ownership cleanly',async()=>{
  const {EventEmitter}=require('node:events');
  const child=new EventEmitter();
  child.exitCode=null;child.killed=false;child._tsFailed=false;
  const signals=[];
  child.kill=signal=>{
    signals.push(signal);child.killed=true;
    if(signal==='SIGKILL')setImmediate(()=>{child.exitCode=0;child.emit('exit',0)});
    return true;
  };
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir()});
  await c.stop(child,{graceMs:12,killMs:120});
  assert.deepEqual(signals,['SIGTERM','SIGKILL']);
  assert.equal(child._tsExited,true);
});

test('unconfirmed node shutdown retains ownership and rejects replacement startup',async()=>{
  const {EventEmitter}=require('node:events');
  const child=new EventEmitter();
  child.exitCode=null;child.killed=false;child._tsFailed=false;
  const signals=[];
  child.kill=signal=>{signals.push(signal);child.killed=true;return true};
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir(),
    portProbe:async()=>{throw Error('Cannot bind while owner unresolved')}});
  c.node=child;
  c.stop=owned=>ProcessController.prototype.stop.call(c,owned,{graceMs:12,killMs:12});
  await assert.rejects(()=>c.stopNode(),/termination not confirmed/);
  assert.equal(c.node,child,'Never abandon an unconfirmed OS process');
  assert.equal(c.snapshot().node,'stopping','Do not claim stopped before observed exit');
  await assert.rejects(()=>c.startNode(),/termination not confirmed/);
  assert.ok(signals.includes('SIGKILL'));
  child.exitCode=0;child._tsExited=true;child.emit('exit',0);
  assert.equal(c.snapshot().node,'stopped');
  c.node=null;
});

test('unconfirmed miner shutdown retains the process and refuses duplicate miner',async()=>{
  const {EventEmitter}=require('node:events');
  const node=new EventEmitter();
  node.exitCode=null;node.killed=false;node._tsFailed=false;
  const miner=new EventEmitter();
  miner.exitCode=null;miner.killed=false;miner._tsFailed=false;
  miner.kill=()=>{miner.killed=true;return true};
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir()});
  c.node=node;c.miner=miner;
  c.stop=child=>ProcessController.prototype.stop.call(c,child,{graceMs:12,killMs:12});
  await assert.rejects(()=>c.stopMiner(),/termination not confirmed/);
  assert.equal(c.miner,miner);
  assert.equal(c.snapshot().miner,'stopping');
  await assert.rejects(()=>c.startMiner(ADDRESS),/Miner termination not confirmed/);
  miner.exitCode=0;miner._tsExited=true;
  c.miner=null;c.node=null;
});


test('wallet activity pagination binds offset and next cursor to one exact node tip',async()=>{
  const http=require('node:http');
  const addr='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
  const tip='b'.repeat(64);
  let mode='normal';
  const server=http.createServer((req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/status')
      return res.end(JSON.stringify({ok:true,network:NETWORK,height:3,tip_hash:tip}));
    if(req.url.startsWith('/explorer/address?')){
      const query=new URL(req.url,'http://localhost').searchParams;
      const isSecond=query.has('cursor');
      const page={ok:true,network:NETWORK,observed_tip_height:3,observed_tip_hash:tip,
        address:addr,balance_atoms:'0',total_events:2,
        events:[{id:isSecond?'reward:b':'reward:a',status:'confirmed'}],
        next_cursor:isSecond?null:tip+':1'};
      if(mode==='stale')page.next_cursor='c'.repeat(64)+':1';
      if(mode==='repeat')page.next_cursor=tip+':0';
      if(mode==='false-end')page.next_cursor=null;
      if(mode==='duplicate')page.events=[{id:'reward:a'},{id:'reward:a'}];
      return res.end(JSON.stringify(page));
    }
    res.statusCode=404;res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const c=new ProcessController({repoRoot:root,dataDir:os.tmpdir(),port:server.address().port});
  c.node={exitCode:null,killed:false,_tsFailed:false};
  try{
    const first=await c.readExplorer('/explorer/address',{address:addr,limit:1});
    assert.equal(first.next_cursor,tip+':1');
    const second=await c.readExplorer('/explorer/address',{address:addr,cursor:first.next_cursor,limit:1});
    assert.equal(second.next_cursor,null);
    assert.equal(second.events[0].id,'reward:b');
    await assert.rejects(()=>c.readExplorer('/explorer/address',{address:addr,cursor:'c'.repeat(64)+':1',limit:1}),
      /wallet activity cursor/);
    for(const variant of['stale','repeat','false-end','duplicate']){
      mode=variant;
      await assert.rejects(()=>c.readExplorer('/explorer/address',{address:addr,limit:1}),
        /Unverified selected-node wallet activity response/);
    }
  }finally{
    c.node=null;
    await new Promise(resolve=>server.close(resolve));
  }
});
