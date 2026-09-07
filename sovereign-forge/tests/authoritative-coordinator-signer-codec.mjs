import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync,createPublicKey,verify as nodeVerify} from 'node:crypto';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {stableStringify} from '../node/authoritative/canonical.mjs';
import {ShareLedger,ShareCoordinator,allocatePplnsOutputs} from '../node/authoritative/share-coordinator.mjs';
import {CoordinatorRegistry} from '../node/authoritative/coordinator-registry.mjs';
import {createSendIntent,validateSendIntent} from '../node/authoritative/intent.mjs';
import {SovereignSignerCore} from '../node/authoritative/signer-core.mjs';
import {encodeHeaderV3,encodeSigningPayloadV3,encodeTransactionV3,hashHeaderV3,transactionIdV3,CODEC_STATUS} from '../node/authoritative/consensus-codec-v3.mjs';

const NETWORK='fairyelf-public-testnet-v4';
function makeWallet(){const {privateKey,publicKey}=generateKeyPairSync('ed25519');const privateJwk=privateKey.export({format:'jwk'}),spki=publicKey.export({type:'spki',format:'der'});return{privateJwk,publicKeySpki:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')}}
function findNonce(candidate,minBits,maxExclusive=Infinity){for(let nonce=0;nonce<2_000_000;nonce++){const hash=hashHex({...candidate.header,nonce});const bits=leadingZeroBits(hash);if(bits>=minBits&&bits<maxExclusive)return{nonce,hash,bits}}throw new Error('nonce search exhausted')}

test('Authoritative delayed-PPLNS ledger is persistent, hash-chained and deterministic',()=>{
  const dir=mkdtempSync(join(tmpdir(),'fae-pplns-')),logFile=join(dir,'shares.jsonl'),alice=makeWallet(),bob=makeWallet();
  const ledger=new ShareLedger({logFile,windowSize:4});
  ledger.append({jobId:'j1',address:alice.address,nonce:1,hash:'1'.repeat(64),shareDifficultyBits:4,blockDifficultyBits:8,height:12,previousBlockHash:'0'.repeat(64)});
  ledger.append({jobId:'j2',address:bob.address,nonce:2,hash:'2'.repeat(64),shareDifficultyBits:4,blockDifficultyBits:8,height:12,previousBlockHash:'0'.repeat(64)});
  ledger.append({jobId:'j3',address:alice.address,nonce:3,hash:'3'.repeat(64),shareDifficultyBits:4,blockDifficultyBits:8,height:12,previousBlockHash:'0'.repeat(64)});
  assert.equal(ledger.summary().totalShares,3);
  const weights=ledger.weights(bob.address),outputs=allocatePplnsOutputs(1000n,weights);
  assert.equal(outputs.reduce((s,o)=>s+BigInt(o.amount_atoms),0n),1000n);
  const aliceOut=outputs.find(o=>o.address===alice.address),bobOut=outputs.find(o=>o.address===bob.address);
  assert.ok(BigInt(aliceOut.amount_atoms)>BigInt(bobOut.amount_atoms));
  const replayed=new ShareLedger({logFile,windowSize:4});assert.equal(replayed.lastHash,ledger.lastHash);assert.equal(replayed.shares.length,3);
  assert.throws(()=>replayed.append({jobId:'j3',address:alice.address,nonce:3,hash:'3'.repeat(64),shareDifficultyBits:4,blockDifficultyBits:8,height:12,previousBlockHash:'0'.repeat(64)}),/Duplicate share/);
});

test('Authoritative coordinator fails closed before coinbase activation and descriptor discovery is signed',async()=>{
  const alice=makeWallet();let status={network:NETWORK,height:11,tip_hash:'a'.repeat(64),difficulty_bits:8,node_identity:'b'.repeat(64)};
  const coordinator=new ShareCoordinator({networkId:NETWORK,publicUrl:'https://coordinator.example',windowSize:32,shareDifficultyDelta:4,statusProvider:async()=>status,multiOutputCoinbaseActive:false});
  await assert.rejects(coordinator.createWork(alice.address),/activation required/);
  const descriptor=await coordinator.descriptor();const registry=new CoordinatorRegistry({networkId:NETWORK});registry.register(descriptor);assert.equal(registry.list().length,1);assert.equal(registry.list()[0].signer.id,coordinator.identity.id);
  const tampered=structuredClone(descriptor);tampered.payload.windowSize+=1;assert.throws(()=>registry.register(tampered),/signature/);
});

test('Authoritative coordinator executes share-only then full-target PPLNS round when explicitly activated',async()=>{
  const alice=makeWallet(),bob=makeWallet();let status={network:NETWORK,height:11,tip_hash:'a'.repeat(64),difficulty_bits:8};let submitted=null;
  const coordinator=new ShareCoordinator({
    networkId:NETWORK,windowSize:32,shareDifficultyDelta:4,multiOutputCoinbaseActive:true,statusProvider:async()=>status,
    distributedTemplateProvider:async({weights,fallback_address})=>{const normalized=weights.map(w=>({address:w.address,weight:BigInt(w.weight)})),payouts=allocatePplnsOutputs(1000n,normalized.length?normalized:[{address:fallback_address,weight:1n}]);return{header:{network:NETWORK,height:12,previous_hash:status.tip_hash,timestamp_ms:1788770000000,difficulty_bits:8,reward_atoms:'1000',tx_root:'c'.repeat(64),tx_count:0},txids:[],payouts}},
    candidateHasher:async(candidate,nonce)=>hashHex({...candidate.header,nonce}),blockSubmitter:async solution=>{submitted=solution;return{height:12,hash:solution.hash}}
  });
  const first=await coordinator.createWork(alice.address);const shareOnly=findNonce(first,first.targetDifficultyBits,first.blockDifficultyBits);const shareResult=await coordinator.submitShare({jobId:first.jobId,nonce:shareOnly.nonce,hash:shareOnly.hash});assert.equal(shareResult.block,null);assert.equal(shareResult.share.seq,1);
  const second=await coordinator.createWork(bob.address);assert.equal(second.payouts.length,1);assert.equal(second.payouts[0].address,alice.address,'prior PPLNS window controls direct payout');const full=findNonce(second,second.blockDifficultyBits);const blockResult=await coordinator.submitShare({jobId:second.jobId,nonce:full.nonce,hash:full.hash});assert.equal(blockResult.block.height,12);assert.ok(submitted);assert.equal(submitted.payouts[0].address,alice.address);
});

test('Sovereign signer signs current FAIRYELF_TX_V2 only after exact preview commitment approval',async()=>{
  const alice=makeWallet(),bob=makeWallet(),utxo={outpoint:`${'d'.repeat(64)}:0`,amount_atoms:'200000000'};let broadcasted=null;
  const signer=new SovereignSignerCore({wallet:alice,network:NETWORK,spendableProvider:async()=>({utxos:[utxo]}),broadcastProvider:async tx=>{broadcasted=tx;return{ok:true,txid:tx.txid}}});
  const intent=createSendIntent({networkId:NETWORK,from:alice.address,to:bob.address,amountAtomic:100000000n,feeAtomic:1000n,expiresAt:new Date(Date.now()+60_000).toISOString()});
  const staged=signer.addIntent(intent),preview=await signer.preview(staged.approvalId);assert.equal(preview.to,bob.address);assert.equal(preview.outputs.length,2);assert.match(preview.previewCommitment,/^[0-9a-f]{64}$/);
  await assert.rejects(signer.approve(staged.approvalId,'0'.repeat(64)),/Preview commitment mismatch/);
  const approved=await signer.approve(staged.approvalId,preview.previewCommitment);assert.equal(approved.privateKeyExposed,false);assert.equal(approved.previewCommitment,preview.previewCommitment);assert.ok(broadcasted);
  const payload={domain:'FAIRYELF_TX_V2',network:broadcasted.network,inputs:broadcasted.inputs,outputs:broadcasted.outputs,public_key_spki:broadcasted.public_key_spki};
  assert.equal(nodeVerify(null,Buffer.from(stableStringify(payload)),createPublicKey({key:Buffer.from(broadcasted.public_key_spki,'base64'),format:'der',type:'spki'}),Buffer.from(broadcasted.signature,'base64')),true);
  assert.equal(hashHex({version:2,network:broadcasted.network,inputs:broadcasted.inputs,outputs:broadcasted.outputs,public_key_spki:broadcasted.public_key_spki,signature:broadcasted.signature}),broadcasted.txid);
  const tampered={...intent,amountAtomic:'100000001'};assert.throws(()=>validateSendIntent(tampered,{networkId:NETWORK}),/integrity/);
});

test('Candidate binary codec preserves Authoritative 0.7 vector and current-v4 compatibility vector',()=>{
  assert.equal(CODEC_STATUS,'candidate-not-active-consensus');
  const vectors=JSON.parse(readFileSync(new URL('../protocol/CONSENSUS_CODEC_V3_VECTORS.json',import.meta.url),'utf8'));
  for(const group of [vectors.historicalAuthoritative07,vectors.currentV4Compatibility]){
    const header=group.header.value;assert.equal(encodeHeaderV3(header).toString('hex'),group.header.encodedHex);assert.equal(hashHeaderV3(header),group.header.doubleSha256);
    const v=group.regularTransaction.value,tx={version:v.version,network:v.network,inputs:v.inputs.map(input=>({txid:input.txid,index:input.index,publicKey:Buffer.from(input.publicKeyUtf8ForVector).toString('base64'),signature:Buffer.from(input.signatureUtf8ForVector).toString('base64')})),outputs:v.outputs};
    assert.equal(encodeSigningPayloadV3(tx).toString('hex'),group.regularTransaction.signingPayloadHex);assert.equal(encodeTransactionV3(tx).toString('hex'),group.regularTransaction.encodedHex);assert.equal(transactionIdV3(tx),group.regularTransaction.doubleSha256);
  }
});
