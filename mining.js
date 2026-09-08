'use strict';

let workerUrl=null;
let coordinatorCursor=0;
const coordinatorHealth=new Map();
const coordinatorIdentityByBase=new Map();
const coordinatorProofHistory=new Map();
const MAX_COORDINATORS=8;
const MAX_PROTOCOL_BACKOFF_MS=5*60_000;
const MAX_EQUIVOCATION_BACKOFF_MS=30*60_000;

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
  return Object.freeze([...new Set(raw.map(normalizeCoordinatorUrl).filter(Boolean))].slice(0,MAX_COORDINATORS));
}
const SHARE_COORDINATORS=configuredShareCoordinators();

function protocolError(message,code='COORDINATOR_PROTOCOL'){const error=new Error(message);error.code=code;return error}
function bytesHex(bytes){return[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
async function hashCanonicalHex(value){const first=await sh(E.encode(stable(value))),second=await sh(first);return bytesHex(second)}
function coordinatorState(base){if(!coordinatorHealth.has(base))coordinatorHealth.set(base,{failures:0,retryAt:0,lastError:null});return coordinatorHealth.get(base)}
function coordinatorAvailable(base){return Date.now()>=coordinatorState(base).retryAt}
function markCoordinatorSuccess(base){coordinatorHealth.set(base,{failures:0,retryAt:0,lastError:null})}
function markCoordinatorFailure(base,error){
  const previous=coordinatorState(base),failures=previous.failures+1;
  let delay=Math.min(60_000,1000*(2**Math.min(6,failures-1)));
  if(error?.code==='COORDINATOR_PROTOCOL')delay=MAX_PROTOCOL_BACKOFF_MS;
  if(error?.code==='COORDINATOR_EQUIVOCATION')delay=MAX_EQUIVOCATION_BACKOFF_MS;
  coordinatorHealth.set(base,{failures,retryAt:Date.now()+delay,lastError:String(error?.message||error)});
}
function saveEquivocationEvidence(evidence){
  try{
    const key='fae-coordinator-equivocation-v1',current=JSON.parse(localStorage.getItem(key)||'[]'),next=[...current,evidence].slice(-4);localStorage.setItem(key,JSON.stringify(next));
  }catch{}
}

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
    if(!response.ok||payload?.ok===false){const error=new Error(payload.error||payload.reason||'Coordinator HTTP '+response.status);error.data=payload;error.status=response.status;error.code='COORDINATOR_HTTP';throw error}
    return payload;
  }finally{if(timer)clearTimeout(timer)}
}

function normalizeWeights(weights){
  if(!Array.isArray(weights)||weights.length<1||weights.length>256)throw protocolError('Coordinator returned invalid PPLNS weights');
  let previous='';
  return weights.map((entry,index)=>{
    const address=String(entry?.address||''),weightText=String(entry?.weight??'');
    if(!validAddr(address)||!/^\d+$/.test(weightText)||BigInt(weightText)<=0n)throw protocolError('Coordinator returned invalid PPLNS weight');
    if(index&&address<=previous)throw protocolError('Coordinator PPLNS weights are not uniquely sorted');previous=address;
    return{address,weight:BigInt(weightText)};
  });
}
function allocateExpectedPayouts(total,weights){
  const totalWeight=weights.reduce((sum,row)=>sum+row.weight,0n);let allocated=0n;
  return weights.map((row,index)=>{const amount=index===weights.length-1?total-allocated:(total*row.weight)/totalWeight;allocated+=amount;return{address:row.address,amount_atoms:amount.toString()}}).filter(row=>BigInt(row.amount_atoms)>0n);
}

async function verifyCoordinatorWorkProof(work){
  const envelope=work?.workProof;
  if(!envelope||envelope.domain!=='FAIRYELF_AUTH_V1'||envelope.version!==1||envelope.kind!=='coordinator-work')throw protocolError('Coordinator work is missing a valid signed receipt');
  if(!envelope.signer?.id||!envelope.signer?.publicKey||!envelope.signature)throw protocolError('Coordinator work receipt is incomplete');
  let publicKeyBytes,signatureBytes,key;
  try{publicKeyBytes=fb(envelope.signer.publicKey);signatureBytes=fb(envelope.signature);const derivedId=bytesHex(await sh(publicKeyBytes));if(derivedId!==envelope.signer.id)throw protocolError('Coordinator work signer id mismatch');key=await crypto.subtle.importKey('spki',publicKeyBytes,{name:'Ed25519'},false,['verify'])}catch(error){if(error?.code)throw error;throw protocolError('Coordinator work signer key is invalid')}
  const issued=Date.parse(envelope.issuedAt),age=Date.now()-issued;if(!Number.isFinite(issued)||age>10*60_000||age<-60_000)throw protocolError('Coordinator work receipt timestamp is invalid');
  const {signature,...signed}=envelope,verified=await crypto.subtle.verify({name:'Ed25519'},key,signatureBytes,E.encode(stable(signed)));if(!verified)throw protocolError('Coordinator work receipt signature is invalid');
  const payload=envelope.payload;
  if(!payload||payload.proofVersion!==1||payload.coordinatorId!==envelope.signer.id||payload.coordinatorId!==work.coordinatorId)throw protocolError('Coordinator work receipt identity mismatch');
  if(payload.network!==NETWORK||payload.jobId!==work.jobId||Number(payload.height)!==Number(work.header?.height)||payload.previousHash!==work.header?.previous_hash)throw protocolError('Coordinator work receipt chain binding mismatch');
  if(Number(payload.blockDifficultyBits)!==Number(work.blockDifficultyBits)||Number(payload.targetDifficultyBits)!==Number(work.targetDifficultyBits)||payload.payoutCommitment!==work.payoutCommitment)throw protocolError('Coordinator work receipt target binding mismatch');
  if(payload.expiresAt!==work.expiresAt||stable(payload.ledgerState)!==stable(work.ledgerState)||stable(payload.pplnsWeights)!==stable(work.pplnsWeights))throw protocolError('Coordinator work receipt ledger binding mismatch');
  if(payload.weightsCommitment!==work.weightsCommitment||payload.templateCommitment!==work.templateCommitment)throw protocolError('Coordinator work receipt commitment mismatch');
  return{signerId:envelope.signer.id,envelope,payload};
}

function rememberCoordinatorProof(base,work,verified){
  const priorIdentity=coordinatorIdentityByBase.get(base);if(priorIdentity&&priorIdentity!==verified.signerId)throw protocolError('Coordinator identity changed during this mining session');coordinatorIdentityByBase.set(base,verified.signerId);
  const ledger=work.ledgerState||{},key=[verified.signerId,NETWORK,work.header.height,work.header.previous_hash,ledger.totalShares,ledger.lastEntryHash].join('|'),existing=coordinatorProofHistory.get(key);
  if(existing&&existing.payload.weightsCommitment!==verified.payload.weightsCommitment){const evidence={detectedAt:new Date().toISOString(),base,key,first:existing.envelope,second:verified.envelope};saveEquivocationEvidence(evidence);const error=protocolError('Coordinator ledger-weight equivocation detected','COORDINATOR_EQUIVOCATION');error.evidence=evidence;throw error}
  coordinatorProofHistory.set(key,verified);
}

async function validateShareWork(work,base){
  if(!work||work.ok!==true||work.workMode!=='share')throw protocolError('Coordinator returned invalid work mode');
  if(typeof work.jobId!=='string'||work.jobId.length<8)throw protocolError('Coordinator returned invalid job id');
  const header=work.header;if(!header||header.network!==NETWORK)throw protocolError('Coordinator work network mismatch');
  const blockBits=Number(work.blockDifficultyBits),targetBits=Number(work.targetDifficultyBits);
  if(!Number.isInteger(blockBits)||!Number.isInteger(targetBits)||blockBits!==Number(header.difficulty_bits)||targetBits<4||targetBits>blockBits)throw protocolError('Coordinator work difficulty mismatch');
  if(!/^[0-9a-f]{64}$/.test(String(header.previous_hash||'')))throw protocolError('Coordinator work tip is invalid');
  const expires=Date.parse(work.expiresAt);if(!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+10*60_000)throw protocolError('Coordinator work expiry is invalid');
  if(header.coinbase_mode!=='pplns-direct')throw protocolError('Coordinator payout mode is invalid');
  const payouts=Array.isArray(work.payouts)?work.payouts:null,outputs=Array.isArray(work.coinbase_outputs)?work.coinbase_outputs:null;if(!payouts||!outputs||!payouts.length||payouts.length>256||stable(payouts)!==stable(outputs))throw protocolError('Coordinator payout/output mismatch');
  const weights=normalizeWeights(work.pplnsWeights),weightsForHash=weights.map(row=>({address:row.address,weight:row.weight.toString()})),weightsCommitment=await hashCanonicalHex(weightsForHash);if(weightsCommitment!==work.weightsCommitment)throw protocolError('Coordinator weight commitment mismatch');
  let subsidy,fees;try{subsidy=BigInt(header.reward_atoms);fees=BigInt(header.fee_atoms??0)}catch{throw protocolError('Coordinator reward/fee values are invalid')}if(subsidy<0n||fees<0n)throw protocolError('Coordinator reward/fee values are invalid');
  const expected=allocateExpectedPayouts(subsidy+fees,weights);if(stable(expected)!==stable(payouts))throw protocolError('Coordinator payout does not match signed PPLNS weights');
  let payoutTotal=0n,previousAddress='';for(const [index,row] of payouts.entries()){const address=String(row?.address||''),amount=String(row?.amount_atoms??'');if(!validAddr(address)||!/^\d+$/.test(amount)||BigInt(amount)<=0n)throw protocolError('Coordinator payout output is invalid');if(index&&address<=previousAddress)throw protocolError('Coordinator payout outputs are not uniquely sorted');previousAddress=address;payoutTotal+=BigInt(amount)}if(payoutTotal!==subsidy+fees)throw protocolError('Coordinator payout total is not subsidy plus fees');
  const payoutCommitment=await hashCanonicalHex(payouts);if(payoutCommitment!==work.payoutCommitment||payoutCommitment!==header.coinbase_root)throw protocolError('Coordinator payout commitment mismatch');if(Number(header.coinbase_count)!==payouts.length||header.miner_address!==payouts[0].address)throw protocolError('Coordinator coinbase metadata mismatch');
  const txids=Array.isArray(work.txids)?work.txids.map(String):[];if(txids.length>20||txids.some(id=>!/^[0-9a-f]{64}$/.test(id))||Number(header.tx_count)!==txids.length||header.tx_root!==await hashCanonicalHex(txids))throw protocolError('Coordinator transaction commitment mismatch');
  const templateCommitment=await hashCanonicalHex({header,txids,payouts,coinbase_outputs:outputs});if(templateCommitment!==work.templateCommitment)throw protocolError('Coordinator template commitment mismatch');
  const verified=await verifyCoordinatorWorkProof(work);rememberCoordinatorProof(base,work,verified);return work;
}

async function mineCoordinatorIteration(base,rewardAddress){
  const work=await validateShareWork(await coordinatorApi(base,'/work',{method:'POST',body:JSON.stringify({address:rewardAddress})}),base);
  const pow=await localPow(work.header,Number(work.targetDifficultyBits),'PPLNS share');
  const accepted=await coordinatorApi(base,'/share',{method:'POST',body:JSON.stringify({jobId:work.jobId,nonce:pow.nonce,hash:pow.hash})});
  if(accepted.accepted!==true||!accepted.share)throw protocolError('Coordinator did not accept the share');
  if(accepted.payoutCommitment!==work.payoutCommitment||accepted.weightsCommitment!==work.weightsCommitment||accepted.templateCommitment!==work.templateCommitment)throw protocolError('Coordinator share receipt commitment mismatch');
  if(!Number.isSafeInteger(Number(accepted.share.seq))||Number(accepted.share.seq)<1||!/^[0-9a-f]{64}$/.test(String(accepted.share.entryHash||''))||Number(accepted.share.targetDifficultyBits)!==Number(work.targetDifficultyBits)||Number(accepted.share.zeroBits)<Number(work.targetDifficultyBits))throw protocolError('Coordinator share receipt is invalid');
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
      if(!coordinatorAvailable(base)){failures.push({base,error:new Error('Coordinator cooling down')});continue}
      try{const result=await mineCoordinatorIteration(base,rewardAddress);markCoordinatorSuccess(base);coordinatorCursor=(index+1)%SHARE_COORDINATORS.length;return result}
      catch(error){if(error?.message==='STOP')throw error;markCoordinatorFailure(base,error);failures.push({base,error});coordinatorCursor=(index+1)%SHARE_COORDINATORS.length}
    }
  }
  return mineDirectIteration(rewardAddress,{fallbackFailures:failures.length});
}

function renderMiningControls(){$('mine').disabled=mining||!wallet;$('stop').disabled=!mining;$('copyminingaddr').disabled=!wallet}

async function miningLoop(){
  if(mining)return;
  if(!wallet){setStatus('mstate','Select a reward address before mining.','bad');return}
  const rewardAddress=wallet.address;mining=true;attemptsTotal=0;renderMiningControls();setStatus('mstate',SHARE_COORDINATORS.length?'Requesting verified PPLNS share work; direct PoW remains available as fallback…':'Requesting a block template for local Proof of Work…');
  try{
    while(mining){
      if(wallet?.address!==rewardAddress)throw Error('Reward address changed while mining');
      try{
        const cycle=await mineOneIteration(rewardAddress);attemptsTotal+=cycle.attempts||0;if(!mining)break;
        if(cycle.mode==='share'){
          setStatus('mstate','Verified share accepted · delayed PPLNS window updated · continuing…','ok');
        }else if(cycle.mode==='share-block'){
          setStatus('mstate','Won block '+cycle.accepted.block.height+' through verified PPLNS · block subsidy + transaction fees paid directly by coinbase · continuing…','ok');await refresh();
        }else{
          const rewardLabel=cycle.template.header.fee_atoms===undefined?'reward':'block reward + transaction fees',fallback=cycle.fallbackFailures?'Coordinator path unavailable · direct PoW fallback · ':'';
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
