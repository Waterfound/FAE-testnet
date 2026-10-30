// V56 adversarial Win32 outbox owner-candidate regression. Disposable only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,open,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newMnemonic,NETWORK} from './crypto.mjs';
import {writeVault} from './vault.mjs';
import {intentPath,writeIntent,readIntent} from './outbox.mjs';
import {observeWindowsDirectoryFenceCandidate} from
  './windows-outbox-directory-fence-candidate.mjs';

test('V56 original encrypted Wallet Windows durability fence rejects wrong handle and absent trusted executor',
  {skip:process.platform!=='win32',timeout:90000},async()=>{
  const parent=await realpath(tmpdir());
  const folder=await mkdtemp(join(parent,'v56-owner-fence-adversary-'));
  const vault=join(folder,'owner.json');
  const secret='isolated-v56-only-valid-test-password';
  const oldSystemRoot=process.env.SystemRoot;
  try{
    const identities=await writeVault(vault,newMnemonic(),'',secret);
    const adjacent=await mkdtemp(join(parent,'v56-unrelated-folder-'));
    try{
      const wrong=await open(adjacent,'r');
      try{
        await assert.rejects(
          observeWindowsDirectoryFenceCandidate(folder,wrong),
          /handle\/path identity mismatch/);
      }finally{await wrong.close()}
    }finally{await rm(adjacent,{recursive:true,force:true})}
    const txid='b'.repeat(64);
    const intent={network:NETWORK,txid,node:'http://127.0.0.1:1111',
      address:identities[0].address,recipient:identities[1].address,
      amount_atoms:'200000000',fee_atoms:'1',
      tip_height:3,tip_hash:'c'.repeat(64)};
    // The native directory helper fails closed if its trusted system
    // executor cannot be resolved. Do NOT poison the original Vault ACL
    // owner process (which needs SystemRoot to create the encrypted file).
    const owned=await open(folder,'r');
    try{
      process.env.SystemRoot='C:\\UntrustedRoot';
      await assert.rejects(
        observeWindowsDirectoryFenceCandidate(folder,owned),
        /trusted Win32 directory fence executable unavailable/);
    }finally{
      process.env.SystemRoot=oldSystemRoot;
      await owned.close();
    }
    await writeIntent(intentPath(vault),intent,secret);
    const contents=await readFile(intentPath(vault),'utf8');
    assert.equal(contents.includes(txid),false);
    assert.equal((await readIntent(intentPath(vault),secret)).txid,txid);
    await assert.rejects(writeIntent(intentPath(vault),intent,secret),/EEXIST/);
    console.log('TS_V56_WIN32_NATIVE_FENCE_FAIL_CLOSED_NEGATIVE_PASS '+
      JSON.stringify({wrong_directory_handle_denied:true,
        invalid_native_executable_denied:true,encrypted_outbox_remains:true,
        duplicate_write_denied:true,authorization_never_granted:true,
        simulated_crash_power_loss:false}));
  }finally{
    if(oldSystemRoot===undefined)delete process.env.SystemRoot;
    else process.env.SystemRoot=oldSystemRoot;
    await rm(folder,{recursive:true,force:true});
  }
});
