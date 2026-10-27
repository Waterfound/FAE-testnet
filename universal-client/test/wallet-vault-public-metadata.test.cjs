'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {readVaultPublicMetadata,parseVaultPublicMetadata}=require('../src/wallet-vault-public-metadata.cjs');
const {WatchAddressBook}=require('../src/watch-address-book.cjs');
const make=()=>({
  format:'FAE_STANDALONE_VAULT_V1',network:'fairyelf-public-testnet-v4',
  public_addresses:Array.from({length:5},(_,index)=>({
    index,address:'faet1'+String(index+2).repeat(38),
    public_key_spki:Buffer.from('valid-public-key-stub-'+index.toString().repeat(4)).toString('base64')
  })),
  encryption:{cipher:'aes-256-gcm',kdf:'scrypt',payload:'ENCRYPTED_PRIVATE_CANARY_NEVER_RENDER'}
});
test('public metadata bridge returns no ciphertext, key, path or signing capability',async()=>{
  const d=make(),publicOnly=parseVaultPublicMetadata(JSON.stringify(d));
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
  await fs.writeFile(filepath,JSON.stringify(make()),{mode:0o600});
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
 const b=make();b.public_addresses[1].address=b.public_addresses[0].address;
 assert.throws(()=>parseVaultPublicMetadata(JSON.stringify(b)),/Duplicate/);
 assert.throws(()=>parseVaultPublicMetadata('{"format":'),/JSON/);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-vault-over-'));
 try{
  const file=path.join(dir,'vault.json');
  await fs.writeFile(file,'X'.repeat(33000),{mode:0o600});
  await assert.rejects(()=>readVaultPublicMetadata(file),/bounded regular file/);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
