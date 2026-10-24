'use strict';

const API='https://wfwwotuhectwknvbvgif.supabase.co/functions/v1/fae-public-testnet-v4';
const NETWORK='fairyelf-public-testnet-v4';
const HRP='faet';
const CS='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const K=0x2bc830a3;
const E=new TextEncoder();
const $=id=>document.getElementById(id);

function setNetworkStatus(state){
  if(window.FAENetworkStatus)return window.FAENetworkStatus.set(state);
  const labels={connecting:'Connecting…',online:'Network online',offline:'Network offline'};
  const root=$('netstatus');
  if(root){
    root.dataset.state=state;
    const label=root.querySelector?.('[data-network-label]')||root.lastElementChild;
    if(label)label.textContent=labels[state];
  }
  return state;
}

let walletAccount=null;
let wallet=null;
let worker=null;
let powReject=null;
let mining=false;
let attemptsTotal=0;
let refreshPromise=null;

function b64(bytes){
  let value='';
  for(const byte of new Uint8Array(bytes))value+=String.fromCharCode(byte);
  return btoa(value);
}

function fb(value){
  return Uint8Array.from(atob(value),character=>character.charCodeAt(0));
}

async function sh(bytes){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
}

function polymod(values){
  const generators=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];
  let checksum=1;
  for(const value of values){
    const top=checksum>>>25;
    checksum=((checksum&0x1ffffff)<<5)^value;
    for(let i=0;i<5;i++)if((top>>>i)&1)checksum^=generators[i];
  }
  return checksum>>>0;
}

function hrpExpand(hrp){
  return [...hrp].map(character=>character.charCodeAt(0)>>>5)
    .concat([0],[...hrp].map(character=>character.charCodeAt(0)&31));
}

function convertBits(data,fromBits,toBits,pad=true){
  let accumulator=0;
  let bitCount=0;
  const result=[];
  const mask=(1<<toBits)-1;
  const maxAccumulator=(1<<(fromBits+toBits-1))-1;
  for(const value of data){
    accumulator=((accumulator<<fromBits)|value)&maxAccumulator;
    bitCount+=fromBits;
    while(bitCount>=toBits){
      bitCount-=toBits;
      result.push((accumulator>>>bitCount)&mask);
    }
  }
  if(pad&&bitCount)result.push((accumulator<<(toBits-bitCount))&mask);
  return result;
}

function address(publicKeyHash){
  const data=convertBits(publicKeyHash,8,5);
  const values=[...hrpExpand(HRP),...data,0,0,0,0,0,0];
  const checksum=(polymod(values)^K)>>>0;
  const suffix=Array.from({length:6},(_,index)=>(checksum>>>(5*(5-index)))&31);
  return HRP+'1'+[...data,...suffix].map(value=>CS[value]).join('');
}

function validAddr(value){
  try{
    if(typeof value!=='string'||value.length>90||value!==value.toLowerCase())return false;
    const separator=value.lastIndexOf('1');
    const values=[...value.slice(separator+1)].map(character=>CS.indexOf(character));
    if(value.slice(0,separator)!==HRP||values.some(item=>item<0)||polymod([...hrpExpand(HRP),...values])!==K)return false;
    const data=values.slice(0,-6);
    let accumulator=0;
    let bitCount=0;
    let byteCount=0;
    for(const item of data){
      accumulator=(accumulator<<5)|item;
      bitCount+=5;
      while(bitCount>=8){
        bitCount-=8;
        byteCount++;
        accumulator&=(1<<Math.min(bitCount+8,30))-1;
      }
    }
    return byteCount===20;
  }catch{
    return false;
  }
}

async function api(path,options){
  const response=await fetch(API+path,options);
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(payload.error||payload.reason||'HTTP '+response.status);
    error.data=payload;
    throw error;
  }
  return payload;
}

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  }
  return value;
}

function stable(value){
  return JSON.stringify(canonical(value));
}

function parseAmt(value){
  const match=/^(\d+)(?:\.(\d{1,8}))?$/.exec(String(value).trim());
  if(!match)throw Error('Amount must have at most 8 decimals');
  return BigInt(match[1])*100000000n+BigInt((match[2]||'').padEnd(8,'0')||'0');
}

function txPayload(transaction){
  return{
    domain:'FAIRYELF_TX_V2',
    network:transaction.network,
    inputs:transaction.inputs,
    outputs:transaction.outputs,
    public_key_spki:transaction.public_key_spki
  };
}

function clearElement(element){
  while(element.firstChild)element.removeChild(element.firstChild);
}

function short(value,start=16,end=8){
  const text=String(value||'');
  if(text.length<=start+end+1)return text;
  return text.slice(0,start)+'…'+text.slice(-end);
}

function readableTime(timestamp){
  if(!timestamp)return '';
  const numeric=Number(timestamp);
  const date=new Date(numeric<1e12?numeric*1000:numeric);
  if(Number.isNaN(date.getTime()))return '';
  return date.toLocaleString(undefined,{dateStyle:'short',timeStyle:'short'});
}

function formatAtoms(atoms){
  const value=BigInt(atoms||0);
  const whole=value/100000000n;
  const fraction=(value%100000000n).toString().padStart(8,'0').replace(/0+$/,'');
  return whole.toString()+(fraction?'.'+fraction:'')+' FAE';
}

function appendEmpty(container,message){
  clearElement(container);
  const empty=document.createElement('div');
  empty.className='empty';
  empty.textContent=message;
  container.append(empty);
}

function renderWalletHistory(transactions,addressValue){
  const container=$('txhist');
  const list=Array.isArray(transactions)?transactions:[];
  if(!list.length){
    appendEmpty(container,'No transactions for this address.');
    return;
  }
  clearElement(container);
  for(const transaction of list){
    const row=document.createElement('div');
    row.className='transaction-row';
    const left=document.createElement('div');
    const title=document.createElement('div');
    title.className='transaction-title';
    const sent=transaction.from_address===addressValue;
    title.textContent=(sent?'Sent':'Received')+' · '+short(transaction.txid,18,8);
    const meta=document.createElement('div');
    meta.className='transaction-meta mono';
    const parts=[transaction.status==='confirmed'?'Confirmed':'Pending'];
    if(transaction.confirmed_height)parts.push('block '+transaction.confirmed_height);
    const time=readableTime(transaction.timestamp_ms||transaction.created_at);
    if(time)parts.push(time);
    meta.textContent=parts.join(' · ');
    left.append(title,meta);
    const state=document.createElement('div');
    state.className='right '+(transaction.status==='confirmed'?'ok':'warn');
    state.textContent=transaction.status==='confirmed'?'✓':'…';
    row.append(left,state);
    container.append(row);
  }
}

function renderRecentNetwork(state){
  const blocks=Array.isArray(state?.recent)?state.recent:[];
  const transfers=[];
  for(const block of blocks){
    const txids=Array.isArray(block.txids)?block.txids:[];
    for(const txid of txids)transfers.push({txid,block});
  }

  const txContainer=$('recenttx');
  if(!transfers.length){
    appendEmpty(txContainer,blocks.length?'No transfers in the latest blocks. Mining rewards are block events, shown below.':'No recent network activity.');
  }else{
    clearElement(txContainer);
    for(const item of transfers.slice(0,12)){
      const row=document.createElement('div');
      row.className='transaction-row';
      const left=document.createElement('div');
      const title=document.createElement('div');
      title.className='transaction-title';
      title.textContent='Transfer · '+short(item.txid,18,8);
      const meta=document.createElement('div');
      meta.className='transaction-meta';
      meta.textContent='Included in block '+item.block.height;
      left.append(title,meta);
      const time=document.createElement('div');
      time.className='transaction-meta right';
      time.textContent=readableTime(item.block.timestamp_ms);
      row.append(left,time);
      txContainer.append(row);
    }
  }

  const blockContainer=$('recentblocks');
  if(!blocks.length){
    appendEmpty(blockContainer,'No recent blocks.');
    return;
  }
  clearElement(blockContainer);
  for(const block of blocks.slice(0,6)){
    const row=document.createElement('div');
    row.className='block-row';
    const left=document.createElement('div');
    const title=document.createElement('div');
    title.className='transaction-title';
    title.textContent='Block '+block.height+' · '+formatAtoms(block.reward_atoms);
    const meta=document.createElement('div');
    meta.className='transaction-meta mono';
    meta.textContent='Miner '+short(block.miner_address,13,7)+' · '+(block.txids?.length||0)+' transfer'+((block.txids?.length||0)===1?'':'s');
    left.append(title,meta);
    const time=document.createElement('div');
    time.className='transaction-meta right';
    time.textContent=readableTime(block.timestamp_ms);
    row.append(left,time);
    blockContainer.append(row);
  }
}

function setEnvironment(name,{remember=true}={}){
  const selected=name==='mining'?'mining':'wallet';
  for(const environment of ['mining','wallet']){
    const active=environment===selected;
    const tab=$('tab-'+environment);
    const panel=$('panel-'+environment);
    tab.setAttribute('aria-selected',String(active));
    tab.tabIndex=active?0:-1;
    panel.hidden=!active;
  }
  if(remember)localStorage.setItem('fae-public-v4-environment',selected);
}

function bindEnvironmentTabs(){
  for(const environment of ['mining','wallet']){
    $('tab-'+environment).addEventListener('click',()=>setEnvironment(environment));
    $('tab-'+environment).addEventListener('keydown',event=>{
      if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
      event.preventDefault();
      const target=environment==='mining'?'wallet':'mining';
      setEnvironment(target);
      $('tab-'+target).focus();
    });
  }
}

async function refreshNow(){
  const networkResults=await Promise.allSettled([api('/status'),api('/state')]);
  const statusResult=networkResults[0];
  const stateResult=networkResults[1];

  if(statusResult.status==='rejected')throw statusResult.reason;
  const status=statusResult.value;
  $('height').textContent=status.height;
  $('issued').textContent=status.issued_fae+' / '+Number(status.max_supply_fae).toLocaleString('en-US')+' FAE';
  const era=Math.floor(Number(status.height)/Number(status.halving_era_blocks||600000));
  const reward=10/(2**era);
  $('reward').textContent=(reward>=1?reward.toLocaleString('en-US',{maximumFractionDigits:8}):reward.toFixed(8).replace(/0+$/,'').replace(/\.$/,''))+' FAE';
  $('difficulty').textContent=status.difficulty_bits+' bits';
  $('runtime').textContent='PUBLIC TESTNET ONLINE · node v'+(status.node_version||'?')+' · height '+status.height;
  $('runtime').className='status ok';
  setNetworkStatus('online');

  if(stateResult.status==='fulfilled')renderRecentNetwork(stateResult.value);

  if(!wallet){
    $('bal').textContent='0 FAE';
    $('ustate').textContent='Select or create a wallet.';
    renderWalletHistory([],null);
    return status;
  }

  const requestedAddress=wallet.address;
  const accountResults=await Promise.allSettled([
    api('/balance?address='+encodeURIComponent(requestedAddress)),
    api('/spendable?address='+encodeURIComponent(requestedAddress)),
    api('/transactions?address='+encodeURIComponent(requestedAddress))
  ]);
  if(wallet?.address!==requestedAddress)return status;

  if(accountResults[0].status==='fulfilled'){
    $('bal').textContent=accountResults[0].value.balance_fae+' FAE';
  }
  if(accountResults[0].status==='fulfilled'&&accountResults[1].status==='fulfilled'){
    $('ustate').textContent='Confirmed '+accountResults[0].value.balance_fae+' FAE · spendable including pending change '+accountResults[1].value.spendable_fae+' FAE';
  }else{
    $('ustate').textContent='Could not refresh this address balance.';
  }
  if(accountResults[2].status==='fulfilled'){
    renderWalletHistory(accountResults[2].value.transactions,requestedAddress);
  }else{
    appendEmpty($('txhist'),'Could not load transaction history.');
  }
  return status;
}

function refresh(){
  if(refreshPromise)return refreshPromise;
  if($('netstatus')?.dataset.state!=='online')setNetworkStatus('connecting');
  refreshPromise=refreshNow().catch(error=>{
    $('runtime').textContent='Network error: '+error.message;
    $('runtime').className='status bad';
    setNetworkStatus('offline');
    throw error;
  }).finally(()=>{refreshPromise=null});
  return refreshPromise;
}

bindEnvironmentTabs();
