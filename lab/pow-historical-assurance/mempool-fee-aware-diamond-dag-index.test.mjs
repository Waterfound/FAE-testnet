/**
 * HPA-UC-001 W2 / PF-12S: candidate-only index-level adversarial diamond DAG.
 * This fixture is deliberately NOT signed and does NOT exercise node admission,
 * network relay, consensus, live block inclusion or production fee policy.
 * It exercises the actual shadow selector and descendant-closure functions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {assertPendingIndexes,removeDescendantPackageOnClone,
  selectFeeSensitiveTemplateCandidate} from './mempool-fee-aware-shadow-candidate.mjs';

function diamond(){
  const s=emptyState(),owner='index-only-owner';
  for(const key of ['source:0','outside:0'])
    s.utxos[key]={outpoint:key,address:owner,amount_atoms:'1000',spent:false};
  function put(id,inputs,amounts,fee){
    const outputs=amounts.map(amount=>({address:owner,amount_atoms:String(amount)}));
    s.transactions[id]={txid:id,from_address:owner,inputs,outputs,
      fee_atoms:String(fee),status:'pending',network:'index-only-fixture'};
    s.mempoolOrder.push(id);
    for(const input of inputs){
      if(s.mempoolSpends[input])throw Error('fixture_duplicate_reservation');
      s.mempoolSpends[input]=id;
    }
    outputs.forEach((output,index)=>{
      const outpoint=id+':'+index;
      s.mempoolOutputs[outpoint]={outpoint,txid:id,output_index:index,
        address:owner,amount_atoms:output.amount_atoms};
    });
  }
  put('root',['source:0'],[500,500],0);
  put('left',['root:0'],[500],0);
  put('right',['root:1'],[500],0);
  put('join',['left:0','right:0'],[600],400);
  put('independent',['outside:0'],[990],10);
  assertPendingIndexes(s,{cap:5});
  return s;
}

test('PF-12S1: a high-fee fan-in must include every parent in topological order',()=>{
  const s=diamond(),before=structuredClone(s);
  const chosen=selectFeeSensitiveTemplateCandidate(s,{limit:4});
  assert.deepEqual(chosen.txids,['root','left','right','join']);
  assert.equal(chosen.fee_atoms,'400');
  const limited=selectFeeSensitiveTemplateCandidate(s,{limit:3});
  assert.ok(!limited.txids.includes('join'),
    'insufficient template capacity must never strand missing ancestors');
  assert.deepEqual(s,before,'selection must never mutate source');
});

test('PF-12S2: evicting diamond root closes all descendants but not independent',()=>{
  const s=diamond(),before=structuredClone(s);
  const result=removeDescendantPackageOnClone(s,['root'],{cap:5,maxPackageSize:4});
  assert.deepEqual(new Set(result.evicted),new Set(['root','left','right','join']));
  assert.deepEqual(result.state.mempoolOrder,['independent']);
  assertPendingIndexes(result.state,{cap:5});
  assert.deepEqual(s,before,'source indexes must remain unchanged');
  assert.throws(()=>removeDescendantPackageOnClone(s,['root'],
    {cap:5,maxPackageSize:3}),e=>e.code==='package_limit');
});

test('PF-12S3: fee forgery and index-valid cycle both fail closed',()=>{
  const s=diamond(),feeCorrupt=structuredClone(s);
  feeCorrupt.transactions.join.fee_atoms='401';
  assert.throws(()=>assertPendingIndexes(feeCorrupt,{cap:5}),
    e=>e.code==='pending_fee_mismatch');
  const cycle=structuredClone(s);
  delete cycle.mempoolSpends['source:0'];
  cycle.transactions.root.inputs=['join:0'];
  cycle.mempoolSpends['join:0']='root';
  cycle.transactions.join.outputs[0].amount_atoms='1000';
  cycle.mempoolOutputs['join:0'].amount_atoms='1000';
  cycle.transactions.join.fee_atoms='0';
  assertPendingIndexes(cycle,{cap:5});
  assert.throws(()=>selectFeeSensitiveTemplateCandidate(cycle),
    e=>e.code==='cyclic_pending_dependency');
});
