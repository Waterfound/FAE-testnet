'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const net=require('node:net');
const {isManagedChildAlive,assertManagedNodeReady,probeLoopbackPort,verifyManagedReadiness,waitForManagedListenEvidence}=require('../src/managed-node-gate.cjs');
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


test('the child itself must announce successful binding: hostile HTTP alone cannot admit a node',async()=>{
  const {EventEmitter}=require('node:events');
  const {PassThrough}=require('node:stream');
  const fake=new EventEmitter();fake.stdout=new PassThrough();fake.exitCode=null;fake.killed=false;
  const port=43179;
  const pending=waitForManagedListenEvidence({child:fake,port,timeoutMs:250});
  // A rogue listener can return a correct-looking /status; it cannot cause the
  // freshly forked canonical child to emit the post-listen signal.
  fake.stdout.write('[FAE] state load failed, starting empty\n');
  await assert.rejects(pending,/listener evidence timed out/);
});
test('bound-port attestation rejects wrong port, partial output and exited child',async()=>{
  const {EventEmitter}=require('node:events');
  const {PassThrough}=require('node:stream');
  const make=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.exitCode=null;child.killed=false;return child};
  const good=make(),v=waitForManagedListenEvidence({child:good,port:43179,timeoutMs:1000});
  good.stdout.write('[FAE] independent node independent-0.3.0 listening on http://127.0.0.1:');
  good.stdout.write('43179 height=0\r\n');
  assert.deepEqual(await v,{owned_process_log:true,host:'127.0.0.1',port:43179});
  const evil=make(),fail=waitForManagedListenEvidence({child:evil,port:43179,timeoutMs:1000});
  evil.stdout.write('[FAE] independent node independent-0.3.0 listening on http://127.0.0.1:43180 height=0\n');
  await assert.rejects(fail,/unexpected endpoint/);
  const exited=make(),exitWait=waitForManagedListenEvidence({child:exited,port:43179,timeoutMs:1000});
  exited.exitCode=1;exited.emit('exit',1);
  await assert.rejects(exitWait,/exited before bound-port/);
});
