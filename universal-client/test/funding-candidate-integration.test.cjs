'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {ProcessController,validateFundingCandidatePayload,NETWORK}=require('../src/controller.cjs');
const ADDRESS='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
const A='a'.repeat(64),B='b'.repeat(64);
const confirmed={outpoint:A+':0',amount_atoms:'9007199254740993',source:'confirmed',created_height:4};
const pending={outpoint:B+':1',amount_atoms:'7',source:'pending',parent_txid:B};
const make=(rows=[confirmed,pending],total='9007199254741000')=>
  ({ok:true,address:ADDRESS,spendable_atoms:total,utxos:rows});
const parse=payload=>validateFundingCandidatePayload(payload,{address:ADDRESS});
test('node funding candidates preserve >2^53 atoms exactly, isolate pending and never confer signing authority',()=>{
  const result=parse(make());
  assert.equal(result.candidate_atoms,'9007199254741000');
  assert.equal(result.confirmed_candidate_atoms,'9007199254740993');
  assert.equal(result.pending_candidate_atoms,'7');
  assert.equal(result.candidate_count,2);
  assert.equal(result.outputs[0].created_height,4);
  assert.equal(result.outputs[1].parent_txid,B);
  assert.equal(result.network,NETWORK);
  assert.equal(result.authority,'SELECTED_NODE_UNTRUSTED_UTXO_CLAIM');
  assert.equal(result.maturity,'NOT_VERIFIED');
  assert.equal(result.ownership,'NOT_VERIFIED');
  assert.equal(result.signer,'UNAVAILABLE');
  assert.equal(result.submission,'NOT_PERFORMED');
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.outputs));
});
test('fake, lossy, malformed and contradictory node funding claims fail closed',()=>{
  for(const input of [
    {...make(),ok:false},{...make(),address:'not-the-request'},
    {...make(),network:'attacknet'}, {...make(),spendable_atoms:9007199254741000},
    {...make(),spendable_atoms:'9007199254741001'},
    {...make(),spendable_atoms:'09007199254741000'},
    {...make(),spendable_atoms:'9e15'},
    {...make(),utxos:[confirmed,confirmed]},
    {...make(),utxos:[{...confirmed,amount_atoms:9007199254740993},pending]},
    {...make(),utxos:[{...confirmed,amount_atoms:'01'},pending]},
    {...make(),utxos:[{...confirmed,amount_atoms:'0'},pending]},
    {...make(),utxos:[{...confirmed,outpoint:'../path'},pending]},
    {...make(),utxos:[{...confirmed,source:'authorized'},pending]},
    {...make(),utxos:[{...confirmed,created_height:NaN},pending]},
    {...make(),utxos:[{...pending,parent_txid:'bad'},confirmed]},
    {...make(),utxos:Array(501).fill(confirmed)},
    null,[],{}
  ])assert.throws(()=>parse(input));
});
test('real optional managed FAE v4 node serves zero source-bound candidates at genesis and revokes reads on stop',
  {timeout:25000},async t=>{
  const root=path.resolve(__dirname,'..','..');
  if(!fs.existsSync(path.join(root,'sovereign-forge','node','fae-node.mjs')))
    return t.skip('Original node not present in this source checkout');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ts-funding-live-'));
  const node=new ProcessController({repoRoot:root,dataDir:temp,nodeExecutable:process.execPath});
  try{
    assert.equal((await node.startNode()).node,'running');
    const observed=await node.readFundingCandidates(ADDRESS);
    assert.equal(observed.network,NETWORK);
    assert.equal(observed.candidate_atoms,'0');
    assert.equal(observed.confirmed_candidate_atoms,'0');
    assert.equal(observed.pending_candidate_atoms,'0');
    assert.deepEqual(observed.outputs,[]);
    assert.equal(observed.observed_tip_height,0);
    assert.match(observed.observed_tip_hash,/^[0-9a-f]{64}$/);
    await node.stopNode();
    await assert.rejects(()=>node.readFundingCandidates(ADDRESS),/not ready or not owned/);
  }finally{
    await node.dispose().catch(()=>{});
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
