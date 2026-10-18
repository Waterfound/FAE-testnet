'use strict';
// BC-FAE-WALLET-STUDIO-001 / Active-read-only slice.
// Never import Studio demo runtime. The approved HTML/CSS canvas stays unmodified.
// Real records require local vault decryption; balances/transactions remain unverified.
(async function(){
  const root=document.documentElement;
  const eventLine=document.getElementById('eventLine');
  const views=[...document.querySelectorAll('[data-screen]')];
  const $=(selector)=>document.querySelector(selector);
  const show=(screen)=>{for(const view of views)view.hidden=view.dataset.screen!==screen};
  const note=(message)=>{
    if(eventLine){eventLine.textContent=message;eventLine.classList.add('visible')}
  };
  const fail=(message)=>{
    show(null);root.dataset.walletAdapter='fail-closed';
    note(message);
  };
  function clearExampleContent(){
    const value=$('.balance-value strong');if(value)value.textContent='—';
    const subtitle=$('.balance-sub');if(subtitle)subtitle.textContent='Balance unavailable · no verified network response';
    const flow=$('.flow-strip');if(flow)flow.textContent='No verified movements available';
    const count=$('.flow-foot span:first-child');if(count)count.textContent='0 verified events';
    const caption=document.getElementById('flowCaption');if(caption)caption.textContent='No verified transfers';
    const reference=$('.reference-data');if(reference)reference.textContent='NO VERIFIED CHAIN HISTORY';
    for(const row of document.querySelectorAll('.activity-list .activity-row'))row.remove();
    const activityTitle=$('.activity-list .list-head span');if(activityTitle)activityTitle.textContent='NO VERIFIED CHAIN HISTORY';
    const rail=$('.wallet-rail');if(rail)rail.replaceChildren();
    const detail=document.getElementById('actionDetail');if(detail)detail.hidden=true;
  }
  function safePublicAddress(address){
    return typeof address==='string' && /^faet1[a-z0-9]{12,}$/i.test(address);
  }
  function bindActions(address){
    for(const button of document.querySelectorAll('[data-action]')){
      button.addEventListener('click',()=>{
        const detail=document.getElementById('actionDetail');
        const title=document.getElementById('actionEyebrow');
        const content=document.getElementById('actionContent');
        if(!detail||!title||!content){fail('The approved action scene is missing.');return}
        detail.hidden=false;
        content.replaceChildren();
        if(button.dataset.action==='receive'){
          title.textContent='RECEIVE / VERIFIED LOCAL ADDRESS';
          const value=document.createElement('div');
          value.className='address-readout';
          value.textContent=address;
          content.append(value);
          note('Receiving address verified by the local encrypted vault. No network balance claim.');
        }else{
          title.textContent='SEND / PROTECTED FUNCTION';
          const p=document.createElement('p');
          p.textContent='Signing remains in the existing verified FAE Wallet until this Studio integration passes the signing-intent gate.';
          const link=document.createElement('a');
          link.href='../../index.html';
          link.textContent='Open verified Wallet →';
          content.append(p,link);
        }
      });
    }
    const dismiss=document.getElementById('dismissAction');
    if(dismiss)dismiss.addEventListener('click',()=>{
      const detail=document.getElementById('actionDetail');if(detail)detail.hidden=true;
    });
  }
  function renderActive(wallets,state,account){
    clearExampleContent();
    const wallet=wallets.find(item=>item.walletId===state.activeWalletId);
    if(!wallet || !Array.isArray(wallet.addresses) || !Array.isArray(account?.addresses))
      throw Error('No verifiable active Wallet record');
    // Identity is scoped to the canonical testnet. Never display a stored Wallet
    // from another chain or trust address metadata without its public-key binding.
    if(wallet.network!=='fairyelf-public-testnet-v4')
      throw Error('Stored Wallet is bound to the wrong network');
    const metadata=wallet.addresses.map(a=>({address:a.address,pub:a.pub}));
    const decrypted=account.addresses.map(a=>({address:a.address,pub:a.pub}));
    if(!metadata.length || metadata.some(a=>typeof a.address!=='string'||typeof a.pub!=='string'||!a.pub)
      || JSON.stringify(metadata)!==JSON.stringify(decrypted)
      || new Set(metadata.map(a=>a.address)).size!==metadata.length)
      throw Error('Vault public identity and authenticated Wallet identity disagree');
    const index=wallet.activeIndex;
    if(!Number.isInteger(index)||index<0||index>=metadata.length)throw Error('Active address is invalid');
    const address=metadata[index].address;
    if(!safePublicAddress(address))throw Error('Address network/prefix validation failed');
    const rank=wallets.indexOf(wallet)+1;
    const heading=$('.balance-upper .eyebrow');
    if(heading)heading.textContent='WALLET '+String(rank).padStart(2,'0')+' / LOCAL';
    const selected=$('.micro-status');
    if(selected)selected.textContent=String(rank).padStart(2,'0')+' · SELECTED';
    const rail=$('.wallet-rail');
    if(!rail)throw Error('Approved Wallet rail is missing');
    const title=document.createElement('div');title.className='rail-heading';
    title.textContent='YOUR WALLETS ';
    const count=document.createElement('span');count.textContent=String(wallets.length).padStart(2,'0');title.append(count);
    rail.append(title);
    for(let i=0;i<wallets.length;i++){
      const item=wallets[i];
      const el=document.createElement('div');
      el.className='wallet-choice'+(i===rank-1?' selected':'');
      const text=document.createElement('span');
      const label=document.createElement('b');label.textContent='Wallet '+String(i+1).padStart(2,'0');
      const hint=document.createElement('small');hint.textContent=i===rank-1?'Selected · local':'Stored · select in verified Wallet';
      text.append(label,hint);el.append(text);rail.append(el);
    }
    const foot=document.createElement('div');foot.className='rail-foot';
    const f1=document.createElement('span');f1.textContent='Active address';
    const f2=document.createElement('b');f2.id='addressReadout';
    f2.textContent=address.slice(0,10)+'…'+address.slice(-6);
    const f3=document.createElement('small');f3.textContent='Authenticated vault identity · no chain claim';
    foot.append(f1,f2,f3);rail.append(foot);
    bindActions(address);
    show('active');root.dataset.walletAdapter='active-authenticated-read-only';
    note('Wallet identity authenticated locally. Network reads are separate from vault authentication.');
    // Read-only chain data is never queried for an unauthenticated or cross-network Wallet.
    // A public request cannot disclose key material; only the selected public address.
    const chain=window.FAEStudioChainRead;
    if(chain&&typeof chain.refresh==='function'){
      void chain.refresh(address).catch(()=>{
        // The network adapter handles its own fail-closed presentation.
      });
    }
  }
  show(null);
  root.dataset.walletAdapter='checking';
  try{
    const vault=window.FAEWalletVault;
    if(!vault||typeof vault.listWallets!=='function'||typeof vault.readState!=='function')
      throw Error('Read-only local vault is unavailable');
    const [wallets,state]=await Promise.all([vault.listWallets(),vault.readState()]);
    if(!Array.isArray(wallets)||!state||views.length!==4)
      throw Error('Vault or authored scenes do not match the contract');
    if(wallets.length||state.activeWalletId){
      if(!state.activeWalletId||typeof vault.loadAccount!=='function')
        throw Error('An active authenticated Wallet is required');
      const account=await vault.loadAccount(state.activeWalletId);
      renderActive(wallets,state,account);
    }else{
      const empty=$('[data-screen="empty"]');
      if(!empty?.querySelector('.empty-primary')||!empty.querySelector('.empty-aside'))
        throw Error('Approved Empty scene missing');
      clearExampleContent();
      show('empty');root.dataset.walletAdapter='empty-vault-read-only';
      const newButton=document.getElementById('startNew');
      const recoveryButton=document.getElementById('startRecovery');
      if(!newButton||!recoveryButton)throw Error('Approved entry actions missing');
      newButton.addEventListener('click',()=>{
        show('create');root.dataset.walletScene='creation-preview';
      });
      recoveryButton.addEventListener('click',()=>{
        show('recovery');root.dataset.walletScene='recovery-preview';
      });
      for(const back of document.querySelectorAll('[data-back="empty"]')){
        back.addEventListener('click',()=>{
          show('empty');if(eventLine)eventLine.textContent='';
        });
      }
    }
  }catch(error){
    fail('Wallet authentication or storage could not be verified. No wallet action is available in this isolated slice.');
  }finally{
    const guard=document.getElementById('integration-first-frame-guard');if(guard)guard.remove();
  }
})();
