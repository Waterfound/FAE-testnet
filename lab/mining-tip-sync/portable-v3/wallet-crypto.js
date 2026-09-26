'use strict';

const FAEWalletCrypto=(()=>{
  const PKCS8_PREFIX=Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
  const ADDRESS_COUNT=5;
  const DERIVATION_SALT=E.encode('FAIRYELF_PUBLIC_TESTNET_V4');

  function b64urlBytes(value){
    const padded=value.replace(/-/g,'+').replace(/_/g,'/');
    return fb(padded+'='.repeat((4-padded.length%4)%4));
  }

  async function mnemonicFromEntropy(entropy){
    if(!(entropy instanceof Uint8Array)||entropy.length!==32)throw Error('FAE recovery entropy must be 256 bits');
    if(!Array.isArray(window.FAE_BIP39_WORDS)||window.FAE_BIP39_WORDS.length!==2048)throw Error('FAE recovery word list unavailable');
    const digest=await sh(entropy);
    let bits='';
    for(const byte of entropy)bits+=byte.toString(2).padStart(8,'0');
    bits+=digest[0].toString(2).padStart(8,'0');
    const words=[];
    for(let offset=0;offset<264;offset+=11){
      words.push(window.FAE_BIP39_WORDS[parseInt(bits.slice(offset,offset+11),2)]);
    }
    return words.join(' ');
  }

  async function entropyFromMnemonic(value){
    if(!Array.isArray(window.FAE_BIP39_WORDS)||window.FAE_BIP39_WORDS.length!==2048)throw Error('FAE recovery word list unavailable');
    const words=String(value).normalize('NFKD').trim().toLowerCase().split(/\s+/);
    if(words.length!==24)throw Error('Recovery phrase must contain exactly 24 words');
    const indexes=new Map(window.FAE_BIP39_WORDS.map((word,index)=>[word,index]));
    let bits='';
    for(const word of words){
      const index=indexes.get(word);
      if(index===undefined)throw Error('Unknown recovery word: '+word);
      bits+=index.toString(2).padStart(11,'0');
    }
    const entropy=Uint8Array.from({length:32},(_,index)=>parseInt(bits.slice(index*8,index*8+8),2));
    const expectedChecksum=parseInt(bits.slice(256,264),2);
    const digest=await sh(entropy);
    if(digest[0]!==expectedChecksum)throw Error('Invalid 24-word checksum or word order');
    return entropy;
  }

  async function bip39Seed(mnemonic,passphrase){
    const password=await crypto.subtle.importKey(
      'raw',
      E.encode(mnemonic.normalize('NFKD')),
      {name:'PBKDF2'},
      false,
      ['deriveBits']
    );
    const bits=await crypto.subtle.deriveBits({
      name:'PBKDF2',
      hash:'SHA-512',
      salt:E.encode('mnemonic'+String(passphrase).normalize('NFKD')),
      iterations:2048
    },password,512);
    return new Uint8Array(bits);
  }

  async function hkdfSeed(root,index){
    const key=await crypto.subtle.importKey('raw',root,{name:'HKDF'},false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits({
      name:'HKDF',
      hash:'SHA-256',
      salt:DERIVATION_SALT,
      info:E.encode('FAIRYELF_ED25519_ADDRESS_V1:'+index)
    },key,256);
    return new Uint8Array(bits);
  }

  async function keyRecordFromSeed(seed,index=0){
    if(!(seed instanceof Uint8Array)||seed.length!==32)throw Error('Ed25519 seed must be 32 bytes');
    const pkcs8=new Uint8Array(PKCS8_PREFIX.length+seed.length);
    pkcs8.set(PKCS8_PREFIX);
    pkcs8.set(seed,PKCS8_PREFIX.length);
    const priv=await crypto.subtle.importKey('pkcs8',pkcs8,{name:'Ed25519'},true,['sign']);
    const jwk=await crypto.subtle.exportKey('jwk',priv);
    if(!jwk.x)throw Error('This browser cannot derive the Ed25519 public key');
    const publicJwk={kty:'OKP',crv:'Ed25519',x:jwk.x,ext:true,key_ops:['verify']};
    const publicKey=await crypto.subtle.importKey('jwk',publicJwk,{name:'Ed25519'},true,['verify']);
    const spki=new Uint8Array(await crypto.subtle.exportKey('spki',publicKey));
    return{index,address:address((await sh(spki)).slice(0,20)),pub:b64(spki),jwk,priv,watchOnly:false};
  }

  async function deriveAddressRecords(seedPhrase,passphrase='',count=ADDRESS_COUNT){
    const entropy=await entropyFromMnemonic(seedPhrase);
    const mnemonic=await mnemonicFromEntropy(entropy);
    const protectedByPassphrase=String(passphrase).length>0;
    const root=protectedByPassphrase?await bip39Seed(mnemonic,passphrase):entropy;
    const records=[];
    for(let index=0;index<count;index++){
      // Empty-passphrase address 0 intentionally retains the original FAE v4 mapping.
      const seed=!protectedByPassphrase&&index===0?entropy:await hkdfSeed(root,index);
      records.push(await keyRecordFromSeed(seed,index));
    }
    return{mnemonic,passphraseProtected:protectedByPassphrase,addresses:records};
  }

  async function restoreRecordFromJwk(jwk,expectedAddress,expectedPublicKey,index=0){
    if(!jwk?.d||!jwk?.x)throw Error('Recovery record is missing an Ed25519 private key');
    const priv=await crypto.subtle.importKey('jwk',jwk,{name:'Ed25519'},true,['sign']);
    const publicJwk={kty:'OKP',crv:'Ed25519',x:jwk.x,ext:true,key_ops:['verify']};
    const publicKey=await crypto.subtle.importKey('jwk',publicJwk,{name:'Ed25519'},true,['verify']);
    const spki=new Uint8Array(await crypto.subtle.exportKey('spki',publicKey));
    const derivedAddress=address((await sh(spki)).slice(0,20));
    if(expectedAddress&&expectedAddress!==derivedAddress)throw Error('Address/private key mismatch in recovery package');
    if(expectedPublicKey&&expectedPublicKey!==b64(spki))throw Error('Public/private key mismatch in recovery package');
    const challenge=crypto.getRandomValues(new Uint8Array(32));
    const signature=await crypto.subtle.sign('Ed25519',priv,challenge);
    if(!await crypto.subtle.verify('Ed25519',publicKey,signature,challenge))throw Error('Recovery key verification failed');
    return{index,address:derivedAddress,pub:b64(spki),jwk,priv,watchOnly:false};
  }

  function entropyFromPrivateJwk(jwk){
    if(!jwk?.d)throw Error('This wallet does not contain recoverable private key material');
    const entropy=b64urlBytes(jwk.d);
    if(entropy.length!==32)throw Error('Unsupported private key length');
    return entropy;
  }

  return{
    ADDRESS_COUNT,
    mnemonicFromEntropy,
    entropyFromMnemonic,
    deriveAddressRecords,
    keyRecordFromSeed,
    restoreRecordFromJwk,
    entropyFromPrivateJwk
  };
})();

window.FAEWalletCrypto=FAEWalletCrypto;
