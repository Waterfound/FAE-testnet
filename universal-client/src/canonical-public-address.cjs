'use strict';
// Untrusted public-address input must pass the *source-owned* FAE Bech32m check.
// No private keys, independent signer or duplicated checksum implementation.
const path=require('node:path');
const {pathToFileURL}=require('node:url');
async function canonicalAddress(address,addressSource){
  if(typeof address!=='string'||address.length>90||
    typeof addressSource!=='string'||!path.isAbsolute(addressSource)||
    path.basename(addressSource)!=='address.mjs')
    throw Error('Invalid canonical FAE public address');
  const {isValidAddress}=await import(pathToFileURL(addressSource).href);
  if(typeof isValidAddress!=='function'||!isValidAddress(address,'faet'))
    throw Error('Invalid canonical FAE public address');
  return address;
}
async function validateSavedWatchCatalog(result,addressSource){
  if(!result||result.kind!=='watch_only'||
    result.network!=='fairyelf-public-testnet-v4'||!Array.isArray(result.entries))
    throw Error('Invalid saved FAE watch-only catalog');
  for(const row of result.entries){
    try{await canonicalAddress(row.address,addressSource)}
    catch{throw Error('Saved watch-only address has invalid canonical checksum; refusing automatic reset')}
  }
  if(result.selected!==null&&result.selected!==undefined){
    if(!result.entries.some(row=>row.address===result.selected))
      throw Error('Saved watch-only selection inconsistent');
  }
  return result;
}
module.exports={canonicalAddress,validateSavedWatchCatalog};
