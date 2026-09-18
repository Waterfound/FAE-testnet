import { writeFile } from 'node:fs/promises';
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import {
  slh_dsa_sha2_128s, slh_dsa_shake_128f,
  slh_dsa_sha2_192s, slh_dsa_shake_192f,
  slh_dsa_sha2_256s, slh_dsa_shake_256f
} from '@noble/post-quantum/slh-dsa.js';

const output=process.argv[2];
if(!output) throw new Error('output path required');
const schemes={
  'ML-DSA-44':ml_dsa44,'ML-DSA-65':ml_dsa65,'ML-DSA-87':ml_dsa87,
  'SLH-DSA-SHA2-128s':slh_dsa_sha2_128s,
  'SLH-DSA-SHAKE-128f':slh_dsa_shake_128f,
  'SLH-DSA-SHA2-192s':slh_dsa_sha2_192s,
  'SLH-DSA-SHAKE-192f':slh_dsa_shake_192f,
  'SLH-DSA-SHA2-256s':slh_dsa_sha2_256s,
  'SLH-DSA-SHAKE-256f':slh_dsa_shake_256f
};
const toHex=b=>Buffer.from(b).toString('hex');
const records=[];
let offset=31;
for(const [algorithm,scheme] of Object.entries(schemes)){
  const seed=Uint8Array.from({length:scheme.lengths.seed},(_,i)=>(i+offset)&255);
  const keys=scheme.keygen(seed);
  const message=new TextEncoder().encode('FAE cross-implementation '+algorithm);
  const signature=scheme.sign(message,keys.secretKey,{extraEntropy:false});
  if(!scheme.verify(signature,message,keys.publicKey)) throw new Error('Noble self verify failed '+algorithm);
  records.push({
    algorithm,
    family:algorithm.startsWith('ML-')?'ML-DSA':'SLH-DSA',
    message:toHex(message),
    public_key:toHex(keys.publicKey),
    signature:toHex(signature)
  });
  offset+=19;
}
const doc={schema:'FAE_PQ_CROSS_NOBLE_TO_CIRCL_V1',source:'noble-0.7.1',records};
await writeFile(output,JSON.stringify(doc,null,2)+'\n');
console.log(JSON.stringify({result:'PASS',records:records.length,output},null,2));
