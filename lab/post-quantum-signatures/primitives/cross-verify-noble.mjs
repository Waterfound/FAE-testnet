import { readFile } from 'node:fs/promises';
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import {
  slh_dsa_sha2_128s, slh_dsa_shake_128f,
  slh_dsa_sha2_192s, slh_dsa_shake_192f,
  slh_dsa_sha2_256s, slh_dsa_shake_256f
} from '@noble/post-quantum/slh-dsa.js';

const input=process.argv[2]; if(!input) throw new Error('input path required');
const schemes={
  'ML-DSA-44':ml_dsa44,'ML-DSA-65':ml_dsa65,'ML-DSA-87':ml_dsa87,
  'SLH-DSA-SHA2-128s':slh_dsa_sha2_128s,
  'SLH-DSA-SHAKE-128f':slh_dsa_shake_128f,
  'SLH-DSA-SHA2-192s':slh_dsa_sha2_192s,
  'SLH-DSA-SHAKE-192f':slh_dsa_shake_192f,
  'SLH-DSA-SHA2-256s':slh_dsa_sha2_256s,
  'SLH-DSA-SHAKE-256f':slh_dsa_shake_256f
};
const hex=s=>Uint8Array.from(Buffer.from(s,'hex'));
const safe=fn=>{try{return !!fn()}catch{return false}};
const doc=JSON.parse(await readFile(input,'utf8'));
let verified=0;
for(const r of doc.records){
  const scheme=schemes[r.algorithm]; if(!scheme) throw new Error('unknown '+r.algorithm);
  const msg=hex(r.message),pk=hex(r.public_key),sig=hex(r.signature);
  if(!safe(()=>scheme.verify(sig,msg,pk))) throw new Error('Noble rejected CIRCL '+r.algorithm);
  const bad=Uint8Array.from(sig); bad[0]^=1;
  if(safe(()=>scheme.verify(bad,msg,pk))) throw new Error('Noble accepted CIRCL tamper '+r.algorithm);
  verified++;
}
console.log(JSON.stringify({schema:'FAE_PQ_CROSS_FINAL_V1',result:'PASS',verified_circl_records:verified},null,2));
