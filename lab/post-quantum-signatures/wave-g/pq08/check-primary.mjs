import { readFile } from 'node:fs/promises';
import { verifyHybridTransaction, shadowTxid } from '../../wave-e/pq05/hybrid-transaction.mjs';
import { parsePublicMetadata, serializePublicMetadata } from '../../wave-e/pq06/shadow-wallet.mjs';

const input=process.argv[2];if(!input)throw new Error('input required');
const doc=JSON.parse(await readFile(input,'utf8'));
let pass=0;
for(const c of doc.cases){
  let observed=false;
  if(c.kind==='transaction'){
    const r=verifyHybridTransaction(c.value);observed=r.ok;
    if(observed&&c.expected_txid&&shadowTxid(c.value)!==c.expected_txid)throw new Error('primary txid disagreement '+c.id);
  }else if(c.kind==='wallet'){
    try{
      const m=parsePublicMetadata(c.value);observed=true;
      if(c.expected_serialized&&serializePublicMetadata(m)!==c.expected_serialized)throw new Error('primary serialization disagreement '+c.id);
    }catch{observed=false}
  }else throw new Error('unknown kind '+c.kind);
  if(observed!==c.expected)throw new Error('primary boundary disagreement '+c.id);
  pass++;
}
console.log(JSON.stringify({schema:'FAE_PQ08_PRIMARY_REPLAY_V1',result:'PASS',cases:pass},null,2));
