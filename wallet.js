'use strict';

const WALLET_KEY='fae-public-v4-wallet';
const WATCH_KEY='fae-public-v4-active-watch';
const KEYRING_KEY='fae-public-v4-keyring-v3';
let sessionMnemonic='';
let walletLoadError='';

function storedAddress(record){
  return{
    index:Number(record.index)||0,
    address:record.address,
    pub:record.pub,
    jwk:record.jwk
  };
}

function storedAccount(account){
  return{
    format:'FAE_BROWSER_KEYRING_V3',
    network:NETWORK,
    source:account.source||'browser',
    passphraseProtected:Boolean(account.passphraseProtected),
    activeIndex:Number(account.activeIndex)||0,
    addresses:account.addresses.map(storedAddress)
  };
}

function saveAccount(){
  if(!walletAccount)return;
  localStorage.setItem(KEYRING_KEY,JSON.stringify(storedAccount(walletAccount)));
  const active=walletAccount.addresses[walletAccount.activeIndex]||walletAccount.addresses[0];
  if(active){
    // Keep the original single-address record for safe rollback compatibility.
    localStorage.setItem(WALLET_KEY,JSON.stringify({address:active.address,pub:active.pub,jwk:active.jwk}));
  }
}

function newAccount(derived,source='browser'){
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
    if(derived.addresses[0].address===restored.address)return newAccount(derived,'migrated');
  }catch{
    // An older direct-key package can still remain a valid one-address wallet.
  }
  return{source:'migrated',passphraseProtected:false,activeIndex:0,addresses:[restored]};
}

async function loadWallet(){
  walletLoadError='';
  try{
    const savedKeyring=JSON.parse(localStorage.getItem(KEYRING_KEY)||'null');
    if(savedKeyring)walletAccount=await hydrateStoredAccount(savedKeyring);
    if(!walletAccount){
      const original=JSON.parse(localStorage.getItem(WALLET_KEY)||'null');
      if(original?.jwk&&original?.address){
        walletAccount=await migrateSingleWallet(original);
        saveAccount();
      }
    }
    const watch=localStorage.getItem(WATCH_KEY);
    if(watch&&validAddr(watch)){
      wallet={index:0,address:watch,watchOnly:true};
    }else if(walletAccount?.addresses.length){
      wallet=walletAccount.addresses[walletAccount.activeIndex]||walletAccount.addresses[0];
    }
  }catch(error){
    walletAccount=null;
    wallet=null;
    walletLoadError=error.message;
  }
}

function replacementConfirmed(){
  if(!walletAccount)return true;
  return window.confirm('Replace the wallet currently saved in this browser? Continue only if its recovery material is safely backed up.');
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
  element.textContent=message;
  element.className='status'+(tone?' '+tone:'');
}

function showWalletAction(action){
  const selectedPanel=$(action+'-panel');
  const willOpen=selectedPanel.hidden;
  for(const name of ['create','recovery','insert']){
    const active=name===action&&willOpen;
    $(name+'-panel').hidden=!active;
    $('action-'+name).setAttribute('aria-pressed',String(active));
  }
  if(willOpen)setTimeout(()=>{
    const target=action==='insert'?'insertseed':action==='recovery'?'recovery':'createwallet';
    $(target).focus();
  },0);
}

function renderAddressList(){
  const container=$('addresslist');
  clearElement(container);
  if(!walletAccount?.addresses.length){
    const empty=document.createElement('div');
    empty.className='empty';
    empty.textContent='No related wallet addresses yet.';
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

function renderWallet(){
  const full=Boolean(wallet&&!wallet.watchOnly&&wallet.priv);
  const watch=Boolean(wallet?.watchOnly);
  $('addr').value=wallet?.address||'';
  $('miningaddr').value=wallet?.address||'';
  $('receive').disabled=!wallet;
  $('copyminingaddr').disabled=!wallet;
  $('mine').disabled=!wallet||mining;
  $('send').disabled=!full;
  $('exportwallet').disabled=!full||!walletAccount;
  $('togglehistory').disabled=!wallet;
  $('restorefromsend').hidden=full||!wallet;
  $('usesaved').hidden=!watch||!walletAccount;

  const kindText=!wallet?'No wallet':watch?'External address':walletAccount?.passphraseProtected?'Passphrase wallet':'Full wallet';
  const kindTone=watch?'pill warn':'pill';
  $('wallet-kind').textContent=kindText;
  $('wallet-kind').className=kindTone;
  $('mining-wallet-kind').textContent=!wallet?'No address':watch?'Cold / watch-only':'Wallet address '+((wallet.index??0)+1);
  $('mining-wallet-kind').className=kindTone;

  if(!wallet){
    setStatus('wstate',walletLoadError?'Saved wallet could not be opened: '+walletLoadError:'No wallet selected.',walletLoadError?'bad':'');
    setStatus('sendstate','Create, insert, or recover a full wallet to send.');
    setStatus('mstate','Select a reward address in Wallet, or insert a public address below.');
  }else if(watch){
    setStatus('wstate','Public address active. Receiving and mining are enabled; sending is locked.','warn');
    setStatus('sendstate','This is a public address only. Insert its seed phrase to send.','warn');
    if(!mining)setStatus('mstate','Ready to mine locally to the external public address.','ok');
  }else{
    setStatus('wstate','Full Ed25519 wallet ready. Receiving, sending, and mining are enabled.','ok');
    setStatus('sendstate','Full wallet ready. Enter a destination and amount.','ok');
    if(!mining)setStatus('mstate','Ready to mine locally to the active wallet address.','ok');
  }
  $('watchstate').textContent=watch?'External address is active. Its private key is not present in this browser.':'';
  renderAddressList();
}

async function activateAccountAddress(listIndex,{refreshData=true}={}){
  if(mining)throw Error('Stop mining before changing the reward address');
  const selected=walletAccount?.addresses[listIndex];
  if(!selected)throw Error('Wallet address not found');
  walletAccount.activeIndex=listIndex;
  wallet=selected;
  localStorage.removeItem(WATCH_KEY);
  saveAccount();
  renderWallet();
  if(refreshData)await refresh();
}

async function createNewWallet(){
  if(mining)throw Error('Stop mining before creating a wallet');
  if(!replacementConfirmed())return;
  const button=$('createwallet');
  button.disabled=true;
  try{
    const entropy=crypto.getRandomValues(new Uint8Array(32));
    sessionMnemonic=await FAEWalletCrypto.mnemonicFromEntropy(entropy);
    const derived=await FAEWalletCrypto.deriveAddressRecords(sessionMnemonic,'');
    walletAccount=newAccount(derived,'created');
    localStorage.removeItem(WATCH_KEY);
    wallet=walletAccount.addresses[0];
    saveAccount();
    renderWallet();
    await showBackup();
    setStatus('recoverystate','Wallet created. Save the 24 words offline before mining or receiving funds.','warn');
    await refresh();
  }finally{
    button.disabled=false;
  }
}

async function insertWalletFromSeed(){
  if(mining)throw Error('Stop mining before inserting a wallet');
  if(!replacementConfirmed())return;
  const seedPhrase=$('insertseed').value;
  const passphrase=$('insertpassphrase').value;
  if(!seedPhrase.trim())throw Error('Enter the 24-word seed phrase');
  const button=$('insertwallet');
  button.disabled=true;
  try{
    const derived=await FAEWalletCrypto.deriveAddressRecords(seedPhrase,passphrase);
    sessionMnemonic=derived.mnemonic;
    walletAccount=newAccount(derived,'inserted');
    localStorage.removeItem(WATCH_KEY);
    wallet=walletAccount.addresses[0];
    saveAccount();
    $('insertseed').value='';
    $('insertpassphrase').value='';
    renderWallet();
    setStatus(
      'recoverystate',
      derived.passphraseProtected
        ?'Passphrase wallet inserted. Five distinct addresses were derived; the passphrase was not saved.'
        :'Ordinary wallet inserted. Its original first address remains compatible with earlier FAE v4 wallets.',
      'ok'
    );
    await refresh();
  }finally{
    button.disabled=false;
  }
}

async function accountFromRecovery(raw){
  if(!raw.trim())throw Error('Paste or choose an FAE recovery package');
  if(!raw.trim().startsWith('{')){
    const derived=await FAEWalletCrypto.deriveAddressRecords(raw,'');
    return{account:newAccount(derived,'recovered'),mnemonic:derived.mnemonic};
  }

  let record;
  try{record=JSON.parse(raw)}catch{throw Error('Invalid recovery JSON')}
  if(record?.network&&record.network!==NETWORK)throw Error('Recovery package belongs to another network');

  if(record?.format==='FAE_TESTNET_WALLET_RECOVERY_V3'){
    let mnemonic='';
    if(record.recovery_words){
      const entropy=await FAEWalletCrypto.entropyFromMnemonic(record.recovery_words);
      mnemonic=await FAEWalletCrypto.mnemonicFromEntropy(entropy);
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
    const derived=await FAEWalletCrypto.deriveAddressRecords(record.recovery_words||'','');
    if(record.address&&record.address!==derived.addresses[0].address)throw Error('Recovery words do not match the package address');
    return{account:newAccount(derived,'recovered'),mnemonic:derived.mnemonic};
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
  if(!replacementConfirmed())return;
  let raw=$('recovery').value;
  const file=$('recoveryfile').files?.[0];
  if(file)raw=await file.text();
  const button=$('importwallet');
  button.disabled=true;
  try{
    const recovered=await accountFromRecovery(raw);
    walletAccount=recovered.account;
    sessionMnemonic=recovered.mnemonic;
    wallet=walletAccount.addresses[walletAccount.activeIndex]||walletAccount.addresses[0];
    localStorage.removeItem(WATCH_KEY);
    saveAccount();
    $('recovery').value='';
    $('recoveryfile').value='';
    renderWallet();
    setStatus('recoverystate','Recovery package verified. The wallet is ready to receive, send, and mine.','ok');
    await refresh();
  }finally{
    button.disabled=false;
  }
}

async function mnemonicForAccount(){
  if(sessionMnemonic)return sessionMnemonic;
  if(walletAccount?.passphraseProtected){
    throw Error('The seed phrase is not stored for this passphrase wallet. Use the original seed and exact passphrase.');
  }
  const first=walletAccount?.addresses.find(item=>item.index===0)||walletAccount?.addresses[0];
  if(!first)throw Error('Full wallet required');
  const entropy=FAEWalletCrypto.entropyFromPrivateJwk(first.jwk);
  const mnemonic=await FAEWalletCrypto.mnemonicFromEntropy(entropy);
  const check=await FAEWalletCrypto.deriveAddressRecords(mnemonic,'',1);
  if(check.addresses[0].address!==first.address)throw Error('This legacy key does not expose a seed phrase');
  sessionMnemonic=mnemonic;
  return mnemonic;
}

async function showBackup(){
  if(!walletAccount||!wallet||wallet.watchOnly)throw Error('Full wallet required');
  $('backup').hidden=false;
  try{
    const words=await mnemonicForAccount();
    $('seedwords').value=words;
    $('copyseed').disabled=false;
    $('backupnote').textContent=walletAccount.passphraseProtected
      ?'These words require the exact original passphrase to derive this wallet. Store them separately. The downloadable JSON contains direct private keys and can spend without the passphrase.'
      :'Write these words on paper in exact order. The downloadable JSON also contains direct private keys.';
  }catch(error){
    $('seedwords').value='Seed phrase not retained in this browser session.';
    $('copyseed').disabled=true;
    $('backupnote').textContent=error.message+' The downloadable recovery JSON contains direct private keys for the five derived addresses.';
  }
  $('backup').scrollIntoView({behavior:'smooth',block:'nearest'});
}

async function recoveryPackage(){
  if(!walletAccount||!wallet||wallet.watchOnly)throw Error('Full wallet required');
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
    warning:'VALUELESS TESTNET PRIVATE KEYS — ANYONE WITH THIS FILE CAN SPEND THESE ADDRESSES. NEVER REUSE IN BITCOIN OR TREZOR.'
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
  if(!walletAccount?.addresses.length)throw Error('No full wallet is saved in this browser');
  await activateAccountAddress(walletAccount.activeIndex);
}

async function sendFAE(){
  if(!wallet||wallet.watchOnly||!wallet.priv)throw Error('Insert the full wallet to send');
  const amount=parseAmt($('sendamt').value);
  const destination=$('sendto').value.trim();
  if(!validAddr(destination)||amount<=0n)throw Error('Invalid destination or amount');
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
  transaction.signature=b64(await crypto.subtle.sign('Ed25519',wallet.priv,E.encode(stable(txPayload(transaction)))));
  const accepted=await api('/submit-tx',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({tx:transaction})
  });
  setStatus('sendstate','Queued '+accepted.txid.slice(0,20)+'… · the transaction is waiting for a block.','ok');
  await refresh();
}

function toggleHistory(){
  const panel=$('history-panel');
  const open=panel.hidden;
  panel.hidden=!open;
  $('togglehistory').setAttribute('aria-expanded',String(open));
  if(open)refresh().catch(()=>{});
}

function showWalletError(error){
  setStatus('recoverystate',error.message,'bad');
}

$('action-create').addEventListener('click',()=>showWalletAction('create'));
$('action-recovery').addEventListener('click',()=>showWalletAction('recovery'));
$('action-insert').addEventListener('click',()=>showWalletAction('insert'));
$('createwallet').addEventListener('click',()=>createNewWallet().catch(showWalletError));
$('insertwallet').addEventListener('click',()=>insertWalletFromSeed().catch(showWalletError));
$('importwallet').addEventListener('click',()=>importRecovery().catch(showWalletError));
$('receive').addEventListener('click',()=>copyReceiveAddress().catch(showWalletError));
$('exportwallet').addEventListener('click',()=>showBackup().catch(showWalletError));
$('copyseed').addEventListener('click',()=>copySeed().catch(showWalletError));
$('downloadbackup').addEventListener('click',()=>downloadBackup().catch(showWalletError));
$('closebackup').addEventListener('click',()=>{$('backup').hidden=true});
$('send').addEventListener('click',()=>sendFAE().catch(error=>setStatus('sendstate',error.message,'bad')));
$('restorefromsend').addEventListener('click',()=>{
  setEnvironment('wallet');
  showWalletAction('insert');
});
$('togglehistory').addEventListener('click',toggleHistory);
$('refresh').addEventListener('click',()=>refresh().catch(()=>{}));
$('useaddr').addEventListener('click',()=>useExistingAddress().catch(error=>setStatus('mstate',error.message,'bad')));
$('usesaved').addEventListener('click',()=>useSavedFullWallet().catch(error=>setStatus('mstate',error.message,'bad')));
