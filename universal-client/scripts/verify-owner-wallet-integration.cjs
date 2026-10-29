'use strict';
// V10 isolated CI integration: source-owned real encrypted FAE wallet file ->
// the unchanged native desktop's public, read-only address book.
// Uses disposable test entropy in a runner; never prints recovery material.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {pathToFileURL}=require('node:url');
const {authenticatedWalletBundle,prepareAttestedWalletSource,runPrivilegedWalletTerminal,WALLET_OWNER_HEAD}=require('../src/native-wallet-terminal-handoff.cjs');
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
async function verifyPrivilegedTerminalLifecycle(ownerScript){
  const tempRoot=await fs.realpath(os.tmpdir());
  const before=new Set((await fs.readdir(tempRoot)).filter(name=>name.startsWith('ts-wallet-snapshot-')));
  const tty={stdin:true,stdout:true,stderr:true};
  const publicVault=path.join(tempRoot,'ts-wallet-lifecycle-fixture.json');
  let unownedRuntimeSpawned=false;
  await assert.rejects(
    runPrivilegedWalletTerminal('address',{
      script:ownerScript,nodeExecutable:path.join(tempRoot,'unowned-runtime'),
      publicVault,tty,spawnFn:()=>{unownedRuntimeSpawned=true;throw Error('must not spawn')}
    }),
    /executable or local vault target not admitted/,
    'Privileged Wallet bridge must be bound to the current owned runtime');
  assert.equal(unownedRuntimeSpawned,false,'Unowned absolute executable must be rejected before staging or spawn');
  console.log('TS_WALLET_TERMINAL_OWNED_RUNTIME_PASS');

  let firstChild,markSpawned;
  const spawned=new Promise(resolve=>{markSpawned=resolve});
  const pending=runPrivilegedWalletTerminal('address',{
    script:ownerScript,nodeExecutable:process.execPath,publicVault,tty,
    spawnFn:()=>{
      firstChild=new EventEmitter();
      markSpawned();
      return firstChild;
    }
  });
  await assert.rejects(
    runPrivilegedWalletTerminal('history',{
      script:ownerScript,nodeExecutable:process.execPath,publicVault,tty,
      spawnFn:()=>{throw Error('Concurrent request reached spawn')}
    }),
    /request already active/,
    'A concurrent privileged Wallet terminal request must fail before staging or spawn');
  await Promise.race([
    spawned,
    new Promise((_,reject)=>setTimeout(
      ()=>reject(Error('First native terminal child did not reach spawn within 10 seconds')),10000))
  ]);
  assert.ok(firstChild,'First native terminal child must reach bounded spawn');
  firstChild.emit('exit',7,null);
  assert.equal((await pending).status,'CLI_EXIT_UNCONFIRMED',
    'Abnormal CLI exit must never be reported as signer success');

  const completed=await runPrivilegedWalletTerminal('address',{
    script:ownerScript,nodeExecutable:process.execPath,publicVault,tty,
    spawnFn:()=>{
      const child=new EventEmitter();
      setImmediate(()=>child.emit('exit',0,null));
      return child;
    }
  });
  assert.equal(completed.status,'CLI_EXIT_SUCCESS',
    'A fresh request is admitted after the prior child exits and cleanup finishes');

  await assert.rejects(
    runPrivilegedWalletTerminal('address',{
      script:ownerScript,nodeExecutable:process.execPath,publicVault,tty,
      spawnFn:()=>{throw Error('CI fixture synchronous start failure')}
    }),
    /terminal start failed/);
  await assert.rejects(
    runPrivilegedWalletTerminal('address',{
      script:ownerScript,nodeExecutable:process.execPath,publicVault,tty,
      spawnFn:()=>{
        const child=new EventEmitter();
        setImmediate(()=>child.emit('error',Error('CI fixture child error')));
        return child;
      }
    }),
    /process unavailable/);

  const after=(await fs.readdir(tempRoot)).filter(name=>
    name.startsWith('ts-wallet-snapshot-')&&!before.has(name));
  assert.deepEqual(after,[],'Every terminal lifecycle outcome must remove its attested source stage');
  console.log('TS_WALLET_TERMINAL_SINGLE_FLIGHT_PASS');
  console.log('TS_WALLET_TERMINAL_FAILURE_CLEANUP_PASS');
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
    await verifyPrivilegedTerminalLifecycle(script);
  }finally{await fs.rm(dir,{recursive:true,force:true})}
  }finally{await stage.release()}
}
main().catch(error=>{console.error('TS_OWNER_INTEROP_FAIL: '+error.message);process.exitCode=1});
