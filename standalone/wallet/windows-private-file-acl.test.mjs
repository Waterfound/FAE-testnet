// Original Wallet owner-security proposal tests. Disposable identities only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,open,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {newMnemonic,NETWORK} from './crypto.mjs';
import {writeVault,readVault,unlockVault} from './vault.mjs';
import {writeIntent,readIntent,intentPath} from './outbox.mjs';
import {hardenWindowsPrivateFile,verifyWindowsPrivateFile} from './windows-private-file-acl.mjs';
test('original encrypted vault: Unix owner-only or NTFS ACL proof; unresolved Windows directory durability fails closed',
  {timeout:90000},async()=>{
  const root=await realpath(tmpdir());
  const dir=await mkdtemp(join(root,'fae-wallet-ntfs-owner-'));
  const vault=join(dir,'vault.json'),password='isolated-#342-Proof-Only-Not-Real';
  try{
    const publicRows=await writeVault(vault,newMnemonic(),'',password);
    assert.ok(publicRows[0].address.startsWith('faet1'));
    assert.equal((await unlockVault(vault,password))[0].address,publicRows[0].address);
    await assert.rejects(unlockVault(vault,'invalid-password'),
      /incorrect_password_or_corrupt_vault/);
    if(process.platform==='win32'){
      await verifyWindowsPrivateFile(vault);
      const systemRoot=process.env.SystemRoot;
      if(typeof systemRoot!=='string'||!/^[A-Z]:\\Windows$/i.test(systemRoot))
        throw Error('trusted Windows test executable unavailable');
      // Grant Everyone SID to prove the original encrypted vault is rejected.
      const icacls=join(systemRoot,'System32','icacls.exe');
      execFileSync(icacls,[vault,'/grant','*S-1-1-0:(R)'],
        {windowsHide:true,timeout:15000,maxBuffer:4096});
      await assert.rejects(readVault(vault),/Windows original Wallet private ACL refused/);
      const handle=await open(vault,'r+');
      try{await hardenWindowsPrivateFile(vault,handle)}
      finally{await handle.close()}
      await verifyWindowsPrivateFile(vault);
      assert.equal((await unlockVault(vault,password))[0].address,publicRows[0].address);
    }else assert.equal((await stat(vault)).mode&0o077,0);
    const journal=intentPath(vault),txid='a'.repeat(64),tip='b'.repeat(64);
    const intent={network:NETWORK,txid,node:'http://127.0.0.1:8025',
      address:publicRows[0].address,recipient:publicRows[1].address,
      amount_atoms:'100000000',fee_atoms:'1',tip_height:1,tip_hash:tip};
    try{await writeIntent(journal,intent,password)}
    catch(error){
      // Original #342 intentionally requires fsync(directory) after the
      // encrypted single-flight intent is written. NTFS Node fsync(directory)
      // returns EPERM on this runner: never claim durable ACK or permit a send.
      if(process.platform!=='win32'||
         !/^outbox_write_incomplete_fail_closed:EPERM: operation not permitted, fsync$/.test(
           String(error?.message)))throw error;
      await verifyWindowsPrivateFile(journal);
      assert.equal((await readFile(journal,'utf8')).includes(txid),false);
      await assert.rejects(writeIntent(journal,intent,password),/EEXIST/);
      console.log('FAE_WALLET_NTFS_VAULT_ACL_PASS_OUTBOX_DIRECTORY_FSYNC_FAIL_CLOSED');
      return;
    }
    assert.equal((await readIntent(journal,password)).txid,txid);
    await assert.rejects(writeIntent(journal,intent,password),/EEXIST/);
    assert.equal((await readFile(journal,'utf8')).includes(txid),false);
    if(process.platform==='win32'){
      await verifyWindowsPrivateFile(journal);
      console.log('FAE_WALLET_NTFS_VAULT_AND_OUTBOX_SOURCE_CANDIDATE_PASS');
    }else{
      assert.equal((await stat(journal)).mode&0o077,0);
      console.log('FAE_WALLET_POSIX_0600_SOURCE_OWNER_REGRESSION_PASS');
    }
  }finally{await rm(dir,{recursive:true,force:true})}
});
