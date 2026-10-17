'use strict';
// DFR-02 / Slice 01: real, read-only vault admission to the exact authored Empty Wallet canvas.
// Never import the Studio's simulated runtime. Never create/recover a wallet, sign or broadcast.
(async function(){
  const root=document.documentElement;
  const eventLine=document.getElementById('eventLine');
  const views=[...document.querySelectorAll('[data-screen]')];
  const show=(screen)=>{
    for(const view of views)view.hidden=view.dataset.screen!==screen;
  };
  const note=(message)=>{
    if(eventLine){eventLine.textContent=message;eventLine.classList.add('visible')}
  };
  const fail=(message)=>{
    show(null);
    root.dataset.walletAdapter='fail-closed';
    note(message);
  };
  show(null);
  root.dataset.walletAdapter='checking';
  try{
    if(!window.FAEWalletVault || typeof window.FAEWalletVault.listWallets!=='function'
      || typeof window.FAEWalletVault.readState!=='function')
      throw Error('Vault read-only API unavailable');
    const [wallets,state]=await Promise.all([
      window.FAEWalletVault.listWallets(),window.FAEWalletVault.readState()
    ]);
    if(!Array.isArray(wallets) || !state || !Array.isArray(views) || views.length!==4)
      throw Error('Unexpected vault or authored scene shape');
    if(wallets.length || state.activeWalletId){
      fail('A saved Wallet exists. This isolated first-slice adapter cannot display it yet; use the existing verified Wallet interface.');
      return;
    }
    const empty=document.querySelector('[data-screen="empty"]');
    if(!empty || !empty.querySelector('.empty-primary') || !empty.querySelector('.empty-aside'))
      throw Error('Authored Empty Wallet composition missing');
    show('empty');
    root.dataset.walletAdapter='empty-vault-read-only';
    // Preview-only affordances: preserve the approved composition; never perform wallet mutation.
    const newButton=document.getElementById('startNew');
    const recoveryButton=document.getElementById('startRecovery');
    if(!newButton || !recoveryButton)throw Error('Authored choice controls missing');
    newButton.addEventListener('click',()=>{
      show('create');
      note('Visual integration preview only. Wallet creation is not enabled in this isolated slice.');
    });
    recoveryButton.addEventListener('click',()=>{
      show('recovery');
      note('Visual integration preview only. Recovery words are not accepted in this isolated slice.');
    });
    for(const back of document.querySelectorAll('[data-back="empty"]')){
      back.addEventListener('click',()=>{show('empty');if(eventLine)eventLine.textContent=''});
    }
  }catch(error){
    fail('Wallet storage could not be verified. No wallet action is available in this isolated slice.');
  }finally{
    const guard=document.getElementById('integration-first-frame-guard');
    if(guard)guard.remove();
  }
})();