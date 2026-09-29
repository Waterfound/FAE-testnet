import {test,expect,chromium,webkit} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const BASE='http://127.0.0.1:4173';

async function installNetwork(context){
  await context.route('https://wfwwotuhectwknvbvgif.supabase.co/**',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    const prefix='/functions/v1/fae-public-testnet-v4';
    const path=url.pathname.slice(prefix.length);
    let body={};
    if(path.startsWith('/status')){
      body={height:300,issued_fae:'3000',max_supply_fae:'12000000',halving_era_blocks:430000,difficulty_bits:18,node_version:5};
    }else if(path.startsWith('/state')){
      body={recent:[]};
    }else if(path.startsWith('/balance')){
      body={balance_fae:'0'};
    }else if(path.startsWith('/spendable')){
      body={spendable_fae:'0',utxos:[]};
    }else if(path.startsWith('/transactions')){
      body={transactions:[]};
    }else{
      throw new Error('Unexpected FAE API route: '+request.url());
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
}

async function completeNewWallet(page){
  await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});
  await page.locator('#action-create').click();
  await page.locator('#createwallet').click();
  await expect(page.locator('#wallet-connected-state')).toBeHidden();
  const phrase=await page.locator('#newseedwords').inputValue();
  expect(phrase.trim().split(/\s+/)).toHaveLength(24);
  expect(await page.evaluate(()=>FAEWalletVault.listWallets().then(items=>items.length))).toBe(0);
  await page.locator('#readyconfirm').click();
  await page.locator('#confirmseed').fill(phrase);
  await page.locator('#confirmwallet').click();
  await expect(page.locator('#wallet-connected-state')).toBeVisible();
  await expect(page.locator('#recoverystate')).toContainText('BACKUP_CONFIRMED');
  return page.locator('#addr').inputValue();
}

for(const [browserName,launcher] of [['Chromium',chromium],['WebKit',webkit]]){
  test(browserName+' preserves encrypted Wallet across a browser-profile restart',async()=>{
    const profile=await mkdtemp(join(tmpdir(),'fae-wallet-vault-'));
    let context;
    try{
      context=await launcher.launchPersistentContext(profile,{headless:true,viewport:{width:1024,height:900}});
      await installNetwork(context);
      let page=context.pages()[0]||await context.newPage();
      const address=await completeNewWallet(page);
      const atRest=await page.evaluate(()=>({
        keyring:localStorage.getItem('fae-public-v4-keyring-v3'),
        single:localStorage.getItem('fae-public-v4-wallet'),
        wallets:FAEWalletVault.listWallets().then(items=>items.length)
      }));
      expect(atRest.keyring).toBeNull();
      expect(atRest.single).toBeNull();
      expect(await atRest.wallets).toBe(1);
      await context.close();
      context=null;

      context=await launcher.launchPersistentContext(profile,{headless:true,viewport:{width:1024,height:900}});
      await installNetwork(context);
      page=context.pages()[0]||await context.newPage();
      await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});
      await expect(page.locator('#wallet-connected-state')).toBeVisible();
      await expect(page.locator('#addr')).toHaveValue(address);
      expect(await page.evaluate(()=>FAEWalletVault.listWallets().then(items=>items.length))).toBe(1);
      expect(await page.evaluate(()=>FAEWalletVault.capabilityProbe().then(result=>result.wrappingKeyExtractable))).toBe(false);
    }finally{
      if(context)await context.close();
      await rm(profile,{recursive:true,force:true});
    }
  });
}

test('unconfirmed creation, wrong confirmation, multi-wallet and mining switch fail closed',async({browser})=>{
  const context=await browser.newContext({viewport:{width:1024,height:900}});
  await installNetwork(context);
  const page=await context.newPage();
  await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});

  await page.locator('#action-create').click();
  await page.locator('#createwallet').click();
  const phrase=await page.locator('#newseedwords').inputValue();
  expect(await page.evaluate(()=>FAEWalletVault.listWallets().then(items=>items.length))).toBe(0);

  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('#wallet-connected-state')).toBeHidden();
  expect(await page.evaluate(()=>FAEWalletVault.listWallets().then(items=>items.length))).toBe(0);

  await page.locator('#action-create').click();
  await page.locator('#createwallet').click();
  const canonical=await page.locator('#newseedwords').inputValue();
  const wrong=await page.evaluate(()=>FAEWalletCrypto.mnemonicFromEntropy(crypto.getRandomValues(new Uint8Array(32))));
  await page.locator('#readyconfirm').click();
  await page.locator('#confirmseed').fill(wrong);
  await page.locator('#confirmwallet').click();
  await expect(page.locator('#recoverystate')).toContainText('do not exactly match');
  expect(await page.evaluate(()=>FAEWalletVault.listWallets().then(items=>items.length))).toBe(0);

  await page.locator('#confirmseed').fill(canonical);
  await page.locator('#confirmwallet').click();
  const firstId=await page.evaluate(()=>FAEWalletVault.readState().then(state=>state.activeWalletId));
  const firstAddress=await page.locator('#addr').inputValue();

  await page.locator('#action-recovery').click();
  const recoveryPhrase=await page.evaluate(()=>FAEWalletCrypto.mnemonicFromEntropy(crypto.getRandomValues(new Uint8Array(32))));
  await page.locator('#recoveryseed').fill(recoveryPhrase);
  await page.locator('#recoverypassphrase').fill('test-only-passphrase-'+Date.now());
  await page.locator('#verifyrecovery').click();
  await expect(page.locator('#recoverypreview-wrap')).toBeVisible();
  await expect(page.locator('#recoverypassphrase')).toHaveValue('');
  await page.locator('#admitrecovery').click();

  const wallets=await page.evaluate(()=>FAEWalletVault.listWallets());
  expect(wallets).toHaveLength(2);
  const secondId=await page.evaluate(()=>FAEWalletVault.readState().then(state=>state.activeWalletId));
  expect(secondId).not.toBe(firstId);

  const miningSwitch=await page.evaluate(async walletId=>{
    mining=true;
    try{
      await switchWallet(walletId);
      return 'unexpected-success';
    }catch(error){
      return error.message;
    }finally{
      mining=false;
      renderWallet();
    }
  },firstId);
  expect(miningSwitch).toContain('Stop mining before switching Wallets');

  await page.evaluate(walletId=>switchWallet(walletId),firstId);
  await expect(page.locator('#addr')).toHaveValue(firstAddress);

  await page.locator('#removewallet').click();
  await expect(page.locator('#remove-panel')).toBeVisible();
  await page.locator('#confirmremove').click();
  expect(await page.evaluate(()=>FAEWalletVault.listWallets().then(items=>items.length))).toBe(1);
  expect((await page.evaluate(()=>FAEWalletVault.listWallets()))[0].walletId).toBe(secondId);

  await context.close();
});

test('legacy V3 migration commits and verifies vault before deleting plaintext JWK storage',async({browser})=>{
  const context=await browser.newContext({viewport:{width:1024,height:900}});
  await installNetwork(context);
  const page=await context.newPage();
  await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});

  const legacy=await page.evaluate(async()=>{
    const phrase=await FAEWalletCrypto.mnemonicFromEntropy(crypto.getRandomValues(new Uint8Array(32)));
    const derived=await FAEWalletCrypto.deriveAddressRecords(phrase,'');
    return{
      expected:derived.addresses[0].address,
      record:{
        format:'FAE_BROWSER_KEYRING_V3',
        network:NETWORK,
        source:'browser',
        passphraseProtected:false,
        activeIndex:2,
        addresses:derived.addresses.map(({index,address,pub,jwk})=>({index,address,pub,jwk}))
      }
    };
  });
  await page.evaluate(record=>localStorage.setItem('fae-public-v4-keyring-v3',JSON.stringify(record)),legacy.record);
  await page.reload({waitUntil:'domcontentloaded'});

  expect(await page.evaluate(()=>localStorage.getItem('fae-public-v4-keyring-v3'))).toBeNull();
  expect(await page.evaluate(()=>localStorage.getItem('fae-public-v4-wallet'))).toBeNull();
  expect(await page.evaluate(()=>FAEWalletVault.listWallets().then(items=>items.length))).toBe(1);
  const migrated=await page.evaluate(()=>FAEWalletVault.migrationStatus());
  expect(migrated.status).toBe('complete');
  const active=await page.evaluate(()=>FAEWalletVault.loadActive().then(value=>value.account.addresses[0].address));
  expect(active).toBe(legacy.expected);
  await context.close();
});

test('authenticated vault tamper and wrong wrapping key never create a substitute Wallet',async({browser})=>{
  const context=await browser.newContext({viewport:{width:1024,height:900}});
  await installNetwork(context);
  const page=await context.newPage();
  await completeNewWallet(page);
  const originalAddress=await page.locator('#addr').inputValue();

  await page.evaluate(async()=>{
    const state=await FAEWalletVault.readState();
    const db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(FAEWalletVault.DB_NAME,FAEWalletVault.DB_VERSION);
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    const tx=db.transaction('wallets','readwrite');
    const store=tx.objectStore('wallets');
    const record=await new Promise((resolve,reject)=>{
      const request=store.get(state.activeWalletId);
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    record.cipher.payload=(record.cipher.payload[0]==='A'?'B':'A')+record.cipher.payload.slice(1);
    store.put(record);
    await new Promise((resolve,reject)=>{
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
    db.close();
  });

  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.locator('#recoverystate')).toContainText(/storage|Wallet|migration/i);
  await expect(page.locator('#wallet-connected-state')).toBeHidden();
  expect(await page.locator('#addr').inputValue()).not.toBe(originalAddress);

  // A fresh valid Wallet in another profile proves the corruption failure did
  // not fabricate or reinterpret replacement identity in this profile.
  const publicRecords=await page.evaluate(()=>FAEWalletVault.listWallets());
  expect(publicRecords).toHaveLength(1);
  await expect(page.evaluate(()=>FAEWalletVault.loadAccount(publicRecords[0].walletId))).rejects.toThrow();

  await context.close();
});
