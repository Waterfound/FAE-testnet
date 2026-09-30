'use strict';

const WALLET_KEY='fae-public-v4-wallet';
const WATCH_KEY='fae-public-v4-active-watch';
const KEYRING_KEY='fae-public-v4-keyring-v3';

let sessionMnemonic='';
let walletLoadError='';
let lastSubmittedTxid='';
let lastSubmittedAddress='';
let activeWalletId=null;
let vaultWallets=[];
let vaultCapability=null;
let pendingNewWallet=null;
let pendingRecovery=null;

function legacyNewAccount(derived,source='browser'){
  return{
    source,
    passphraseProtected:Boolean(derived.passphraseProtected),
    activeIndex:0,
    addresses:derived.addresses
  };
}

async function hydrateStoredAccount(record){
  if(record?.network&&record.network!==NETWORK)throw Error('Saved wallet belongs to another network');
  if(!Array.isArray(record?.addresses)||!record.addresses.length)throw Error('Saved wallet has no addresses');
  if(record.addresses.length>50)throw Error('Saved wallet contains too many addresses');
  const addresses=[];
  const seen=new Set();
  for(const item of record.addresses){
    const restored=await FAEWalletCrypto.restoreRecordFromJwk(
      item.jwk||item.private_key_jwk,
      item.address,
      item.pub||item.public_key_spki,
      Number(item.index)||0
    );
    if(seen.has(restored.address))throw Error('Saved wallet contains duplicate addresses');
    seen.add(restored.address);
    addresses.push(restored);
  }
  const activeIndex=Math.min(Math.max(Number(record.activeIndex??record.active_index)||0,0),addresses.length-1);
  return{
    source:record.source||'recovered',
    passphraseProtected:Boolean(record.passphraseProtected??record.passphrase_protected??record.passphrase_required),
    activeIndex,
    addresses
  };
}

async function migrateSingleWallet(record){
  const restored=await FAEWalletCrypto.restoreRecordFromJwk(record.jwk,record.address,record.pub,0);
  try{
    const entropy=FAEWalletCrypto.entropyFromPrivateJwk(record.jwk);
    const mnemonic=await FAEWalletCrypto.mnemonicFromEntropy(entropy);
    const derived=await FAEWalletCrypto.deriveAddressRecords(mnemonic,'');
    if(derived.addresses[0].address===restored.address)return legacyNewAccount(derived,'migrated');
  }catch{
    // A legacy direct-key package may remain a valid one-address wallet.
  }
  return{source:'migrated',passphraseProtected:false,activeIndex:0,addresses:[restored]};
}

function sameAddressSet(left,right){
  return JSON.stringify((left||[]).map(item=>[Number(item.index)||0,item.address,item.pub]))===
    JSON.stringify((right||[]).map(item=>[Number(item.index)||0,item.address,item.pub]));
}

async function migrateLegacyWallet(){
  const rawKeyring=localStorage.getItem(KEYRING_KEY);
  const rawSingle=localStorage.getItem(WALLET_KEY);
  if(!rawKeyring&&!rawSingle)return null;

  let account;
  let legacyFormat;
  try{
    if(rawKeyring){
      let record;
      try{record=JSON.parse(rawKeyring)}catch{throw Error('Legacy wallet keyring JSON is invalid')}
      account=await hydrateStoredAccount(record);
      legacyFormat=record?.format||'FAE_BROWSER_KEYRING_V3';
    }else{
      let record;
      try{record=JSON.parse(rawSingle)}catch{throw Error('Legacy single-wallet JSON is invalid')}
      if(!record?.jwk||!record?.address)throw Error('Legacy single-wallet record is incomplete');
      account=await migrateSingleWallet(record);
      legacyFormat='FAE_BROWSER_SINGLE_WALLET';
    }

    const before=await FAEWalletVault.listWallets();
    const admitted=await FAEWalletVault.admitAccount(account,{
      network:NETWORK,
      source:'legacy-migration',
      makeActive:before.length===0
    });
    const verified=await FAEWalletVault.loadAccount(admitted.walletId);
    if(!sameAddressSet(account.addresses,verified.addresses))throw Error('Legacy migration identity verification failed');

    await FAEWalletVault.markMigration({
      status:'complete',
      from:legacyFormat,
      walletId:admitted.walletId,
      completedAt:new Date().toISOString()
    });

    // Delete legacy private-key storage only after the encrypted vault commit
    // has been read back, decrypted and identity-verified.
    localStorage.removeItem(KEYRING_KEY);
    localStorage.removeItem(WALLET_KEY);
    return admitted.walletId;
  }catch(error){
    await FAEWalletVault.markMigration({
      status:'failed',
      error:String(error?.message||error),
      failedAt:new Date().toISOString()
    }).catch(()=>{});
    throw error;
  }
}

async function refreshVaultWallets(){
  vaultWallets=await FAEWalletVault.listWallets();
  return vaultWallets;
}

async function loadWallet(){
  walletLoadError='';
  walletAccount=null;
  activeWalletId=null;
  try{
    vaultCapability=await FAEWalletVault.capabilityProbe();
    try{
      await migrateLegacyWallet();
    }catch(error){
      walletLoadError='Legacy wallet migration stopped safely: '+error.message;
    }

    await refreshVaultWallets();
    if(vaultWallets.length){
      const active=await FAEWalletVault.loadActive();
      if(!active?.record||!active?.account)throw Error('Persistent vault contains Wallets but no valid active Wallet');
      if(active.record.network!==NETWORK)throw Error('Saved Wallet belongs to another network');
      activeWalletId=active.record.walletId;
      walletAccount=active.account;
    }

    const watch=localStorage.getItem(WATCH_KEY);
    if(watch&&validAddr(watch)){
      wallet={index:0,address:watch,watchOnly:true};
    }else if(walletAccount?.addresses.length){
      wallet=walletAccount.addresses[walletAccount.activeIndex]||walletAccount.addresses[0];
    }else{
      wallet=null;
    }
  }catch(error){
    walletAccount=null;
    wallet=null;
    activeWalletId=null;
    vaultWallets=[];
    walletLoadError=error.message;
  }
}

async function copyText(value){
  if(!value)throw Error('No address or recovery phrase to copy');
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(value);
    return;
  }
  const temporary=document.createElement('textarea');
  temporary.value=value;
  temporary.style.position='fixed';
  temporary.style.opacity='0';
  document.body.append(temporary);
  temporary.select();
  const copied=document.execCommand('copy');
  temporary.remove();
  if(!copied)throw Error('Clipboard access was denied');
}

function setStatus(id,message,tone=''){
  const element=$(id);
  if(!element)return;
  element.textContent=message;
  element.className='status'+(tone?' '+tone:'');
}

function clearPendingNewWallet(){
  pendingNewWallet=null;
  $('newseedwords').value='';
  $('confirmseed').value='';
  $('new-wallet-backup').hidden=true;
  $('new-wallet-confirmation').hidden=true;
  $('new-wallet-start').hidden=false;
}

function clearPendingRecovery(){
  pendingRecovery=null;
  $('recoveryseed').value='';
  $('recoverypassphrase').value='';
  $('recoverypreview').value='';
  $('recoverypreview-wrap').hidden=true;
}

function showWalletAction(action){
  if(!['create','recovery'].includes(action))return;
  if(action==='create')clearPendingRecovery();
  else clearPendingNewWallet();
  const selectedPanel=$(action+'-panel');
  const willOpen=selectedPanel.hidden;
  for(const name of ['create','recovery']){
    const active=name===action&&willOpen;
    $(name+'-panel').hidden=!active;
    $('action-'+name).setAttribute('aria-pressed',String(active));
  }
  if(willOpen)setTimeout(()=>$(action==='recovery'?'recoveryseed':'createwallet').focus(),0);
}

function renderWalletList(){
  const container=$('walletlist');
  if(!container)return;
  clearElement(container);
  if(!vaultWallets.length){
    const empty=document.createElement('div');
    empty.className='empty';
    empty.textContent='No Wallets are saved in this browser.';
    container.append(empty);
    return;
  }
  vaultWallets.forEach((record,index)=>{
    const row=document.createElement('div');
    row.className='wallet-row'+(record.walletId===activeWalletId?' active':'');
    const main=document.createElement('div');
    main.className='wallet-row-main';
    const label=document.createElement('div');
    label.className='wallet-row-label';
    label.textContent='Wallet '+(index+1)+(record.passphraseProtected?' · passphrase':'');
    const address=document.createElement('div');
    address.className='wallet-row-address mono';
    address.textContent=record.addresses[0]?.address||'No address';
    main.append(label,address);
    const button=document.createElement('button');
    button.type='button';
    button.className=record.walletId===activeWalletId?'ghost':'alt';
    button.textContent=record.walletId===activeWalletId?'Active':'Switch';
    button.disabled=record.walletId===activeWalletId;
    button.addEventListener('click',()=>switchWallet(record.walletId).catch(showWalletError));
    row.append(main,button);
    container.append(row);
  });
}

function renderAddressList(){
  const container=$('addresslist');
  if(!container)return;
  clearElement(container);
  if(!walletAccount?.addresses.length){
    const empty=document.createElement('div');
    empty.className='empty';
    empty.textContent='No derived Wallet addresses yet.';
    container.append(empty);
    return;
  }
  walletAccount.addresses.forEach((record,listIndex)=>{
    const active=!wallet?.watchOnly&&wallet?.address===record.address;
    const row=document.createElement('button');
    row.type='button';
    row.className='address-row';
    row.setAttribute('aria-pressed',String(active));
    row.setAttribute('aria-label','Use wallet address '+(record.index+1));

    const number=document.createElement('span');
    number.className='address-number';
    number.textContent='Address '+(record.index+1);
    const value=document.createElement('span');
    value.className='address-value mono';
    value.textContent=record.address;
    const marker=document.createElement('span');
    marker.className='active-mark';
    marker.textContent=active?'Active':'Use';
    row.append(number,value,marker);
    row.addEventListener('click',()=>activateAccountAddress(listIndex).catch(showWalletError));
    container.append(row);
  });
}

function renderVaultPersistence(){
  const target=$('vaultstate');
  if(!target)return;
  if(walletLoadError){
    target.textContent=walletLoadError;
    return;
  }
  const persistence=vaultCapability?.persistence;
  target.textContent=persistence?.persisted
    ?'Local encrypted vault ready · browser persistent-storage protection granted.'
    :'Local encrypted vault ready · browser storage policy remains browser-managed; keep the 24-word recovery phrase offline.';
}

function renderWallet(){
  const hasFullWallet=vaultWallets.length>0;
  const full=Boolean(wallet&&!wallet.watchOnly&&wallet.priv);
  const watch=Boolean(wallet?.watchOnly);

  $('wallet-connected-state').hidden=!hasFullWallet;
  $('wallet-empty-note').hidden=hasFullWallet;
  $('wallet-entry-title').textContent=hasFullWallet?'Add Wallet':'Set up Wallet';
  $('wallet-entry-subtitle').textContent=hasFullWallet
    ?'Add another independent Wallet without replacing the current one.'
    :'Choose how you want to begin.';

  $('addr').value=wallet?.address||'';
  $('miningaddr').value=wallet?.address||'';
  $('receive').disabled=!wallet;
  $('copyminingaddr').disabled=!wallet;
  $('mine').disabled=!wallet||mining;
  $('send').disabled=!full;
  $('exportwallet').disabled=!full||!walletAccount;
  $('togglehistory').disabled=!wallet;
  $('removewallet').disabled=!activeWalletId;

  const showSubmittedTxid=Boolean(lastSubmittedTxid&&wallet?.address===lastSubmittedAddress);
  $('lastsendtx').hidden=!showSubmittedTxid;
  $('lastsendtxid').value=showSubmittedTxid?lastSubmittedTxid:'';
  $('copylastsendtx').disabled=!showSubmittedTxid;
  $('restorefromsend').hidden=full||!wallet;
  $('restorefromsend').textContent=walletAccount?'Return to active Wallet':'Recovery Wallet';
  $('usesaved').hidden=!watch||!walletAccount;

  const kindText=!wallet?'No wallet':watch?'External address':walletAccount?.passphraseProtected?'Passphrase Wallet':'Full Wallet';
  const kindTone=watch?'pill warn':'pill';
  $('wallet-kind').textContent=kindText;
  $('wallet-kind').className=kindTone;
  $('mining-wallet-kind').textContent=!wallet?'No address':watch?'Cold / watch-only':'Wallet address '+((wallet.index??0)+1);
  $('mining-wallet-kind').className=kindTone;

  if(!wallet){
    setStatus('wstate',walletLoadError?'Wallet storage requires attention: '+walletLoadError:'No Wallet selected.',walletLoadError?'bad':'');
    setStatus('sendstate','Create or recover a full Wallet to send.');
    setStatus('mstate','Select a reward address in Wallet, or insert a public address below.');
  }else if(watch){
    setStatus('wstate','External public address active for receiving/mining. Its private key is not present here.','warn');
    setStatus('sendstate','Return to a saved full Wallet to send.','warn');
    if(!mining)setStatus('mstate','Ready to mine locally to the external public address.','ok');
  }else{
    setStatus('wstate','Wallet Connected · local signing is available.','ok');
    setStatus('sendstate','Full Wallet ready. Enter a destination and amount.','ok');
    if(!mining)setStatus('mstate','Ready to mine locally to the active Wallet address.','ok');
  }
  $('watchstate').textContent=watch?'External address is active. It is separate from the persistent Wallet vault.':'';
  renderWalletList();
  renderAddressList();
  renderVaultPersistence();
}

async function activateVaultAccount(walletId,{refreshData=true}={}){
  if(mining)throw Error('Stop mining before switching Wallets');
  await FAEWalletVault.setActiveWallet(walletId);
  const account=await FAEWalletVault.loadAccount(walletId);
  activeWalletId=walletId;
  walletAccount=account;
  localStorage.removeItem(WATCH_KEY);
  wallet=account.addresses[account.activeIndex]||account.addresses[0];
  await refreshVaultWallets();
  renderWallet();
  if(refreshData)await refresh();
}

async function switchWallet(walletId){
  return activateVaultAccount(walletId);
}

async function activateAccountAddress(listIndex,{refreshData=true}={}){
  if(mining)throw Error('Stop mining before changing the reward address');
  if(!activeWalletId)throw Error('No active Wallet is selected');
  const selected=walletAccount?.addresses[listIndex];
  if(!selected)throw Error('Wallet address not found');
  walletAccount=await FAEWalletVault.setActiveAddress(activeWalletId,listIndex);
  wallet=walletAccount.addresses[walletAccount.activeIndex];
  localStorage.removeItem(WATCH_KEY);
  await refreshVaultWallets();
  renderWallet();
  if(refreshData)await refresh();
}

async function canonicalMnemonic(raw){
  const words=String(raw||'').trim().split(/\s+/).filter(Boolean);
  if(words.length!==24)throw Error('Enter exactly 24 recovery words');
  const entropy=await FAEWalletCrypto.entropyFromMnemonic(words.join(' '));
  return FAEWalletCrypto.mnemonicFromEntropy(entropy);
}

async function beginNewWallet(){
  if(mining)throw Error('Stop mining before creating a Wallet');
  await FAEWalletVault.capabilityProbe();
  const button=$('createwallet');
  button.disabled=true;
  try{
    const entropy=crypto.getRandomValues(new Uint8Array(32));
    const mnemonic=await FAEWalletCrypto.mnemonicFromEntropy(entropy);
    const account=legacyNewAccount(await FAEWalletCrypto.deriveAddressRecords(mnemonic,''),'created');
    pendingNewWallet={mnemonic,account};
    $('newseedwords').value=mnemonic;
    $('new-wallet-start').hidden=true;
    $('new-wallet-backup').hidden=false;
    $('new-wallet-confirmation').hidden=true;
    setStatus('recoverystate','NEW_WALLET_BACKUP · Not saved yet. Store all 24 words offline.','warn');
  }finally{button.disabled=false}
}

async function copyNewSeed(){
  if(!pendingNewWallet)throw Error('Generate a New Wallet first');
  await copyText(pendingNewWallet.mnemonic);
  setStatus('recoverystate','24 words copied. Offline written backup is still recommended; clear the clipboard after use.','warn');
}

function readyForNewWalletConfirmation(){
  if(!pendingNewWallet)throw Error('Generate a New Wallet first');
  $('new-wallet-backup').hidden=true;
  $('new-wallet-confirmation').hidden=false;
  $('confirmseed').value='';
  $('confirmseed').focus();
  setStatus('recoverystate','NEW_WALLET_CONFIRMATION · Re-enter all 24 words. The Wallet is still not saved.','warn');
}

function backToNewWalletSeed(){
  if(!pendingNewWallet)throw Error('No pending New Wallet');
  $('new-wallet-confirmation').hidden=true;
  $('new-wallet-backup').hidden=false;
  $('confirmseed').value='';
}

async function confirmNewWallet(){
  if(mining)throw Error('Stop mining before saving a Wallet');
  if(!pendingNewWallet)throw Error('No pending New Wallet');
  const confirmed=await canonicalMnemonic($('confirmseed').value);
  if(confirmed!==pendingNewWallet.mnemonic)throw Error('The 24 words do not exactly match the generated Wallet');
  const expectedAddress=pendingNewWallet.account.addresses[0].address;
  const admitted=await FAEWalletVault.admitAccount(pendingNewWallet.account,{
    network:NETWORK,
    source:'created-backup-confirmed',
    makeActive:true
  });
  const verified=await FAEWalletVault.loadAccount(admitted.walletId);
  if(verified.addresses[0].address!==expectedAddress)throw Error('Persistent Wallet identity verification failed');
  clearPendingNewWallet();
  sessionMnemonic='';
  $('create-panel').hidden=true;
  $('action-create').setAttribute('aria-pressed','false');
  await refreshVaultWallets();
  await activateVaultAccount(admitted.walletId,{refreshData:false});
  setStatus('recoverystate','BACKUP_CONFIRMED · Wallet Connected. The New Wallet is now saved in the local encrypted vault.','ok');
  await refresh();
}

async function verifyRecoveryWallet(){
  if(mining)throw Error('Stop mining before recovering a Wallet');
  await FAEWalletVault.capabilityProbe();
  const phrase=await canonicalMnemonic($('recoveryseed').value);
  const passphrase=$('recoverypassphrase').value;
  const derived=await FAEWalletCrypto.deriveAddressRecords(phrase,passphrase);
  pendingRecovery={
    account:legacyNewAccount(derived,'recovered'),
    mnemonic:phrase
  };
  $('recoverypreview').value=derived.addresses[0].address;
  $('recoverypreview-wrap').hidden=false;
  $('recoveryseed').value='';
  $('recoverypassphrase').value='';
  setStatus(
    'recoverystate',
    derived.passphraseProtected
      ?'Recovery derived locally with the supplied passphrase. Check the receiving address before adding it.'
      :'Recovery derived locally. Check the receiving address before adding it.',
    'warn'
  );
}

async function admitRecoveryWallet(){
  if(mining)throw Error('Stop mining before adding a Wallet');
  if(!pendingRecovery)throw Error('Verify the recovery phrase first');
  const expected=pendingRecovery.account.addresses[0].address;
  const admitted=await FAEWalletVault.admitAccount(pendingRecovery.account,{
    network:NETWORK,
    source:'recovered',
    makeActive:true
  });
  const verified=await FAEWalletVault.loadAccount(admitted.walletId);
  if(verified.addresses[0].address!==expected)throw Error('Recovered Wallet identity verification failed');
  clearPendingRecovery();
  sessionMnemonic='';
  $('recovery-panel').hidden=true;
  $('action-recovery').setAttribute('aria-pressed','false');
  await refreshVaultWallets();
  await activateVaultAccount(admitted.walletId,{refreshData:false});
  setStatus('recoverystate',admitted.deduplicated?'Wallet already existed in this vault · switched to it.':'Wallet Connected · recovery added to the local encrypted vault.','ok');
  await refresh();
}

async function accountFromRecovery(raw){
  if(!raw.trim())throw Error('Paste or choose an FAE recovery package');
  if(!raw.trim().startsWith('{')){
    const phrase=await canonicalMnemonic(raw);
    const derived=await FAEWalletCrypto.deriveAddressRecords(phrase,'');
    return{account:legacyNewAccount(derived,'recovered'),mnemonic:phrase};
  }

  let record;
  try{record=JSON.parse(raw)}catch{throw Error('Invalid recovery JSON')}
  if(record?.network&&record.network!==NETWORK)throw Error('Recovery package belongs to another network');

  if(record?.format==='FAE_TESTNET_WALLET_RECOVERY_V3'){
    let mnemonic='';
    if(record.recovery_words){
      mnemonic=await canonicalMnemonic(record.recovery_words);
    }
    const account=await hydrateStoredAccount({
      ...record,
      passphraseProtected:record.passphrase_required,
      activeIndex:record.active_index,
      addresses:record.addresses
    });
    if(mnemonic&&!record.passphrase_required){
      const check=await FAEWalletCrypto.deriveAddressRecords(mnemonic,'',1);
      if(check.addresses[0].address!==account.addresses[0].address)throw Error('Recovery words do not match the package keys');
    }
    return{account,mnemonic};
  }

  if(record?.format==='FAE_TESTNET_WALLET_RECOVERY_V2'){
    const mnemonic=await canonicalMnemonic(record.recovery_words||'');
    const derived=await FAEWalletCrypto.deriveAddressRecords(mnemonic,'');
    if(record.address&&record.address!==derived.addresses[0].address)throw Error('Recovery words do not match the package address');
    return{account:legacyNewAccount(derived,'recovered'),mnemonic};
  }

  if(record?.format==='FAE_TESTNET_WALLET_RECOVERY_V1'){
    const restored=await FAEWalletCrypto.restoreRecordFromJwk(
      record.private_key_jwk,
      record.address,
      record.public_key_spki,
      0
    );
    return{account:{source:'recovered',passphraseProtected:false,activeIndex:0,addresses:[restored]},mnemonic:''};
  }
  throw Error('Unsupported recovery package');
}

async function importRecovery(){
  if(mining)throw Error('Stop mining before recovery');
  await FAEWalletVault.capabilityProbe();
  let raw=$('recovery').value;
  const file=$('recoveryfile').files?.[0];
  if(file)raw=await file.text();
  const button=$('importwallet');
  button.disabled=true;
  try{
    const recovered=await accountFromRecovery(raw);
    const admitted=await FAEWalletVault.admitAccount(recovered.account,{
      network:NETWORK,
      source:'legacy-recovery-package',
      makeActive:true
    });
    sessionMnemonic='';
    $('recovery').value='';
    $('recoveryfile').value='';
    await refreshVaultWallets();
    await activateVaultAccount(admitted.walletId,{refreshData:false});
    setStatus('recoverystate',admitted.deduplicated?'Legacy package matches an existing Wallet · switched to it.':'Legacy recovery package verified and added to the encrypted vault.','ok');
    await refresh();
  }finally{button.disabled=false}
}

async function mnemonicForAccount(){
  if(sessionMnemonic)return sessionMnemonic;
  if(walletAccount?.passphraseProtected){
    throw Error('The original seed phrase cannot be reconstructed from this passphrase-derived Wallet. Use the original 24 words and exact passphrase.');
  }
  const first=walletAccount?.addresses.find(item=>item.index===0)||walletAccount?.addresses[0];
  if(!first)throw Error('Full Wallet required');
  const entropy=FAEWalletCrypto.entropyFromPrivateJwk(first.jwk);
  const mnemonic=await FAEWalletCrypto.mnemonicFromEntropy(entropy);
  const check=await FAEWalletCrypto.deriveAddressRecords(mnemonic,'',1);
  if(check.addresses[0].address!==first.address)throw Error('This legacy key does not expose a seed phrase');
  return mnemonic;
}

async function showBackup(){
  if(!walletAccount||!wallet||wallet.watchOnly)throw Error('Full Wallet required');
  $('backup').hidden=false;
  try{
    const words=await mnemonicForAccount();
    $('seedwords').value=words;
    $('copyseed').disabled=false;
    $('backupnote').textContent='Store these 24 words offline. They are never sent to FAE infrastructure.';
  }catch(error){
    $('seedwords').value='Original seed phrase is not retained by this Wallet record.';
    $('copyseed').disabled=true;
    $('backupnote').textContent=error.message+' The advanced recovery JSON contains direct testnet private keys.';
  }
  $('backup').scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function recoveryPackage(){
  if(!walletAccount||!wallet||wallet.watchOnly)throw Error('Full Wallet required');
  let recoveryWords;
  try{recoveryWords=await mnemonicForAccount()}catch{recoveryWords=undefined}
  const record={
    format:'FAE_TESTNET_WALLET_RECOVERY_V3',
    network:NETWORK,
    created_at:new Date().toISOString(),
    active_index:walletAccount.activeIndex,
    passphrase_required:Boolean(walletAccount.passphraseProtected),
    addresses:walletAccount.addresses.map(item=>({
      index:item.index,
      address:item.address,
      public_key_spki:item.pub,
      private_key_jwk:item.jwk
    })),
    warning:'PRIVATE TESTNET KEYS — ANYONE WITH THIS FILE CAN SPEND THESE ADDRESSES. KEEP IT PRIVATE AND OFFLINE.'
  };
  if(recoveryWords)record.recovery_words=recoveryWords;
  return record;
}

async function copySeed(){
  const words=await mnemonicForAccount();
  await copyText(words);
  setStatus('recoverystate','24 words copied. Store them offline, then clear the clipboard.','warn');
}

async function downloadBackup(){
  const record=await recoveryPackage();
  const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download='fairyelf-testnet-wallet-'+wallet.address.slice(0,14)+'.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  setStatus('recoverystate','Recovery JSON downloaded. It contains direct private keys; keep it private and offline.','warn');
}

async function copyReceiveAddress(){
  if(!wallet)throw Error('Select an address first');
  await copyText(wallet.address);
  setStatus('wstate','Receiving address copied.','ok');
}

async function useExistingAddress(){
  if(mining)throw Error('Stop mining before changing the reward address');
  const value=$('existingaddr').value.trim();
  if(!validAddr(value))throw Error('Invalid FAE testnet address');
  wallet={index:0,address:value,watchOnly:true};
  localStorage.setItem(WATCH_KEY,value);
  $('existingaddr').value='';
  renderWallet();
  await refresh();
}

async function useSavedFullWallet(){
  if(mining)throw Error('Stop mining before changing the reward address');
  if(!activeWalletId||!walletAccount?.addresses.length)throw Error('No full Wallet is saved in this browser');
  await activateVaultAccount(activeWalletId);
}

function prepareRemoveWallet(){
  if(!activeWalletId)throw Error('No active Wallet to remove');
  $('remove-panel').hidden=false;
  $('remove-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function removeActiveWallet(){
  if(mining)throw Error('Stop mining before removing a Wallet');
  if(!activeWalletId)throw Error('No active Wallet to remove');
  const removing=activeWalletId;
  const result=await FAEWalletVault.removeWallet(removing);
  await refreshVaultWallets();
  sessionMnemonic='';
  $('remove-panel').hidden=true;

  if(result.activeWalletId){
    activeWalletId=result.activeWalletId;
    walletAccount=await FAEWalletVault.loadAccount(activeWalletId);
    localStorage.removeItem(WATCH_KEY);
    wallet=walletAccount.addresses[walletAccount.activeIndex]||walletAccount.addresses[0];
  }else{
    activeWalletId=null;
    walletAccount=null;
    const watch=localStorage.getItem(WATCH_KEY);
    wallet=watch&&validAddr(watch)?{index:0,address:watch,watchOnly:true}:null;
  }
  renderWallet();
  setStatus('recoverystate','Wallet removed from this browser. No other Wallet was changed.','ok');
  await refresh();
}

async function sendFAE(){
  if(!wallet||wallet.watchOnly||!wallet.priv)throw Error('Insert the full wallet to send');
  const amount=parseAmt($('sendamt').value);
  const destination=$('sendto').value.trim();
  if(!validAddr(destination)||amount<=0n)throw Error('Invalid destination or amount');
  if(!globalThis.FAEWalletSigningIntent)throw Error('Wallet signing-intent guard is unavailable');
  const signingIntent=FAEWalletSigningIntent.create({
    network:NETWORK,
    sourceAddress:wallet.address,
    destination,
    amountAtoms:String(amount)
  });
  const currentIntent=()=>({
    network:NETWORK,
    sourceAddress:wallet?.address||'',
    destination:$('sendto').value.trim(),
    amountAtoms:String(parseAmt($('sendamt').value))
  });
  const spendable=await api('/spendable?address='+encodeURIComponent(wallet.address));
  let total=0n;
  const inputs=[];
  for(const output of spendable.utxos){
    inputs.push(output.outpoint);
    total+=BigInt(output.amount_atoms);
    if(total>=amount)break;
  }
  if(total<amount)throw Error('Insufficient spendable balance');
  const outputs=[{address:destination,amount_atoms:String(amount)}];
  if(total>amount)outputs.push({address:wallet.address,amount_atoms:String(total-amount)});
  const transaction={
    version:2,
    network:NETWORK,
    inputs,
    outputs,
    public_key_spki:wallet.pub,
    signature:''
  };
  FAEWalletSigningIntent.assertCurrent(signingIntent,currentIntent());
  FAEWalletSigningIntent.assertTransaction(signingIntent,transaction);
  const signingPayload=stable(txPayload(transaction));
  const signatureBytes=await crypto.subtle.sign('Ed25519',wallet.priv,E.encode(signingPayload));
  FAEWalletSigningIntent.assertCurrent(signingIntent,currentIntent());
  FAEWalletSigningIntent.assertTransaction(signingIntent,transaction);
  if(stable(txPayload(transaction))!==signingPayload)throw Error('SEND_INTENT_INTEGRITY: transaction changed during signing');
  transaction.signature=b64(signatureBytes);
  const accepted=await api('/submit-tx',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({tx:transaction})
  });
  const acceptedTxid=String(accepted.txid||'');
  const receipt=globalThis.FAEWalletTransactions?.acceptedReceipt
    ?globalThis.FAEWalletTransactions.acceptedReceipt({
      txid:acceptedTxid,
      address:wallet.address,
      network:NETWORK,
      acceptedAt:new Date().toISOString()
    })
    :null;
  if(!receipt)throw Error('Wallet transaction receipt adapter is unavailable');
  lastSubmittedTxid=receipt.txid;
  lastSubmittedAddress=receipt.address;
  $('lastsendtx').hidden=false;
  $('lastsendtxid').value=receipt.txid;
  $('copylastsendtx').disabled=false;
  setStatus('sendstate','Transaction accepted by the node and still unconfirmed. It is waiting for a block.','ok');
  try{
    await refresh();
  }catch(error){
    setStatus(
      'sendstate',
      'Transaction accepted and still unconfirmed. Wallet refresh is unavailable; the accepted TXID below is preserved. '+error.message,
      'warn'
    );
  }
}

async function copyLastSentTxid(){
  if(!lastSubmittedTxid||wallet?.address!==lastSubmittedAddress)throw Error('No submitted transaction ID is available for this address');
  await copyTransactionId(lastSubmittedTxid,$('copylastsendtx'));
  setStatus('sendstate','Full transaction ID copied. The transaction remains unconfirmed until a block includes it.','ok');
}

function toggleHistory(){
  const panel=$('history-panel');
  const open=panel.hidden;
  panel.hidden=!open;
  $('togglehistory').setAttribute('aria-expanded',String(open));
  $('togglehistory').textContent=open?'Hide history':'Show history';
  // Opening/closing history is presentation-only. An automatic refresh here can
  // replace the focused transaction row while keyboard users are navigating it.
  // Data refresh remains explicit via the wallet refresh/retry paths.
}

function showWalletError(error){
  setStatus('recoverystate',error.message,'bad');
}

$('action-create').addEventListener('click',()=>showWalletAction('create'));
$('action-recovery').addEventListener('click',()=>showWalletAction('recovery'));
$('createwallet').addEventListener('click',()=>beginNewWallet().catch(showWalletError));
$('copynewseed').addEventListener('click',()=>copyNewSeed().catch(showWalletError));
$('readyconfirm').addEventListener('click',()=>{try{readyForNewWalletConfirmation()}catch(error){showWalletError(error)}});
$('backtonewseed').addEventListener('click',()=>{try{backToNewWalletSeed()}catch(error){showWalletError(error)}});
$('cancelnewwallet').addEventListener('click',()=>{clearPendingNewWallet();setStatus('recoverystate','New Wallet creation cancelled. Nothing was saved.')});
$('cancelnewwalletconfirm').addEventListener('click',()=>{clearPendingNewWallet();setStatus('recoverystate','New Wallet creation cancelled. Nothing was saved.')});
$('confirmwallet').addEventListener('click',()=>confirmNewWallet().catch(showWalletError));
$('verifyrecovery').addEventListener('click',()=>verifyRecoveryWallet().catch(showWalletError));
$('admitrecovery').addEventListener('click',()=>admitRecoveryWallet().catch(showWalletError));
$('cancelrecovery').addEventListener('click',()=>{clearPendingRecovery();setStatus('recoverystate','Recovery cancelled. Nothing was added.')});
$('importwallet').addEventListener('click',()=>importRecovery().catch(showWalletError));
$('removewallet').addEventListener('click',()=>{try{prepareRemoveWallet()}catch(error){showWalletError(error)}});
$('confirmremove').addEventListener('click',()=>removeActiveWallet().catch(showWalletError));
$('cancelremove').addEventListener('click',()=>{$('remove-panel').hidden=true});
$('receive').addEventListener('click',()=>copyReceiveAddress().catch(showWalletError));
$('exportwallet').addEventListener('click',()=>showBackup().catch(showWalletError));
$('copyseed').addEventListener('click',()=>copySeed().catch(showWalletError));
$('downloadbackup').addEventListener('click',()=>downloadBackup().catch(showWalletError));
$('closebackup').addEventListener('click',()=>{$('backup').hidden=true;$('seedwords').value=''});
$('send').addEventListener('click',()=>sendFAE().catch(error=>setStatus('sendstate',error.message,'bad')));
$('restorefromsend').addEventListener('click',()=>{
  if(walletAccount){
    useSavedFullWallet().catch(error=>setStatus('sendstate',error.message,'bad'));
    return;
  }
  setEnvironment('wallet');
  showWalletAction('recovery');
});
$('togglehistory').addEventListener('click',toggleHistory);
$('copylastsendtx').addEventListener('click',()=>copyLastSentTxid().catch(error=>setStatus('sendstate',error.message,'bad')));
$('refresh').addEventListener('click',()=>refresh().catch(()=>{}));
$('useaddr').addEventListener('click',()=>useExistingAddress().catch(error=>setStatus('mstate',error.message,'bad')));
$('usesaved').addEventListener('click',()=>useSavedFullWallet().catch(error=>setStatus('mstate',error.message,'bad')));
