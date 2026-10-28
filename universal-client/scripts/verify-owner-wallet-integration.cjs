'use strict';
// V10 isolated CI integration: source-owned real encrypted FAE wallet file ->
// the unchanged native desktop's public, read-only address book.
// Uses disposable test entropy in a runner; never prints recovery material.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {authenticatedWalletBundle,prepareAttestedWalletSource,WALLET_OWNER_HEAD}=require('../src/native-wallet-terminal-handoff.cjs');
const {readVaultPublicMetadata}=require('../src/wallet-vault-public-metadata.cjs');
const {WatchAddressBook}=require('../src/watch-address-book.cjs');

// Real disposable attested-source fixtures: never mutate the protected owner
// checkout or its encrypted vault. Each negative case must fail closed.
async function verifySourceSnapshotRejectsMutation(ownerScript){
  const mutated=await prepareAttestedWalletSource(ownerScript);
  const mutatedRoot=mutated.root;
  try{
    const dependency=path.join(mutatedRoot,'standalone','wallet','crypto.mjs');
    await fs.chmod(dependency,0o600);
    await fs.appendFile(dependency,'\n// CI fixture tamper: not an executable release\n');
    await assert.rejects(()=>authenticatedWalletBundle(mutated.script),
      /Wallet bundle dependency digest mismatch/,
      'Mutated staged import must never pass bundle attestation');
    await assert.rejects(()=>prepareAttestedWalletSource(mutated.script),
      /Wallet bundle dependency digest mismatch/,
      'Mutated candidate original must never be accepted for a second staging');
    console.log('TS_WALLET_MUTATED_IMPORT_REJECTED');
  }finally{await mutated.release()}
  await assert.rejects(fs.stat(mutatedRoot),{code:'ENOENT'},
    'Source snapshot must be removed even after rejected attestation');

  const missing=await prepareAttestedWalletSource(ownerScript);
  const missingRoot=missing.root;
  try{
    await fs.unlink(path.join(missingRoot,'standalone','wallet','outbox.mjs'));
    await assert.rejects(()=>authenticatedWalletBundle(missing.script),
      /ENOENT/, 'Missing owner dependency must fail closed');
    console.log('TS_WALLET_MISSING_IMPORT_REJECTED');
  }finally{await missing.release()}
  await assert.rejects(fs.stat(missingRoot),{code:'ENOENT'});

  if(process.platform!=='win32'){
    const redirected=await prepareAttestedWalletSource(ownerScript);
    const redirectedRoot=redirected.root;
    try{
      const dependency=path.join(redirectedRoot,'standalone','wallet','crypto.mjs');
      const real=dependency+'.original';
      await fs.rename(dependency,real);
      await fs.symlink(real,dependency);
      await assert.rejects(()=>authenticatedWalletBundle(redirected.script),
        /Wallet bundle dependency is redirected/,
        'Owner source import symlink must not be followed');
      console.log('TS_WALLET_SYMLINK_IMPORT_REJECTED');
    }finally{await redirected.release()}
    await assert.rejects(fs.stat(redirectedRoot),{code:'ENOENT'});
  }
}
async function main(){
  const root=process.env.TS_OWNER_WALLET_ROOT;
  if(typeof root!=='string'||!path.isAbsolute(root)||process.env.CI!=='true')
    throw Error('Exact protected Wallet owner CI checkout required');
  const script=path.join(root,'standalone','wallet','fae-wallet.mjs');
  await authenticatedWalletBundle(script);
  const {execFileSync}=require('node:child_process');
  const checkout=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',timeout:5000}).trim();
  if(checkout!==WALLET_OWNER_HEAD)throw Error('Protected Wallet checkout head mismatch');
  const stage=await prepareAttestedWalletSource(script);
  try{
  const crypto=await import(pathToFileURL(path.join(stage.root,'standalone','wallet','crypto.mjs')).href);
  const {writeVault}=await import(pathToFileURL(path.join(stage.root,'standalone','wallet','vault.mjs')).href);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-wallet-real-interop-'));
  try{
    await fs.chmod(dir,0o700);
    const vault=path.join(dir,'test-vault.json');
    const disposable=crypto.newMnemonic();
    const ownerAddresses=(await writeVault(vault,disposable,'','CI_DISPOSABLE_TEST_ONLY')).map(x=>x.address);
    const original=await fs.readFile(vault,'utf8');
    const bridge=await readVaultPublicMetadata(vault,{
      addressSource:path.join(stage.root,'sovereign-forge','node','authoritative','address.mjs')
    });
    assert.deepEqual(bridge.addresses,ownerAddresses);
    assert.equal(bridge.provenance,'unverified_encrypted_vault_public_metadata');
    const serial=JSON.stringify(bridge);
    assert.equal(serial.includes(disposable),false);
    assert.equal(serial.includes('CI_DISPOSABLE_TEST_ONLY'),false);
    assert.equal(serial.includes('public_key_spki'),false);
    assert.equal(serial.includes('ENCRYPTED'),false);
    const bookRoot=path.join(dir,'watch');
    const book=new WatchAddressBook(bookRoot);
    await book.importPublicVaultAddresses(bridge.addresses);
    const after=(await new WatchAddressBook(bookRoot).list()).entries;
    assert.deepEqual(new Set(after.map(x=>x.address)),new Set(ownerAddresses));
    await book.importPublicVaultAddresses(bridge.addresses);
    assert.equal((await new WatchAddressBook(bookRoot).list()).entries.length,5);
    assert.equal((await fs.readFile(vault,'utf8')),original,
      'Read-only integration must preserve the exact encrypted owner vault');
    console.log('TS_REAL_OWNER_VAULT_TO_DESKTOP_WATCH_PASS: 5 public addresses; native signing remains disabled');
    console.log('TS_WALLET_ATTESTED_SOURCE_SNAPSHOT_PASS');
    await verifySourceSnapshotRejectsMutation(script);
  }finally{await fs.rm(dir,{recursive:true,force:true})}
  }finally{await stage.release()}
}
main().catch(error=>{console.error('TS_OWNER_INTEROP_FAIL: '+error.message);process.exitCode=1});
