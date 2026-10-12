'use strict';

import {createExplorerClient,EXPLORER_NETWORK,ExplorerClientError} from './api-client.mjs';

const $=id=>document.getElementById(id);
const ui={
  pill:$('network-pill'),label:$('network-label'),origin:$('api-origin'),
  binding:$('binding-pill'),deployment:$('deployment-label'),
  form:$('search-form'),input:$('search-input'),refresh:$('refresh-button'),home:$('home-button'),
  blocks:$('latest-blocks'),eyebrow:$('detail-eyebrow'),title:$('detail-title'),detail:$('detail-content'),
  notice:$('notice'),height:$('metric-height'),supply:$('metric-supply'),
  target:$('metric-target'),mempool:$('metric-mempool')
};
let client=null;

const text=v=>v===null||v===undefined||v===''?'—':String(v);
const short=(v,l=10,r=8)=>{const s=String(v||'');return s.length<=l+r+1?s:s.slice(0,l)+'…'+s.slice(-r)};
const fae=v=>{try{const n=BigInt(v??0),c=100000000n,w=n/c,f=(n%c).toString().padStart(8,'0').replace(/0+$/,'');return String(w)+(f?'.'+f:'')+' FAE'}catch{return '—'}};
const time=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?new Date(n).toLocaleString():'—'};

function el(tag,{cls='',txt='',type='',title=''}={}){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  n.textContent=String(txt);
  if(type)n.type=type;
  if(title)n.title=title;
  return n;
}
function setNet(state,label){ui.pill.dataset.state=state;ui.label.textContent=label}
function notice(message,kind='error'){ui.notice.hidden=false;ui.notice.dataset.kind=kind;ui.notice.textContent=message}
function clearNotice(){ui.notice.hidden=true;ui.notice.textContent='';ui.notice.removeAttribute('data-kind')}
function failMessage(error){
  if(error instanceof ExplorerClientError){
    if(error.code==='tip_changed_retry')return 'The chain tip changed. Reload this address for a coherent view.';
    if(error.code==='network_mismatch')return 'Network identity mismatch. The Explorer blocked this data.';
    return error.message;
  }
  return error?.message||'Unexpected Explorer error.';
}
function fail(error,{replace=true}={}){
  console.error(error);setNet('offline','Explorer unavailable');notice(failMessage(error));
  if(replace){
    const box=el('div',{cls:'empty-state'});
    box.append(el('strong',{txt:'Read blocked'}),el('span',{txt:failMessage(error)}));
    setDetail('Fail closed','Unable to render',box);
  }
}
function setDetail(eyebrow,title,content,{clearable=true}={}){
  ui.eyebrow.textContent=eyebrow;ui.title.textContent=title;ui.home.hidden=!clearable;ui.detail.replaceChildren(content);
}
function emptyDetail(){
  const box=el('div',{cls:'empty-state'});
  box.append(el('strong',{txt:'No object selected'}),el('span',{txt:'Search for a block, transaction or address.'}));
  setDetail('Explorer','Read-only chain view',box,{clearable:false});
}
function loading(label){
  const box=el('div',{cls:'empty-state'});
  box.append(el('strong',{txt:label}),el('span',{txt:'Reading independently validated node state.'}));
  setDetail('Explorer','Loading',box);
}
function cell(label,value,{wide=false,mono=false}={}){
  const root=el('div',{cls:'data-cell'+(wide?' wide':'')});
  root.append(el('span',{txt:label}),el(mono?'code':'strong',{txt:text(value)}));
  return root;
}
function route(path){location.hash='#'+path}
function matchRoute(m){
  if(m.type==='block')return '/block/'+encodeURIComponent(m.hash||m.height);
  if(m.type==='transaction')return '/tx/'+encodeURIComponent(m.txid);
  if(m.type==='address')return '/address/'+encodeURIComponent(m.address);
  return '/';
}
async function loadConfig(){
  const r=await fetch('./config.json',{method:'GET',headers:{accept:'application/json'},cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
  if(!r.ok)throw Error('Explorer config unavailable (HTTP '+r.status+').');
  const v=await r.json();
  if(v?.schema!=='FAE_EXPLORER_APP_CONFIG_V2'||v.network!==EXPLORER_NETWORK||v.read_only!==true){
    throw Error('Explorer config failed its read-only/network contract.');
  }
  if(!['LOCAL_DEV','UNBOUND','BOUND_CANDIDATE'].includes(v.binding_state))throw Error('Explorer binding state is invalid.');
  if(v.binding_state==='UNBOUND'&&v.api_base!==null)throw Error('UNBOUND Explorer must not contain an API base.');
  if(v.binding_state!=='UNBOUND'&&!v.api_base)throw Error('Bound/local Explorer config is missing its API base.');
  if(v.binding_state==='BOUND_CANDIDATE'&&new URL(v.api_base).protocol!=='https:')throw Error('Public Explorer node binding must use HTTPS.');
  return v;
}
async function refreshStatus(){
  const s=await client.status();
  ui.height.textContent=Number(s.height).toLocaleString();
  ui.supply.textContent=text(s.issued_fae)+' FAE';
  ui.target.textContent=text(s.target_seconds)+'s';
  ui.mempool.textContent=Number(s.mempool_size||0).toLocaleString();
  setNet('online','Network online');
}
function blockButton(b){
  const row=el('button',{cls:'block-row',type:'button'});
  const head=el('div',{cls:'row-head'});
  head.append(el('strong',{txt:'Block #'+b.height}),el('span',{cls:'tag confirmed',txt:b.confirmations+' conf'}));
  row.append(head,el('code',{cls:'hash-line',txt:b.hash,title:b.hash}));
  const meta=el('div',{cls:'row-meta'});meta.append(el('span',{txt:time(b.timestamp_ms)}),el('span',{txt:fae(b.reward_atoms)}));row.append(meta);
  row.addEventListener('click',()=>route('/block/'+encodeURIComponent(b.hash)));
  return row;
}
async function refreshBlocks(){
  const r=await client.blocks({limit:12});
  const rows=r.blocks.map(blockButton);
  if(!rows.length)rows.push(el('div',{cls:'empty-state',txt:'No blocks yet.'}));
  ui.blocks.replaceChildren(...rows);setNet('online','Network online');
}
async function refresh(){
  if(!client){notice('No verified HTTPS Independent Node is bound yet.','pending');return}
  clearNotice();ui.refresh.disabled=true;
  try{await Promise.all([refreshStatus(),refreshBlocks()])}catch(e){fail(e,{replace:false})}finally{ui.refresh.disabled=false}
}
function blockView(b){
  const w=el('div',{cls:'detail-stack'});
  w.append(el('h3',{cls:'detail-title',txt:'Block #'+b.height}),el('code',{cls:'detail-subtitle',txt:b.hash,title:b.hash}));
  const g=el('div',{cls:'data-grid'});
  g.append(cell('Confirmations',b.confirmations),cell('Timestamp',time(b.timestamp_ms)),cell('Reward',fae(b.reward_atoms)),cell('Difficulty bits',b.difficulty_bits),cell('Miner',b.miner_address,{wide:true,mono:true}),cell('Previous hash',b.previous_hash,{wide:true,mono:true}),cell('Nonce',b.nonce),cell('Transactions',b.txids?.length||0));
  w.append(g);
  if(b.txids?.length){
    const list=el('div',{cls:'match-list'});
    for(const id of b.txids){
      const r=el('button',{cls:'match-row',type:'button'});
      r.append(el('strong',{txt:'Transaction'}),el('code',{cls:'hash-line',txt:id,title:id}));
      r.addEventListener('click',()=>route('/tx/'+encodeURIComponent(id)));list.append(r);
    }
    w.append(list);
  }
  return w;
}
function txView(t){
  const w=el('div',{cls:'detail-stack'});
  w.append(el('h3',{cls:'detail-title',txt:'Transaction'}),el('code',{cls:'detail-subtitle',txt:t.txid,title:t.txid}));
  const g=el('div',{cls:'data-grid'});
  g.append(cell('Status',t.status),cell('Confirmations',t.confirmations),cell('Fee',fae(t.fee_atoms)),cell('Confirmed height',t.confirmed_height),cell('From',t.from_address,{wide:true,mono:true}),cell('Block hash',t.block_hash,{wide:true,mono:true}));
  w.append(g);
  if(t.outputs?.length){
    const list=el('div',{cls:'event-list'});
    t.outputs.forEach((o,i)=>{
      const r=el('div',{cls:'event-row'}),h=el('div',{cls:'row-head'});
      h.append(el('strong',{txt:'Output #'+i}),el('span',{cls:'amount-positive',txt:fae(o.amount_atoms)}));
      r.append(h,el('code',{cls:'hash-line',txt:o.address,title:o.address}));list.append(r);
    });
    w.append(list);
  }
  return w;
}
function eventRow(e,address){
  const r=el('div',{cls:'event-row'}),h=el('div',{cls:'row-head'});
  const label=e.type==='reward'?'Mining reward':e.sent?'Sent transfer':'Received transfer';
  h.append(el('strong',{txt:label}),el('span',{cls:e.type==='reward'?'tag reward':e.status==='confirmed'?'tag confirmed':'tag pending',txt:e.type==='reward'?'reward':e.status}));
  r.append(h);
  const m=el('div',{cls:'row-meta'});
  m.append(el('span',{txt:e.timestamp_ms?time(e.timestamp_ms):text(e.created_at)}),el('span',{txt:e.confirmations==null?'pending':e.confirmations+' conf'}));r.append(m);
  if(e.type==='reward')r.append(el('strong',{cls:'amount-positive',txt:'+'+fae(e.amount_atoms)}));
  else{
    const received=BigInt(e.received_atoms||0);
    if(e.sent){
      const outputs=(e.outputs||[]).reduce((s,o)=>s+BigInt(o.amount_atoms||0),0n);
      const change=(e.outputs||[]).reduce((s,o)=>s+(o.address===address?BigInt(o.amount_atoms||0):0n),0n);
      r.append(el('strong',{cls:'amount-negative',txt:'−'+fae(outputs-change+BigInt(e.fee_atoms||0))}));
    }else r.append(el('strong',{cls:'amount-positive',txt:'+'+fae(received)}));
    if(e.txid){
      const b=el('button',{cls:'text-button',type:'button',txt:'TX '+short(e.txid)});
      b.addEventListener('click',()=>route('/tx/'+encodeURIComponent(e.txid)));r.append(b);
    }
  }
  return r;
}
function addressBase(a){
  const w=el('div',{cls:'detail-stack'});
  w.append(el('h3',{cls:'detail-title',txt:'Address'}),el('code',{cls:'detail-subtitle',txt:a.address,title:a.address}));
  const g=el('div',{cls:'data-grid'});
  g.append(cell('Balance',a.balance_fae?a.balance_fae+' FAE':fae(a.balance_atoms)),cell('Events',a.total_events),cell('Observed height',a.observed_tip_height),cell('Tip',short(a.observed_tip_hash),{mono:true}));
  w.append(g);
  const list=el('div',{cls:'event-list'});list.dataset.events='1';w.append(list);return w;
}
function appendAddress(a,root){
  const list=root.querySelector('[data-events]');
  for(const e of a.events||[])list.append(eventRow(e,a.address));
  root.querySelector('[data-more]')?.remove();
  if(a.next_cursor){
    const b=el('button',{cls:'load-more',type:'button',txt:'Load more activity'});b.dataset.more='1';
    b.addEventListener('click',async()=>{
      b.disabled=true;b.textContent='Loading…';
      try{const n=await client.address({address:a.address,limit:30,cursor:a.next_cursor});appendAddress(n,root)}
      catch(e){fail(e,{replace:false});b.disabled=false;b.textContent='Retry'}
    });
    root.append(b);
  }
}
function matchesView(r){
  const w=el('div',{cls:'detail-stack'});
  w.append(el('h3',{cls:'detail-title',txt:'Search results'}),el('div',{cls:'detail-subtitle',txt:r.query}));
  const list=el('div',{cls:'match-list'});
  for(const m of r.matches||[]){
    const b=el('button',{cls:'match-row',type:'button'}),h=el('div',{cls:'row-head'});
    h.append(el('strong',{txt:m.type==='block'?'Block #'+m.height:m.type==='transaction'?'Transaction':'Address'}),el('span',{cls:'tag',txt:m.type}));
    const id=m.hash||m.txid||m.address;
    b.append(h,el('code',{cls:'hash-line',txt:id,title:id}));b.addEventListener('click',()=>route(matchRoute(m)));list.append(b);
  }
  w.append(list);return w;
}
async function show(parts){
  try{
    clearNotice();
    if(!parts.length){emptyDetail();return}
    const [kind,...tail]=parts,id=tail.join('/');
    if(kind==='block'&&id){
      loading('Loading block…');
      const r=/^[1-9]\d*$/.test(id)?await client.blockByHeight(id):await client.blockByHash(id);
      setDetail('Block','Block #'+r.block.height,blockView(r.block));return;
    }
    if(kind==='tx'&&id){
      loading('Loading transaction…');const r=await client.transaction(id);
      setDetail('Transaction',short(id,12,10),txView(r.transaction));return;
    }
    if(kind==='address'&&id){
      loading('Loading address…');const r=await client.address({address:id,limit:30,cursor:null}),w=addressBase(r);
      appendAddress(r,w);setDetail('Address',short(id,12,10),w);return;
    }
    if(kind==='search'&&id){
      loading('Searching…');const r=await client.search(id);
      if(r.matches?.length===1){route(matchRoute(r.matches[0]));return}
      setDetail('Search',(r.matches?.length||0)+' matches',matchesView(r));return;
    }
    notice('Unknown Explorer route.');emptyDetail();
  }catch(e){fail(e)}
}
function currentRoute(){
  const raw=(location.hash||'#/').replace(/^#/,'').split('?')[0];
  return raw.split('/').filter(Boolean).map(x=>{try{return decodeURIComponent(x)}catch{return x}});
}
function renderUnbound(config){
  client=null;
  setNet('connecting','Node binding pending');
  ui.binding.textContent='Unbound';
  ui.deployment.textContent=config.deployment_state;
  ui.origin.textContent='API: unbound';
  ui.input.disabled=true;
  ui.form.querySelector('button[type="submit"]').disabled=true;
  ui.refresh.disabled=true;
  ui.blocks.replaceChildren(el('div',{cls:'empty-state',txt:'No verified Independent Node is bound.'}));
  const box=el('div',{cls:'empty-state'});
  box.append(
    el('strong',{txt:'Public frontend prebind'}),
    el('span',{txt:'This Explorer is public, but chain queries remain disabled until an eligible HTTPS Independent Node is verified and bound.'})
  );
  setDetail('Deployment','Node binding pending',box,{clearable:false});
  notice('Frontend deployment is non-authoritative and intentionally unbound. No chain data is being presented.','pending');
}
async function bootstrap(){
  setNet('connecting','Connecting…');
  try{
    const c=await loadConfig();
    ui.deployment.textContent=c.deployment_state;
    if(c.binding_state==='UNBOUND'){renderUnbound(c);return}
    client=createExplorerClient({apiBase:c.api_base,expectedNetwork:c.network});
    ui.binding.textContent=c.binding_state==='LOCAL_DEV'?'Local dev':'Bound candidate';
    ui.origin.textContent='API: '+new URL(client.apiBase).origin;
    await refresh();await show(currentRoute());
  }catch(e){fail(e)}
}

ui.form.addEventListener('submit',e=>{
  e.preventDefault();
  if(!client){notice('Search is disabled until a verified HTTPS Independent Node is bound.','pending');return}
  const q=ui.input.value.trim();
  if(!q){notice('Enter a block height, hash, TXID or FAE address.');return}
  route('/search/'+encodeURIComponent(q));
});
ui.refresh.addEventListener('click',refresh);
ui.home.addEventListener('click',()=>route('/'));
window.addEventListener('hashchange',()=>client?show(currentRoute()):undefined);
bootstrap();
