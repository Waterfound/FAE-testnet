'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fork}=require('node:child_process');
const path=require('node:path');
const http=require('node:http');
const {OwnedNodeIpc}=require('../src/owned-node-ipc.cjs');
const fixture=path.join(__dirname,'fixtures','owned-ipc-child.cjs');
function childFor(mode='good'){
  return fork(fixture,[],{env:{...process.env,IPC_FIXTURE_MODE:mode},
    stdio:['ignore','ignore','ignore','ipc']});
}
async function withChild(mode,callback){
  const child=childFor(mode);
  try{return await callback(child)}
  finally{
    if(child.connected)child.disconnect();
    if(child.exitCode===null)child.kill();
  }
}
test('actual separate OS child IPC succeeds without relying on an HTTP endpoint',async()=>{
  await withChild('good',async child=>{
    const attacker=http.createServer((req,res)=>{
      res.writeHead(200,{'content-type':'application/json'});
      res.end(JSON.stringify({ok:true,process_authenticated:true,network:'wrong-network'}));
    });
    await new Promise(resolve=>attacker.listen(0,'127.0.0.1',resolve));
    try{
      const ipc=new OwnedNodeIpc(child);
      assert.equal((await ipc.read('status')).source,'REAL_CHILD_OS_IPC_FIXTURE_ONLY');
      assert.equal((await ipc.read('status')).height,1);
      await assert.rejects(ipc.read('submit-signed'),/Unsupported native IPC read/);
      ipc.revoke();
      await assert.rejects(ipc.read('status'),/unavailable/);
    }finally{await new Promise(resolve=>attacker.close(resolve))}
  });
});
for(const [mode,pattern] of [
  ['wrong-session',/Unauthenticated/],
  ['wrong-network',/Unauthenticated/],
  ['replay',/Stale or replayed/]
]){
  test('rejects '+mode+' from the child rather than trusting claimed status',async()=>{
    await withChild(mode,async child=>{
      const ipc=new OwnedNodeIpc(child);
      await assert.rejects(ipc.read('status'),pattern);
      await assert.rejects(ipc.read('status'),/unavailable/);
    });
  });
}
test('process death revokes a pending IPC operation',async()=>{
  await withChild('die',async child=>{
    const ipc=new OwnedNodeIpc(child,{timeoutMs:800});
    await assert.rejects(ipc.read('status'),/exited or disconnected|send failed/);
    await assert.rejects(ipc.read('status'),/unavailable/);
  });
});
test('IPC timeout is fail-closed and never retries state-changing commands',async()=>{
  await withChild('hang',async child=>{
    const ipc=new OwnedNodeIpc(child,{timeoutMs:80});
    await assert.rejects(ipc.read('status'),/timeout/);
    await assert.rejects(ipc.read('status'),/unavailable/);
  });
});

// V50 original miner -> parent -> original node transport candidate:
// this proves OS-owned framing and unknown-outcome safety against a disposable
// fixture, NOT acceptance by any original protected node or original consensus.
const syntheticBlock=()=>({
  header:{network:'fairyelf-public-testnet-v4',height:2,
    previous_hash:'0'.repeat(64),tx_count:0},
  nonce:7,hash:'a'.repeat(64),txids:[]
});
test('V50 no original-node owner admission means zero native block mutations',async()=>{
  await withChild('good',async child=>{
    const ipc=new OwnedNodeIpc(child);
    await assert.rejects(ipc.submitMinedBlock(syntheticBlock()),/not owner-admitted/);
    await assert.rejects(ipc.read('submit-mined-block',{submission:syntheticBlock()}),
      /Unsupported native IPC read/);
    assert.equal((await ipc.read('status')).source,'REAL_CHILD_OS_IPC_FIXTURE_ONLY');
    ipc.revoke();
  });
});
test('V50 candidate accepted-format receipt uses true OS child IPC, no HTTP fallback',async()=>{
  await withChild('good',async child=>{
    const ipc=new OwnedNodeIpc(child,{allowBlockMutation:true});
    const receipt=await ipc.submitMinedBlock(syntheticBlock());
    assert.deepEqual(receipt,{ok:true,network:'fairyelf-public-testnet-v4',
      durable:true,height:2,hash:'a'.repeat(64),tx_count:0});
    assert.equal(ipc.counter,2,'one mutation plus a separate native status verification');
    assert.equal((await ipc.read('status')).source,'SYNTHETIC_POST_ACK_TIP_ONLY');
    ipc.revoke();
  });
});
test('V50 successor: a positive durable ACK is rejected if original-node tip contradicts it',async()=>{
  await withChild('block-status-wrong-tip',async child=>{
    const ipc=new OwnedNodeIpc(child,{allowBlockMutation:true});
    await assert.rejects(ipc.submitMinedBlock(syntheticBlock()),
      /receipt contradicted by authenticated chain tip/);
    assert.equal(ipc.counter,2,'one mutation and one independent status, never retry');
    assert.equal(ipc.revoked,true);
    await assert.rejects(ipc.read('status'),/unavailable/);
  });
});
for(const mode of ['block-not-durable','block-hash-mismatch']){
  test('V50 forged simulated native block receipt '+mode+' revokes entire session',async()=>{
    await withChild(mode,async child=>{
      const ipc=new OwnedNodeIpc(child,{allowBlockMutation:true});
      await assert.rejects(ipc.submitMinedBlock(syntheticBlock()),
        /not durable or mismatched/);
      assert.equal(ipc.revoked,true);
      await assert.rejects(ipc.read('status'),/unavailable/);
    });
  });
}
test('V50 original mined-block request refuses malformed/oversized envelopes before IPC send',async()=>{
  await withChild('good',async child=>{
    const ipc=new OwnedNodeIpc(child,{allowBlockMutation:true});
    for(const invalid of [
      {...syntheticBlock(),nonce:-1},
      {...syntheticBlock(),hash:'z'.repeat(64)},
      {...syntheticBlock(),header:{...syntheticBlock().header,network:'mainnet'}},
      {...syntheticBlock(),txids:['invalid']},
      {...syntheticBlock(),extra_auth:true},
      {...syntheticBlock(),header:{...syntheticBlock().header,
        untrusted_padding:'x'.repeat(66000)}}
    ])await assert.rejects(ipc.submitMinedBlock(invalid),
      /Invalid original mined-block proposal|exceeds IPC limit/);
    // None of the rejected requests consumed the authenticated sequence.
    assert.equal(ipc.counter,0);
    assert.equal((await ipc.read('status')).height,1);
    ipc.revoke();
  });
});
test('V50 unknown result never retries an original-node block mutation',async()=>{
  await withChild('hang',async child=>{
    const ipc=new OwnedNodeIpc(child,{allowBlockMutation:true,timeoutMs:80});
    await assert.rejects(ipc.submitMinedBlock(syntheticBlock()),/outcome unknown/);
    assert.equal(ipc.counter,1);
    assert.equal(ipc.revoked,true);
    await assert.rejects(ipc.submitMinedBlock(syntheticBlock()),/unavailable/);
    assert.equal(ipc.counter,1,'timeout cannot trigger a second native mutation');
  });
});

const disposableSignedTx=()=>({
  version:2,network:'fairyelf-public-testnet-v4',
  inputs:['c'.repeat(64)+':0'],
  outputs:[{address:'faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn',
    amount_atoms:'99999999'}],
  public_key_spki:'A'.repeat(44),signature:'A'.repeat(88)
});
test('V50 original Wallet native transmission is disabled absent signer/source-owner admission',async()=>{
  await withChild('good',async child=>{
    const ipc=new OwnedNodeIpc(child);
    await assert.rejects(ipc.submitSignedTx(disposableSignedTx(),'a'.repeat(64)),
      /not owner-admitted/);
    await assert.rejects(ipc.read('submit-signed-tx',{tx:disposableSignedTx()}),
      /Unsupported native IPC read/);
    assert.equal(ipc.counter,0,'no mutation or response accepted from default client');
    ipc.revoke();
  });
});
test('V50 native signed TX candidate binds expected original Wallet TXID to same-child lookup',async()=>{
  await withChild('good',async child=>{
    const ipc=new OwnedNodeIpc(child,{allowSignedTxMutation:true});
    const txid='a'.repeat(64);
    const observed=await ipc.submitSignedTx(disposableSignedTx(),txid);
    assert.equal(observed.txid,txid);
    assert.equal(observed.status,'pending');
    assert.equal(observed.observed_tip_height,1);
    assert.equal(observed.confirmation_finality,'NOT_PROVEN');
    assert.equal(observed.submission_source,'ORIGINAL_NODE_INHERITED_IPC_CANDIDATE');
    assert.equal(ipc.counter,2,'one submission + one read-only same OS-child reconciliation');
    ipc.revoke();
  });
});
for(const variant of ['signed-wrong-txid','signed-not-found']){
  test('V50 signed TX IPC source contradictions revoke '+variant,async()=>{
    await withChild(variant,async child=>{
      const ipc=new OwnedNodeIpc(child,{allowSignedTxMutation:true});
      await assert.rejects(ipc.submitSignedTx(disposableSignedTx(),'a'.repeat(64)),
        /native acknowledgement mismatch|outcome unverified/);
      assert.equal(ipc.revoked,true);
      await assert.rejects(ipc.read('status'),/unavailable/);
    });
  });
}
test('V50 malformed signed original TX is rejected BEFORE OS IPC',async()=>{
  await withChild('good',async child=>{
    const ipc=new OwnedNodeIpc(child,{allowSignedTxMutation:true});
    const txid='a'.repeat(64);
    for(const bad of [
      {...disposableSignedTx(),network:'mainnet'},
      {...disposableSignedTx(),signature:undefined},
      {...disposableSignedTx(),inputs:[]},
      {...disposableSignedTx(),inputs:['invalid']},
      {...disposableSignedTx(),outputs:[]},
      {...disposableSignedTx(),outputs:[{address:'somewhere',amount_atoms:'0'}]},
      {...disposableSignedTx(),owner_override:true}
    ])await assert.rejects(ipc.submitSignedTx(bad,txid),/shape rejected/);
    await assert.rejects(ipc.submitSignedTx(disposableSignedTx(),'not-a-txid'),/shape rejected/);
    assert.equal(ipc.counter,0);
    ipc.revoke();
  });
});
test('V50 native signed TX timeout is UNKNOWN, never an automatic resubmission',async()=>{
  await withChild('hang',async child=>{
    const ipc=new OwnedNodeIpc(child,{allowSignedTxMutation:true,timeoutMs:80});
    await assert.rejects(ipc.submitSignedTx(disposableSignedTx(),'a'.repeat(64)),
      /outcome unknown/);
    assert.equal(ipc.revoked,true);
    assert.equal(ipc.counter,1);
    await assert.rejects(ipc.submitSignedTx(disposableSignedTx(),'a'.repeat(64)),
      /unavailable/);
    assert.equal(ipc.counter,1,'no retry after unknown signed-tx outcome');
  });
});
