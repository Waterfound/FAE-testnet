'use strict';
// DFR-05 candidate slice: public reads AFTER verified local-vault identity.
// No signing, sending, key access, invented transaction history or implicit mutation.
(function(){
  const BASE='https://wfwwotuhectwknvbvgif.supabase.co/functions/v1/fae-public-testnet-v4';
  const NETWORK='fairyelf-public-testnet-v4';
  let epoch=0;
  let pending=null;
  const $=selector=>document.querySelector(selector);
  const unavailable=()=>{
    const field=$('.balance-value strong');if(field)field.textContent='—';
    const sub=$('.balance-sub');if(sub)sub.textContent='Balance unavailable · no verified network response';
    const reference=$('.reference-data');if(reference)reference.textContent='HISTORY UNAVAILABLE';
    const activity=$('.activity-list .list-head span');if(activity)activity.textContent='HISTORY UNAVAILABLE';
    const strip=$('.flow-strip');if(strip)strip.textContent='No verified movement data';
    const caption=document.getElementById('flowCaption');if(caption)caption.textContent='Network not verified';
    const count=$('.flow-foot span:first-child');if(count)count.textContent='—';
    const list=$('.activity-list');
    if(list)for(const row of list.querySelectorAll('.activity-row'))row.remove();
  };
  function amount(value){
    const text=String(value);
    if(!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(text))throw Error('Invalid response amount');
    if(!Number.isFinite(Number(text))||Number(text)>12050000)throw Error('Unexpected balance outside configured bounds');
    return text;
  }
  function formatAtoms(atoms){
    const n=BigInt(atoms);
    const whole=n/100000000n;
    const fraction=(n%100000000n).toString().padStart(8,'0').replace(/0+$/,'');
    return whole.toString()+(fraction?'.'+fraction:'')+' FAE';
  }
  function drawHistory(normalized,address){
    const rows=normalized.transactions;
    const reference=$('.reference-data');
    const title=$('.activity-list .list-head span');
    const strip=$('.flow-strip');
    const foot=$('.flow-foot span:first-child');
    const caption=document.getElementById('flowCaption');
    const list=$('.activity-list');
    if(reference)reference.textContent='RECENT · BOUNDED SOURCE';
    if(title)title.textContent='RECENT · NOT LIFETIME';
    if(foot)foot.textContent=rows.length+' verified recent transfer'+(rows.length===1?'':'s');
    if(caption)caption.textContent=rows.length?'Selected address · recent activity':'No transfers in available recent coverage';
    if(strip){
      strip.replaceChildren();
      if(!rows.length)strip.textContent='No transfers in available recent coverage';
      for(const tx of rows.slice(0,12)){
        const mark=document.createElement('div');
        mark.className='flow-mark status-'+(tx.status.kind==='confirmed'?'confirmed':tx.status.kind==='pending'?'pending':'unknown');
        const line=document.createElement('span');line.className='flow-inner';
        mark.append(line);mark.title=tx.direction+' / '+tx.status.kind;
        strip.append(mark);
      }
    }
    if(!list)return;
    for(const row of list.querySelectorAll('.activity-row'))row.remove();
    for(const tx of rows.slice(0,8)){
      const row=document.createElement('div');row.className='activity-row';
      const descriptor=document.createElement('div');descriptor.className='activity-title';
      const label=document.createElement('b');label.textContent=tx.direction==='received'?'Received':tx.direction==='sent'?'Sent':tx.direction==='self'?'Self transfer':'Transfer';
      const sub=document.createElement('small');sub.textContent=tx.status.kind+' · '+tx.txid.slice(0,12)+'…';
      descriptor.append(label,sub);
      const size=document.createElement('strong');
      const atomList=tx.outputs.filter(out=>tx.direction==='sent'?out.address!==address:out.address===address);
      const atoms=atomList.reduce((sum,out)=>sum+BigInt(out.amount_atoms),0n);
      size.textContent=(tx.direction==='received'?'+':tx.direction==='sent'?'−':'')+formatAtoms(atoms);
      row.append(descriptor,size);list.append(row);
    }
  }
  async function getJson(path,signal){
    const response=await fetch(BASE+path,{signal,method:'GET',cache:'no-store'});
    if(!response.ok)throw Error('Unverified HTTP response');
    return response.json();
  }
  async function refresh(address){
    const ticket=++epoch;
    if(pending)pending.abort();
    const ctl=new AbortController();pending=ctl;
    const guard=()=>ticket===epoch&&!ctl.signal.aborted;
    unavailable();
    if(typeof address!=='string'||!/^faet1[a-z0-9]{12,}$/.test(address))return false;
    const header=$('.balance-label');if(header)header.textContent='Confirmed balance';
    try{
      // The FAE public API is the same exact endpoint as the legacy verified Wallet.
      const status=await getJson('/status',ctl.signal);
      if(!guard())return false;
      if(!status||!Number.isSafeInteger(Number(status.height))||Number(status.height)<0
        ||(status.network&&status.network!==NETWORK))throw Error('Network identity or height invalid');
      const responses=await Promise.allSettled([
        getJson('/balance?address='+encodeURIComponent(address),ctl.signal),
        getJson('/transactions?address='+encodeURIComponent(address),ctl.signal)
      ]);
      if(!guard())return false;
      if(responses[0].status==='fulfilled'){
        try{
          const balance=amount(responses[0].value?.balance_fae);
          const figure=$('.balance-value strong');if(figure)figure.textContent=balance;
          const sub=$('.balance-sub');if(sub)sub.textContent='Confirmed · public testnet · height '+String(status.height);
        }catch{
          const sub=$('.balance-sub');if(sub)sub.textContent='Balance response could not be verified';
        }
      }
      if(responses[1].status==='fulfilled'){
        const normalizer=window.FAEWalletTransactions?.normalizeHistoryPayload;
        const parsed=typeof normalizer==='function'
          ?normalizer(responses[1].value,address)
          :{state:'invalid_payload'};
        if(parsed.state==='ready_recent'||parsed.state==='empty_within_available_coverage'){
          drawHistory(parsed,address);
        }
      }
      return true;
    }catch{
      if(guard())unavailable();
      return false;
    }finally{
      if(pending===ctl)pending=null;
    }
  }
  function invalidate(){
    ++epoch;if(pending)pending.abort();pending=null;unavailable();
  }
  window.FAEStudioChainRead=Object.freeze({refresh,invalidate});
})();
