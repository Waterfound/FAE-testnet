import {createHash,createPrivateKey,createPublicKey,hkdfSync,pbkdf2Sync,randomBytes,sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {encodeAddress,isValidAddress} from '../../sovereign-forge/node/authoritative/address.mjs';
import {hashHex} from '../../sovereign-forge/node/authoritative/crypto.mjs';
import {stableStringify} from '../../sovereign-forge/node/authoritative/canonical.mjs';

export const NETWORK='fairyelf-public-testnet-v4';
export const COIN=100000000n;
const WORD_SOURCE=new URL('../../bip39-en.js',import.meta.url);
const browserWords={window:{}};
vm.runInNewContext(readFileSync(WORD_SOURCE,'utf8'),browserWords,{timeout:1000});
export const WORDS=Object.freeze(Array.from(browserWords.window.FAE_BIP39_WORDS||[]));
if(WORDS.length!==2048||new Set(WORDS).size!==2048)throw Error('invalid_canonical_bip39_wordlist');
const INDEX=new Map(WORDS.map((word,i)=>[word,i]));
const PKCS8_PREFIX=Buffer.from('302e020100300506032b657004220420','hex');

export function entropyToMnemonic(value){
  const entropy=Buffer.from(value);
  if(entropy.length!==32)throw Error('entropy_requires_32_bytes');
  const checksum=createHash('sha256').update(entropy).digest()[0];
  let bits='';
  for(const byte of entropy)bits+=byte.toString(2).padStart(8,'0');
  bits+=checksum.toString(2).padStart(8,'0');
  return Array.from({length:24},(_,i)=>WORDS[Number.parseInt(bits.slice(i*11,i*11+11),2)]).join(' ');
}
export function mnemonicToEntropy(value){
  const words=String(value).normalize('NFKD').trim().toLowerCase().split(/\s+/);
  if(words.length!==24)throw Error('recovery_requires_24_words');
  let bits='';
  for(const word of words){
    const index=INDEX.get(word);
    if(index===undefined)throw Error('unknown_recovery_word');
    bits+=index.toString(2).padStart(11,'0');
  }
  const entropy=Buffer.from(Array.from({length:32},(_,i)=>Number.parseInt(bits.slice(i*8,i*8+8),2)));
  if(createHash('sha256').update(entropy).digest()[0]!==Number.parseInt(bits.slice(256,264),2))throw Error('invalid_recovery_checksum');
  return entropy;
}
export function newMnemonic(){return entropyToMnemonic(randomBytes(32))}
export function deriveRecords(mnemonic,passphrase='',count=5){
  if(!Number.isSafeInteger(count)||count<1||count>50)throw Error('invalid_address_count');
  const entropy=mnemonicToEntropy(mnemonic);
  const normalized=entropyToMnemonic(entropy);
  const protectedByPassphrase=String(passphrase).length>0;
  const root=protectedByPassphrase
    ?pbkdf2Sync(normalized.normalize('NFKD'),'mnemonic'+String(passphrase).normalize('NFKD'),2048,64,'sha512')
    :entropy;
  const records=[];
  for(let index=0;index<count;index++){
    const derived=!protectedByPassphrase&&index===0?Buffer.from(entropy):
      Buffer.from(hkdfSync('sha256',root,Buffer.from('FAIRYELF_PUBLIC_TESTNET_V4'),
        Buffer.from('FAIRYELF_ED25519_ADDRESS_V1:'+index),32));
    const privateKey=createPrivateKey({key:Buffer.concat([PKCS8_PREFIX,derived]),format:'der',type:'pkcs8'});
    const spki=createPublicKey(privateKey).export({type:'spki',format:'der'});
    const address=encodeAddress(createHash('sha256').update(spki).digest().subarray(0,20),'faet');
    records.push({index,address,public_key_spki:spki.toString('base64'),privateKey});
    derived.fill(0);
  }
  root.fill(0);
  entropy.fill(0);
  return records;
}
export function parseAtoms(value){
  const match=/^(\d+)(?:\.(\d{1,8}))?$/.exec(String(value));
  if(!match)throw Error('invalid_amount_precision');
  const n=BigInt(match[1])*COIN+BigInt((match[2]||'').padEnd(8,'0')||'0');
  if(n<=0n)throw Error('amount_must_be_positive');
  return n;
}
export function txPayload(tx){
  return{domain:'FAIRYELF_TX_V2',network:tx.network,inputs:tx.inputs,
    outputs:tx.outputs,public_key_spki:tx.public_key_spki};
}
export function buildSignedTransaction(record,inputs,outputs){
  if(!record.privateKey)throw Error('watch_only_cannot_sign');
  if(!Array.isArray(inputs)||inputs.length<1||inputs.length>64||new Set(inputs).size!==inputs.length)throw Error('invalid_inputs');
  if(!Array.isArray(outputs)||outputs.length<1||outputs.length>16)throw Error('invalid_outputs');
  for(const o of outputs)if(!isValidAddress(o.address)||!(/^[1-9]\d*$/.test(String(o.amount_atoms))))throw Error('invalid_output');
  const tx={version:2,network:NETWORK,inputs,outputs,public_key_spki:record.public_key_spki,signature:''};
  tx.signature=sign(null,Buffer.from(stableStringify(txPayload(tx))),record.privateKey).toString('base64');
  return {tx,txid:hashHex(tx)};
}
