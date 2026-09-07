import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,leadingZeroBits,sha256} from '../node/authoritative/crypto.mjs';
import {stableStringify} from '../node/authoritative/canonical.mjs';
import {emptyState,createMiningTemplate,createDistributedTemplate,appendBlockFromSubmission,acceptTxInto,issued,balanceAtoms,NETWORK} from '../node/authoritative/fae-v4-core.mjs';

function wallet(){const{privateKey,publicKey}=generateKeyPairSync('ed25519'),spki=publicKey.export({type:'spki',format:'der'});return{privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')}}
function mine(header){for(let nonce=0;nonce<10_000_000;nonce++){const hash=hashHex({...header,nonce});if(leadingZeroBits(hash)>=header.difficulty_bits)return{nonce,hash}}throw new Error('PoW search exhausted')}
function signedTx(from,inputs,outputs){const unsigned={version:2,network:NETWORK,inputs,outputs,public_key_spki:from.pub},payload={domain:'FAIRYELF_TX_V2',network:NETWORK,inputs,outputs,public_key_spki:from.pub},signature=nodeSign(null,Buffer.from(stableStringify(payload)),from.privateKey).toString('base64');return{...unsigned,signature}}

test('reconciled v4 core preserves history then activates fee-paying multi-output coinbase without inflating issuance',()=>{
  const alice=wallet(),bob=wallet(),miner=wallet();const activationHeight=2;let state=emptyState();

  const first=createMiningTemplate(state,alice.address,{activationHeight});
  assert.equal(first.header.fee_atoms,undefined);assert.equal(first.coinbase_outputs,undefined);
  const pow1=mine(first.header);state=appendBlockFromSubmission(state,{header:first.header,nonce:pow1.nonce,hash:pow1.hash,txids:first.txids},{activationHeight});
  assert.equal(issued(state),1_000_000_000n);assert.equal(balanceAtoms(state,alice.address),1_000_000_000n);

  const tx=signedTx(alice,[`${pow1.hash}:0`],[{address:bob.address,amount_atoms:'100000000'},{address:alice.address,amount_atoms:'899999000'}]);
  const accepted=acceptTxInto(state,tx);assert.equal(accepted.fee_atoms,'1000');

  const second=createMiningTemplate(state,miner.address,{activationHeight});
  assert.equal(second.header.coinbase_mode,'direct');assert.equal(second.header.fee_atoms,'1000');assert.equal(second.coinbase_outputs.length,1);assert.equal(second.coinbase_outputs[0].amount_atoms,'1000001000');assert.equal(second.header.coinbase_root,hashHex(second.coinbase_outputs));
  const pow2=mine(second.header);state=appendBlockFromSubmission(state,{header:second.header,nonce:pow2.nonce,hash:pow2.hash,txids:second.txids,coinbase_outputs:second.coinbase_outputs},{activationHeight});

  assert.equal(issued(state),2_000_000_000n,'fees must not count as new issuance');
  assert.equal(balanceAtoms(state,miner.address),1_000_001_000n,'miner receives scheduled subsidy plus validated fee');
  const unspent=Object.values(state.utxos).filter(u=>!u.spent).reduce((sum,u)=>sum+BigInt(u.amount_atoms),0n);assert.equal(unspent,2_000_000_000n,'UTXO value equals issued supply after fee redistribution');

  const distributed=createDistributedTemplate(state,[{address:alice.address,weight:2n},{address:bob.address,weight:1n}],{activationHeight});
  assert.equal(distributed.header.coinbase_mode,'pplns-direct');assert.equal(distributed.coinbase_outputs.length,2);assert.equal(distributed.coinbase_outputs.reduce((sum,o)=>sum+BigInt(o.amount_atoms),0n),1_000_000_000n);assert.equal(distributed.header.coinbase_root,hashHex(distributed.coinbase_outputs));
});

test('multi-output fields fail closed before the activation boundary',()=>{
  const miner=wallet(),activationHeight=100;const state=emptyState(),template=createMiningTemplate(state,miner.address,{activationHeight});
  const mutated={...template.header,fee_atoms:'0',coinbase_count:1,coinbase_mode:'direct',coinbase_root:hashHex([{address:miner.address,amount_atoms:'1000000000'}])},pow=mine(mutated);
  assert.throws(()=>appendBlockFromSubmission(state,{header:mutated,nonce:pow.nonce,hash:pow.hash,txids:[],coinbase_outputs:[{address:miner.address,amount_atoms:'1000000000'}]},{activationHeight}),/premature_coinbase_v1_fields/);
});
