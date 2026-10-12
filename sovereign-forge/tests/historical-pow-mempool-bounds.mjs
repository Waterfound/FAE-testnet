import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';

import {
  NETWORK,MAX_MEMPOOL_TXS,MAX_TRANSACTION_BYTES,
  emptyState,acceptTxInto,verifyTxCrypto,txPayload
} from '../node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../node/authoritative/canonical.mjs';
import {sha256} from '../node/authoritative/crypto.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  return{
    privateKey,
    pub:spki.toString('base64'),
    address:encodeAddress(sha256(spki).subarray(0,20),'faet')
  };
}

function signedSelfSpend(owner,input,amount='100000000'){
  const unsigned={
    version:2,network:NETWORK,inputs:[input],
    outputs:[{address:owner.address,amount_atoms:amount}],
    public_key_spki:owner.pub
  };
  const signature=nodeSign(
    null,
    Buffer.from(stableStringify(txPayload({...unsigned,signature:''}))),
    owner.privateKey
  ).toString('base64');
  return{...unsigned,signature};
}

test('PF-11 valid zero-fee pending chain is deterministically bounded by mempool policy',()=>{
  assert.equal(MAX_MEMPOOL_TXS,4096);
  const owner=wallet(),state=emptyState();
  state.utxos['brownout-seed:0']={
    outpoint:'brownout-seed:0',
    address:owner.address,
    amount_atoms:'100000000',
    created_height:0,
    spent:false,
    spent_by:null
  };

  let outpoint='brownout-seed:0';
  for(let i=0;i<MAX_MEMPOOL_TXS;i++){
    const record=acceptTxInto(state,signedSelfSpend(owner,outpoint));
    outpoint=record.txid+':0';
  }
  assert.equal(state.mempoolOrder.length,MAX_MEMPOOL_TXS);
  const before=stableStringify(state);
  assert.throws(
    ()=>acceptTxInto(state,signedSelfSpend(owner,outpoint)),
    error=>String(error.code||error.message)==='mempool_full'
  );
  assert.equal(stableStringify(state),before,'rejected over-cap transaction mutated mempool state');
});

test('PF-11 oversized normalized transaction is rejected before cryptographic parsing',()=>{
  assert.equal(MAX_TRANSACTION_BYTES,16*1024);
  const result=verifyTxCrypto({
    version:2,
    network:NETWORK,
    inputs:['x'],
    outputs:[{address:'x',amount_atoms:'1'}],
    public_key_spki:'A'.repeat(MAX_TRANSACTION_BYTES+1024),
    signature:''
  });
  assert.equal(result.ok,false);
  assert.equal(result.error,'transaction_too_large');
});

console.log(JSON.stringify({
  status:'PASS_IF_NODE_TESTS_COMPLETE',
  scope:'PF-11 valid-mempool boundedness',
  max_mempool_txs:MAX_MEMPOOL_TXS,
  max_transaction_bytes:MAX_TRANSACTION_BYTES,
  authority:'CANDIDATE_ASSURANCE_ONLY'
}));
