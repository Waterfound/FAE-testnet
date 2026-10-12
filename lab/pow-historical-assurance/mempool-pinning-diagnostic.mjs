import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';

import {
  NETWORK,MAX_MEMPOOL_TXS,emptyState,acceptTxInto,txPayload
} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  return{privateKey,pub:spki.toString('base64'),address:encodeAddress(sha256(spki).subarray(0,20),'faet')};
}
function signed(owner,input,amount,fee=0n){
  const inputValue=BigInt(amount);
  const out=(inputValue-BigInt(fee)).toString();
  const unsigned={version:2,network:NETWORK,inputs:[input],outputs:[{address:owner.address,amount_atoms:out}],public_key_spki:owner.pub};
  const signature=nodeSign(null,Buffer.from(stableStringify(txPayload({...unsigned,signature:''}))),owner.privateKey).toString('base64');
  return{...unsigned,signature};
}

const attacker=wallet(),victim=wallet(),state=emptyState();
const amount='1000000000';
state.utxos['attacker:0']={outpoint:'attacker:0',address:attacker.address,amount_atoms:amount,created_height:0,spent:false,spent_by:null};
state.utxos['victim:0']={outpoint:'victim:0',address:victim.address,amount_atoms:amount,created_height:0,spent:false,spent_by:null};

let outpoint='attacker:0';
for(let i=0;i<MAX_MEMPOOL_TXS;i++){
  const tx=signed(attacker,outpoint,amount,0n);
  const rec=acceptTxInto(state,tx);
  outpoint=rec.txid+':0';
}

let victimError=null;
try{
  acceptTxInto(state,signed(victim,'victim:0',amount,1000000n));
}catch(error){
  victimError=String(error.code||error.message);
}

assert.equal(victimError,'mempool_full');
assert.equal(state.mempoolOrder.length,MAX_MEMPOOL_TXS);

console.log(JSON.stringify({
  schema:'FAE_MEMPOOL_PINNING_DIAGNOSTIC_V1',
  status:'ADMISSION_PINNING_REPRODUCED',
  attacker_transactions:MAX_MEMPOOL_TXS,
  attacker_fee_atoms_each:'0',
  victim_fee_atoms:'1000000',
  victim_rejection:victimError,
  interpretation:'The deterministic hard cap bounds memory growth, but the current full-mempool rule rejects even an unrelated higher-fee valid transaction before fee-aware admission/eviction. Resource boundedness and admission economics are therefore separate closure questions.',
  routing:{
    element_8:'resource boundedness candidate can be evaluated independently',
    element_2:'fee/security-budget and mempool admission economics must own anti-pinning policy before mainnet'
  },
  authority:'DIAGNOSTIC_ONLY'
},null,2));
