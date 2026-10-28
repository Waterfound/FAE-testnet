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
let balanceRequest=0,activityRequest=0,paymentRequest=0,activityPage=null;
function clearWalletObservations(reason='Select an address and refresh its local observation'){
  balanceRequest++;activityRequest++;paymentRequest++;
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
get('payment-review').addEventListener('click',reviewPayment);
get('explorer-latest').addEventListener('click',()=>explorer('/explorer/blocks',{limit:12}));
get('explorer-search').addEventListener('click',()=>{const q=get('explorer-query').value.trim();if(q)void explorer('/explorer/search',{q})});
reduce.addEventListener('change',()=>{if(active==='home'){heroAtRest=true;hero()}balanceMedia()});
document.addEventListener('visibilitychange',()=>{
  if(active==='home'&&document.hidden){heroAtRest=true;hero()}
  balanceMedia();
});
if(window.triumph){window.triumph.onState(view);window.triumph.snapshot().then(view).catch(()=>{});if(typeof window.triumph.watchList==='function')void watchLoad()}
hero({entry:true});
