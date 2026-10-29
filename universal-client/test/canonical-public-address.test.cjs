'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {canonicalAddress,validateSavedWatchCatalog}=require('../src/canonical-public-address.cjs');
const source=path.resolve(__dirname,'..','..','sovereign-forge/node/authoritative/address.mjs');
const valid='faet1z5g4r8qgv29jcy350mvxgr3hpk35vjhdk3s6fn';
const forged=valid.slice(0,-1)+(valid.endsWith('q')?'p':'q');
test('canonical watch/miner/public-read address gate accepts real FAE Bech32m address',async()=>{
  assert.equal(await canonicalAddress(valid,source),valid);
  const book={network:'fairyelf-public-testnet-v4',kind:'watch_only',
    selected:valid,entries:[{address:valid,alias:'Read-only',hidden:false}]};
  assert.equal(await validateSavedWatchCatalog(book,source),book);
});
test('canonical address gate rejects checksum-correct-looking spoof before native dispatch',async()=>{
  for(const addr of [forged,valid.toUpperCase(),'fae1'+valid.slice(4),'faet1'+'q'.repeat(38),valid+'x','',null]){
    await assert.rejects(()=>canonicalAddress(addr,source),/Invalid canonical/);
  }
  await assert.rejects(()=>canonicalAddress(valid,'/tmp/wallet-keys.json'),/Invalid canonical/);
});
test('corrupt persisted watch-only checksums fail closed without destructive reset',async()=>{
  const book={network:'fairyelf-public-testnet-v4',kind:'watch_only',
    selected:valid,entries:[{address:valid,alias:'Good',hidden:false},
      {address:forged,alias:'Bad',hidden:false}]};
  await assert.rejects(()=>validateSavedWatchCatalog(book,source),/invalid canonical checksum/);
  assert.equal(book.entries.length,2,'No persisted data discarded or silently rewritten');
  await assert.rejects(()=>validateSavedWatchCatalog({...book,entries:[],selected:valid},source),
    /selection inconsistent/);
});
