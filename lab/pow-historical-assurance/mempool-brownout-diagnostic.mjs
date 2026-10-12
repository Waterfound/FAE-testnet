import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as nodeSign} from 'node:crypto';

import {
  NETWORK,emptyState,acceptTxInto,txPayload
} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';
import {sha256} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {encodeAddress} from '../../sovereign-forge/node/authoritative/address.mjs';

function wallet(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const spki=publicKey.export({format:'der',type:'spki'});
  return{
    privateKey,
    pub:spki.toString('base64'),
    address:encodeAddress(sha256(spki).subarray(0,20),'faet')
  };
}

function signedTx(owner,input,amount){
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

const requested=Number(process.env.FAE_BROWNOUT_TXS||4096);
const target=Math.max(100,Math.min(20000,Number.isSafeInteger(requested)?requested:4096));
const requireBound=process.env.FAE_BROWNOUT_REQUIRE_BOUND==='1';

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
let accepted=0,rejection=null;
const heapBefore=process.memoryUsage().heapUsed;
const started=process.hrtime.bigint();

for(let i=0;i<target;i++){
  const tx=signedTx(owner,outpoint,'100000000');
  try{
    const record=acceptTxInto(state,tx);
    accepted++;
    outpoint=record.txid+':0';
  }catch(error){
    rejection=String(error.code||error.message);
    break;
  }
}

const elapsedMs=Number(process.hrtime.bigint()-started)/1e6;
const heapAfter=process.memoryUsage().heapUsed;
const serializedBytes=Buffer.byteLength(JSON.stringify(state));
const bounded=rejection!==null&&/mempool|capacity|limit|full|resource/i.test(rejection);
const status=bounded?'BOUNDED_BY_POLICY':(rejection?'REJECTED_OTHER_REASON':'CURRENT_GAP_REPRODUCED_TO_TEST_CEILING');

const result={
  schema:'FAE_VALID_MEMPOOL_BROWNOUT_DIAGNOSTIC_V1',
  status,
  requested_transactions:target,
  accepted_transactions:accepted,
  rejection,
  mempool_order:state.mempoolOrder.length,
  mempool_outputs:Object.keys(state.mempoolOutputs).length,
  mempool_spends:Object.keys(state.mempoolSpends).length,
  serialized_state_bytes:serializedBytes,
  elapsed_ms:elapsedMs,
  heap_delta_bytes:heapAfter-heapBefore,
  interpretation:bounded
    ?'A deterministic admission bound was observed before the diagnostic ceiling.'
    :'No deterministic global mempool admission bound was observed before the diagnostic ceiling.',
  authority:'DIAGNOSTIC_ONLY'
};

console.log(JSON.stringify(result,null,2));
if(requireBound)assert.equal(bounded,true,'valid mempool pressure reached diagnostic ceiling without a deterministic admission bound');
