import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto,randomBytes} from 'node:crypto';
import vm from 'node:vm';
import {encodeAddress} from '../sovereign-forge/node/authoritative/address.mjs';
import {hashHex} from '../sovereign-forge/node/authoritative/crypto.mjs';
import {generateNodeIdentity,signEnvelope} from '../sovereign-forge/node/authoritative/node-identity.mjs';
import {allocatePplnsOutputs} from '../sovereign-forge/node/authoritative/share-coordinator.mjs';

class FakeClassList{add(){}remove(){}toggle(){}}
class FakeElement{
  constructor(id=''){this.id=id;this.hidden=false;this.tabIndex=0;this.disabled=false;this.value='';this.files=[];this.textContent='';this.className='';this.children=[];this.attributes={};this.dataset={};this.classList=new FakeClassList();this.style={};this.listeners={};this.lastElementChild={textContent:''}}
  addEventListener(type,listener){(this.listeners[type]??=[]).push(listener)}setAttribute(name,value){this.attributes[name]=String(value)}getAttribute(name){return this.attributes[name]}querySelector(){return this.lastElementChild}
  append(...nodes){this.children.push(...nodes);this.firstChild=this.children[0]||null;this.lastElementChild=this.children.at(-1)||this.lastElementChild}removeChild(node){this.children=this.children.filter(x=>x!==node);this.firstChild=this.children[0]||null;return node}
  focus(){}select(){}remove(){}scrollIntoView(){}click(){}
}
const elements=new Map(),document={body:new FakeElement('body'),getElementById(id){if(!elements.has(id))elements.set(id,new FakeElement(id));return elements.get(id)},createElement(){return new FakeElement()},execCommand(){return true}},storage=new Map(),localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};

const NETWORK='fairyelf-public-testnet-v4',ACTIVE='fae-public-testnet-v4';
const MALICIOUS='https://malicious-coordinator.test',OFFLINE='https://offline-coordinator.test',GOOD='https://good-coordinator.test';
const identities=new Map([[MALICIOUS,generateNodeIdentity()],[GOOD,generateNodeIdentity()]]),latestWork=new Map();
let goodMode='active',directTemplates=0,directSubmissions=0;
const workCalls=new Map(),shareCalls=new Map();
const increment=(map,key)=>map.set(key,(map.get(key)||0)+1);
const ledgerEmpty={totalShares:0,windowShares:0,uniqueMinersInWindow:0,lastEntryHash:'0'.repeat(64),windowSize:2048};

function buildWork(base,requestAddress,{identity=identities.get(base),weights=null,ledgerState=ledgerEmpty,jobId=null,tamperPayout=false}={}){
  const pplnsWeights=(weights??[{address:requestAddress,weight:'1'}]).map(row=>({address:String(row.address),weight:String(row.weight)})).sort((a,b)=>a.address.localeCompare(b.address));
  const payouts=allocatePplnsOutputs(1037n,pplnsWeights),txids=[],header={network:NETWORK,height:151,previous_hash:'a'.repeat(64),timestamp_ms:1788895000000,difficulty_bits:18,miner_address:payouts[0].address,reward_atoms:'1000',fee_atoms:'37',tx_root:hashHex(txids),tx_count:0,coinbase_root:hashHex(payouts),coinbase_count:payouts.length,coinbase_mode:'pplns-direct'};
  const blockDifficultyBits=18,targetDifficultyBits=12,payoutCommitment=hashHex(payouts),weightsCommitment=hashHex(pplnsWeights),templateCommitment=hashHex({header,txids,payouts,coinbase_outputs:payouts}),expiresAt=new Date(Date.now()+4*60_000).toISOString(),resolvedJobId=jobId??('job-'+randomBytes(8).toString('hex'));
  const proofPayload={proofVersion:1,coordinatorId:identity.id,network:NETWORK,jobId:resolvedJobId,requestAddress,ledgerState,pplnsWeights,weightsCommitment,templateCommitment,height:header.height,previousHash:header.previous_hash,blockDifficultyBits,targetDifficultyBits,payoutCommitment,expiresAt};
  const work={ok:true,workMode:'share',jobId:resolvedJobId,coordinatorId:identity.id,requestAddress,targetDifficultyBits,blockDifficultyBits,payoutCommitment,ledgerState,pplnsWeights,weightsCommitment,templateCommitment,expiresAt,header,txids,payouts:structuredClone(payouts),coinbase_outputs:structuredClone(payouts),workProof:signEnvelope(identity,'coordinator-work',proofPayload)};
  if(tamperPayout)work.payouts[0].amount_atoms=(BigInt(work.payouts[0].amount_atoms)-1n).toString();
  return work;
}

const fetch=async(url,options={})=>{
  const text=String(url),method=options.method||'GET',base=[MALICIOUS,OFFLINE,GOOD].find(candidate=>text.startsWith(candidate));
  if(base){
    if(base===OFFLINE)throw new TypeError('fetch failed: simulated coordinator outage');
    if(text.endsWith('/work')&&method==='POST'){
      increment(workCalls,base);if(base===GOOD&&goodMode==='inactive')return new Response(JSON.stringify({ok:false,error:'PPLNS multi-output coinbase activation required'}),{status:409,headers:{'content-type':'application/json'}});
      const requestAddress=JSON.parse(options.body).address,work=buildWork(base,requestAddress,{tamperPayout:base===MALICIOUS});latestWork.set(base,work);return new Response(JSON.stringify(work),{status:200,headers:{'content-type':'application/json'}});
    }
    if(text.endsWith('/share')&&method==='POST'){
      increment(shareCalls,base);const work=latestWork.get(base);if(base===GOOD&&goodMode==='stale')return new Response(JSON.stringify({ok:false,error:'Stale share job after chain-tip change'}),{status:409,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify({ok:true,accepted:true,share:{seq:1,entryHash:'d'.repeat(64),zeroBits:64,targetDifficultyBits:work.targetDifficultyBits},block:null,payoutCommitment:work.payoutCommitment,weightsCommitment:work.weightsCommitment,templateCommitment:work.templateCommitment}),{status:200,headers:{'content-type':'application/json'}});
    }
  }
  const path=text.split(ACTIVE)[1]||'';let body={};
  if(path.startsWith('/status'))body={height:150,issued_fae:'1500',max_supply_fae:'12000000',halving_era_blocks:600000,difficulty_bits:18,node_version:5};
  else if(path.startsWith('/state'))body={recent:[]};
  else if(path.startsWith('/balance'))body={balance_fae:'0'};
  else if(path.startsWith('/spendable'))body={spendable_fae:'0',utxos:[]};
  else if(path.startsWith('/transactions'))body={transactions:[]};
  else if(path.startsWith('/template')){directTemplates++;body={header:{network:NETWORK,height:151,previous_hash:'a'.repeat(64),difficulty_bits:18,reward_atoms:'1000'},txids:[]}}
  else if(path.startsWith('/submit-block')){directSubmissions++;body={ok:true,height:151,hash:'0'.repeat(64),tx_count:0}}
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
};

let clipboard='';const context={window:null,document,localStorage,fetch,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Array,Map,Set,BigInt,Blob,URL,Response,Error,String,Number,Object,JSON,Date,Math,Promise,console,atob,btoa,AbortController,navigator:{clipboard:{writeText:async value=>{clipboard=value}}},setTimeout,clearTimeout,setInterval:()=>0,clearInterval,confirm:()=>true,FAE_SHARE_COORDINATORS:[MALICIOUS,OFFLINE,GOOD],powCalls:0};context.window=context;vm.createContext(context);
for(const file of ['bip39-en.js','network-status.js','core.js','wallet-crypto.js','wallet.js','mining.js'])vm.runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context,{filename:file});
await new Promise(resolve=>setTimeout(resolve,25));await vm.runInContext('createNewWallet()',context);const address=vm.runInContext('wallet.address',context);context.address=address;context.goodBase=GOOD;
vm.runInContext("localPow=async()=>{powCalls++;return{nonce:7,hash:'0'.repeat(64),attempts:1}}",context);

const multi=await vm.runInContext('mineOneIteration(address)',context);assert.equal(multi.mode,'share');assert.equal(multi.coordinator,GOOD);assert.equal(workCalls.get(MALICIOUS),1);assert.equal(workCalls.get(GOOD),1);assert.equal(shareCalls.get(MALICIOUS)||0,0);assert.equal(shareCalls.get(GOOD),1);assert.equal(context.powCalls,1);assert.equal(directTemplates,0);assert.equal(directSubmissions,0);
const maliciousState=vm.runInContext('coordinatorState(FAE_SHARE_COORDINATORS[0])',context);assert.ok(maliciousState.retryAt-Date.now()>4*60_000);assert.match(maliciousState.lastError,/payout|commitment/i);

goodMode='inactive';const fallback=await vm.runInContext('mineOneIteration(address)',context);assert.equal(fallback.mode,'direct');assert.equal(fallback.fallbackFailures,3);assert.equal(directTemplates,1);assert.equal(directSubmissions,1);assert.equal(context.powCalls,2);

const secondary=encodeAddress(randomBytes(20),'faet'),pair=[address,secondary].sort(),ledgerState={totalShares:5,windowShares:5,uniqueMinersInWindow:2,lastEntryHash:'e'.repeat(64),windowSize:2048};
const equivocationA=buildWork(GOOD,address,{weights:[{address:pair[0],weight:'2'},{address:pair[1],weight:'3'}],ledgerState,jobId:'job-equivocation-a'}),equivocationB=buildWork(GOOD,address,{weights:[{address:pair[0],weight:'3'},{address:pair[1],weight:'2'}],ledgerState,jobId:'job-equivocation-b'});context.equivocationA=equivocationA;context.equivocationB=equivocationB;
vm.runInContext('coordinatorProofHistory.clear();coordinatorIdentityByBase.clear()',context);await vm.runInContext('validateShareWork(equivocationA,goodBase,address)',context);let equivocationError=null;try{await vm.runInContext('validateShareWork(equivocationB,goodBase,address)',context)}catch(error){equivocationError=error}assert.equal(equivocationError?.code,'COORDINATOR_EQUIVOCATION');assert.match(equivocationError?.message||'',/equivocation/i);
const evidence=JSON.parse(localStorage.getItem('fae-coordinator-equivocation-v1')||'[]');assert.equal(evidence.length,1);assert.equal(evidence[0].first.signer.id,identities.get(GOOD).id);assert.equal(evidence[0].second.signer.id,identities.get(GOOD).id);assert.notEqual(evidence[0].first.payload.weightsCommitment,evidence[0].second.payload.weightsCommitment);

const otherIdentity=generateNodeIdentity(),identityFlip=buildWork(GOOD,address,{identity:otherIdentity,ledgerState:{...ledgerEmpty,lastEntryHash:'f'.repeat(64)},jobId:'job-identity-flip'});context.identityFlip=identityFlip;let identityError=null;try{await vm.runInContext('validateShareWork(identityFlip,goodBase,address)',context)}catch(error){identityError=error}assert.match(identityError?.message||'',/identity changed/i);

assert.equal(vm.runInContext('SHARE_COORDINATORS.length',context),3);assert.equal(clipboard,'');console.log('FAE browser multi-coordinator failover, malicious payout rejection, signed-work verification and equivocation checks passed.');
