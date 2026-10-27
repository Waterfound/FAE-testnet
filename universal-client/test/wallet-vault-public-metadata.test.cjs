'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {generateKeyPairSync,createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {readVaultPublicMetadata,parseVaultPublicMetadata}=require('../src/wallet-vault-public-metadata.cjs');
const {WatchAddressBook}=require('../src/watch-address-book.cjs');
async function make(){
  const {encodeAddress}=await import(pathToFileURL(path.resolve(__dirname,'..','..','sovereign-forge','node','authoritative','address.mjs')).href);
  return {
    format:'FAE_STANDALONE_VAULT_V1',network:'fairyelf-public-testnet-v4',
    public_addresses:Array.from({length:5},(_,index)=>{
      const {publicKey}=generateKeyPairSync('ed25519');
      const spki=publicKey.export({type:'spki',format:'der'});
      return {index,address:encodeAddress(createHash('sha256').update(spki).digest().subarray(0,20),'faet'),
        public_key_spki:spki.toString('base64')};
    }),
    encryption:{cipher:'aes-256-gcm',kdf:'scrypt',payload:'ENCRYPTED_PRIVATE_CANARY_NEVER_RENDER'}
  };
}
test('public metadata bridge returns no ciphertext, key, path or signing capability',async()=>{
  const d=await make(),publicOnly=parseVaultPublicMetadata(JSON.stringify(d));
  assert.equal(publicOnly.addresses.length,5);
  assert.equal(publicOnly.provenance,'unverified_encrypted_vault_public_metadata');
  assert.equal(JSON.stringify(publicOnly).includes('CANARY'),false);
  assert.equal(JSON.stringify(publicOnly).includes('public_key_spki'),false);
  assert.equal(publicOnly.sign,undefined);
});
test('native vault file picker side validates 0600 regular files and does not expose encrypted payload',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-public-vault-'));
 try{
  const filepath=path.join(dir,'my.vault.json');
  await fs.writeFile(filepath,JSON.stringify(await make()),{mode:0o600});
  const publicOnly=await readVaultPublicMetadata(filepath);
  assert.equal(publicOnly.addresses.length,5);
  const watch=new WatchAddressBook(path.join(dir,'watch'));
  await watch.importPublicVaultAddresses(publicOnly.addresses);
  const again=new WatchAddressBook(path.join(dir,'watch'));
  assert.equal((await again.list()).entries.length,5);
  await again.importPublicVaultAddresses(publicOnly.addresses);
  assert.equal((await(new WatchAddressBook(path.join(dir,'watch'))).list()).entries.length,5);
  if(process.platform!=='win32'){
    await fs.chmod(filepath,0o644);
    await assert.rejects(()=>readVaultPublicMetadata(filepath),/private file permissions/);
    await fs.chmod(filepath,0o600);
    await fs.symlink(filepath,path.join(dir,'symlink.json'));
    await assert.rejects(()=>readVaultPublicMetadata(path.join(dir,'symlink.json')),/regular file/);
  }
 }finally{await fs.rm(dir,{force:true,recursive:true})}
});
test('vault metadata rejects wrong network, duplicate addresses, malformed envelope and oversized file',async()=>{
 const a=make();a.network='untrusted-network';
 assert.throws(()=>parseVaultPublicMetadata(JSON.stringify(a)),/Incompatible/);
 const b=await make();b.public_addresses[1].address=b.public_addresses[0].address;
 assert.throws(()=>parseVaultPublicMetadata(JSON.stringify(b)),/Duplicate/);
 assert.throws(()=>parseVaultPublicMetadata('{"format":'),/JSON/);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-vault-over-'));
 try{
  const file=path.join(dir,'vault.json');
  await fs.writeFile(file,'X'.repeat(33000),{mode:0o600});
  await assert.rejects(()=>readVaultPublicMetadata(file),/bounded regular file/);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});


test('native vault public import authenticates SPKI/address correspondence without unlocking secrets',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-vault-keybinding-'));
  try{
    const file=path.join(dir,'vault.json'),data=await make();
    await fs.writeFile(file,JSON.stringify(data),{mode:0o600});
    const ok=await readVaultPublicMetadata(file);
    assert.deepEqual(ok.addresses,data.public_addresses.map(x=>x.address));
    assert.equal(JSON.stringify(ok).includes('public_key_spki'),false);
    assert.equal(JSON.stringify(ok).includes('CANARY'),false);
    const wrong={...data,public_addresses:data.public_addresses.map(x=>({...x}))};
    wrong.public_addresses[0].address=wrong.public_addresses[1].address;
    await fs.writeFile(file,JSON.stringify(wrong),{mode:0o600});
    await assert.rejects(()=>readVaultPublicMetadata(file),/Duplicate public address/);
    wrong.public_addresses[0].address=data.public_addresses[0].address;
    wrong.public_addresses[0].public_key_spki=data.public_addresses[1].public_key_spki;
    await fs.writeFile(file,JSON.stringify(wrong),{mode:0o600});
    await assert.rejects(()=>readVaultPublicMetadata(file),/does not match its Ed25519 key/);
    wrong.public_addresses[0].public_key_spki='bm90LWEtcHVibGljLWtleQ==';
    await fs.writeFile(file,JSON.stringify(wrong),{mode:0o600});
    await assert.rejects(()=>readVaultPublicMetadata(file),/Invalid public FAE Ed25519 key/);
  }finally{await fs.rm(dir,{recursive:true,force:true})}
});
