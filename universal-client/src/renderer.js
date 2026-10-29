'use strict';
const get=id=>document.getElementById(id);
const PAGES=new Set(['home','wallet','mining','node','explorer','settings']);
const media={hero:'../assets/hero.webp',heroRest:'../assets/hero-rest.png',balance:'../assets/balance.gif',balanceRest:'../assets/balance-rest.png'};
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
// Verified against the private unchanged Hero WebP: 150 frames, total ANMF duration 4,999ms.
// This is a UI lifecycle cap, not proof that every device decodes every frame on time.
const HERO_PLAYBACK_MS=4999;
let heroTimer=null,heroGeneration=0;
let active='home',heroAtRest=false,state={node:'stopped',miner:'stopped'};
function cancelHeroTimer(){
  if(heroTimer!==null){clearTimeout(heroTimer);heroTimer=null}
}
function setMedia(id,placeholder,src,onReady){
  const img=get(id),fallback=get(placeholder);
  img.onload=()=>{img.hidden=false;fallback.hidden=true;if(onReady)onReady()};
  img.onerror=()=>{img.hidden=true;fallback.hidden=false};
  img.src=src;
}
function clearMedia(id){const img=get(id);img.removeAttribute('src');img.hidden=true}
function hero({entry=false}={}){
  cancelHeroTimer();
  const generation=++heroGeneration;
  if(entry)heroAtRest=false;
  if(active!=='home')return;
  clearMedia('hero-motion');clearMedia('hero-rest');
  const still=reduce.matches||document.hidden||heroAtRest;
  if(still){
    heroAtRest=true;
    setMedia('hero-rest','hero-unavailable',media.heroRest);
    return;
  }
  setMedia('hero-motion','hero-unavailable',media.hero,()=>{
    if(generation!==heroGeneration||active!=='home'||document.hidden)return;
    heroTimer=setTimeout(()=>{
      if(generation!==heroGeneration||active!=='home')return;
      // Remove the animated image after a single source-timed playback.
      // Original verified last frame is served from immutable hero-rest.png.
      heroAtRest=true;hero();
    },HERO_PLAYBACK_MS);
  });
}
function balanceMedia(){
  clearMedia('balance-motion');clearMedia('balance-rest');
  if(active!=='wallet')return;
  const still=reduce.matches||document.hidden;
  setMedia(still?'balance-rest':'balance-motion','balance-unavailable',still?media.balanceRest:media.balance);
}
function show(page){
  if(!PAGES.has(page)||page===active)return;
  const previous=active;active=page;
  for(const p of PAGES)get('page-'+p).classList.toggle('visible',page===p);
  for(const btn of document.querySelectorAll('.nav[data-page]')){
    const yes=btn.dataset.page===page;btn.classList.toggle('active',yes);
    if(yes)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');
  }
  if(previous==='home'){cancelHeroTimer();heroGeneration++;clearMedia('hero-motion');clearMedia('hero-rest')}
  if(page==='home')hero({entry:true});
  balanceMedia();
}
function view(s){
  const nodeWasRunning=state.node==='running';
  state=s;
  if(nodeWasRunning&&s.node!=='running')clearWalletObservations('Local node stopped; no current balance observation');
  get('node-state').textContent=s.node==='running'?'Running (process)':s.node==='starting'?'Starting':s.node==='stopping'?'Stopping':'Stopped';
  get('miner-state').textContent=s.miner==='running'?(s.telemetry?.state||'Running'):s.miner==='starting'?'Starting':s.miner==='stopping'?'Stopping':'Stopped';
  get('home-node').textContent=s.node==='running'?'Process running':s.node==='starting'?'Starting':s.node==='stopping'?'Stopping':'Stopped';
  get('home-miner').textContent=s.miner==='running'?'Process running':s.miner==='starting'?'Starting':s.miner==='stopping'?'Stopping':'Stopped';
  get('network-tag').textContent=s.node==='running'?'LOCAL NODE PROCESS':'LOCAL NODE OFFLINE';
  for(const key of ['hashrate_hs','accepted','rejected']){
    const value=s.telemetry?.[key];get('miner-'+key).textContent=Number.isSafeInteger(value)?String(value):'—';
  }
  const recovery=get('node-recovery');
  recovery.hidden=!s.node_recovery;
  recovery.textContent=s.node_recovery==='INTERRUPTED_STATE_WRITE'
    ?'Recovery required: an interrupted node state write was detected. No files were erased. Review verified recovery evidence before restarting.'
    :s.node_recovery==='UNSAFE_PERSISTED_STATE'
      ?'Recovery required: saved node state is corrupted or unsafe. No chain reset or destructive repair was attempted.'
      :s.node_recovery?'Recovery required: node state needs independent verification.':'';
  get('node-start').disabled=s.node!=='stopped';
  get('node-stop').disabled=s.node==='stopped';
  get('miner-start').disabled=s.miner!=='stopped';
  get('miner-stop').disabled=s.miner==='stopped';
}
let toastTimer;
function alertText(text){
  const el=get('toast');el.textContent=String(text);el.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true},4800);
}
async function safely(fn){try{return await fn()}catch(e){alertText(e.message||'Action unavailable');return null}}
async function status(){
  const r=await safely(()=>window.triumph.status());
  const h=r?.height;
  get('node-height').textContent=Number.isSafeInteger(h)&&h>=0?String(h):'—';
  get('home-network').textContent=r?'FAE v4 · local node responding':'Not connected';
}
let balanceRequest=0,activityRequest=0,paymentRequest=0,txReceiptRequest=0,fundingRequest=0,activityPage=null;
function clearWalletObservations(reason='Select an address and refresh its local observation'){
  balanceRequest++;activityRequest++;paymentRequest++;txReceiptRequest++;fundingRequest++;
  get('funding-candidates-output').textContent='Node or selected address changed. Funding candidates must be read again.';
  get('wallet-tx-output').textContent='Selected-node observation cleared. Recheck the TXID after restarting the node.';
  get('payment-review-output').textContent='Review reset. No payment signed or submitted.';
  get('balance-amount').textContent='— FAE';
  get('balance-status').textContent=reason;
  activityPage=null;get('wallet-activity-more').hidden=true;
  get('wallet-activity-output').textContent='No current local node activity observation';
}
let selectedWatchAddress=null;
function watchRender(result){
  const oldAddress=get('wallet-address').value.trim();
  const target=get('watch-entries');target.replaceChildren();
  if(!Array.isArray(result?.entries)){target.textContent='Local public-address catalog unavailable';return}
  if(typeof result.selected==='string'&&result.entries.some(e=>e.address===result.selected)){
    get('wallet-address').value=result.selected;
    get('mining-address').value=result.selected;
  }else if(selectedWatchAddress){
    if(get('wallet-address').value===selectedWatchAddress)get('wallet-address').value='';
    if(get('mining-address').value===selectedWatchAddress)get('mining-address').value='';
  }
  selectedWatchAddress=result.selected||null;
  if(get('wallet-address').value.trim()!==oldAddress)clearWalletObservations();
  if(!result.entries.length){target.textContent='No saved public addresses';return}
  for(const entry of result.entries){
    const row=document.createElement('div');row.className='watch-entry';
    const label=document.createElement('span');
    label.textContent=entry.alias+' · '+(entry.hidden?'hidden':entry.address);
    row.append(label);
    const select=document.createElement('button');
    select.textContent=result.selected===entry.address?'Selected':'Select';
    select.addEventListener('click',()=>{
      if(get('wallet-address').value.trim()!==entry.address)clearWalletObservations();
      get('wallet-address').value=entry.address;
      get('mining-address').value=entry.address;
      if(typeof window.triumph.watchSelect==='function'){
        void safely(()=>window.triumph.watchSelect(entry.address)).then(saved=>{if(saved)watchRender(saved)});
      }
    });
    row.append(select);
    const toggle=document.createElement('button');toggle.textContent=entry.hidden?'Show':'Hide';
    toggle.addEventListener('click',async()=>{
      const r=await safely(()=>window.triumph.watchUpdate(entry.address,{hidden:!entry.hidden}));
      if(r)watchRender(r);
    });
    row.append(toggle);
    const remove=document.createElement('button');remove.textContent='Remove';
    remove.addEventListener('click',async()=>{
      const r=await safely(()=>window.triumph.watchRemove(entry.address));
      if(r)watchRender(r);
    });
    row.append(remove);target.append(row);
  }
}
async function watchLoad(){watchRender(await safely(()=>window.triumph.watchList()))}
async function balance(){
  const generation=++balanceRequest;
  get('balance-amount').textContent='— FAE';
  get('balance-status').textContent='Reading node…';
  const address=get('wallet-address').value.trim();
  const r=await safely(()=>window.triumph.balance(address));
  if(generation!==balanceRequest||get('wallet-address').value.trim()!==address||state.node!=='running')return;
  if(!r){get('balance-status').textContent='No verified balance observation';return}
  const raw=r.balance_atoms;
  if(!/^\d+$/.test(String(raw))){get('balance-status').textContent='Invalid balance payload';return}
  const atoms=BigInt(raw),whole=atoms/100000000n,tail=(atoms%100000000n).toString().padStart(8,'0').replace(/0+$/,'');
  get('balance-amount').textContent=whole.toString()+(tail?'.'+tail:'')+' FAE';
  get('balance-status').textContent='Selected local node observation · not a finality guarantee';
}
// Selected node claims only: candidate outputs include unconfirmed descendants
// and may contain immature coinbase rewards. Never permit signing from here.
async function inspectFundingCandidates(){
  const generation=++fundingRequest;
  const address=get('wallet-address').value.trim();
  const output=get('funding-candidates-output');
  if(state.node!=='running'){
    output.textContent='Start the managed local node before observing public outputs.';
    return;
  }
  output.textContent='Reading source-bound selected-node UTXO candidates…';
  const result=await safely(()=>window.triumph.fundingCandidates(address));
  if(generation!==fundingRequest||address!==get('wallet-address').value.trim()||
     state.node!=='running')return;
  if(!result||result.authority!=='SELECTED_NODE_UNTRUSTED_UTXO_CLAIM'||
     result.address!==address||
     result.funding_authorization!=='DENIED_UNVERIFIED'||
     result.eligible_candidate_atoms!=='0'||result.eligible_candidate_count!==0||
     !Array.isArray(result.outputs)||result.outputs.some(item=>
       item?.spend_eligibility!=='UNVERIFIED'||
       !Array.isArray(item.exclusion_reasons)||item.exclusion_reasons.length<4)){
    output.textContent='No compatible fail-closed selected-node funding observation.';
    return;
  }
  const exact=(atoms)=>{
    const n=BigInt(atoms),whole=n/100000000n,tail=(n%100000000n).toString().padStart(8,'0').replace(/0+$/,'');
    return whole.toString()+(tail?'.'+tail:'');
  };
  output.textContent=[
    'FAE TESTNET · SELECTED NODE FUNDING CANDIDATES · READ ONLY',
    'Address: '+address,
    'Claimed total: '+exact(result.candidate_atoms)+' FAE',
    'Claimed confirmed outputs: '+exact(result.confirmed_candidate_atoms)+' FAE',
    'Claimed pending outputs: '+exact(result.pending_candidate_atoms)+' FAE',
    'Observed output count: '+result.candidate_count,
    'Eligible for signing or submission: '+exact(result.eligible_candidate_atoms)+
      ' FAE · '+result.eligible_candidate_count+' outputs',
    'Funding authorization: '+result.funding_authorization,
    'Observed tip: #'+result.observed_tip_height+' · '+result.observed_tip_hash,
    ...result.outputs.slice(0,20).map(item=>
      item.source.toUpperCase()+' · '+item.outpoint+' · '+exact(item.amount_atoms)+
      ' FAE · '+item.spend_eligibility+' · '+item.exclusion_reasons.join(', ')),
    ...(result.outputs.length>20?['Additional output rows omitted from display.']:[]),
    'Coinbase maturity: NOT VERIFIED · Key ownership: NOT VERIFIED',
    'Managed node process identity: NOT CRYPTOGRAPHICALLY AUTHENTICATED',
    'Signing: UNAVAILABLE · Submission: NOT PERFORMED'
  ].join('\n');
}
async function walletActivity({append=false}={}){
  const address=get('wallet-address').value.trim();
  const previous=append?activityPage:null;
  if(append&&(!previous||previous.address!==address||!previous.cursor))return;
  const generation=++activityRequest;
  const output=get('wallet-activity-output'),loadMore=get('wallet-activity-more');
  loadMore.hidden=true;
  if(!append){activityPage=null;output.textContent='Reading selected node…'}
  else output.textContent='Loading additional selected-node events…';
  const query={address,limit:20};
  if(append)query.cursor=previous.cursor;
  const observed=await safely(()=>window.triumph.explorer('/explorer/address',query));
  if(generation!==activityRequest||get('wallet-address').value.trim()!==address||state.node!=='running')return;
  if(!observed||observed.address!==address||!Array.isArray(observed.events)){
    activityPage=null;
    output.textContent='No validated local address observation. Reload activity.';
    return;
  }
  if(append&&(observed.observed_tip_height!==previous.height||
    observed.observed_tip_hash!==previous.hash)){
    activityPage=null;
    output.textContent='Chain tip changed; the prior page is stale. Refresh observations.';
    return;
  }
  const events=append?[...previous.events,...observed.events]:observed.events;
  // Never claim full lifetime history; these are current selected-node indexed events.
  if(events.length>1000||new Set(events.map(x=>x.id)).size!==events.length){
    activityPage=null;output.textContent='Inconsistent or excessive history page. Refresh observations.';return;
  }
  activityPage={address,height:observed.observed_tip_height,hash:observed.observed_tip_hash,
    cursor:observed.next_cursor,events};
  output.textContent=JSON.stringify({
    address,
    provenance:'selected_local_node_testnet_observation_not_independent_finality',
    coverage:'current_selected_node_index_not_guaranteed_lifetime_history',
    network:observed.network,
    observed_tip_height:observed.observed_tip_height,
    observed_tip_hash:observed.observed_tip_hash,
    shown_events:events.length,total_events:observed.total_events,
    next_cursor:observed.next_cursor,
    events
  },null,2);
  loadMore.hidden=!observed.next_cursor||events.length>=1000;
}
async function reviewPayment(){
  const generation=++paymentRequest;
  const draft={
    from:get('wallet-address').value.trim(),
    to:get('payment-to').value.trim(),
    amount:get('payment-amount').value.trim(),
    fee:get('payment-fee').value.trim()
  };
  const output=get('payment-review-output');
  output.textContent='Validating public FAE testnet payment…';
  const result=await safely(()=>window.triumph.reviewPayment(draft));
  if(generation!==paymentRequest||
     get('wallet-address').value.trim()!==draft.from||
     get('payment-to').value.trim()!==draft.to||
     get('payment-amount').value.trim()!==draft.amount||
     get('payment-fee').value.trim()!==draft.fee)return;
  if(!result){output.textContent='Unsigned payment review unavailable. No transaction submitted.';return}
  // Only text projection, no HTML; no signing or submission capability exists here.
  output.textContent=[
    'FAE PUBLIC TESTNET · UNSIGNED REVIEW ONLY',
    'From: '+result.from,
    'To: '+result.to,
    'Amount: '+result.amount_fae+' FAE',
    'Fee: '+result.fee_fae+' FAE',
    'Total: '+result.total_fae+' FAE',
    'Custody: NOT AUTHENTICATED · Balance: NOT CHECKED',
    'Signing: UNAVAILABLE · Submission: NOT SUBMITTED',
    'TRIUM is the intended future ticker; the existing asset is FAE.'
  ].join('\n');
}
async function observePaymentFunds(){
  const generation=++paymentRequest;
  const draft={
    from:get('wallet-address').value.trim(),
    to:get('payment-to').value.trim(),
    amount:get('payment-amount').value.trim(),
    fee:get('payment-fee').value.trim()
  };
  const output=get('payment-review-output');
  if(state.node!=='running'){
    output.textContent='Local node is not running. No balance observed, signed or submitted.';
    return;
  }
  output.textContent='Reading current selected-node FAE balance for unsigned draft…';
  const observed=await safely(()=>window.triumph.observePaymentFunds(draft));
  if(generation!==paymentRequest||state.node!=='running'||
     get('wallet-address').value.trim()!==draft.from||
     get('payment-to').value.trim()!==draft.to||
     get('payment-amount').value.trim()!==draft.amount||
     get('payment-fee').value.trim()!==draft.fee)return;
  if(!observed||observed.node!=='CURRENT_MANAGED_LOCAL_NODE_ASSERTION'){
    output.textContent='No compatible local funding observation. Nothing signed or submitted.';return;
  }
  output.textContent=[
    'FAE PUBLIC TESTNET · UNSIGNED REVIEW · NODE-REPORTED BALANCE',
    'From: '+observed.from,
    'To: '+observed.to,
    'Amount: '+observed.amount_fae+' FAE',
    'Fee: '+observed.fee_fae+' FAE',
    'Total: '+observed.total_fae+' FAE',
    'Local selected node reports: '+observed.observed_fae+' FAE',
    'Observed at local tip: #'+observed.observed_tip_height+' · '+observed.observed_tip_hash,
    observed.funding==='NODE_REPORTED_BALANCE_BELOW_DRAFT_TOTAL'
      ?'Node-reported balance is below draft total.'
      :'Node-reported balance meets draft total; this is NOT spendability proof.',
    'Custody: NOT AUTHENTICATED · Spendable UTXOs: NOT VERIFIED',
    'Signing: UNAVAILABLE · Submission: NOT SUBMITTED',
    'No independent confirmation or node process-authentication claim.'
  ].join('\n');
}
// Public-only receipt reader: the existing ProcessController binds Explorer
// responses to a stable selected-node tip. No submit or signing IPC is exposed.
async function trackWalletTransaction(){
  const id=get('wallet-txid').value.trim();
  const generation=++txReceiptRequest;
  const output=get('wallet-tx-output');
  if(!/^[0-9a-f]{64}$/.test(id)){
    output.textContent='Invalid FAE testnet transaction ID. Use exactly 64 lowercase hexadecimal characters.';
    return;
  }
  if(state.node!=='running'){
    output.textContent='Start your local node to observe a public transaction. Nothing was submitted.';
    return;
  }
  output.textContent='Checking the selected managed node at a stable chain tip…';
  const observation=await safely(()=>window.triumph.transactionLookup(id));
  if(generation!==txReceiptRequest||get('wallet-txid').value.trim()!==id||state.node!=='running')return;
  // Only native parent owner may confer this provenance. No renderer flag
  // chooses the transport; rejected IPC must NEVER downgrade to localhost.
  if(observation?.origin==='PARENT_OWNED_NATIVE_IPC'){
    const receipt=observation.result;
    const hash=/^[0-9a-f]{64}$/;
    const compatible=receipt&&receipt.txid===id&&
      typeof receipt.result_known==='boolean'&&
      Number.isSafeInteger(receipt.observed_tip_height)&&receipt.observed_tip_height>=0&&
      hash.test(receipt.observed_tip_hash)&&
      receipt.confirmation_finality==='NOT_PROVEN'&&
      (receipt.result_known?
        ['pending','confirmed'].includes(receipt.status)&&
        (receipt.status==='pending'?receipt.confirmed_height===null:
          Number.isSafeInteger(receipt.confirmed_height)&&
          receipt.confirmed_height>=1&&
          receipt.confirmed_height<=receipt.observed_tip_height):
        receipt.status===null&&receipt.confirmed_height===null);
    if(!compatible){
      output.textContent='Invalid original-node native transaction evidence. No payment status asserted.';
      return;
    }
    if(!receipt.result_known){
      output.textContent=[
        'FAE PUBLIC TESTNET · NATIVE ORIGINAL NODE READ',
        'Transaction: '+id,
        'Status: NOT OBSERVED ON THIS NODE · outcome UNKNOWN',
        'Observed tip: #'+receipt.observed_tip_height+' · '+receipt.observed_tip_hash,
        'Absence is not proof a previous submission failed. Never automatically resubmit.',
        'Source: actual parent-owned OS IPC · local node assertion only.',
        'Desktop signing: UNAVAILABLE · Submission: NOT PERFORMED'
      ].join('\n');
      return;
    }
    const stateLabel=receipt.status==='confirmed'
      ?'CONFIRMED BY SELECTED NODE · independent finality NOT PROVEN'
      :'PENDING · SELECTED NODE CLAIM';
    output.textContent=[
      'FAE PUBLIC TESTNET · NATIVE ORIGINAL NODE READ',
      'Transaction: '+id,
      'Status: '+stateLabel,
      ...(receipt.status==='confirmed'?['Included at block #'+receipt.confirmed_height]:[]),
      'Observed tip: #'+receipt.observed_tip_height+' · '+receipt.observed_tip_hash,
      'Source: parent-owned OS IPC · original-node claim, not independently finalized.',
      'No signing authorization or transaction submission occurred in this desktop view.'
    ].join('\n');
    return;
  }
  if(observation?.origin!=='LOCAL_HTTP_EXPLORER_CLAIM'){
    output.textContent='Authenticated transaction lookup unavailable. No HTTP fallback or payment status asserted.';
    return;
  }
  const receipt=observation.result;
  const tx=receipt?.transaction;
  const tip=receipt?.observed_tip_height,tipHash=receipt?.observed_tip_hash;
  const hash=/^[0-9a-f]{64}$/;
  if(receipt?.ok!==true||receipt.network!=='fairyelf-public-testnet-v4'||
     !Number.isSafeInteger(tip)||tip<0||typeof tipHash!=='string'||!hash.test(tipHash)||
     tx?.txid!==id||tx.network!==receipt.network||
     !['pending','confirmed'].includes(tx.status)){
    output.textContent='No compatible transaction observation from the selected node. No confirmation asserted.';
    return;
  }
  let stateLabel;
  if(tx.status==='confirmed'){
    const h=tx.confirmed_height,confirmations=tx.confirmations;
    if(!Number.isSafeInteger(h)||h<1||h>tip||
       typeof tx.block_hash!=='string'||!hash.test(tx.block_hash)||
       !Number.isSafeInteger(confirmations)||confirmations!==tip-h+1){
      output.textContent='Inconsistent confirmed transaction observation. No confirmation asserted.';
      return;
    }
    stateLabel='CONFIRMED BY SELECTED NODE · '+confirmations+' local-chain confirmation(s)';
  }else{
    if(tx.confirmed_height!==null||tx.block_hash!==null||tx.confirmations!==null){
      output.textContent='Contradictory pending transaction observation. No pending state asserted.';
      return;
    }
    stateLabel='PENDING · SELECTED NODE MEMPOOL CLAIM';
  }
  output.textContent=[
    'FAE PUBLIC TESTNET · READ-ONLY TRANSACTION RECEIPT',
    'Transaction: '+id,
    'Status: '+stateLabel,
    ...(tx.status==='confirmed'?['Included at block #'+tx.confirmed_height,'Block hash: '+tx.block_hash]:[]),
    'Observed tip: #'+tip+' · '+tipHash,
    'Source: selected managed local node / Explorer stable-tip observation.',
    'Not independently finalized or authenticated for signing.',
    'Desktop Wallet signing: UNAVAILABLE · Desktop submission: NOT PERFORMED'
  ].join('\n');
}
async function explorer(route,query){
  get('explorer-output').textContent='Reading…';
  const r=await safely(()=>window.triumph.explorer(route,query));
  get('explorer-output').textContent=r?JSON.stringify(r,null,2):'No verified Explorer observation';
}
for(const b of document.querySelectorAll('.nav[data-page]'))b.addEventListener('click',()=>show(b.dataset.page));
get('node-start').addEventListener('click',async()=>{const r=await safely(()=>window.triumph.startNode());if(r){view(r);await status()}});
get('node-stop').addEventListener('click',async()=>{const r=await safely(()=>window.triumph.stopNode());if(r)view(r)});
get('node-refresh').addEventListener('click',status);
get('miner-start').addEventListener('click',async()=>{const r=await safely(()=>window.triumph.startMiner(get('mining-address').value.trim()));if(r)view(r)});
get('miner-stop').addEventListener('click',async()=>{const r=await safely(()=>window.triumph.stopMiner());if(r)view(r)});
get('refresh-balance').addEventListener('click',balance);
get('funding-candidates-refresh').addEventListener('click',inspectFundingCandidates);
get('wallet-address').addEventListener('input',()=>clearWalletObservations());
get('watch-import-vault').addEventListener('click',async()=>{
  if(typeof window.triumph.watchImportVault!=='function')return;
  const result=await safely(()=>window.triumph.watchImportVault());
  if(result?.entries){watchRender(result);alertText('Public-only addresses imported. Vault remains locked and unverified.')}
});
get('watch-save').addEventListener('click',async()=>{
  const addr=get('wallet-address').value.trim(),label=get('watch-alias').value.trim();
  const r=await safely(()=>window.triumph.watchAdd(addr,label));
  if(r){get('watch-alias').value='';watchRender(r)}
});
get('refresh-wallet-activity').addEventListener('click',()=>walletActivity());
get('wallet-activity-more').addEventListener('click',()=>walletActivity({append:true}));
for(const id of ['payment-to','payment-amount','payment-fee']){
  get(id).addEventListener('input',()=>{
    paymentRequest++;
    get('payment-review-output').textContent='Payment details changed. Review again; nothing signed or submitted.';
  });
}
get('payment-review').addEventListener('click',reviewPayment);
let nativeWalletReady=false,nativeWalletBusy=false;
const nativeWalletButtons=['native-wallet-create','native-wallet-recover','native-wallet-address','native-wallet-outbox'];
function nativeWalletButtonsState(){
  for(const id of nativeWalletButtons)get(id).disabled=!nativeWalletReady||nativeWalletBusy;
}
async function refreshNativeWalletCandidate(){
  const result=await safely(()=>window.triumph.nativeWalletStatus());
  nativeWalletReady=result?.state==='TRUSTED_SOURCE_AND_TTY_CANDIDATE';
  nativeWalletButtonsState();
  get('native-wallet-availability').textContent=nativeWalletReady
    ?'Exact Wallet owner files verified and an interactive terminal is attached. Candidate use only; no signing admission.'
    :'Privileged terminal Wallet unavailable in this installation. Public-only observation remains available.';
}
async function nativeWalletTerminal(command){
  if(!nativeWalletReady||nativeWalletBusy)return;
  nativeWalletBusy=true;nativeWalletButtonsState();
  get('native-wallet-operation').textContent='Use the separate attached terminal for this candidate operation. Nothing is entered in the desktop window.';
  const result=await safely(()=>window.triumph.nativeWalletTerminal(command));
  if(result?.public_import==='WATCH_ONLY_UNVERIFIED')await watchLoad();
  get('native-wallet-operation').textContent=result?.public_import==='WATCH_ONLY_UNVERIFIED'
    ?'Native CLI completed. '+result.imported_count+' public watch-only addresses were imported. The vault remains locked and signing is unavailable.'
    :result?.public_import==='NOT_IMPORTED_VAULT_PRESERVED'
      ?'Native CLI completed, but public address import was not verified. Vault data was preserved; use the separate native import dialog.'
      :result?.status==='CLI_EXIT_SUCCESS'
        ?command==='outbox'
          ?'Original Wallet outbox command exited successfully in the separate terminal. Inspect its result there; no password, decrypted intent or TXID was returned to this window. No payment was sent, retried or acknowledged.'
          :'Native CLI exited successfully. Desktop signing is not admitted; public-only observation remains separate.'
        :command==='outbox'
          ?'Original Wallet outbox result is unresolved or unavailable in the separate terminal. A non-success exit may mean pending, unknown, or a terminal error; inspect the protected terminal. No transaction was sent, retried or acknowledged here.'
          :'Native CLI did not confirm successful completion; no desktop signing or submission was enabled.';
  nativeWalletBusy=false;
  await refreshNativeWalletCandidate();
}
get('native-wallet-create').addEventListener('click',()=>nativeWalletTerminal('create'));
get('native-wallet-recover').addEventListener('click',()=>nativeWalletTerminal('recover'));
get('native-wallet-address').addEventListener('click',()=>nativeWalletTerminal('address'));
get('native-wallet-outbox').addEventListener('click',()=>nativeWalletTerminal('outbox'));
get('payment-funds').addEventListener('click',observePaymentFunds);
get('wallet-tx-track').addEventListener('click',trackWalletTransaction);
get('wallet-txid').addEventListener('input',()=>{
  txReceiptRequest++;
  get('wallet-tx-output').textContent='Transaction ID changed. Recheck the selected node; no prior observation remains current.';
});
get('explorer-latest').addEventListener('click',()=>explorer('/explorer/blocks',{limit:12}));
get('explorer-search').addEventListener('click',()=>{const q=get('explorer-query').value.trim();if(q)void explorer('/explorer/search',{q})});
reduce.addEventListener('change',()=>{if(active==='home'){heroAtRest=true;hero()}balanceMedia()});
document.addEventListener('visibilitychange',()=>{
  if(active==='home'&&document.hidden){heroAtRest=true;hero()}
  balanceMedia();
});
if(window.triumph){window.triumph.onState(view);window.triumph.snapshot().then(view).catch(()=>{});if(typeof window.triumph.watchList==='function')void watchLoad();if(typeof window.triumph.nativeWalletStatus==='function')void refreshNativeWalletCandidate()}
hero({entry:true});
