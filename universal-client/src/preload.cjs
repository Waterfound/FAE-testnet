'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('triumph',Object.freeze({
  snapshot:()=>ipcRenderer.invoke('ts:snapshot'),
  nativeWalletStatus:()=>ipcRenderer.invoke('ts:native-wallet-status'),
  nativeWalletTerminal:command=>ipcRenderer.invoke('ts:native-wallet-terminal',command),
  startNode:()=>ipcRenderer.invoke('ts:start-node'),
  stopNode:()=>ipcRenderer.invoke('ts:stop-node'),
  startMiner:address=>ipcRenderer.invoke('ts:start-miner',address),
  stopMiner:()=>ipcRenderer.invoke('ts:stop-miner'),
  status:()=>ipcRenderer.invoke('ts:status'),
  balance:address=>ipcRenderer.invoke('ts:balance',address),
  reviewPayment:publicDraft=>ipcRenderer.invoke('ts:review-payment',publicDraft),
  observePaymentFunds:publicDraft=>ipcRenderer.invoke('ts:observe-payment-funds',publicDraft),
  explorer:(route,query)=>ipcRenderer.invoke('ts:explorer',route,query),
  watchList:()=>ipcRenderer.invoke('ts:watch-list'),
  watchAdd:(address,alias)=>ipcRenderer.invoke('ts:watch-add',address,alias),
  watchUpdate:(address,changes)=>ipcRenderer.invoke('ts:watch-update',address,changes),
  watchRemove:address=>ipcRenderer.invoke('ts:watch-remove',address),
  watchSelect:address=>ipcRenderer.invoke('ts:watch-select',address),
  watchImportVault:()=>ipcRenderer.invoke('ts:watch-import-vault'),
  onState:callback=>{
    if(typeof callback!=='function')throw Error('Listener required');
    const listener=(_event,state)=>callback(state);
    ipcRenderer.on('ts:state',listener);
    return()=>ipcRenderer.removeListener('ts:state',listener);
  }
}));
