import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {
  NETWORK,emptyState,appendBlockFromFeed,appendBlockFromSubmission,createMiningTemplate,txPayload
} from '../node/authoritative/fae-v4-core.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {stableStringify} from '../node/authoritative/canonical.mjs';
import {CODEC_STATUS} from '../node/authoritative/consensus-codec-v3.mjs';
import {
  SHADOW_CODEC_STATUS,assertShadowCodecIsNonAuthoritative,
  encodeCurrentV4BlockShadow,decodeCurrentV4BlockShadow,
  encodeCurrentV4TransactionShadow,decodeCurrentV4TransactionShadow
} from '../node/authoritative/consensus-v3-shadow-codec.mjs';
import {
  SHADOW_HARNESS_STATUS,shadowBlockParity,shadowTransactionParity,assertShadowParity
} from '../node/authoritative/consensus-v3-shadow-harness.mjs';

function legacyState(){let state=emptyState();for(const block of legacyBlocks)state=appendBlockFromFeed(state,block,new Map(),{activationHeight:null});return state}
function wallet(){const{privateKey,publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return{privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')}}
function signTx(owner,inputs,outputs,extra={}){const tx={version:2,network:NETWORK,inputs:[...inputs],outputs:outputs.map(output=>({...output})),public_key_spki:owner.pub};return{...tx,signature:nodeSign(null,Buffer.from(stableStringify(txPayload(tx))),owner.privateKey).toString('base64'),...extra}}
function mineCandidate(template){for(let nonce=0;nonce<12_000_000;nonce++){const hash=hashHex({...template.header,nonce});if(leadingZeroBits(hash)>=template.header.difficulty_bits)return{header:structuredClone(template.header),nonce,hash,txids:[...(template.txids||[])],...(template.coinbase_outputs?{coinbase_outputs:structuredClone(template.coinbase_outputs)}:{})}}throw new Error('PoW search exhausted')}
function mutate(candidate,fn){const copy=structuredClone(candidate);fn(copy);return copy}

function assertParity(report,label){assert.doesNotThrow(()=>assertShadowParity(report),`${label}: ${JSON.stringify(report)}`);assert.equal(report.parity,true,label)}

test('v3 shadow activation harness is cryptographically/architecturally fenced from consensus authority',()=>{
  assert.equal(CODEC_STATUS,'candidate-not-active-consensus');
  assert.equal(SHADOW_CODEC_STATUS,'shadow-only-not-consensus');
  assert.equal(SHADOW_HARNESS_STATUS,'dual-validation-observer-only');
  assert.equal(assertShadowCodecIsNonAuthoritative(),true);
});

test('current-v4 block shadow codec is strict, lossless for valid direct and activated-coinbase blocks, and rejects malformed frames',()=>{
  const state=legacyState(),miner=wallet();
  for(const activationHeight of [null,12]){
    const candidate=mineCandidate(createMiningTemplate(state,miner.address,{activationHeight})),encoded=encodeCurrentV4BlockShadow(candidate),decoded=decodeCurrentV4BlockShadow(encoded);
    assert.deepEqual(decoded,candidate);
    assert.throws(()=>decodeCurrentV4BlockShadow(Buffer.concat([encoded,Buffer.from([0])])),/trailing_bytes/);
    const wrongMagic=Buffer.from(encoded);wrongMagic[0]^=0xff;assert.throws(()=>decodeCurrentV4BlockShadow(wrongMagic),/magic_mismatch/);
    assert.throws(()=>decodeCurrentV4BlockShadow(encoded.subarray(0,encoded.length-1)),/truncated_shadow_payload/);
  }
});

test('block dual-validation preserves every accepted current-v4 decision and rejects adversarial mutations',()=>{
  const state=legacyState(),miner=wallet(),valid=mineCandidate(createMiningTemplate(state,miner.address,{activationHeight:null}));
  const accepted=shadowBlockParity(state,valid,{activationHeight:null});assertParity(accepted,'valid direct block');assert.equal(accepted.authoritative.accepted,true);assert.equal(accepted.codec.semanticLossless,true);assert.equal(accepted.stateEqual,true);

  const previousTs=Number(state.chain.at(-1).timestamp_ms),cases=[
    ['wrong-network',c=>{c.header.network='fairyelf-wrong-network'}],
    ['stale-height',c=>{c.header.height+=1}],
    ['wrong-prevhash',c=>{c.header.previous_hash='f'.repeat(64)}],
    ['wrong-difficulty',c=>{c.header.difficulty_bits+=1}],
    ['wrong-reward',c=>{c.header.reward_atoms=(BigInt(c.header.reward_atoms)+1n).toString()}],
    ['wrong-tx-root',c=>{c.header.tx_root='f'.repeat(64)}],
    ['wrong-tx-count',c=>{c.header.tx_count+=1}],
    ['timestamp-regression',c=>{c.header.timestamp_ms=previousTs-1}],
    ['bad-miner',c=>{c.header.miner_address='faet1invalid'}],
    ['premature-fee-fields',c=>{c.header.fee_atoms='0';c.header.coinbase_root='0'.repeat(64);c.header.coinbase_count=1;c.header.coinbase_mode='direct'}],
    ['premature-coinbase-outputs',c=>{c.coinbase_outputs=[{address:miner.address,amount_atoms:c.header.reward_atoms}]}],
    ['negative-nonce',c=>{c.nonce=-1}],
    ['forged-hash',c=>{c.hash='f'.repeat(64)}]
  ];
  for(const[name,change]of cases){const report=shadowBlockParity(state,mutate(valid,change),{activationHeight:null});assertParity(report,name);assert.equal(report.authoritative.accepted,false,name)}
});

test('activated direct coinbase fields also remain lossless under shadow validation without activating v3 itself',()=>{
  const state=legacyState(),miner=wallet(),candidate=mineCandidate(createMiningTemplate(state,miner.address,{activationHeight:12}));
  const report=shadowBlockParity(state,candidate,{activationHeight:12});assertParity(report,'activated coinbase block');
  assert.equal(report.authoritative.accepted,true);assert.equal(report.codec.semanticLossless,true);assert.equal(report.stateEqual,true);
  assert.equal(CODEC_STATUS,'candidate-not-active-consensus');assert.equal(SHADOW_CODEC_STATUS,'shadow-only-not-consensus');
});

test('transaction dual-validation preserves accepted state exactly across a valid-value corpus',()=>{
  const base=legacyState(),owner=wallet(),recipient=wallet(),block=mineCandidate(createMiningTemplate(base,owner.address,{activationHeight:null})),state=appendBlockFromSubmission(base,block,{activationHeight:null}),input=`${block.hash}:0`;
  const amounts=['1','1000','1000000','100000000','333333333','500000000','750000000','999998999'];
  for(const amount of amounts){
    const send=BigInt(amount),fee=1001n,change=1_000_000_000n-send-fee;if(change<=0n)continue;
    const tx=signTx(owner,[input],[{address:recipient.address,amount_atoms:send.toString()},{address:owner.address,amount_atoms:change.toString()}]);
    const report=shadowTransactionParity(state,tx);assertParity(report,`accepted amount ${amount}`);assert.equal(report.authoritative.accepted,true);assert.equal(report.codec.semanticLossless,true);assert.equal(report.stateEqual,true);assert.equal(report.authoritative.txid,report.shadow.txid);assert.equal(report.authoritative.feeAtoms,fee.toString());
  }
});

test('transaction dual-validation rejects wrong network/version/signature, malformed ownership and economic attacks',()=>{
  const base=legacyState(),owner=wallet(),recipient=wallet(),attacker=wallet(),block=mineCandidate(createMiningTemplate(base,owner.address,{activationHeight:null})),state=appendBlockFromSubmission(base,block,{activationHeight:null}),input=`${block.hash}:0`,missing=`${'f'.repeat(64)}:0`;
  const valid=signTx(owner,[input],[{address:recipient.address,amount_atoms:'100000000'},{address:owner.address,amount_atoms:'899999000'}]);
  const cases=[
    ['wrong-version',{...valid,version:3}],
    ['wrong-network',signTx(owner,[input],[{address:recipient.address,amount_atoms:'100000000'}],{network:'wrong-network'})],
    ['bad-signature',{...valid,signature:Buffer.alloc(64,7).toString('base64')}],
    ['bad-address',signTx(owner,[input],[{address:'faet1invalid',amount_atoms:'100000000'}])],
    ['overspend',signTx(owner,[input],[{address:recipient.address,amount_atoms:'1000000001'}])],
    ['duplicate-input',signTx(owner,[input,input],[{address:recipient.address,amount_atoms:'100000000'}])],
    ['missing-input',signTx(owner,[missing],[{address:recipient.address,amount_atoms:'1'}])],
    ['input-not-owned',signTx(attacker,[input],[{address:recipient.address,amount_atoms:'1'}])],
    ['txid-mismatch',{...valid,txid:'0'.repeat(64)}],
    ['from-key-mismatch',{...valid,from_address:attacker.address}]
  ];
  for(const[name,tx]of cases){const report=shadowTransactionParity(state,tx);assertParity(report,name);assert.equal(report.authoritative.accepted,false,name)}
});

test('current-v4 transaction shadow codec rejects trailing, truncated and wrong-magic binary frames',()=>{
  const owner=wallet(),recipient=wallet(),tx=signTx(owner,[`${'a'.repeat(64)}:0`],[{address:recipient.address,amount_atoms:'1'}]),encoded=encodeCurrentV4TransactionShadow(tx);
  assert.deepEqual(decodeCurrentV4TransactionShadow(encoded),tx);
  assert.throws(()=>decodeCurrentV4TransactionShadow(Buffer.concat([encoded,Buffer.from([0])])),/trailing_bytes/);
  assert.throws(()=>decodeCurrentV4TransactionShadow(encoded.subarray(0,encoded.length-1)),/truncated_shadow_payload/);
  const wrongMagic=Buffer.from(encoded);wrongMagic[0]^=0xff;assert.throws(()=>decodeCurrentV4TransactionShadow(wrongMagic),/magic_mismatch/);
});
