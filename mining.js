'use strict';

let workerUrl=null;

function stopWorker(reason=''){
  if(worker){
    worker.terminate();
    worker=null;
  }
  if(workerUrl){
    URL.revokeObjectURL(workerUrl);
    workerUrl=null;
  }
  if(reason&&powReject){
    const reject=powReject;
    powReject=null;
    reject(Error(reason));
  }
}

function localPow(header){
  return new Promise((resolve,reject)=>{
    powReject=reject;
    const source=[
      "'use strict';",
      "const E=new TextEncoder();",
      "function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value}",
      "async function digest(value){const first=await crypto.subtle.digest('SHA-256',E.encode(JSON.stringify(canonical(value))));const second=await crypto.subtle.digest('SHA-256',first);return [...new Uint8Array(second)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}",
      "function leadingZeroBits(hash){let count=0;for(const character of hash){const value=parseInt(character,16);if(!value){count+=4;continue}if(value<2)count+=3;else if(value<4)count+=2;else if(value<8)count++;break}return count}",
      "onmessage=async event=>{let nonce=Math.floor(Math.random()*1e9),attempts=0;const started=performance.now();for(;;nonce++,attempts++){const hash=await digest({...event.data,nonce});if(leadingZeroBits(hash)>=event.data.difficulty_bits){postMessage({nonce,hash,attempts:attempts+1});return}if(attempts%256===0)postMessage({progress:true,attempts,rate:Math.round(attempts/Math.max(.01,(performance.now()-started)/1000))})}}"
    ].join('');
    workerUrl=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    worker=new Worker(workerUrl);
    worker.onmessage=event=>{
      if(event.data.progress){
        $('mstate').textContent='Mining height '+header.height+' · '+(attemptsTotal+event.data.attempts).toLocaleString()+' hashes · '+event.data.rate.toLocaleString()+' H/s';
        $('mstate').className='status';
        return;
      }
      powReject=null;
      const result=event.data;
      stopWorker();
      resolve(result);
    };
    worker.onerror=event=>{
      powReject=null;
      stopWorker();
      reject(Error(event.message||'Proof of Work worker failed'));
    };
    worker.postMessage(header);
  });
}

function renderMiningControls(){
  $('mine').disabled=mining||!wallet;
  $('stop').disabled=!mining;
  $('copyminingaddr').disabled=!wallet;
}

async function miningLoop(){
  if(mining)return;
  if(!wallet){
    setStatus('mstate','Select a reward address before mining.','bad');
    return;
  }
  const rewardAddress=wallet.address;
  mining=true;
  attemptsTotal=0;
  renderMiningControls();
  setStatus('mstate','Requesting a block template for local Proof of Work…');
  try{
    while(mining){
      if(wallet?.address!==rewardAddress)throw Error('Reward address changed while mining');
      const template=await api('/template?address='+encodeURIComponent(rewardAddress));
      const result=await localPow(template.header);
      attemptsTotal+=result.attempts||0;
      if(!mining)break;
      try{
        const submission={
          header:template.header,
          nonce:result.nonce,
          hash:result.hash,
          txids:template.txids||[]
        };
        if(Array.isArray(template.coinbase_outputs))submission.coinbase_outputs=template.coinbase_outputs;
        const accepted=await api('/submit-block',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify(submission)
        });
        const rewardLabel=template.header.fee_atoms===undefined?'reward':'block reward + transaction fees';
        setStatus('mstate','Won block '+accepted.height+' · '+rewardLabel+' sent directly to '+short(rewardAddress,13,7)+' · continuing…','ok');
        await refresh();
      }catch(error){
        const errorCode=error.data?.error;
        const reason=error.data?.reason;
        if(errorCode==='stale_tip'||reason==='stale_tip'||reason==='race_lost'){
          setStatus('mstate','Another miner won that height. Fetching the new tip and continuing…','warn');
          await refresh();
          continue;
        }
        throw error;
      }
    }
  }catch(error){
    if(mining)setStatus('mstate','Mining error: '+error.message,'bad');
  }finally{
    stopWorker();
    mining=false;
    renderMiningControls();
  }
}

function stopMining(){
  if(!mining)return;
  mining=false;
  stopWorker('STOP');
  setStatus('mstate','Mining stopped locally.');
  renderMiningControls();
}

$('mine').addEventListener('click',miningLoop);
$('stop').addEventListener('click',stopMining);
$('copyminingaddr').addEventListener('click',()=>copyText(wallet?.address).then(()=>{
  setStatus('mstate','Reward address copied.','ok');
}).catch(error=>setStatus('mstate',error.message,'bad')));
$('openwallet').addEventListener('click',()=>setEnvironment('wallet'));
$('refreshnetwork').addEventListener('click',()=>refresh().catch(()=>{}));

(async()=>{
  await loadWallet();
  renderWallet();
  const savedEnvironment=localStorage.getItem('fae-public-v4-environment');
  setEnvironment(savedEnvironment||(wallet?'mining':'wallet'),{remember:false});
  await refresh().catch(()=>{});
  setInterval(()=>refresh().catch(()=>{}),7000);
})();
