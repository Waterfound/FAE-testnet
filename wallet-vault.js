'use strict';

const FAEWalletVault=(()=>{
  const DB_NAME='fae-wallet-vault-v1';
  const DB_VERSION=1;
  const FORMAT='FAE_BROWSER_VAULT_V1';
  const WRAP_KEY_ID='wrapping-key-v1';
  const META_STATE_KEY='state';
  const te=new TextEncoder();
  const td=new TextDecoder();

  function fail(code,message){
    const error=new Error(message);
    error.code=code;
    return error;
  }

  function requestPromise(request){
    return new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||fail('IDB_REQUEST_FAILED','Browser storage request failed'));
    });
  }

  function transactionPromise(transaction){
    return new Promise((resolve,reject)=>{
      transaction.oncomplete=()=>resolve();
      transaction.onabort=()=>reject(transaction.error||fail('IDB_TRANSACTION_ABORTED','Browser storage transaction was aborted'));
      transaction.onerror=()=>{};
    });
  }

  function openDatabase(){
    if(!globalThis.indexedDB)throw fail('PERSISTENT_VAULT_UNAVAILABLE','IndexedDB is unavailable in this browser context');
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('wallets'))db.createObjectStore('wallets',{keyPath:'walletId'});
        if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
        if(!db.objectStoreNames.contains('keys'))db.createObjectStore('keys',{keyPath:'key'});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||fail('PERSISTENT_VAULT_UNAVAILABLE','Could not open the local FAE vault'));
      request.onblocked=()=>reject(fail('PERSISTENT_VAULT_BLOCKED','A previous FAE tab is blocking the wallet vault upgrade'));
    });
  }

  async function dbGet(storeName,key){
    const db=await openDatabase();
    try{
      const tx=db.transaction(storeName,'readonly');
      const value=await requestPromise(tx.objectStore(storeName).get(key));
      await transactionPromise(tx);
      return value;
    }finally{db.close()}
  }

  async function dbGetAll(storeName){
    const db=await openDatabase();
    try{
      const tx=db.transaction(storeName,'readonly');
      const value=await requestPromise(tx.objectStore(storeName).getAll());
      await transactionPromise(tx);
      return value;
    }finally{db.close()}
  }

  async function sha256Hex(value){
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(String(value))));
    return Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
  }

  function bytesToBase64(bytes){
    let raw='';
    for(const byte of new Uint8Array(bytes))raw+=String.fromCharCode(byte);
    return btoa(raw);
  }

  function base64ToBytes(value){
    return Uint8Array.from(atob(String(value)),character=>character.charCodeAt(0));
  }

  function firstPublicRecord(account){
    const addresses=Array.isArray(account?.addresses)?account.addresses:[];
    if(!addresses.length)throw fail('INVALID_WALLET','Wallet has no derived addresses');
    const first=addresses.find(item=>Number(item.index)===0)||addresses[0];
    if(!first?.address||!first?.pub)throw fail('INVALID_WALLET','Wallet identity is missing public address material');
    return first;
  }

  async function walletFingerprint(account,network){
    const first=firstPublicRecord(account);
    return sha256Hex(['FAE_WALLET_ID_V1',String(network),String(first.address),String(first.pub)].join('|'));
  }

  async function walletIdentity(account,network){
    return 'wallet-'+await walletFingerprint(account,network);
  }

  function publicAddresses(account){
    return account.addresses.map(item=>({
      index:Number(item.index)||0,
      address:String(item.address||''),
      pub:String(item.pub||'')
    }));
  }

  function privatePayload(account){
    return{
      addresses:account.addresses.map(item=>({
        index:Number(item.index)||0,
        address:String(item.address||''),
        pub:String(item.pub||''),
        jwk:item.jwk
      }))
    };
  }

  function aadFor(record){
    return te.encode([FORMAT,record.network,record.walletId,record.fingerprint].join('|'));
  }

  async function getWrappingKey(){
    const existing=await dbGet('keys',WRAP_KEY_ID);
    if(existing?.cryptoKey){
      if(existing.cryptoKey.extractable)throw fail('VAULT_KEY_WEAKENED','Persistent vault wrapping key unexpectedly became extractable');
      return existing.cryptoKey;
    }
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const db=await openDatabase();
    try{
      const tx=db.transaction('keys','readwrite');
      tx.objectStore('keys').put({key:WRAP_KEY_ID,version:1,cryptoKey:key});
      await transactionPromise(tx);
    }finally{db.close()}
    const restored=await dbGet('keys',WRAP_KEY_ID);
    if(!restored?.cryptoKey||restored.cryptoKey.extractable)throw fail('PERSISTENT_KEY_RESTORE_FAILED','Browser could not persist the non-extractable vault key');
    return restored.cryptoKey;
  }

  async function requestPersistentStorage(){
    if(!navigator?.storage?.persist)return{supported:false,granted:false,persisted:null};
    let before=null;
    try{if(navigator.storage.persisted)before=await navigator.storage.persisted()}catch{}
    let granted=before===true;
    if(!granted){
      try{granted=await navigator.storage.persist()}catch{granted=false}
    }
    let after=granted;
    try{if(navigator.storage.persisted)after=await navigator.storage.persisted()}catch{}
    return{supported:true,granted:Boolean(granted),persisted:Boolean(after)};
  }

  async function capabilityProbe(){
    if(!crypto?.subtle)throw fail('PERSISTENT_VAULT_UNAVAILABLE','WebCrypto is unavailable in this browser context');
    const key=await getWrappingKey();
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const aad=te.encode('FAE_VAULT_PROBE_V1');
    const plain=crypto.getRandomValues(new Uint8Array(32));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,plain);
    const restoredKey=await getWrappingKey();
    const decrypted=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},restoredKey,encrypted));
    if(decrypted.length!==plain.length||decrypted.some((value,index)=>value!==plain[index])){
      throw fail('PERSISTENT_VAULT_PROBE_FAILED','Persistent vault encryption self-test failed');
    }
    const persistence=await requestPersistentStorage();
    return{
      ok:true,
      database:DB_NAME,
      format:FORMAT,
      wrappingKeyExtractable:Boolean(restoredKey.extractable),
      persistence
    };
  }

  async function encryptAccount(account,{network,source}){
    const fingerprint=await walletFingerprint(account,network);
    const walletId='wallet-'+fingerprint;
    const createdAt=new Date().toISOString();
    const shell={
      walletId,
      fingerprint,
      format:FORMAT,
      network,
      source:source||account.source||'browser',
      passphraseProtected:Boolean(account.passphraseProtected),
      activeIndex:Number(account.activeIndex)||0,
      addresses:publicAddresses(account),
      createdAt,
      updatedAt:createdAt,
      cipher:{name:'AES-GCM',version:1,iv:'',payload:''}
    };
    const key=await getWrappingKey();
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const plaintext=te.encode(JSON.stringify(privatePayload(account)));
    const encrypted=await crypto.subtle.encrypt({
      name:'AES-GCM',
      iv,
      additionalData:aadFor(shell),
      tagLength:128
    },key,plaintext);
    shell.cipher.iv=bytesToBase64(iv);
    shell.cipher.payload=bytesToBase64(new Uint8Array(encrypted));
    return shell;
  }

  async function decryptRecord(record){
    if(record?.format!==FORMAT)throw fail('UNSUPPORTED_VAULT_RECORD','Unsupported FAE wallet vault record');
    if(!record.walletId||!record.fingerprint||!Array.isArray(record.addresses)||!record.addresses.length){
      throw fail('CORRUPTED_VAULT','Wallet vault metadata is incomplete');
    }
    const key=await getWrappingKey();
    let decoded;
    try{
      const plaintext=await crypto.subtle.decrypt({
        name:'AES-GCM',
        iv:base64ToBytes(record.cipher?.iv||''),
        additionalData:aadFor(record),
        tagLength:128
      },key,base64ToBytes(record.cipher?.payload||''));
      decoded=JSON.parse(td.decode(plaintext));
    }catch{
      throw fail('CORRUPTED_VAULT','Wallet vault authentication/decryption failed');
    }
    if(!Array.isArray(decoded?.addresses)||decoded.addresses.length!==record.addresses.length){
      throw fail('CORRUPTED_VAULT','Wallet vault private/public address sets do not match');
    }
    const addresses=[];
    for(let i=0;i<decoded.addresses.length;i++){
      const secret=decoded.addresses[i];
      const pub=record.addresses[i];
      if(Number(secret.index)!==Number(pub.index)||secret.address!==pub.address||secret.pub!==pub.pub){
        throw fail('CORRUPTED_VAULT','Wallet vault public/private metadata mismatch');
      }
      const restored=await FAEWalletCrypto.restoreRecordFromJwk(secret.jwk,pub.address,pub.pub,Number(pub.index)||0);
      addresses.push(restored);
    }
    const account={
      source:record.source||'vault',
      passphraseProtected:Boolean(record.passphraseProtected),
      activeIndex:Number(record.activeIndex)||0,
      addresses
    };
    const computed=await walletFingerprint(account,record.network);
    if(computed!==record.fingerprint||record.walletId!=='wallet-'+computed){
      throw fail('CORRUPTED_VAULT','Wallet identity fingerprint mismatch');
    }
    if(account.activeIndex<0||account.activeIndex>=addresses.length)throw fail('CORRUPTED_VAULT','Active address index is invalid');
    return account;
  }

  async function readState(){
    const state=await dbGet('meta',META_STATE_KEY);
    return state||{key:META_STATE_KEY,format:FORMAT,activeWalletId:null,migration:null};
  }

  async function writeState(next){
    const db=await openDatabase();
    try{
      const tx=db.transaction('meta','readwrite');
      tx.objectStore('meta').put({...next,key:META_STATE_KEY,format:FORMAT});
      await transactionPromise(tx);
    }finally{db.close()}
  }

  async function listWallets(){
    const records=await dbGetAll('wallets');
    return records.map(record=>({
      walletId:record.walletId,
      fingerprint:record.fingerprint,
      network:record.network,
      source:record.source,
      passphraseProtected:Boolean(record.passphraseProtected),
      activeIndex:Number(record.activeIndex)||0,
      addresses:record.addresses.map(item=>({...item})),
      createdAt:record.createdAt,
      updatedAt:record.updatedAt
    })).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||a.walletId.localeCompare(b.walletId));
  }

  async function getWalletRecord(walletId){
    return dbGet('wallets',walletId);
  }

  async function loadAccount(walletId){
    const record=await getWalletRecord(walletId);
    if(!record)throw fail('WALLET_NOT_FOUND','Wallet is not present in the local vault');
    return decryptRecord(record);
  }

  async function loadActive(){
    const state=await readState();
    if(!state.activeWalletId)return{state,record:null,account:null};
    const record=await getWalletRecord(state.activeWalletId);
    if(!record)throw fail('CORRUPTED_VAULT','Active wallet points to a missing vault record');
    const account=await decryptRecord(record);
    return{state,record,account};
  }

  async function admitAccount(account,{network,source,makeActive=true}={}){
    if(!network)throw fail('INVALID_WALLET','Network is required for wallet admission');
    if(!Array.isArray(account?.addresses)||!account.addresses.length)throw fail('INVALID_WALLET','Wallet has no addresses');
    for(const item of account.addresses){
      if(!item?.jwk?.d)throw fail('INVALID_WALLET','Wallet admission requires local private key material');
    }
    const candidate=await encryptAccount(account,{network,source});
    const existing=await getWalletRecord(candidate.walletId);
    if(existing){
      const restored=await decryptRecord(existing);
      const existingAddresses=restored.addresses.map(item=>item.address);
      const incomingAddresses=account.addresses.map(item=>item.address);
      if(JSON.stringify(existingAddresses)!==JSON.stringify(incomingAddresses)){
        throw fail('WALLET_ID_COLLISION','Wallet identity collision with different derived addresses');
      }
      if(makeActive)await setActiveWallet(candidate.walletId);
      return{walletId:candidate.walletId,deduplicated:true,record:existing,account:restored};
    }

    const db=await openDatabase();
    try{
      const tx=db.transaction(['wallets','meta'],'readwrite');
      tx.objectStore('wallets').add(candidate);
      const state=await requestPromise(tx.objectStore('meta').get(META_STATE_KEY));
      tx.objectStore('meta').put({
        ...(state||{}),
        key:META_STATE_KEY,
        format:FORMAT,
        activeWalletId:makeActive?candidate.walletId:(state?.activeWalletId||candidate.walletId)
      });
      await transactionPromise(tx);
    }finally{db.close()}

    const verifiedRecord=await getWalletRecord(candidate.walletId);
    const verified=await decryptRecord(verifiedRecord);
    if(verified.addresses[0].address!==account.addresses[0].address){
      throw fail('VAULT_COMMIT_VERIFICATION_FAILED','Wallet vault commit did not round-trip to the expected identity');
    }
    return{walletId:candidate.walletId,deduplicated:false,record:verifiedRecord,account:verified};
  }

  async function setActiveWallet(walletId){
    const record=await getWalletRecord(walletId);
    if(!record)throw fail('WALLET_NOT_FOUND','Wallet is not present in the local vault');
    await decryptRecord(record);
    const state=await readState();
    await writeState({...state,activeWalletId:walletId});
    return walletId;
  }

  async function setActiveAddress(walletId,activeIndex){
    const record=await getWalletRecord(walletId);
    if(!record)throw fail('WALLET_NOT_FOUND','Wallet is not present in the local vault');
    const index=Number(activeIndex);
    if(!Number.isInteger(index)||index<0||index>=record.addresses.length)throw fail('INVALID_ACTIVE_ADDRESS','Active address index is invalid');
    const db=await openDatabase();
    try{
      const tx=db.transaction('wallets','readwrite');
      tx.objectStore('wallets').put({...record,activeIndex:index,updatedAt:new Date().toISOString()});
      await transactionPromise(tx);
    }finally{db.close()}
    const verified=await loadAccount(walletId);
    if(verified.activeIndex!==index)throw fail('VAULT_COMMIT_VERIFICATION_FAILED','Active address did not persist');
    return verified;
  }

  async function removeWallet(walletId){
    const record=await getWalletRecord(walletId);
    if(!record)return{removed:false,activeWalletId:(await readState()).activeWalletId};
    await decryptRecord(record);
    const state=await readState();
    const remaining=(await listWallets()).filter(item=>item.walletId!==walletId);
    const fallback=remaining[0]?.walletId||null;
    const nextActive=state.activeWalletId===walletId?fallback:state.activeWalletId;
    const db=await openDatabase();
    try{
      const tx=db.transaction(['wallets','meta'],'readwrite');
      tx.objectStore('wallets').delete(walletId);
      tx.objectStore('meta').put({...state,key:META_STATE_KEY,format:FORMAT,activeWalletId:nextActive||fallback});
      await transactionPromise(tx);
    }finally{db.close()}
    if(await getWalletRecord(walletId))throw fail('VAULT_COMMIT_VERIFICATION_FAILED','Wallet removal did not persist');
    return{removed:true,activeWalletId:nextActive||fallback};
  }

  async function migrationStatus(){
    return (await readState()).migration||null;
  }

  async function markMigration(migration){
    const state=await readState();
    await writeState({...state,migration});
    return migration;
  }

  return{
    DB_NAME,
    DB_VERSION,
    FORMAT,
    capabilityProbe,
    walletFingerprint,
    walletIdentity,
    listWallets,
    readState,
    loadAccount,
    loadActive,
    admitAccount,
    setActiveWallet,
    setActiveAddress,
    removeWallet,
    migrationStatus,
    markMigration
  };
})();

window.FAEWalletVault=FAEWalletVault;
