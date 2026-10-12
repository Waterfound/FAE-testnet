import { createHash, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { isValidAddress } from '../../../../sovereign-forge/node/authoritative/address.mjs';

export const SHADOW_KIND='FAE_PQ_HYBRID_TX_V1';
export const SHADOW_VERSION=1;
export const SIGNING_DOMAIN='FAIRYELF_PQ_HYBRID_TX_V1';
export const TXID_DOMAIN='FAIRYELF_PQ_HYBRID_TXID_V1';
export const SHADOW_NETWORK='fairyelf-public-testnet-v4';

export const MLDSA_SCHEMES={
  'ML-DSA-44':ml_dsa44,
  'ML-DSA-65':ml_dsa65,
  'ML-DSA-87':ml_dsa87
};

export function canonicalize(value){
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonicalize(value[k])]));
  return value;
}
export function stableStringify(value){return JSON.stringify(canonicalize(value))}

function strictB64(value,label){
  if(typeof value!=='string'||value.length===0||value.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('invalid_'+label);
  const out=Buffer.from(value,'base64');
  if(out.toString('base64')!==value)throw new Error('invalid_'+label);
  return new Uint8Array(out);
}
function amount(value){
  if(typeof value!=='string'||!/^[1-9][0-9]*$/.test(value))throw new Error('invalid_amount');
  return value;
}
const HYBRID_ALLOWED_FIELDS=new Set([
  'kind','shadow_version','network','inputs','outputs',
  'ed25519_public_key_spki','mldsa_parameter_set','mldsa_public_key',
  'ed25519_signature','mldsa_signature'
]);
function normalizeCore(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('malformed_shadow_transaction');
  for(const key of Object.keys(raw))if(!HYBRID_ALLOWED_FIELDS.has(key))throw new Error('unexpected_shadow_field:'+key);
  if(raw.kind!==SHADOW_KIND)throw new Error('wrong_kind');
  if(Number(raw.shadow_version)!==SHADOW_VERSION)throw new Error('wrong_shadow_version');
  if(raw.network!==SHADOW_NETWORK)throw new Error('wrong_network');
  const inputs=Array.isArray(raw.inputs)?raw.inputs.map(String):[];
  if(inputs.length<1||new Set(inputs).size!==inputs.length||inputs.some(v=>!v||v.length>160))throw new Error('invalid_inputs');
  const outputs=Array.isArray(raw.outputs)?raw.outputs.map(o=>({address:String(o?.address||''),amount_atoms:amount(String(o?.amount_atoms||''))})):[];
  if(outputs.length<1)throw new Error('invalid_outputs');
  for(const o of outputs)if(!isValidAddress(o.address,'faet'))throw new Error('invalid_output_address');
  const parameterSet=String(raw.mldsa_parameter_set||'');
  if(!MLDSA_SCHEMES[parameterSet])throw new Error('unsupported_mldsa_parameter_set');
  const edPk=String(raw.ed25519_public_key_spki||'');
  const mlPk=String(raw.mldsa_public_key||'');
  strictB64(edPk,'ed25519_public_key_spki');
  const mlBytes=strictB64(mlPk,'mldsa_public_key');
  if(mlBytes.length!==MLDSA_SCHEMES[parameterSet].lengths.publicKey)throw new Error('wrong_mldsa_public_key_size');
  return{
    kind:SHADOW_KIND,
    shadow_version:SHADOW_VERSION,
    network:SHADOW_NETWORK,
    inputs,
    outputs,
    ed25519_public_key_spki:edPk,
    mldsa_parameter_set:parameterSet,
    mldsa_public_key:mlPk
  };
}
export function signingPayload(raw){
  return{domain:SIGNING_DOMAIN,...normalizeCore(raw)};
}
export function signingBytes(raw){return Buffer.from(stableStringify(signingPayload(raw)))}

export function normalizeHybridTransaction(raw){
  const core=normalizeCore(raw);
  const edSig=String(raw.ed25519_signature||'');
  const mlSig=String(raw.mldsa_signature||'');
  strictB64(edSig,'ed25519_signature');
  const mlSigBytes=strictB64(mlSig,'mldsa_signature');
  if(mlSigBytes.length!==MLDSA_SCHEMES[core.mldsa_parameter_set].lengths.signature)throw new Error('wrong_mldsa_signature_size');
  return{...core,ed25519_signature:edSig,mldsa_signature:mlSig};
}

export function signHybridTransaction(unsigned,ed25519PrivateKey,mldsaSecretKey){
  const core=normalizeCore(unsigned);
  const message=signingBytes(core);
  const edSignature=edSign(null,message,ed25519PrivateKey);
  const scheme=MLDSA_SCHEMES[core.mldsa_parameter_set];
  const mlSignature=scheme.sign(message,mldsaSecretKey,{extraEntropy:false});
  return{...core,ed25519_signature:Buffer.from(edSignature).toString('base64'),mldsa_signature:Buffer.from(mlSignature).toString('base64')};
}

export function verifyHybridTransaction(raw){
  try{
    const tx=normalizeHybridTransaction(raw);
    const message=signingBytes(tx);
    const edKey=createPublicKey({key:Buffer.from(tx.ed25519_public_key_spki,'base64'),format:'der',type:'spki'});
    const edOk=edVerify(null,message,edKey,Buffer.from(tx.ed25519_signature,'base64'));
    if(!edOk)return{ok:false,error:'invalid_ed25519_signature'};
    const scheme=MLDSA_SCHEMES[tx.mldsa_parameter_set];
    const mlOk=scheme.verify(
      Uint8Array.from(Buffer.from(tx.mldsa_signature,'base64')),
      Uint8Array.from(message),
      Uint8Array.from(Buffer.from(tx.mldsa_public_key,'base64'))
    );
    if(!mlOk)return{ok:false,error:'invalid_mldsa_signature'};
    return{ok:true,tx,txid:shadowTxid(tx)};
  }catch(error){return{ok:false,error:error.message||'invalid_shadow_transaction'}}
}

export function shadowTxid(raw){
  const tx=normalizeHybridTransaction(raw);
  return createHash('sha256').update(TXID_DOMAIN).update('\0').update(stableStringify(tx)).digest('hex');
}
