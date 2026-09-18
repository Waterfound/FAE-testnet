import { performance } from 'node:perf_hooks';
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { encodeAddress } from '../../../../sovereign-forge/node/authoritative/address.mjs';
import { stableStringify } from '../../../../sovereign-forge/node/authoritative/canonical.mjs';
import { txPayload, normalizeTx } from '../../../../sovereign-forge/node/authoritative/fae-v4-core.mjs';

const IMPORT_START=performance.now();
const ml=await import('@noble/post-quantum/ml-dsa.js');
const slh=await import('@noble/post-quantum/slh-dsa.js');
const IMPORT_MS=performance.now()-IMPORT_START;
const { signHybridTransaction }=await import('../../wave-e/pq05/hybrid-transaction.mjs');

const WARM_FAST=4, ITER_FAST=15, WARM_SLOW=1, ITER_SLOW=3;
const PKCS8_PREFIX=Buffer.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
const fixed=(n,o)=>Buffer.from(Array.from({length:n},(_,i)=>(i+o)&255));
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2};
const mad=a=>{const m=median(a);return median(a.map(x=>Math.abs(x-m)))};
const stats=a=>({median_ms:+median(a).toFixed(6),mad_ms:+mad(a).toFixed(6),min_ms:+Math.min(...a).toFixed(6),max_ms:+Math.max(...a).toFixed(6),iterations:a.length});
function once(fn){const t=process.hrtime.bigint();const v=fn();return [v,Number(process.hrtime.bigint()-t)/1e6]}
function bench(fn,warm,iters){
  for(let i=0;i<warm;i++)fn();
  global.gc?.();const rss0=process.memoryUsage().rss,cpu0=process.cpuUsage(),times=[];let last;
  for(let i=0;i<iters;i++){const [v,t]=once(fn);last=v;times.push(t)}
  const cpu=process.cpuUsage(cpu0);global.gc?.();const rss1=process.memoryUsage().rss;
  return {last,timing:stats(times),cpu_us_per_iter:+((cpu.user+cpu.system)/iters).toFixed(2),rss_delta_bytes:rss1-rss0};
}
function edKey(seed){const priv=createPrivateKey({key:Buffer.concat([PKCS8_PREFIX,seed]),format:'der',type:'pkcs8'});const pub=createPublicKey(priv);return{priv,pub,spki:Buffer.from(pub.export({format:'der',type:'spki'}))}}
const ed=edKey(fixed(32,9)),msg=Buffer.from('FAE PQ-09 resource economics benchmark');
const edSig=edSign(null,msg,ed.priv);
const baseline={
  name:'Ed25519 baseline',public_key_bytes:ed.spki.length,private_key_bytes:32,signature_bytes:edSig.length,
  keygen:bench(()=>edKey(fixed(32,19)),WARM_FAST,ITER_FAST),
  sign:bench(()=>edSign(null,msg,ed.priv),WARM_FAST,ITER_FAST),
  verify:bench(()=>edVerify(null,msg,ed.pub,edSig),WARM_FAST,ITER_FAST)
};
delete baseline.keygen.last;delete baseline.sign.last;delete baseline.verify.last;

const recipient=encodeAddress(fixed(20,71),'faet'),input='2'.repeat(64)+':0',edSpki=ed.spki.toString('base64');
const active={version:2,network:'fairyelf-public-testnet-v4',inputs:[input],outputs:[{address:recipient,amount_atoms:'1000'}],public_key_spki:edSpki,signature:''};
active.signature=edSign(null,Buffer.from(stableStringify(txPayload(normalizeTx(active)))),ed.priv).toString('base64');
const activeTxBytes=Buffer.byteLength(stableStringify(active));
baseline.serialized_transaction_bytes=activeTxBytes;
baseline.incremental_bytes_vs_transaction_v2=0;
baseline.block_payload_20tx_bytes=activeTxBytes*20;
baseline.mempool_storage_per_tx_bytes=activeTxBytes;
baseline.network_transfer_per_tx_bytes=activeTxBytes;

const ML={
 'ML-DSA-44':ml.ml_dsa44,'ML-DSA-65':ml.ml_dsa65,'ML-DSA-87':ml.ml_dsa87
};
const rows=[baseline];let offset=41;
for(const [name,scheme] of Object.entries(ML)){
  const seed=fixed(scheme.lengths.seed,offset),keys=scheme.keygen(seed),sig=scheme.sign(msg,keys.secretKey,{extraEntropy:false});
  const unsigned={kind:'FAE_PQ_HYBRID_TX_V1',shadow_version:1,network:'fairyelf-public-testnet-v4',inputs:[input],outputs:[{address:recipient,amount_atoms:'1000'}],ed25519_public_key_spki:edSpki,mldsa_parameter_set:name,mldsa_public_key:Buffer.from(keys.publicKey).toString('base64')};
  const hybrid=signHybridTransaction(unsigned,ed.priv,keys.secretKey),txBytes=Buffer.byteLength(stableStringify(hybrid));
  const r={name:'Ed25519 + '+name+' hybrid',public_key_bytes:scheme.lengths.publicKey,private_key_bytes:scheme.lengths.secretKey,signature_bytes:scheme.lengths.signature,
    serialized_transaction_bytes:txBytes,incremental_bytes_vs_transaction_v2:txBytes-activeTxBytes,block_payload_20tx_bytes:txBytes*20,mempool_storage_per_tx_bytes:txBytes,network_transfer_per_tx_bytes:txBytes,
    keygen:bench(()=>scheme.keygen(seed),WARM_FAST,ITER_FAST),
    sign:bench(()=>scheme.sign(msg,keys.secretKey,{extraEntropy:false}),WARM_FAST,ITER_FAST),
    verify:bench(()=>scheme.verify(sig,msg,keys.publicKey),WARM_FAST,ITER_FAST)};
  delete r.keygen.last;delete r.sign.last;delete r.verify.last;rows.push(r);offset+=29;
}
const SLH={
 'SLH-DSA-SHA2-128s':slh.slh_dsa_sha2_128s,'SLH-DSA-SHAKE-128f':slh.slh_dsa_shake_128f,
 'SLH-DSA-SHA2-192s':slh.slh_dsa_sha2_192s,'SLH-DSA-SHAKE-192f':slh.slh_dsa_shake_192f,
 'SLH-DSA-SHA2-256s':slh.slh_dsa_sha2_256s,'SLH-DSA-SHAKE-256f':slh.slh_dsa_shake_256f
};
for(const [name,scheme] of Object.entries(SLH)){
  const seed=fixed(scheme.lengths.seed,offset),keys=scheme.keygen(seed),sig=scheme.sign(msg,keys.secretKey,{extraEntropy:false});
  const r={name,public_key_bytes:scheme.lengths.publicKey,private_key_bytes:scheme.lengths.secretKey,signature_bytes:scheme.lengths.signature,
    serialized_transaction_bytes:null,incremental_bytes_vs_transaction_v2:null,block_payload_20tx_bytes:null,mempool_storage_per_tx_bytes:null,network_transfer_per_tx_bytes:null,
    transaction_metric_status:'N/A_NO_FROZEN_FAE_SLH_TRANSACTION_FORMAT',
    keygen:bench(()=>scheme.keygen(seed),WARM_SLOW,ITER_SLOW),
    sign:bench(()=>scheme.sign(msg,keys.secretKey,{extraEntropy:false}),WARM_SLOW,ITER_SLOW),
    verify:bench(()=>scheme.verify(sig,msg,keys.publicKey),WARM_SLOW,ITER_SLOW)};
  delete r.keygen.last;delete r.sign.last;delete r.verify.last;rows.push(r);offset+=31;
}
const out={schema:'FAE_PQ09_RESOURCE_ECONOMICS_V1',result:'PASS',runtime:{node:process.version,platform:process.platform,arch:process.arch,module_initialization_ms:+IMPORT_MS.toFixed(6),max_rss_kb:process.resourceUsage().maxRSS},frozen_iterations:{fast:{warmup:WARM_FAST,measured:ITER_FAST},slow:{warmup:WARM_SLOW,measured:ITER_SLOW}},rows,physical_device_claims:false,iphone_ipad_inference:false,operational_winner_promoted:false,activation_authorized:false};
console.log(JSON.stringify(out,null,2));
