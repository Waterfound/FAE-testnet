'use strict';
// V33 candidate: strict original-node IPC receipt invariants.
// No signer, no submit, no wallet secrets, and no product activation.
const test=require('node:test');
const assert=require('node:assert/strict');
const {ProcessController}=require('../src/controller.cjs');
const NETWORK='fairyelf-public-testnet-v4';
const TXID='b'.repeat(64),ZERO='0'.repeat(64);
function native(result){
  const c=Object.create(ProcessController.prototype);
  c.nativeIpcCandidate=true;
  let requests=0;
  c.nativeRead=async(op,p)=>{
    requests++;
    assert.equal(op,'transaction-lookup');
    assert.deepEqual(p,{txid:TXID});
    return result;
  };
  return {c,calls:()=>requests};
}
function result(overrides={}){
  return {ok:true,network:NETWORK,txid:TXID,found:false,
    status:null,confirmed_height:null,tip_height:0,tip_hash:ZERO,...overrides};
}
test('read-only native transaction lookup preserves no-record as unknown, never failed',async()=>{
  const {c,calls}=native(result());
  assert.deepEqual(await c.readTransactionByTxid(TXID),{
    txid:TXID,result_known:false,status:null,confirmed_height:null,
    observed_tip_height:0,observed_tip_hash:ZERO,confirmation_finality:'NOT_PROVEN'
  });
  assert.equal(calls(),1);
});
test('original-node pending observation requires NULL confirmed height',async()=>{
  const {c}=native(result({found:true,status:'pending',tip_height:5}));
  const read=await c.readTransactionByTxid(TXID);
  assert.equal(read.status,'pending');
  assert.equal(read.confirmation_finality,'NOT_PROVEN');
});
test('original-node confirmed observation requires a valid actual block height',async()=>{
  const {c}=native(result({found:true,status:'confirmed',confirmed_height:3,tip_height:5}));
  const read=await c.readTransactionByTxid(TXID);
  assert.equal(read.confirmed_height,3);
  assert.equal(read.confirmation_finality,'NOT_PROVEN');
});
test('contradictory or forged native confirmation never becomes desktop evidence',async()=>{
  const forged=[
    {found:true,status:'confirmed',confirmed_height:null},
    {found:true,status:'confirmed',confirmed_height:0},
    {found:true,status:'confirmed',confirmed_height:6,tip_height:5},
    {found:true,status:'pending',confirmed_height:2},
    {found:true,status:'failed'},
    {found:false,status:'pending'},
    {found:false,confirmed_height:3},
    {txid:'a'.repeat(64)},
    {network:'wrong-network'},
    {tip_hash:'not-hex'},
    {tip_height:-1},
    {ok:false}
  ];
  for(const mutation of forged){
    const {c}=native(result(mutation));
    await assert.rejects(c.readTransactionByTxid(TXID),
      /Invalid native original-node transaction evidence/,
      'Forged source mutation '+JSON.stringify(mutation));
  }
});
test('invalid exact transaction ID is rejected before contacting original node',async()=>{
  const {c,calls}=native(result());
  await assert.rejects(c.readTransactionByTxid('bad'),/Canonical transaction ID required/);
  await assert.rejects(c.readTransactionByTxid(TXID.toUpperCase()),/Canonical transaction ID required/);
  assert.equal(calls(),0);
});
test('unadmitted native session never silently degrades to local HTTP Explorer',async()=>{
  const {c,calls}=native(result());
  c.nativeIpcCandidate=false;
  await assert.rejects(c.readTransactionByTxid(TXID),
    /Authenticated original-node transaction lookup unavailable/);
  assert.equal(calls(),0);
});
test('native IPC transport rejection propagates, never yields a false not-found',async()=>{
  const {c}=native(result());
  c.nativeRead=async()=>{throw Error('real_native_session_revoked')};
  await assert.rejects(c.readTransactionByTxid(TXID),/real_native_session_revoked/);
});
