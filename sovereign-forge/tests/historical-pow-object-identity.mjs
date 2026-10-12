import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';

import {
  NETWORK,emptyState,acceptTxInto,verifyTxCrypto,txPayload,
  createMiningTemplate,validateBlockEnvelope
} from '../node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../node/authoritative/canonical.mjs';
import {hashHex,sha256} from '../node/authoritative/crypto.mjs';
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

function signedTx(owner,inputs,outputs){
  const unsigned={
    version:2,network:NETWORK,inputs:[...inputs],
    outputs:outputs.map(row=>({...row})),
    public_key_spki:owner.pub
  };
  const signature=nodeSign(
    null,
    Buffer.from(stableStringify(txPayload({...unsigned,signature:''}))),
    owner.privateKey
  ).toString('base64');
  return{...unsigned,signature};
}

function seeded(owner){
  const state=emptyState();
  state.utxos['historical-seed:0']={
    outpoint:'historical-seed:0',
    address:owner.address,
    amount_atoms:'1000000',
    created_height:0,
    spent:false,
    spent_by:null
  };
  return state;
}

test('PF-07 same claimed txid with different valid body cannot poison later valid transaction',()=>{
  const owner=wallet(),recipient=wallet();
  const valid=signedTx(owner,['historical-seed:0'],[
    {address:recipient.address,amount_atoms:'900000'}
  ]);
  const validCheck=verifyTxCrypto(valid);
  assert.equal(validCheck.ok,true);

  const alternate=signedTx(owner,['historical-seed:0'],[
    {address:recipient.address,amount_atoms:'899999'}
  ]);
  const alternateCheck=verifyTxCrypto(alternate);
  assert.equal(alternateCheck.ok,true);
  assert.notEqual(alternateCheck.txid,validCheck.txid);

  const state=seeded(owner);
  assert.throws(
    ()=>acceptTxInto(state,{...alternate,txid:validCheck.txid}),
    error=>String(error.code||error.message)==='txid_mismatch'
  );
  assert.equal(Object.keys(state.transactions).length,0);
  assert.equal(state.mempoolOrder.length,0);
  assert.equal(Object.keys(state.mempoolSpends).length,0);
  assert.equal(Object.keys(state.mempoolOutputs).length,0);

  const accepted=acceptTxInto(state,valid);
  assert.equal(accepted.txid,validCheck.txid);
  assert.equal(state.transactions[validCheck.txid].status,'pending');
});

test('PF-07 duplicate transaction commitments are rejected before PoW/state mutation',()=>{
  const owner=wallet(),recipient=wallet(),state=seeded(owner);
  const tx=signedTx(owner,['historical-seed:0'],[
    {address:recipient.address,amount_atoms:'900000'}
  ]);
  const accepted=acceptTxInto(state,tx);
  const template=createMiningTemplate(state,owner.address);
  const duplicate=[accepted.txid,accepted.txid];
  const header={
    ...template.header,
    tx_count:2,
    tx_root:hashHex(duplicate)
  };
  const before=stableStringify(state);
  assert.throws(
    ()=>validateBlockEnvelope(state,header,0,'0'.repeat(64),duplicate),
    /invalid_tx_list/
  );
  assert.equal(stableStringify(state),before);
});

test('PF-07 transaction-root/body-list mismatch is rejected before PoW/state mutation',()=>{
  const owner=wallet(),recipient=wallet(),state=seeded(owner);
  const tx=signedTx(owner,['historical-seed:0'],[
    {address:recipient.address,amount_atoms:'900000'}
  ]);
  acceptTxInto(state,tx);
  const template=createMiningTemplate(state,owner.address);
  const header={...template.header,tx_root:'f'.repeat(64)};
  const before=stableStringify(state);
  assert.throws(
    ()=>validateBlockEnvelope(state,header,0,'0'.repeat(64),template.txids),
    /tx_commitment_mismatch/
  );
  assert.equal(stableStringify(state),before);
});

console.log(JSON.stringify({
  status:'PASS_IF_NODE_TESTS_COMPLETE',
  scope:'PF-07 same-id/different-body and commitment poisoning regressions',
  authority:'ASSURANCE_ONLY'
}));
