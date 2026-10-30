// Candidate source-owner security tests, no user secrets/network or release.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,open,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {newMnemonic,NETWORK} from './crypto.mjs';
import {writeVault,readVault,unlockVault} from './vault.mjs';
import {writeIntent,readIntent,intentPath} from './outbox.mjs';
import {hardenWindowsPrivateFile,verifyWindowsPrivateFile} from './windows-private-file-acl.mjs';

test('original Wallet protected vault/outbox: POSIX 0600 or real owner-only NTFS ACL', {timeout:80000}, async()=>{
  const root=await realpath(tmpdir());
  const dir=await mkdtemp(join(root,'fae-wallet-owner-private-'));
  const vault=join(dir,'vault.json'), password='isolated-#342-Test-Passphrase-Not-User';
  try{
    const publicRows=await writeVault(vault,newMnemonic(),'',password);
    assert.ok(publicRows[0].address.startsWith('faet1'));
    const unlocked=await unlockVault(vault,password);
    assert.equal(unlocked[0].address,publicRows[0].address);
    await assert.rejects(unlockVault(vault,'invalid-password'),
      /incorrect_password_or_corrupt_vault/);
    const journal=intentPath(vault), txid='a'.repeat(64),tip='b'.repeat(64);
    await writeIntent(journal,{network:NETWORK,txid,node:'http://127.0.0.1:8025',
      address:publicRows[0].address,recipient:publicRows[1].address,
      amount_atoms:'100000000',fee_atoms:'1',tip_height:1,tip_hash:tip},password);
    const recovered=await readIntent(journal,password);
    assert.equal(recovered.txid,txid);
    assert.equal(recovered.address,publicRows[0].address);
    await assert.rejects(writeIntent(journal,{network:NETWORK,txid,node:'http://127.0.0.1:8025',
      address:publicRows[0].address,amount_atoms:'100000000',fee_atoms:'1',
      tip_height:1,tip_hash:tip},password),/EEXIST/);
    assert.equal((await readFile(journal,'utf8')).includes(txid),false,
      'encrypted owner outbox has no plaintext TXID');
    if(process.platform==='win32'){
      await verifyWindowsPrivateFile(vault);
      await verifyWindowsPrivateFile(journal);
      const systemRoot=process.env.SystemRoot;
      if(typeof systemRoot!=='string'||!/^[A-Z]:\\Windows$/i.test(systemRoot))
        throw Error('trusted NTFS test environment unavailable');
      // Adversarially grant the well-known Everyone SID. Reading must
      // immediately fail closed; do NOT allow an inherited/non-owner ACE.
      const icacls=join(systemRoot,'System32','icacls.exe');
      execFileSync(icacls,[vault,'/grant','*S-1-1-0:(R)'],
        {windowsHide:true,timeout:15000,maxBuffer:4096});
      await assert.rejects(readVault(vault),
        /Windows original Wallet private ACL refused/);
      const handle=await open(vault,'r+');
      try{await hardenWindowsPrivateFile(vault,handle)}
      finally{await handle.close()}
      await verifyWindowsPrivateFile(vault);
      assert.equal((await unlockVault(vault,password))[0].address,publicRows[0].address);
      console.log('FAE_WALLET_NTFS_OWNER_PRIVATE_ACL_CANDIDATE_PASS');
    }else{
      const {stat}=await import('node:fs/promises');
      assert.equal((await stat(vault)).mode&0o077,0);
      assert.equal((await stat(journal)).mode&0o077,0);
      console.log('FAE_WALLET_POSIX_0600_UNCHANGED_PASS');
    }
  }finally{await rm(dir,{recursive:true,force:true})}
});
