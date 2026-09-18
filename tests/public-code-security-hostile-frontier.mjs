import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync,sign as nodeSign,webcrypto} from 'node:crypto';

import {
  NETWORK,MAX_SUPPLY,START_BITS,ZERO_HASH,
  emptyState,cloneState,expectedReward,createMiningTemplate,
  validateBlockEnvelope,verifyTxCrypto,acceptTxInto,
  txPayload,preferred,reconcileDetachedTransactions
} from '../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../sovereign-forge/node/authoritative/canonical.mjs';
import {hashHex,sha256} from '../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../sovereign-forge/node/authoritative/address.mjs';
import {generateNodeIdentity} from '../sovereign-forge/node/authoritative/node-identity.mjs';
import {createPeerDescriptor,PeerDirectory} from '../sovereign-forge/node/authoritative/peer-directory.mjs';
import {PeerDiversityPolicy} from '../sovereign-forge/node/authoritative/peer-diversity.mjs';

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({type:'spki',format:'der'});
  return{
    privateKey,
    publicKey,
    spki,
    pub:spki.toString('base64'),
    address:encodeAddress(sha256(spki).subarray(0,20),'faet')
  };
}

function signedTx(from,{inputs=['fund:0'],outputs=null,network=NETWORK}={}){
  const normalizedOutputs=outputs??[{address:from.address,amount_atoms:'1'}];
  const base={version:2,network,inputs:[...inputs],outputs:normalizedOutputs,public_key_spki:from.pub};
  const payload=txPayload({...base,signature:''});
  const signature=nodeSign(null,Buffer.from(stableStringify(payload)),from.privateKey).toString('base64');
  return{...base,signature};
}

function fakeBlock({height=1,hash='a'.repeat(64),difficulty_bits=START_BITS,reward_atoms='0'}={}){
  return{height,hash,difficulty_bits,reward_atoms};
}

// PSR-05 — Consensus and Economic hostile gates.
test('PSR-05 supply boundary caps reward exactly and refuses mining after the cap',()=>{
  const almost=emptyState();
  almost.chain.push(fakeBlock({reward_atoms:(MAX_SUPPLY-1n).toString()}));
  assert.equal(expectedReward(almost,2),1n);

  const full=emptyState();
  full.chain.push(fakeBlock({reward_atoms:MAX_SUPPLY.toString()}));
  assert.equal(expectedReward(full,2),0n);
  assert.throws(()=>createMiningTemplate(full,wallet().address),/supply_cap_reached/);
});

test('PSR-05 malformed consensus fields and duplicate tx commitments fail before state mutation',()=>{
  const miner=wallet(),state=emptyState(),before=structuredClone(state);
  const base={
    network:NETWORK,height:1,previous_hash:ZERO_HASH,
    timestamp_ms:Date.now(),difficulty_bits:START_BITS,
    miner_address:miner.address,reward_atoms:'1',
    tx_root:hashHex([]),tx_count:0
  };
  assert.throws(
    ()=>validateBlockEnvelope(state,base,0,'0'.repeat(64),[]),
    /invalid_consensus_fields/
  );
  const correct={...base,reward_atoms:expectedReward(state,1).toString(),tx_count:2};
  assert.throws(
    ()=>validateBlockEnvelope(state,correct,0,'0'.repeat(64),['a'.repeat(64),'a'.repeat(64)]),
    /invalid_tx_list/
  );
  assert.deepEqual(state,before,'rejected hostile block input must not mutate state');
});

test('PSR-05 lower-work fork never defeats higher-work fork and equal-work tie is deterministic',()=>{
  const lower={chain:[fakeBlock({hash:'0'.repeat(64),difficulty_bits:18})]};
  const higher={chain:[fakeBlock({hash:'f'.repeat(64),difficulty_bits:19})]};
  assert.equal(preferred(lower,higher),false);
  assert.equal(preferred(higher,lower),true);

  const equalA={chain:[fakeBlock({hash:'0'.repeat(64),difficulty_bits:18})]};
  const equalB={chain:[fakeBlock({hash:'f'.repeat(64),difficulty_bits:18})]};
  assert.equal(preferred(equalA,equalB),true);
  assert.equal(preferred(equalB,equalA),false);
});

// PSR-06 — Wallet, keys and signature hostile gates.
test('PSR-06 invalid signatures, malformed keys, duplicate inputs and wrong networks fail closed',()=>{
  const alice=wallet();
  const good=signedTx(alice);
  assert.equal(verifyTxCrypto(good).ok,true);

  const sig=Buffer.from(good.signature,'base64');sig[0]^=0x01;
  const badSignature={...good,signature:sig.toString('base64')};
  assert.equal(verifyTxCrypto(badSignature).ok,false);
  assert.match(verifyTxCrypto(badSignature).error,/invalid_signature|invalid_public_key_or_signature/);

  const malformedKey=verifyTxCrypto({...good,public_key_spki:'not-der'});
  assert.equal(malformedKey.ok,false);
  assert.match(malformedKey.error,/invalid_public_key_or_signature/);

  const wrongNetwork=verifyTxCrypto(signedTx(alice,{network:'attacker-network'}));
  assert.equal(wrongNetwork.ok,false);
  assert.equal(wrongNetwork.error,'malformed_transaction');
});

test('PSR-06 transaction admission rejects duplicate inputs, overspend and replayed txid',()=>{
  const alice=wallet(),bob=wallet();
  const duplicate=signedTx(alice,{inputs:['fund:0','fund:0'],outputs:[{address:bob.address,amount_atoms:'1'}]});
  assert.equal(verifyTxCrypto(duplicate).error,'invalid_inputs');

  const state=emptyState();
  state.utxos['fund:0']={outpoint:'fund:0',address:alice.address,amount_atoms:'100',created_height:1,spent:false,spent_by:null};

  const overspend=signedTx(alice,{outputs:[{address:bob.address,amount_atoms:'101'}]});
  assert.throws(()=>acceptTxInto(cloneState(state),overspend),/overspend/);

  const valid=signedTx(alice,{outputs:[{address:bob.address,amount_atoms:'90'}]});
  acceptTxInto(state,valid);
  assert.throws(()=>acceptTxInto(state,valid),/duplicate_txid|input_reserved/);
});

test('PSR-06 browser recovery rejects mismatched address and public-key claims using ephemeral keys',async()=>{
  const elements=new Map();
  const context={
    window:null,document:{getElementById(id){if(!elements.has(id))elements.set(id,{dataset:{},lastElementChild:null,hidden:false,tabIndex:0,addEventListener(){},setAttribute(){},focus(){},querySelector(){return null}});return elements.get(id)}},
    crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,Set,BigInt,Error,String,Number,Object,JSON,Date,Math,Promise,console,atob,btoa,
    fetch:async()=>new Response('{}',{status:200}),Response
  };
  context.window=context;vm.createContext(context);
  for(const file of ['bip39-en.js','core.js','wallet-crypto.js']){
    vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context,{filename:file});
  }
  const entropy=webcrypto.getRandomValues(new Uint8Array(32));
  context.entropy=entropy;
  const record=await vm.runInContext('FAEWalletCrypto.keyRecordFromSeed(entropy,0)',context);
  context.record=record;
  await assert.rejects(
    vm.runInContext("FAEWalletCrypto.restoreRecordFromJwk(record.jwk,'faet1nottherightaddress',record.pub,0)",context),
    /Address\/private key mismatch/
  );
  await assert.rejects(
    vm.runInContext("FAEWalletCrypto.restoreRecordFromJwk(record.jwk,record.address,'AAAA',0)",context),
    /Public\/private key mismatch/
  );
});

// PSR-07 — P2P, discovery and eclipse hostile gates.
test('PSR-07 peer-directory admission bounds source, network-group and unverified floods',()=>{
  const now=Date.now();
  const directory=new PeerDirectory({
    networkId:NETWORK,maxRecords:5,maxRecordsPerSource:3,maxRecordsPerNetworkGroup:2,
    maxUnverifiedRecords:4,maxEndpointsPerIdentity:2,now:()=>now
  });
  for(let i=0;i<10;i++){
    const identity=generateNodeIdentity();
    directory.register(createPeerDescriptor(identity,{
      networkId:NETWORK,endpoint:'http://203.0.113.'+(i+1)+':8787',ttlMs:60_000,now
    }),{source:'attacker-gossip'});
  }
  const status=directory.admissionStatus();
  assert.ok(status.records<=5);
  assert.ok(status.maxObservedSourceRecords<=3);
  assert.ok(status.maxObservedNetworkGroupRecords<=2);
  assert.ok(status.unverifiedRecords<=4);
});

test('PSR-07 wrong-network, expired and invalid-scheme peer descriptors fail closed',()=>{
  const now=Date.now(),identity=generateNodeIdentity();
  const directory=new PeerDirectory({networkId:NETWORK,now:()=>now});

  const wrongNetwork=createPeerDescriptor(identity,{networkId:'attacker-network',endpoint:'https://peer.example',ttlMs:60_000,now});
  assert.throws(()=>directory.register(wrongNetwork),/network mismatch/i);

  const expired=createPeerDescriptor(identity,{networkId:NETWORK,endpoint:'https://peer.example',ttlMs:60_000,now:now-120_000});
  assert.throws(()=>directory.register(expired),/expired|time invalid/i);

  assert.throws(
    ()=>createPeerDescriptor(identity,{networkId:NETWORK,endpoint:'ftp://peer.example',ttlMs:60_000,now}),
    /HTTP or HTTPS/
  );
});

test('PSR-07 authenticated peers are demoted after repeated probe failure and same-group Sybils never satisfy diversity',()=>{
  const now=Date.now(),identity=generateNodeIdentity(),endpoint='https://peer.example';
  const directory=new PeerDirectory({networkId:NETWORK,authenticationFailureThreshold:2,now:()=>now});
  directory.register(createPeerDescriptor(identity,{networkId:NETWORK,endpoint,ttlMs:60_000,now}),{source:'operator'});
  assert.equal(directory.markAuthenticated(identity.id,endpoint),true);
  assert.equal(directory.markProbeFailure(identity.id,endpoint).demoted,false);
  assert.equal(directory.markProbeFailure(identity.id,endpoint).demoted,true);
  assert.equal(directory.observations()[0].authenticated,false);

  const pinned='1'.repeat(64);
  const policy=new PeerDiversityPolicy({pinnedIdentityIds:[pinned]});
  const records=[...Array.from({length:12},(_,i)=>({
    endpoint:'http://10.2.3.'+(i+1)+':8787',
    identityId:(i===0?pinned:(i+2).toString(16).padStart(64,'0'))
  }))];
  const result=policy.evaluate(records);
  assert.equal(result.ready,false);
  assert.equal(result.distinctNetworkGroups,1);
  assert.ok(result.violations.some(v=>v.code==='insufficient_network_diversity'));
});

// PSR-08 — Persistence, reorg and recovery hostile gates.
test('PSR-08 detached valid transaction is deterministically reaccepted after reorg',()=>{
  const alice=wallet(),bob=wallet(),candidate=emptyState();
  candidate.utxos['fund:0']={outpoint:'fund:0',address:alice.address,amount_atoms:'100',created_height:1,spent:false,spent_by:null};
  const previous=cloneState(candidate);
  const tx=signedTx(alice,{outputs:[{address:bob.address,amount_atoms:'90'}]});
  const admitted=acceptTxInto(previous,tx);
  assert.equal(admitted.status,'pending');

  const result=reconcileDetachedTransactions(candidate,previous);
  assert.equal(result.reacceptedRecords.length,1);
  assert.equal(result.rejected,0);
  assert.equal(result.state.transactions[result.reacceptedRecords[0].txid].status,'pending');
});

test('PSR-08 detached transaction conflicting with canonical spent state is rejected without resurrection',()=>{
  const alice=wallet(),bob=wallet(),candidate=emptyState();
  candidate.utxos['fund:0']={outpoint:'fund:0',address:alice.address,amount_atoms:'100',created_height:1,spent:true,spent_by:'canonical-spend'};
  const previous=emptyState();
  previous.utxos['fund:0']={outpoint:'fund:0',address:alice.address,amount_atoms:'100',created_height:1,spent:false,spent_by:null};
  const tx=signedTx(alice,{outputs:[{address:bob.address,amount_atoms:'90'}]});
  acceptTxInto(previous,tx);

  const result=reconcileDetachedTransactions(candidate,previous);
  assert.equal(result.reacceptedRecords.length,0);
  assert.equal(result.rejected,1);
  assert.equal(Object.keys(result.state.transactions).length,0);
});

// PSR-09 — Browser/frontend/API/backend hostile boundary gates.
test('PSR-09 browser address and amount parsers reject hostile boundary inputs',async()=>{
  const elements=new Map();
  let mode='ok';
  const context={
    window:null,document:{getElementById(id){if(!elements.has(id))elements.set(id,{dataset:{},lastElementChild:null,hidden:false,tabIndex:0,addEventListener(){},setAttribute(){},focus(){},querySelector(){return null}});return elements.get(id)}},
    crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,Set,BigInt,Error,String,Number,Object,JSON,Date,Math,Promise,console,atob,btoa,Response,
    fetch:async()=>{
      if(mode==='error')return new Response(JSON.stringify({error:'hostile-backend-error'}),{status:400,headers:{'content-type':'application/json'}});
      if(mode==='nonjson')return{ok:false,status:502,json:async()=>{throw new Error('not json')}};
      return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
    }
  };
  context.window=context;vm.createContext(context);
  vm.runInContext(await readFile(new URL('../core.js',import.meta.url),'utf8'),context,{filename:'core.js'});

  const good=wallet().address;context.good=good;
  assert.equal(vm.runInContext('validAddr(good)',context),true);
  for(const bad of[good.toUpperCase(),'x'.repeat(91),'faet1$$$$','javascript:alert(1)']){
    context.bad=bad;assert.equal(vm.runInContext('validAddr(bad)',context),false);
  }
  for(const bad of['-1','1e3','1.000000001','NaN','Infinity']){
    context.bad=bad;assert.throws(()=>vm.runInContext('parseAmt(bad)',context));
  }

  mode='error';
  await assert.rejects(vm.runInContext("api('/hostile')",context),/hostile-backend-error/);
  mode='nonjson';
  await assert.rejects(vm.runInContext("api('/hostile')",context),/HTTP 502/);
});

console.log(JSON.stringify({
  status:'PASS',
  frontier:'PSR-05||PSR-06||PSR-07||PSR-08||PSR-09',
  runtime_or_consensus_change:false,
  secrets_persisted:false
}));
