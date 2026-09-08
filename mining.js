'use strict';

let workerUrl=null;
let coordinatorCursor=0;

function normalizeCoordinatorUrl(value){
  try{
    const url=new URL(String(value));
    if(url.username||url.password)return null;
    const local=url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname==='[::1]';
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))return null;
    url.hash='';url.search='';url.pathname=url.pathname.replace(/\/$/,'');
    return url.toString().replace(/\/$/,'');
  }catch{return null}
}
function configuredShareCoordinators(){
  const configured=window.FAE_SHARE_COORDINATORS,raw=Array.isArray(configured)?configured:typeof configured==='string'?configured.split(','):[];
  return Object.freeze([...new Set(raw.map(normalizeCoordinatorUrl).filter(Boolean))].slice(0,8));
}
const SHARE_COORDINATORS=configuredShareCoordinators();

function stopWorker(reason=''){
  if(worker){worker.terminate();worker=null}
  if(workerUrl){URL.revokeObjectURL(workerUrl);workerUrl=null}
  if(reason&&powReject){const reject=powReject;powReject=null;reject(Error(reason))}
}

function localPow(header,targetBits=Number(header?.difficulty_bits),workLabel='block'){
  if(!Number.isInteger(targetBits)||targetBits<1||targetBits>64)return Promise.reject(Error('Invalid Proof of Work target'));
  return new Promise((resolve,reject)=>{
    powReject=reject;
    const source=[
      "'use strict';",
      "const E=new TextEncoder();",
      "function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value}",
      "async function digest(value){const first=await crypto.subtle.digest('SHA-256',E.encode(JSON.stringify(canonical(value))));const second=await crypto.subtle.digest('SHA-256',first);return [...new Uint8Array(second)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}",
      "function leadingZeroBits(hash){let count=0;for(const character of hash){const value=parseInt(character,16);if(!value){count+=4;continue}if(value<2)count+=3;else if(value<4)count+=2;else if(value<8)count++;break}return count}",
      "onmessage=async event=>{const header=event.data.header,targetBits=event.data.targetBits;let nonce=Math.floor(Math.random()*1e9),attempts=0;const started=performance.now();for(;;nonce++,attempts++){const hash=await digest({...header,nonce});if(leadingZeroBits(hash)>=targetBits){postMessage({nonce,hash,attempts:attempts+1});return}if(attempts%256===0)postMessage({progress:true,attempts,rate:Math.round(attempts/Math.max(.01,(performance.now()-started)/1000))})}}"
    ].join('');
    workerUrl=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));worker=new Worker(workerUrl);
    worker.onmessage=event=>{
      if(event.data.progress){$('mstate').textContent='Mining '+workLabel+' at height '+header.height+' · '+(attemptsTotal+event.data.attempts).toLocaleString()+' hashes · '+event.data.rate.toLocaleString()+' H/s';$('mstate').className='status';return}
      powReject=null;const result=event.data;stopWorker();resolve(result);
    };
    worker.onerror=event=>{powReject=null;stopWorker();reject(Error(event.message||'Proof of Work worker failed'))};
    worker.postMessage({header,targetBits});
  });
}

async function coordinatorApi(base,path,options={}){
  let timer=null,controller=null;
  if(typeof AbortController!=='undefined'){controller=new AbortController();timer=setTimeout(()=>controller.abort(),7000)}
  try{
    const response=await fetch(base+path,{...options,signal:options.signal||controller?.signal,headers:{'content-type':'application/json',...(options.headers||{})}}),payload=await response.json().catch(()=>({}));
    if(!response.ok||payload?.ok===false){const error=new Error(payload.error||payload.reason||'Coordinator HTTP '+response.status);error.data=payload;error.status=response.status;throw error}
    return payload;
  }finally{if(timer)clearTimeout(timer)}
}

function validateShareWork(work){
  if(!work||work.ok!==true||work.workMode!=='share')throw Error('Coordinator returned invalid work mode');
  if(typeof work.jobId!=='string'||work.jobId.length<8)throw Error('Coordinator returned invalid job id');
  const header=work.header;if(!header||header.network!==NETWORK)throw Error('Coordinator work network mismatch');
  const blockBits=Number(work.blockDifficultyBits),targetBits=Number(work.targetDifficultyBits);
  if(!Number.isInteger(blockBits)||!Number.isInteger(targetBits)||blockBits!==Number(header.difficulty_bits)||targetBits<4||targetBits>blockBits)throw Error('Coordinator work difficulty mismatch');
  if(!/^[0-9a-f]{64}$/.test(String(header.previous_hash||'')))throw Error('Coordinator work tip is invalid');
  if(!/^[0-9a-f]{64}$/.test(String(work.payoutCommitment||'')))throw Error('Coordinator payout commitment is invalid');
  if(header.coinbase_mode!=='pplns-direct'||!Array.isArray(work.payouts)||!work.payouts.length)throw Error('Coordinator payout mode is invalid');
  return work;
}

async function mineCoordinatorIteration(base,rewardAddress){
  const work=validateShareWork(await coordinatorApi(base,'/work',{method:'POST',body:JSON.stringify({address:rewardAddress})}));
  const pow=await localPow(work.header,Number(work.targetDifficultyBits),'PPLNS share');
  const accepted=await coordinatorApi(base,'/share',{method:'POST',body:JSON.stringify({jobId:work.jobId,nonce:pow.nonce,hash:pow.hash})});
  if(accepted.accepted!==true||!accepted.share)throw Error('Coordinator did not accept the share');
  return{mode:accepted.block?'share-block':'share',coordinator:base,work,pow,accepted,attempts:pow.attempts||0};
}

async function mineDirectIteration(rewardAddress,{fallbackFailures=0}={}){
  const template=await api('/template?address='+encodeURIComponent(rewardAddress)),pow=await localPow(template.header,Number(template.header.difficulty_bits),'block'),submission={header:template.header,nonce:pow.nonce,hash:pow.hash,txids:template.txids||[]};
  if(Array.isArray(template.coinbase_outputs))submission.coinbase_outputs=template.coinbase_outputs;
  const accepted=await api('/submit-block',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(submission)});
  return{mode:'direct',template,pow,accepted,attempts:pow.attempts||0,fallbackFailures};
}

async function mineOneIteration(rewardAddress){
  const failures=[];
  if(SHARE_COORDINATORS.length){
    const start=coordinatorCursor%SHARE_COORDINATORS.length;
    for(let offset=0;offset<SHARE_COORDINATORS.length;offset++){
      const index=(start+offset)%SHARE_COORDINATORS.length,base=SHARE_COORDINATORS[index];
      try{const result=await mineCoordinatorIteration(base,rewardAddress);coordinatorCursor=(index+1)%SHARE_COORDINATORS.length;return result}
      catch(error){if(error?.message==='STOP')throw error;failures.push({base,error});coordinatorCursor=(index+1)%SHARE_COORDINATORS.length}
    }
  }
  return mineDirectIteration(rewardAddress,{fallbackFailures:failures.length});
}

function renderMiningControls(){$('mine').disabled=mining||!wallet;$('stop').disabled=!mining;$('copyminingaddr').disabled=!wallet}

async function miningLoop(){
  if(mining)return;
  if(!wallet){setStatus('mstate','Select a reward address before mining.','bad');return}
  const rewardAddress=wallet.address;mining=true;attemptsTotal=0;renderMiningControls();setStatus('mstate',SHARE_COORDINATORS.length?'Requesting PPLNS share work; direct PoW remains available as fallback…':'Requesting a block template for local Proof of Work…');
  try{
    while(mining){
      if(wallet?.address!==rewardAddress)throw Error('Reward address changed while mining');
      try{
        const cycle=await mineOneIteration(rewardAddress);attemptsTotal+=cycle.attempts||0;if(!mining)break;
        if(cycle.mode==='share'){
          setStatus('mstate','Share accepted · delayed PPLNS window updated · continuing…','ok');
        }else if(cycle.mode==='share-block'){
          setStatus('mstate','Won block '+cycle.accepted.block.height+' through PPLNS · block subsidy + transaction fees paid directly by coinbase · continuing…','ok');await refresh();
        }else{
          const rewardLabel=cycle.template.header.fee_atoms===undefined?'reward':'block reward + transaction fees',fallback=cycle.fallbackFailures?'Coordinator unavailable · direct PoW fallback · ':'';
          setStatus('mstate',fallback+'Won block '+cycle.accepted.height+' · '+rewardLabel+' sent directly to '+short(rewardAddress,13,7)+' · continuing…','ok');await refresh();
        }
      }catch(error){
        if(error?.message==='STOP')break;
        const errorCode=error.data?.error,reason=error.data?.reason;
        if(errorCode==='stale_tip'||reason==='stale_tip'||reason==='race_lost'||/stale/i.test(error.message||'')){setStatus('mstate','Mining work became stale. Fetching the new tip and continuing…','warn');await refresh();continue}
        throw error;
      }
    }
  }catch(error){if(mining)setStatus('mstate','Mining error: '+error.message,'bad')}
  finally{stopWorker();mining=false;renderMiningControls()}
}

function stopMining(){if(!mining)return;mining=false;stopWorker('STOP');setStatus('mstate','Mining stopped locally.');renderMiningControls()}

$('mine').addEventListener('click',miningLoop);
$('stop').addEventListener('click',stopMining);
$('copyminingaddr').addEventListener('click',()=>copyText(wallet?.address).then(()=>{setStatus('mstate','Reward address copied.','ok')}).catch(error=>setStatus('mstate',error.message,'bad')));
$('openwallet').addEventListener('click',()=>setEnvironment('wallet'));
$('refreshnetwork').addEventListener('click',()=>refresh().catch(()=>{}));

(async()=>{await loadWallet();renderWallet();const savedEnvironment=localStorage.getItem('fae-public-v4-environment');setEnvironment(savedEnvironment||(wallet?'mining':'wallet'),{remember:false});await refresh().catch(()=>{});setInterval(()=>refresh().catch(()=>{}),7000)})();
