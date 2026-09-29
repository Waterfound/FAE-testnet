import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:4173';
const SUBMIT_TXID='a'.repeat(64);
const HISTORY_TXID='b'.repeat(64);

const profiles=[
  {name:'desktop-mouse',viewport:{width:1440,height:900},hasTouch:false},
  {name:'tablet-touch',viewport:{width:834,height:1194},hasTouch:true},
  {name:'mobile-touch',viewport:{width:390,height:844},hasTouch:true}
];

async function activate(locator,touch){
  if(touch)await locator.tap();
  else await locator.click();
}

async function installDeterministicNetwork(page){
  await page.route('https://wfwwotuhectwknvbvgif.supabase.co/**',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    const prefix='/functions/v1/fae-public-testnet-v4';
    if(!url.pathname.startsWith(prefix)){
      throw new Error('Unexpected FAE Supabase route: '+request.url());
    }
    const path=url.pathname.slice(prefix.length);
    let body={};

    if(path.startsWith('/status')){
      body={
        height:250,
        issued_fae:'2500',
        max_supply_fae:'12000000',
        halving_era_blocks:430000,
        difficulty_bits:18,
        node_version:5
      };
    }else if(path.startsWith('/state')){
      body={recent:[]};
    }else if(path.startsWith('/balance')){
      body={balance_fae:'2'};
    }else if(path.startsWith('/spendable')){
      body={
        spendable_fae:'2',
        utxos:[{outpoint:'browser-fixture:0',amount_atoms:'200000000'}]
      };
    }else if(path.startsWith('/transactions')){
      const address=url.searchParams.get('address');
      if(!address)throw new Error('Transactions request missing active address: '+request.url());
      body={transactions:[{
        txid:HISTORY_TXID,
        from_address:address,
        inputs:['browser-fixture:0'],
        outputs:[{address,amount_atoms:'100000000'}],
        status:'pending',
        confirmed_height:null,
        created_at:'2026-09-27T17:00:00Z',
        mempool_seq:1
      }]};
    }else if(path.startsWith('/submit-tx')){
      body={txid:SUBMIT_TXID};
    }else{
      throw new Error('Unexpected FAE API route: '+request.url());
    }

    await route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify(body)
    });
  });
}

for(const profile of profiles){
  test(profile.name+' completes Wallet Transaction UX journey',async({browser})=>{
    const context=await browser.newContext({
      viewport:profile.viewport,
      hasTouch:profile.hasTouch,
      locale:'en-US'
    });
    await context.grantPermissions(
      ['clipboard-read','clipboard-write'],
      {origin:BASE}
    );
    const page=await context.newPage();
    await installDeterministicNetwork(page);

    await page.goto(BASE+'/index.html',{waitUntil:'domcontentloaded'});
    await expect(page.locator('#netstatus')).toHaveAttribute('data-state','online');

    await activate(page.locator('#action-create'),profile.hasTouch);
    await activate(page.locator('#createwallet'),profile.hasTouch);
    await expect(page.locator('#wallet-connected-state')).toBeHidden();
    await expect(page.locator('#newseedwords')).not.toHaveValue('');
    const recoveryWords=await page.locator('#newseedwords').inputValue();
    expect(recoveryWords.trim().split(/\s+/)).toHaveLength(24);
    await activate(page.locator('#readyconfirm'),profile.hasTouch);
    await page.locator('#confirmseed').fill(recoveryWords);
    await activate(page.locator('#confirmwallet'),profile.hasTouch);
    await expect(page.locator('#wallet-connected-state')).toBeVisible();
    await expect(page.locator('#addr')).toHaveValue(/^faet1/);
    await expect(page.locator('#historystate')).toHaveAttribute('data-state','ready_recent');
    await expect(page.locator('#txhist details')).toHaveCount(1);

    if(await page.locator('#backup').isVisible()){
      await activate(page.locator('#closebackup'),profile.hasTouch);
    }

    const toggle=page.locator('#togglehistory');
    if(profile.hasTouch){
      await toggle.tap();
      await expect(toggle).toHaveAttribute('aria-expanded','false');
      await toggle.tap();
      await expect(toggle).toHaveAttribute('aria-expanded','true');
    }else{
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded','false');
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded','true');
    }

    const details=page.locator('#txhist details').first();
    const summary=details.locator('summary');
    if(profile.hasTouch)await summary.tap();
    else{
      await summary.focus();
      await expect(summary).toBeFocused();
      await page.keyboard.press('Enter');
    }
    await expect(details).toHaveAttribute('open','');

    const fullHistoryId=details.locator('[data-detail-key="txid"] textarea');
    await expect(fullHistoryId).toHaveValue(HISTORY_TXID);
    await expect(fullHistoryId).toHaveAttribute('readonly','');
    await expect(details.locator('[data-detail-key="direction"] .transaction-detail-value')).toHaveText('Self transfer');
    await expect(details.locator('[data-detail-key="status"] .transaction-detail-value')).toHaveText('Pending');
    await expect(details.locator('[data-detail-key="outputs"] .transaction-detail-value')).toContainText('1 FAE');

    const copyHistory=details.locator('.transaction-copy');
    await activate(copyHistory,profile.hasTouch);
    await expect(details.locator('.transaction-copy-feedback')).toHaveText('Full transaction ID copied.');
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(HISTORY_TXID);

    const destination=await page.evaluate(()=>walletAccount.addresses[1].address);
    await page.locator('#sendto').fill(destination);
    await page.locator('#sendamt').fill('1');
    await activate(page.locator('#send'),profile.hasTouch);
    await expect(page.locator('#lastsendtx')).toBeVisible();
    await expect(page.locator('#lastsendtxid')).toHaveValue(SUBMIT_TXID);
    await expect(page.locator('#sendstate')).toContainText('accepted');
    await expect(page.locator('#sendstate')).toContainText('unconfirmed');

    await activate(page.locator('#copylastsendtx'),profile.hasTouch);
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(SUBMIT_TXID);
    await expect(page.locator('#sendstate')).toContainText('remains unconfirmed');

    await expect(page.locator('#historycoverage')).toContainText('latest 100 network transactions');
    await expect(page.locator('#historycoverage')).toContainText('up to 30');
    await expect(page.locator('#historycoverage')).toContainText('No pagination');
    await expect(page.locator('#historycoverage')).toContainText('mining rewards are excluded');
    await expect(page.locator('#historycoverage')).toContainText('not lifetime history');

    const overflow=await page.evaluate(
      ()=>document.documentElement.scrollWidth-document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await context.close();
  });
}

test('WTX-05 evidence is browser-CI, not physical-device evidence',async()=>{
  expect(profiles.some(profile=>profile.hasTouch)).toBe(true);
  expect(profiles.map(profile=>profile.name)).toEqual([
    'desktop-mouse','tablet-touch','mobile-touch'
  ]);
});
