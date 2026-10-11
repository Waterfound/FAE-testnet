/**
 * Candidate only: public, read-only address observation for ONE selected Wallet.
 * This module cannot select/unlock/create a cryptographic wallet or sign.
 * The actual admitted vault/mining guard remains the authority for the active identity.
 */
import {ExplorerDataError} from './explorer-read-adapter.mjs';

const ATOMS=/^(0|[1-9]\d*)$/;
const ADDRESS=/^faet1[a-z0-9]{7,85}$/;
function fail(message){throw new ExplorerDataError('INVALID_QUERY',message);}
function immutable(value){return Object.freeze(value);}
function tipMatches(a,b){
  return a&&b&&a.network===b.network&&a.height===b.height&&a.hash===b.hash;
}
function selection(wallet){
  if(!wallet||typeof wallet!=='object'||Array.isArray(wallet))fail('Public Wallet selection required');
  const names=Object.keys(wallet).sort();
  if(names.length!==2||names[0]!=='address'||names[1]!=='walletId')
    fail('Pass only public walletId + address; no secret fields');
  if(typeof wallet.walletId!=='string'||!wallet.walletId.trim()||wallet.walletId.length>128)
    fail('Invalid persistent Wallet identity');
  if(typeof wallet.address!=='string'||!ADDRESS.test(wallet.address))
    fail('Invalid public FAE address');
  return immutable({walletId:wallet.walletId,address:wallet.address});
}
export function createWalletPublicLedgerObserver({adapter}={}){
  if(!adapter||typeof adapter.status!=='function'||typeof adapter.address!=='function')
    fail('Validated public read adapter required');
  let active=null,locked=false,epoch=0;
  let current=immutable({state:'no_wallet',walletId:null,address:null,balanceAtoms:null,tip:null,code:null});
  function snapshot(state,{balanceAtoms=null,tip=null,code=null}={}){
    current=immutable({
      state,
      walletId:active?.walletId??null,
      address:locked?null:active?.address??null,
      balanceAtoms,tip,code
    });
    return current;
  }
  function selectWallet(wallet){
    if(locked)fail('Vault is locked: public observer cannot switch Wallet authority');
    active=selection(wallet);
    epoch++;
    return snapshot('unknown');
  }
  function setVaultLocked(value){
    if(typeof value!=='boolean')fail('Explicit external vault lock state required');
    locked=value;
    epoch++;
    if(!active)return snapshot('no_wallet');
    // The caller must separately authenticate unlock at the crypto-vault layer.
    return snapshot(locked?'locked':'unknown');
  }
  function clear(){
    epoch++;
    active=null;
    locked=false;
    return snapshot('no_wallet');
  }
  async function refresh(){
    if(!active||locked)return current;
    const requestEpoch=++epoch;
    const requestIdentity=active;
    snapshot('loading');
    const discarded=()=>immutable({state:'stale_discarded',walletId:requestIdentity.walletId});
    try{
      const observed=await adapter.status();
      if(requestEpoch!==epoch)return discarded();
      if(!observed||!observed.tip)throw new ExplorerDataError('INVALID_RESPONSE','Missing selected node tip');
      const ledger=await adapter.address({address:requestIdentity.address,expectedTip:observed.tip});
      if(requestEpoch!==epoch)return discarded();
      if(!tipMatches(observed.tip,ledger?.tip))
        throw new ExplorerDataError('TIP_CHANGED','Selected-chain observation changed');
      if(typeof ledger.balanceAtoms!=='string'||!ATOMS.test(ledger.balanceAtoms))
        throw new ExplorerDataError('INVALID_RESPONSE','Untrusted public balance representation');
      return snapshot('observed',{balanceAtoms:ledger.balanceAtoms,tip:observed.tip});
    }catch(error){
      if(requestEpoch!==epoch)return discarded();
      const code=error instanceof ExplorerDataError?error.code:'NETWORK_UNAVAILABLE';
      return snapshot('unavailable',{code});
    }
  }
  return immutable({selectWallet,setVaultLocked,clear,refresh,getSnapshot:()=>current});
}
