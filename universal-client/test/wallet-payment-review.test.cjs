'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {parseFaeAmount,formatAtoms,reviewPublicPayment,compareObservedFunds}=require('../src/wallet-payment-review.cjs');
const addressSource=path.resolve(__dirname,'..','..','sovereign-forge/node/authoritative/address.mjs');
const valid='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
test('real canonical Bech32m public payment review returns exact, explicitly unsigned FAE values',async()=>{
  const draft=await reviewPublicPayment({from:valid,to:valid,amount:'1.00000001',fee:'0.00000002'},{addressSource});
  assert.equal(draft.amount_fae,'1.00000001');
  assert.equal(draft.fee_fae,'0.00000002');
  assert.equal(draft.total_fae,'1.00000003');
  assert.equal(draft.asset,'FAE');
  assert.equal(draft.intended_ticker,'TRIUM');
  assert.equal(draft.signing,'UNAVAILABLE');
  assert.equal(draft.submission,'NOT_SUBMITTED');
  assert.equal(draft.custody,'SOURCE_ADDRESS_NOT_AUTHENTICATED');
  assert.equal(draft.balance,'NOT_CHECKED');
  assert.equal(draft.network,'fairyelf-public-testnet-v4');
  assert.equal(draft.node,'NOT_USED');
  assert.ok(!Object.hasOwn(draft,'txid'));
});
test('native payment review rejects forged checksum or wrong FAE address',async()=>{
  const forged=valid.slice(0,-1)+(valid.endsWith('q')?'p':'q');
  await assert.rejects(()=>reviewPublicPayment({from:valid,to:forged,amount:'1',fee:'0'},{addressSource}),/canonical FAE testnet address/);
  await assert.rejects(()=>reviewPublicPayment({from:'fae1'+valid.slice(4),to:valid,amount:'1',fee:'0'},{addressSource}),/canonical FAE testnet address/);
});
test('native payment review refuses malformed, overprecision or ambiguous monetary input',async()=>{
  for(const amount of ['0','0.000000001','01','1e5','-1','1.','1,5',' 1','0x10','Infinity']){
    await assert.rejects(()=>reviewPublicPayment({from:valid,to:valid,amount,fee:'0'},{addressSource}));
  }
  assert.equal(parseFaeAmount('0.00000001'),1n);
  assert.equal(formatAtoms(parseFaeAmount('1.23456789')),'1.23456789');
  await assert.rejects(()=>reviewPublicPayment({from:valid,to:valid,amount:'1',fee:'-0.1'},{addressSource}));
  await assert.rejects(()=>reviewPublicPayment({from:valid,to:valid,amount:'1',fee:'999999999999999999999999999999'},{addressSource}));
});
test('reject unexpected secret-bearing IPC fields and never open a vault or access a node',async()=>{
  for(const x of [
    {from:valid,to:valid,amount:'1',fee:'0',password:'not-allowed'},
    {from:valid,to:valid,amount:'1',fee:'0',mnemonic:'not-allowed'},
    {from:valid,to:valid,amount:'1',fee:'0',network:'unknown'},
    {from:valid,to:valid,amount:1,fee:'0'},
    {from:valid,to:valid,amount:'1',fee:'0',privateKey:'not-allowed'},
    null,[]
  ])await assert.rejects(()=>reviewPublicPayment(x,{addressSource}));
});


test('selected-node balance comparison remains unsigned, explicitly unspendable, and exact to 8 decimal FAE',async()=>{
  const draft=await reviewPublicPayment({from:valid,to:valid,amount:'1.00000001',fee:'0.00000002'},{addressSource});
  const low=compareObservedFunds(draft,{ok:true,address:valid,balance_atoms:'100000002'});
  assert.equal(low.funding,'NODE_REPORTED_BALANCE_BELOW_DRAFT_TOTAL');
  assert.equal(low.observed_fae,'1.00000002');
  assert.equal(low.total_fae,'1.00000003');
  assert.equal(low.spendability,'NOT_VERIFIED');
  assert.equal(low.signing,'UNAVAILABLE');
  assert.equal(low.submission,'NOT_SUBMITTED');
  assert.equal(low.custody,'SOURCE_ADDRESS_NOT_AUTHENTICATED');
  assert.equal(low.confirmation,'NOT_INDEPENDENTLY_VERIFIED');
  const exact=compareObservedFunds(draft,{ok:true,address:valid,balance_atoms:'100000003'});
  assert.equal(exact.funding,'NODE_REPORTED_BALANCE_AT_LEAST_DRAFT_TOTAL');
  assert.equal(exact.node,'CURRENT_MANAGED_LOCAL_NODE_ASSERTION');
});
test('wrong sender, contradictory draft total and malformed selected-node funds fail closed',async()=>{
  const draft=await reviewPublicPayment({from:valid,to:valid,amount:'1',fee:'0.1'},{addressSource});
  for(const observed of [
    null,[],{},
    {ok:true,address:'faet1'+'q'.repeat(38),balance_atoms:'999999999'},
    {ok:false,address:valid,balance_atoms:'999999999'},
    {ok:true,address:valid,network:'attacker-network',balance_atoms:'999999999'},
    {ok:true,address:valid,balance_atoms:'-1'},
    {ok:true,address:valid,balance_atoms:'1e13'},
    {ok:true,address:valid,balance_atoms:'01'},
    {ok:true,address:valid,balance_atoms:100},
    {ok:true,address:valid,balance_atoms:'1'.repeat(81)}
  ])assert.throws(()=>compareObservedFunds(draft,observed));
  assert.throws(()=>compareObservedFunds({...draft,total_fae:'0'},{
    ok:true,address:valid,balance_atoms:'999999999'}),/total mismatched/);
  assert.throws(()=>compareObservedFunds({...draft,state:'SIGNED'},{
    ok:true,address:valid,balance_atoms:'999999999'}),/Unverified/);
});
