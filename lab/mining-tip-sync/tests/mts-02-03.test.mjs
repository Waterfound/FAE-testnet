import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MiningSessionIdentityModel,
  makeWorkIdentity,
  parentTipIdentity
} from '../work-identity.mjs';
import {
  TIP_OBSERVER_CONTRACT,
  TIP_OBSERVER_STATES,
  classifyAuthoritativeTip,
  classifyCrossTabHint
} from '../tip-observer.mjs';

const NETWORK='fairyelf-public-testnet-v4';
const A='a'.repeat(64);
const B='b'.repeat(64);
const C='c'.repeat(64);
const reward='faet1labonlyrewardaddress';

function header(height,previous_hash){return{height,previous_hash}}

test('MTS-02 work identity binds session, generation, network, height, parent and reward address',()=>{
  const work=makeWorkIdentity({
    network:NETWORK,
    header:header(101,A),
    rewardAddress:reward,
    generation:1,
    sessionId:'session-001'
  });
  assert.equal(work.height,101);
  assert.equal(work.previous_hash,A);
  assert.match(work.work_id,/session-001\|1\|fairyelf-public-testnet-v4\|101\|/);
  assert.deepEqual(parentTipIdentity(work),{height:100,tip_hash:A});
});

test('MTS-02 generation is monotonic and old callbacks are rejected after replacement',()=>{
  const model=new MiningSessionIdentityModel({sessionId:'session-002'});
  const first=model.bindWork({network:NETWORK,header:header(101,A),rewardAddress:reward});
  assert.equal(model.classifyWorkerEvent({generation:first.generation,type:'progress'}).accepted,true);

  const second=model.bindWork({network:NETWORK,header:header(102,B),rewardAddress:reward});
  assert.equal(second.generation,first.generation+1);
  assert.deepEqual(
    model.classifyWorkerEvent({generation:first.generation,type:'solution'}),
    {
      accepted:false,
      reason:'STALE_GENERATION',
      event_generation:first.generation,
      current_generation:second.generation
    }
  );
  assert.equal(model.classifyWorkerEvent({generation:second.generation,type:'progress'}).accepted,true);
});

test('MTS-02 invalidated current generation rejects queued progress and solution events',()=>{
  const model=new MiningSessionIdentityModel({sessionId:'session-003'});
  const work=model.bindWork({network:NETWORK,header:header(101,A),rewardAddress:reward});
  const invalidation=model.invalidateCurrent('TIP_INVALIDATED');
  assert.equal(invalidation.changed,true);
  for(const type of ['progress','solution','error']){
    const result=model.classifyWorkerEvent({generation:work.generation,type});
    assert.equal(result.accepted,false);
    assert.equal(result.reason,'INVALIDATED_GENERATION');
  }
});

test('MTS-03 exact parent tip is current even if unrelated/mempool fields change',()=>{
  const work=makeWorkIdentity({network:NETWORK,header:header(101,A),rewardAddress:reward,generation:1,sessionId:'s'});
  const result=classifyAuthoritativeTip({
    work,
    observation:{ok:true,height:100,tip_hash:A,mempool_version:999,balance_version:4}
  });
  assert.equal(result.state,TIP_OBSERVER_STATES.CURRENT);
  assert.equal(result.reason,'PARENT_TIP_MATCH');
});

test('MTS-03 same-height different hash is stale because parent was replaced',()=>{
  const work=makeWorkIdentity({network:NETWORK,header:header(101,A),rewardAddress:reward,generation:1,sessionId:'s'});
  const result=classifyAuthoritativeTip({work,observation:{ok:true,height:100,tip_hash:B}});
  assert.equal(result.state,TIP_OBSERVER_STATES.STALE);
  assert.equal(result.reason,'PARENT_REPLACED');
});

test('MTS-03 higher authoritative height is stale regardless of hash',()=>{
  const work=makeWorkIdentity({network:NETWORK,header:header(101,A),rewardAddress:reward,generation:1,sessionId:'s'});
  const result=classifyAuthoritativeTip({work,observation:{ok:true,height:101,tip_hash:B}});
  assert.equal(result.state,TIP_OBSERVER_STATES.STALE);
  assert.equal(result.reason,'CHAIN_ADVANCED');
});

test('MTS-03 observer behind work parent is unknown rather than a false-positive cancellation',()=>{
  const work=makeWorkIdentity({network:NETWORK,header:header(101,A),rewardAddress:reward,generation:1,sessionId:'s'});
  const result=classifyAuthoritativeTip({work,observation:{ok:true,height:99,tip_hash:C}});
  assert.equal(result.state,TIP_OBSERVER_STATES.UNKNOWN);
  assert.equal(result.reason,'OBSERVER_BEHIND_WORK_PARENT');
});

test('MTS-03 transport failure and malformed response are unknown',()=>{
  const work=makeWorkIdentity({network:NETWORK,header:header(101,A),rewardAddress:reward,generation:1,sessionId:'s'});
  assert.equal(classifyAuthoritativeTip({work,observation:{ok:false,error:'offline'}}).state,TIP_OBSERVER_STATES.UNKNOWN);
  assert.equal(classifyAuthoritativeTip({work,observation:{ok:true,height:100,tip_hash:'bad'}}).state,TIP_OBSERVER_STATES.UNKNOWN);
});

test('MTS-03 cross-tab signal is only a revalidation hint, never chain authority',()=>{
  const result=classifyCrossTabHint({height:101,tip_hash:B});
  assert.equal(result.state,TIP_OBSERVER_STATES.REVALIDATE);
  assert.equal(result.authoritative,false);
  assert.equal(result.reason,'UNTRUSTED_ACCELERATION_HINT');
  assert.equal(TIP_OBSERVER_CONTRACT.same_device_hint_is_authority,false);
});

console.log('MTS-02 work identity and MTS-03 tip observer contract tests passed.');
