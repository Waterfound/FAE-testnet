'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {isManagedChildAlive,assertManagedNodeReady,probeLoopbackPort,verifyManagedReadiness}=require('../src/managed-node-gate.cjs');
const good=()=>({ok:true,network:'fairyelf-public-testnet-v4',height:0,tip_hash:'0'.repeat(64),node_version:'independent-0.3.0'});
const child=()=>({exitCode:null,killed:false});
test('stopped, failed, absent or starting child cannot authorize reads/mining',()=>{
  assert.equal(isManagedChildAlive(null),false);
  assert.throws(()=>assertManagedNodeReady(null),/not ready or not owned/);
  assert.throws(()=>assertManagedNodeReady(child(),true),/not ready or not owned/);
  assert.throws(()=>assertManagedNodeReady({...child(),_tsFailed:true}),/not ready or not owned/);
  assert.throws(()=>assertManagedNodeReady({...child(),exitCode:1}),/not ready or not owned/);
  assert.doesNotThrow(()=>assertManagedNodeReady(child()));
});
test('port collision prevents managed node admission without attaching to unrelated listener',async()=>{
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try{await assert.rejects(()=>probeLoopbackPort(port),/unavailable/)}
  finally{await new Promise(resolve=>server.close(resolve))}
  await probeLoopbackPort(port);
});
test('genuine v4 node response proves supported read contract, not mainnet finality',async()=>{
  assert.equal((await verifyManagedReadiness({child:child(),readStatus:async()=>good()})).height,0);
  await assert.rejects(()=>verifyManagedReadiness({child:child(),readStatus:async()=>({...good(),network:'evil-net'})}),/network mismatch/);
  await assert.rejects(()=>verifyManagedReadiness({child:{exitCode:1,killed:false},readStatus:async()=>good()}),/exited before readiness/);
  await assert.rejects(()=>verifyManagedReadiness({child:child(),readStatus:async()=>({...good(),height:'x'}),timeoutMs:10,pollMs:1}),/failed readiness|timed out/);
});
