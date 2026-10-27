'use strict';
// Read ONLY untrusted public metadata from the independently owned encrypted
// standalone FAE Wallet candidate. No decrypt/unlock/sign API is exposed.
const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createPublicKey,createHash}=require('node:crypto');
const {address}=require('./watch-address-book.cjs');
const FORMAT='FAE_STANDALONE_VAULT_V1';
const NETWORK='fairyelf-public-testnet-v4';
const NOFOLLOW=constants.O_NOFOLLOW||0;
function parseVaultPublicMetadata(bytes){
  let data;
  try{data=JSON.parse(bytes)}catch{throw Error('Invalid encrypted FAE vault JSON')}
  if(!data||typeof data!=='object'||Array.isArray(data)||
     data.format!==FORMAT||data.network!==NETWORK||
     !Array.isArray(data.public_addresses)||data.public_addresses.length!==5||
     !data.encryption||typeof data.encryption!=='object'||
     data.encryption.cipher!=='aes-256-gcm'||data.encryption.kdf!=='scrypt')
    throw Error('Incompatible encrypted FAE vault');
  const seen=new Set();
  const publicAddresses=data.public_addresses.map((record,i)=>{
    if(!record||typeof record!=='object'||record.index!==i||
       typeof record.public_key_spki!=='string'||
       record.public_key_spki.length<32||record.public_key_spki.length>512)
      throw Error('Invalid encrypted vault public record');
    const a=address(record.address);
    if(seen.has(a))throw Error('Duplicate public address in encrypted vault');
    seen.add(a);
    return a;
  });
  // Deliberately do not export file path, encrypted payload or public keys.
  // Records are UNAUTHENTICATED until a privileged signer decrypts the vault.
  return Object.freeze({network:NETWORK,provenance:'unverified_encrypted_vault_public_metadata',addresses:publicAddresses});
}
// The public SPKI/address consistency check uses unchanged, authoritative
// FAE Bech32m address encoding. It NEVER decrypts the vault or proves ownership.
async function assertPublicKeyAddressesMatchCanonical(bytes,addressSource){
  const {encodeAddress}=await import(pathToFileURL(addressSource).href);
  let payload;try{payload=JSON.parse(bytes)}catch{throw Error('Invalid vault metadata JSON')}
  if(!Array.isArray(payload.public_addresses)||payload.public_addresses.length!==5)
    throw Error('Invalid public wallet record count');
  for(const row of payload.public_addresses){
    const encoded=row?.public_key_spki;
    if(typeof encoded!=='string'||!(/^[A-Za-z0-9+/]+={0,2}$/).test(encoded))
      throw Error('Invalid public key SPKI encoding');
    const raw=Buffer.from(encoded,'base64');
    let key;
    try{key=createPublicKey({key:raw,format:'der',type:'spki'})}
    catch{throw Error('Invalid public FAE Ed25519 key')}
    if(key.asymmetricKeyType!=='ed25519')throw Error('Unrecognized public FAE signing algorithm');
    const canonical=key.export({type:'spki',format:'der'});
    if(!Buffer.isBuffer(canonical)||!canonical.equals(raw)||canonical.length>512)
      throw Error('Noncanonical public FAE key SPKI');
    const expected=encodeAddress(createHash('sha256').update(canonical).digest().subarray(0,20),'faet');
    if(row.address!==expected)throw Error('Encrypted vault public address does not match its Ed25519 key');
  }
}
async function readVaultPublicMetadata(file,{addressSource=path.resolve(__dirname,'..','..','sovereign-forge','node','authoritative','address.mjs')}={}){
  if(typeof file!=='string'||!path.isAbsolute(file))
    throw Error('Native vault file selection required');
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size<100||st.size>32768)
    throw Error('Vault must be a bounded regular file');
  if(process.platform!=='win32'&&(st.mode&0o077)!==0)
    throw Error('Encrypted FAE vault requires private file permissions');
  if(typeof process.getuid==='function'&&st.uid!==process.getuid())
    throw Error('Encrypted FAE vault owner mismatch');
  const fd=await fs.open(file,constants.O_RDONLY|NOFOLLOW);
  try{
    const check=await fd.stat();
    if(!check.isFile()||check.size!==st.size||check.ino!==st.ino||check.dev!==st.dev)
      throw Error('Vault file changed during open');
    const bytes=await fd.readFile('utf8');
    const publicOnly=parseVaultPublicMetadata(bytes);
    await assertPublicKeyAddressesMatchCanonical(bytes,addressSource);
    return publicOnly;
  }finally{await fd.close()}
}
module.exports={readVaultPublicMetadata,parseVaultPublicMetadata,assertPublicKeyAddressesMatchCanonical};
