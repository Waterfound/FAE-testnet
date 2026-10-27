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
    await assert.rejects(()=>c.readBalance(ADDRESS),/Invalid|Local node HTTP|invalid/i);
    await c.stopNode();
    assert.equal(c.snapshot().node,'stopped');
    await assert.rejects(()=>c.readStatus(),/not ready or not owned/);
  }finally{
    await c.dispose().catch(()=>{});
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
