/**
 * Element 5, candidate: observe the active identity from the REAL
 * FAEWalletVault public-only metadata API, then read that address via the
 * verified Explorer adapter. This module does not switch wallets, unlock,
 * load private accounts, sign, create mnemonic, or authorize mining.
 *
 * Intended caller order: existing Wallet verifies mining stop and commits its
 * own vault switch -> this bridge re-reads the committed public identity.
 * A separate trusted crypto/PIN lock owner must govern access to signing.
 */
import {createWalletPublicLedgerObserver} from './wallet-public-ledger-observer.mjs';
import {ExplorerDataError} from './explorer-read-adapter.mjs';

const WALLET_ID=/^wallet-[a-f0-9]{64}$/;
const ADDR=/^faet1[a-z0-9]{7,85}$/;
function bad(message){throw new ExplorerDataError('INVALID_VAULT_METADATA',message)}
function cold(code='VAULT_UNAVAILABLE'){return Object.freeze({state:'vault_unavailable',walletId:null,address:null,balanceAtoms:null,tip:null,code})}
function frozen(x){return Object.freeze(x)}
function same(a,b){return a?.walletId===b?.walletId&&a?.address===b?.address;}
function portValid(vault){
  return vault&&['readState','listWallets'].every(k=>typeof vault[k]==='function');
}
function sanitize(meta,{activeWalletId,network}){
  if(!meta||typeof meta!=='object'||!WALLET_ID.test(meta.walletId)||meta.walletId!==activeWalletId)
    bad('Active Wallet public identity is absent or inconsistent');
  if(meta.network!==network)bad('Active Wallet belongs to a different network');
  if(!Array.isArray(meta.addresses)||meta.addresses.length<1||meta.addresses.length>50)
    bad('Active Wallet address set is missing or unbounded');
  const idx=meta.activeIndex;
  if(!Number.isInteger(idx)||idx<0||idx>=meta.addresses.length)
    bad('Active Wallet address index is corrupt');
  const address=meta.addresses[idx]?.address;
  if(typeof address!=='string'||!ADDR.test(address))
    bad('Active Wallet public address is invalid');
  return frozen({walletId:meta.walletId,address});
}
export function createVaultBoundPublicObserver({vault,adapter,network='fairyelf-public-testnet-v4'}={}){
  if(!portValid(vault))bad('FAEWalletVault public readState/listWallets port required');
  if(typeof network!=='string'||!network.trim())bad('Expected network required');
  const observer=createWalletPublicLedgerObserver({adapter});
  let active=null,nonce=0;

  const reset=()=>{active=null;observer.clear();return observer.getSnapshot()};
  function stale(){return frozen({state:'stale_discarded',walletId:null,address:null,balanceAtoms:null,tip:null,code:null});}
  async function inspect(){
    const state=await vault.readState();
    if(!state||typeof state!=='object')bad('Wallet vault state missing');
    const wallets=await vault.listWallets();
    if(!Array.isArray(wallets))bad('Wallet vault list missing');
    if(!state.activeWalletId){
      if(wallets.length)bad('Nonempty vault without persistent active selection');
      return null;
    }
    const matches=wallets.filter(x=>x?.walletId===state.activeWalletId);
    if(matches.length!==1)bad('Selected persistent Wallet missing or duplicated');
    return sanitize(matches[0],{activeWalletId:state.activeWalletId,network});
  }
  async function sync(){
    const id=++nonce;
    try{
      const selection=await inspect();
      if(id!==nonce)return stale();
      if(selection===null)return reset();
      if(!same(selection,active)){
        active=selection;
        observer.selectWallet(selection);
      }
      return observer.getSnapshot();
    }catch(e){
      if(id!==nonce)return stale();
      reset();
      return cold(e instanceof ExplorerDataError?e.code:'VAULT_UNAVAILABLE');
    }
  }
  async function refresh(){
    const selection=await sync();
    if(selection.state==='stale_discarded'||selection.state==='vault_unavailable'||selection.state==='no_wallet')
      return selection;
    const id=nonce;
    const requested=active;
    const result=await observer.refresh();
    if(id!==nonce)return stale();
    // External tab may have switched Wallet or its active address while the
    // independent node was answering. Do not return an unverified balance.
    let current;
    try{current=await inspect()}catch{if(id===nonce)reset();return cold('VAULT_UNAVAILABLE')}
    if(id!==nonce)return stale();
    if(!same(current,requested)){
      reset();
      return cold('VAULT_CHANGED');
    }
    return result;
  }
  function invalidate(){
    nonce++;
    return reset();
  }
  return frozen({sync,refresh,invalidate,getSnapshot:()=>observer.getSnapshot()});
}
