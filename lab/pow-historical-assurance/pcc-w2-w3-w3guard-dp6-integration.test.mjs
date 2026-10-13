/**
 * PCC-001 independent composition: verified W2 fee-shadow, frozen DP6 evidence,
 * and W3 candidate ShareCoordinator intake + async ledger guards share a tree.
 * Only simulated activationHeight=1 in a local test fixture. No live policy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as edSign} from 'node:crypto';
import {NETWORK,emptyState,txPayload,createDistributedTemplate} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {PPLNS_COINBASE_ACTIVATION_HEIGHT,MAX_COINBASE_OUTPUTS} from '../../sovereign-forge/node/authoritative/pplns-activation.mjs';
import {ShareLedger,ShareCoordinator} from '../../sovereign-forge/node/authoritative/share-coordinator.mjs';
import {simulateFeeAwareAdmission,selectFeeSensitiveTemplateCandidate} from './mempool-fee-aware-shadow-candidate.mjs';

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  return {privateKey,public_key_spki:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')};
}
function acceptedW2FeeState(){
  const w=wallet(),original=emptyState(),outpoint='pcc-integrated:0',inputAtoms=1000000n,fee=250000n;
  original.utxos[outpoint]={outpoint,address:w.address,amount_atoms:inputAtoms.toString(),created_height:0,spent:false,spent_by:null};
  const before=stableStringify(original),unsigned={
    version:2,network:NETWORK,inputs:[outpoint],outputs:[{address:w.address,amount_atoms:(inputAtoms-fee).toString()}],
    public_key_spki:w.public_key_spki
  };
  const signature=edSign(null,Buffer.from(stableStringify(txPayload({...unsigned,signature:''}))),w.privateKey).toString('base64');
  const result=simulateFeeAwareAdmission(original,{...unsigned,signature});
  assert.equal(result.decision,'admitted_without_eviction');
  assert.equal(stableStringify(original),before,'W2 simulation must preserve authoritative state');
  assert.equal(result.fee_atoms,fee.toString());
  const selected=selectFeeSensitiveTemplateCandidate(result.state,{limit:1});
  assert.deepEqual(selected.txids,[result.admitted]);
  assert.equal(selected.fee_atoms,fee.toString());
  return {w,fee,result};
}
function ledgerWithDistinctPayees(count){
  const ledger=new ShareLedger({windowSize:2048}),addresses=[];
  for(let i=0;i<count;i++){
    const bytes=Buffer.alloc(20);
    bytes.writeUInt16BE(i+1,18);
    const address=encodeAddress(bytes,'faet');
    addresses.push(address);
    ledger.append({jobId:'PCC-W3-'+i,address,nonce:i,hash:'0'.repeat(64),
      shareDifficultyBits:8,blockDifficultyBits:18,height:1,previousBlockHash:'0'.repeat(64)});
  }
  addresses.sort();
  return {ledger,addresses};
}

test('PCC-W2W3DP6-01: signed fee candidate creates source-bound PPLNS test template and exact subsidy-plus-fee payout, without live activation',async()=>{
  const {result,fee}=acceptedW2FeeState();
  const {ledger,addresses}=ledgerWithDistinctPayees(2);
  let providerCalls=0,latestChain=null;
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,candidateHasher:async()=>{throw new Error('unexpected hash');},
    statusProvider:async()=>latestChain,
    distributedTemplateProvider:async({weights})=>{
      providerCalls++;
      const template=createDistributedTemplate(result.state,weights,{activationHeight:1});
      latestChain={network:NETWORK,height:Number(template.header.height)-1,tip_hash:template.header.previous_hash};
      return template;
    }
  });
  coordinator.ledger=ledger;
  const stateBefore=stableStringify(result.state),work=await coordinator.createWork(addresses[0]);
  assert.equal(providerCalls,1);
  assert.equal(work.txids.length,1);
  assert.deepEqual(work.txids,[result.admitted]);
  assert.equal(work.header.fee_atoms,fee.toString());
  const payout=work.coinbase_outputs.reduce((s,x)=>s+BigInt(x.amount_atoms),0n);
  assert.equal(payout,BigInt(work.header.reward_atoms)+fee);
  assert.equal(work.header.coinbase_mode,'pplns-direct');
  assert.equal(work.header.miner_address,work.coinbase_outputs[0].address);
  assert.equal(coordinator.jobs.size,1);
  assert.equal(stableStringify(result.state),stateBefore);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null,'source economic activation must remain frozen');
});

test('PCC-W2W3DP6-02: W2 signed fee state cannot bypass W3 256-payee admission fence or reach provider',async()=>{
  const {result}=acceptedW2FeeState();
  const {ledger,addresses}=ledgerWithDistinctPayees(MAX_COINBASE_OUTPUTS+1);
  let providerCalls=0;
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,candidateHasher:async()=>{throw new Error('unexpected hash');},
    distributedTemplateProvider:async({weights})=>{
      providerCalls++;
      return createDistributedTemplate(result.state,weights,{activationHeight:1});
    }
  });
  coordinator.ledger=ledger;
  const before=stableStringify(result.state);
  await assert.rejects(coordinator.createWork(addresses[0]),e=>e.code==='candidate_pplns_output_capacity_exceeded');
  assert.equal(providerCalls,0,'external provider must never observe invalid payout cardinality');
  assert.equal(coordinator.jobs.size,0,'no signed invalid payout job');
  assert.equal(ledger.summary().totalShares,MAX_COINBASE_OUTPUTS+1);
  assert.equal(stableStringify(result.state),before);
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});

test('PCC-CF11..13: authentic signed W2 fee candidate fails closed under stale tip, height, wrong-network or absent chain status',async()=>{
  const scenarios=[
    {name:'tip',code:'candidate_pplns_chain_state_changed_during_template'},
    {name:'height',code:'candidate_pplns_chain_state_changed_during_template'},
    {name:'network',code:'candidate_pplns_chain_status_incomplete'},
    {name:'missing_tip',code:'candidate_pplns_chain_status_incomplete'},
    {name:'offline',code:'unreachable_authoritative_status'}
  ];
  for(const scenario of scenarios){
    const {result,fee}=acceptedW2FeeState(),{ledger,addresses}=ledgerWithDistinctPayees(2);
    let chain=null,templateCalls=0;
    const before=stableStringify(result.state),coordinator=new ShareCoordinator({
      multiOutputCoinbaseActive:true,
      candidateHasher:async()=>{throw new Error('unexpected hash')},
      statusProvider:async()=>{
        if(scenario.name==='offline')throw new Error('unreachable_authoritative_status');
        return chain;
      },
      distributedTemplateProvider:async({weights})=>{
        templateCalls++;
        const template=createDistributedTemplate(result.state,weights,{activationHeight:1});
        chain={network:NETWORK,height:Number(template.header.height)-1,tip_hash:template.header.previous_hash};
        if(scenario.name==='tip')chain.tip_hash=(chain.tip_hash[0]==='0'?'1':'0')+chain.tip_hash.slice(1);
        if(scenario.name==='height')chain.height++;
        if(scenario.name==='network')chain.network='wrong-network';
        if(scenario.name==='missing_tip')delete chain.tip_hash;
        assert.equal(template.header.fee_atoms,fee.toString());
        return template;
      }
    });
    coordinator.ledger=ledger;
    await assert.rejects(coordinator.createWork(addresses[0]),e=>e.code===scenario.code||e.message===scenario.code,scenario.name);
    assert.equal(templateCalls,1,scenario.name);
    assert.equal(coordinator.jobs.size,0,'no stale or unauthorized source job may be signed');
    assert.equal(stableStringify(result.state),before,'W2 signed mempool state must remain intact');
    assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
  }
});

test('PCC-CF14: valid signed W2 fee candidate cannot sign stale source PPLNS share window changed during template construction',async()=>{
  const {result}=acceptedW2FeeState(),{ledger,addresses}=ledgerWithDistinctPayees(2);
  let chain=null;
  const coordinator=new ShareCoordinator({
    multiOutputCoinbaseActive:true,
    candidateHasher:async()=>{throw new Error('unexpected hash')},
    statusProvider:async()=>chain,
    distributedTemplateProvider:async({weights})=>{
      const template=createDistributedTemplate(result.state,weights,{activationHeight:1});
      chain={network:NETWORK,height:Number(template.header.height)-1,tip_hash:template.header.previous_hash};
      ledger.append({jobId:'PCC-CF14-concurrent',address:addresses[0],nonce:911,hash:'0'.repeat(64),
        shareDifficultyBits:8,blockDifficultyBits:18,height:1,previousBlockHash:'0'.repeat(64)});
      return template;
    }
  });
  coordinator.ledger=ledger;
  await assert.rejects(coordinator.createWork(addresses[0]),e=>e.code==='candidate_pplns_source_window_changed_during_template');
  assert.equal(coordinator.jobs.size,0);
  assert.equal(ledger.summary().totalShares,3,'new legitimate share is not silently discarded');
  assert.equal(PPLNS_COINBASE_ACTIVATION_HEIGHT,null);
});
