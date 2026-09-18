import { createHash, createPublicKey, verify as verifySig } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const input=process.argv[2];if(!input)throw new Error('input required');
const doc=JSON.parse(await readFile(input,'utf8'));
const TX_FIELDS=new Set(['kind','shadow_version','network','inputs','outputs','ed25519_public_key_spki','mldsa_parameter_set','mldsa_public_key','ed25519_signature','mldsa_signature']);
const WALLET_FIELDS=new Set(['schema','index','mldsa_parameter_set','legacy_address','legacy_public_key_spki','mldsa_public_key','mldsa_public_key_sha256']);
const ML={
 'ML-DSA-44':{pk:1312,sig:2420,oid:[2,16,840,1,101,3,4,3,17]},
 'ML-DSA-65':{pk:1952,sig:3309,oid:[2,16,840,1,101,3,4,3,18]},
 'ML-DSA-87':{pk:2592,sig:4627,oid:[2,16,840,1,101,3,4,3,19]}
};
const SHADOW_KIND='FAE_PQ_HYBRID_TX_V1',NETWORK='fairyelf-public-testnet-v4',SIGN_DOMAIN='FAIRYELF_PQ_HYBRID_TX_V1',TXID_DOMAIN='FAIRYELF_PQ_HYBRID_TXID_V1';
const CHARSET='qpzry9x8gf2tvdw0s3jn54khce6mua7l',BECH32M=0x2bc830a3;
const canon=v=>Array.isArray(v)?v.map(canon):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v);
const stable=v=>JSON.stringify(canon(v));
function strictB64(s){if(typeof s!=='string'||!s.length||s.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(s))throw new Error('b64');const b=Buffer.from(s,'base64');if(b.toString('base64')!==s)throw new Error('b64');return b}
function derLen(n){if(n<128)return Buffer.from([n]);const a=[];for(;n;n>>=8)a.unshift(n&255);return Buffer.from([0x80|a.length,...a])}
function oidBytes(oid){const out=[40*oid[0]+oid[1]];for(const n0 of oid.slice(2)){let n=n0,parts=[n&127];while((n>>=7))parts.unshift(0x80|(n&127));out.push(...parts)}return Buffer.from(out)}
function seq(...parts){const body=Buffer.concat(parts);return Buffer.concat([Buffer.from([0x30]),derLen(body.length),body])}
function tlv(tag,body){return Buffer.concat([Buffer.from([tag]),derLen(body.length),body])}
function mlSpki(raw,oid){const alg=seq(tlv(0x06,oidBytes(oid)));const bit=tlv(0x03,Buffer.concat([Buffer.from([0]),raw]));return seq(alg,bit)}
function polymod(values){const g=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let c=1;for(const v of values){const top=c>>>25;c=((c&0x1ffffff)<<5)^v;for(let i=0;i<5;i++)if((top>>>i)&1)c^=g[i]}return c>>>0}
function hrpExpand(hrp){return [...hrp].map(c=>c.charCodeAt(0)>>>5).concat([0],[...hrp].map(c=>c.charCodeAt(0)&31))}
function convertBits(data,from,to,pad=true){let acc=0,bits=0,res=[],mask=(1<<to)-1,max=(1<<(from+to-1))-1;for(const v of data){if(v<0||(v>>>from)!==0)throw Error('bits');acc=((acc<<from)|v)&max;bits+=from;while(bits>=to){bits-=to;res.push((acc>>>bits)&mask)}}if(pad){if(bits)res.push((acc<<(to-bits))&mask)}else if(bits>=from||((acc<<(to-bits))&mask))throw Error('padding');return res}
function encodeAddress(payload,hrp='faet'){const data=convertBits(payload,8,5,true),mod=(polymod([...hrpExpand(hrp),...data,0,0,0,0,0,0])^BECH32M)>>>0,chk=Array.from({length:6},(_,i)=>(mod>>>(5*(5-i)))&31);return hrp+'1'+[...data,...chk].map(v=>CHARSET[v]).join('')}
function validAddress(s){try{if(typeof s!=='string'||s!==s.toLowerCase())return false;const p=s.lastIndexOf('1');if(s.slice(0,p)!=='faet')return false;const vals=[...s.slice(p+1)].map(c=>CHARSET.indexOf(c));if(vals.some(v=>v<0)||polymod([...hrpExpand('faet'),...vals])!==BECH32M)return false;return convertBits(vals.slice(0,-6),5,8,false).length===20}catch{return false}}
function core(raw){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('obj');if(Object.keys(raw).some(k=>!TX_FIELDS.has(k)))throw Error('field');if(raw.kind!==SHADOW_KIND||raw.shadow_version!==1||raw.network!==NETWORK)throw Error('hdr');if(!Array.isArray(raw.inputs)||!raw.inputs.length||new Set(raw.inputs.map(String)).size!==raw.inputs.length)throw Error('inputs');if(!Array.isArray(raw.outputs)||!raw.outputs.length)throw Error('outputs');for(const o of raw.outputs){if(!validAddress(String(o.address))||!/^([1-9][0-9]*)$/.test(String(o.amount_atoms)))throw Error('out')}const meta=ML[raw.mldsa_parameter_set];if(!meta)throw Error('set');const ed=strictB64(raw.ed25519_public_key_spki),ml=strictB64(raw.mldsa_public_key);if(ml.length!==meta.pk)throw Error('pk');return{kind:SHADOW_KIND,shadow_version:1,network:NETWORK,inputs:raw.inputs.map(String),outputs:raw.outputs.map(o=>({address:String(o.address),amount_atoms:String(o.amount_atoms)})),ed25519_public_key_spki:raw.ed25519_public_key_spki,mldsa_parameter_set:raw.mldsa_parameter_set,mldsa_public_key:raw.mldsa_public_key}}
function verifyTx(raw){try{const c=core(raw);const edSig=strictB64(raw.ed25519_signature),mlSig=strictB64(raw.mldsa_signature),meta=ML[c.mldsa_parameter_set];if(mlSig.length!==meta.sig)throw Error('sig');const msg=Buffer.from(stable({domain:SIGN_DOMAIN,...c}));const edKey=createPublicKey({key:strictB64(c.ed25519_public_key_spki),format:'der',type:'spki'});if(!verifySig(null,msg,edKey,edSig))return false;const mlKey=createPublicKey({key:mlSpki(strictB64(c.mldsa_public_key),meta.oid),format:'der',type:'spki'});return verifySig(null,msg,mlKey,mlSig)}catch{return false}}
function txid(raw){const keys=[...Object.keys(raw)].sort();void keys;return createHash('sha256').update(TXID_DOMAIN).update('\0').update(stable(raw)).digest('hex')}
function verifyWallet(raw){try{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('obj');const keys=Object.keys(raw);if(keys.length!==WALLET_FIELDS.size||keys.some(k=>!WALLET_FIELDS.has(k)))throw Error('fields');if(raw.schema!=='FAE_PQ_SHADOW_WALLET_PUBLIC_V1'||!Number.isInteger(raw.index)||raw.index<0)throw Error('hdr');const meta=ML[raw.mldsa_parameter_set];if(!meta)throw Error('set');const legacy=strictB64(raw.legacy_public_key_spki),pq=strictB64(raw.mldsa_public_key);if(pq.length!==meta.pk)throw Error('size');if(createHash('sha256').update(pq).digest('hex')!==raw.mldsa_public_key_sha256)throw Error('fp');const addr=encodeAddress(createHash('sha256').update(legacy).digest().subarray(0,20));if(addr!==raw.legacy_address)throw Error('addr');return true}catch{return false}}
let count=0,valid=0,invalid=0;
for(const c of doc.cases){let observed;if(c.kind==='transaction'){observed=verifyTx(c.value);if(observed&&c.expected_txid&&txid(c.value)!==c.expected_txid)throw Error('txid '+c.id)}else if(c.kind==='wallet'){observed=verifyWallet(c.value);if(observed&&c.expected_serialized&&stable(c.value)!==c.expected_serialized)throw Error('serialization '+c.id)}else throw Error('kind');if(observed!==c.expected)throw Error('independent disagreement '+c.id);count++;observed?valid++:invalid++}
console.log(JSON.stringify({schema:'FAE_PQ08_INDEPENDENT_NODE_VERIFIER_V1',result:'PASS',cases:count,valid,invalid,no_shared_verdict_cache:true,private_material_emitted:false},null,2));
