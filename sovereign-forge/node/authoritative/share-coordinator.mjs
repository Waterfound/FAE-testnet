import {appendFileSync,existsSync,mkdirSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hashHex,leadingZeroBits} from './crypto.mjs';
import {isValidAddress} from './address.mjs';
import {generateNodeIdentity,signEnvelope} from './node-identity.mjs';

const DEFAULT_WINDOW=2048;
const DEFAULT_SHARE_DIFFICULTY_DELTA=6;
const JOB_TTL_MS=5*60_000;
const MAX_JOBS=1024;
const MAX_LOG_REPLAY=1_000_000;

function entryHash(entry){const {entryHash:_ignored,...withoutHash}=entry;return hashHex(withoutHash)}

export class ShareLedger{
  constructor({logFile=null,windowSize=DEFAULT_WINDOW}={}){
    this.logFile=logFile;this.windowSize=Math.max(1,Math.min(100_000,Number(windowSize)||DEFAULT_WINDOW));this.shares=[];this.seen=new Set();this.lastHash='0'.repeat(64);if(logFile)this.load();
  }
  load(){
    if(!existsSync(this.logFile))return;
    const lines=readFileSync(this.logFile,'utf8').split(/\r?\n/).filter(Boolean);if(lines.length>MAX_LOG_REPLAY)throw new Error('Share log exceeds replay ceiling');
    let previous='0'.repeat(64),expectedSeq=1;
    for(const line of lines){const entry=JSON.parse(line);if(entry.seq!==expectedSeq)throw new Error('Share log sequence gap');if(entry.previousEntryHash!==previous)throw new Error('Share log hash-chain mismatch');if(entry.entryHash!==entryHash(entry))throw new Error('Share log entry hash mismatch');const duplicateKey=`${entry.jobId}:${entry.nonce}`;if(this.seen.has(duplicateKey))throw new Error('Duplicate share in persisted log');this.seen.add(duplicateKey);this.shares.push(entry);previous=entry.entryHash;expectedSeq++}
    this.lastHash=previous;
  }
  append({jobId,address,nonce,hash,shareDifficultyBits,blockDifficultyBits,height,previousBlockHash}){
    const duplicateKey=`${jobId}:${nonce}`;if(this.seen.has(duplicateKey))throw new Error('Duplicate share');
    const entry={version:1,seq:this.shares.length+1,jobId,address,nonce,hash,shareDifficultyBits,blockDifficultyBits,height,previousBlockHash,previousEntryHash:this.lastHash};entry.entryHash=entryHash(entry);
    this.shares.push(entry);this.seen.add(duplicateKey);this.lastHash=entry.entryHash;
    if(this.logFile){mkdirSync(dirname(this.logFile),{recursive:true});appendFileSync(this.logFile,`${JSON.stringify(entry)}\n`,{mode:0o600})}
    return entry;
  }
  window(){return this.shares.slice(-this.windowSize)}
  weights(fallbackAddress){const counts=new Map();for(const share of this.window())counts.set(share.address,(counts.get(share.address)??0n)+1n);if(counts.size===0)counts.set(fallbackAddress,1n);return [...counts.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([address,weight])=>({address,weight}))}
  summary(){const window=this.window();return{totalShares:this.shares.length,windowShares:window.length,uniqueMinersInWindow:new Set(window.map(s=>s.address)).size,lastEntryHash:this.lastHash,windowSize:this.windowSize}}
}

export function allocatePplnsOutputs(totalRewardAtoms,weights){
  const totalReward=BigInt(totalRewardAtoms);if(totalReward<0n)throw new Error('Reward cannot be negative');if(!Array.isArray(weights)||weights.length===0)throw new Error('PPLNS weights required');
  const normalized=weights.map(entry=>({address:String(entry.address),weight:BigInt(entry.weight)}));if(normalized.some(entry=>entry.weight<=0n))throw new Error('PPLNS weights must be positive');
  const totalWeight=normalized.reduce((sum,entry)=>sum+entry.weight,0n);let allocated=0n;
  return normalized.map((entry,index)=>{const amount=index===normalized.length-1?totalReward-allocated:(totalReward*entry.weight)/totalWeight;allocated+=amount;return{address:entry.address,amount_atoms:amount.toString()}}).filter(entry=>BigInt(entry.amount_atoms)>0n);
}

export class ShareCoordinator{
  constructor({networkId='fairyelf-public-testnet-v4',addressHrp='faet',logFile=null,windowSize=DEFAULT_WINDOW,shareDifficultyDelta=DEFAULT_SHARE_DIFFICULTY_DELTA,identity=null,publicUrl=null,multiOutputCoinbaseActive=false,statusProvider=null,distributedTemplateProvider=null,blockSubmitter=null,candidateHasher=null}={}){
    this.networkId=networkId;this.addressHrp=addressHrp;this.identity=identity??generateNodeIdentity();this.publicUrl=publicUrl?publicUrl.replace(/\/$/,''):null;this.ledger=new ShareLedger({logFile,windowSize});this.shareDifficultyDelta=Math.max(1,Math.min(20,Number(shareDifficultyDelta)||DEFAULT_SHARE_DIFFICULTY_DELTA));this.multiOutputCoinbaseActive=Boolean(multiOutputCoinbaseActive);this.statusProvider=statusProvider;this.distributedTemplateProvider=distributedTemplateProvider;this.blockSubmitter=blockSubmitter;this.candidateHasher=candidateHasher;this.jobs=new Map();
  }
  pruneJobs(){const now=Date.now();for(const [id,job] of this.jobs)if(job.expiresAt<=now)this.jobs.delete(id);while(this.jobs.size>MAX_JOBS)this.jobs.delete(this.jobs.keys().next().value)}
  async upstreamStatus(){if(typeof this.statusProvider!=='function')throw new Error('Coordinator upstream status provider is not configured');return this.statusProvider()}
  async descriptor({lifetimeMs=15*60_000}={}){
    if(!this.publicUrl)throw new Error('Coordinator public URL is not configured');const upstream=await this.upstreamStatus();const issuedAt=new Date().toISOString(),validUntil=new Date(Date.now()+Math.max(60_000,Math.min(24*60*60_000,lifetimeMs))).toISOString();
    return signEnvelope(this.identity,'coordinator-descriptor',{descriptorVersion:1,type:'fairyelf-share-coordinator',coordinatorId:this.identity.id,network:this.networkId,endpoint:this.publicUrl,mode:'pplns-direct-pay',windowSize:this.ledger.windowSize,shareDifficultyDelta:this.shareDifficultyDelta,upstreamNodeIdentity:upstream.node_identity??upstream.nodeIdentity??null,issuedAt,validUntil});
  }
  async status(){const upstream=await this.upstreamStatus();return{version:1,mode:'pplns-direct-pay',activation:this.multiOutputCoinbaseActive?'active':'candidate-awaiting-multi-output-coinbase',upstream:{network:upstream.network,height:Number(upstream.height),tip:upstream.tip_hash??upstream.tip,difficultyBits:Number(upstream.difficulty_bits??upstream.difficultyBits)},shareDifficultyDelta:this.shareDifficultyDelta,activeJobs:this.jobs.size,...this.ledger.summary()}}
  async createWork(address){
    if(!isValidAddress(address,this.addressHrp))throw new Error('Invalid mining address');
    if(!this.multiOutputCoinbaseActive)throw new Error('PPLNS multi-output coinbase activation required');
    if(typeof this.distributedTemplateProvider!=='function'||typeof this.candidateHasher!=='function')throw new Error('Distributed mining adapter is not configured');
    this.pruneJobs();const weights=this.ledger.weights(address).map(({address,weight})=>({address,weight:weight.toString()}));const candidate=await this.distributedTemplateProvider({weights,fallback_address:address});
    const blockBits=Number(candidate.header?.difficulty_bits);if(!Number.isInteger(blockBits))throw new Error('Distributed template missing block difficulty');
    if(!Array.isArray(candidate.payouts)||candidate.payouts.length<1)throw new Error('Distributed template missing payout outputs');
    const expectedTotal=BigInt(candidate.header.reward_atoms),actualTotal=candidate.payouts.reduce((sum,o)=>sum+BigInt(o.amount_atoms),0n);if(actualTotal!==expectedTotal)throw new Error('Distributed payout total does not equal block reward');
    const shareDifficultyBits=Math.max(4,blockBits-this.shareDifficultyDelta),jobId=randomUUID(),expiresAt=Date.now()+JOB_TTL_MS,payoutCommitment=hashHex(candidate.payouts);
    this.jobs.set(jobId,{jobId,address,candidate:structuredClone(candidate),shareDifficultyBits,expiresAt,payoutCommitment});
    return{...candidate,jobId,workMode:'share',targetDifficultyBits:shareDifficultyBits,blockDifficultyBits:blockBits,payoutCommitment,expiresAt:new Date(expiresAt).toISOString()};
  }
  async submitShare({jobId,nonce,hash}){
    this.pruneJobs();const job=this.jobs.get(jobId);if(!job)throw new Error('Stale or unknown share job');if(!Number.isSafeInteger(nonce)||nonce<0)throw new Error('Invalid share nonce');if(!/^[0-9a-f]{64}$/.test(hash??''))throw new Error('Invalid share hash');
    const current=await this.upstreamStatus(),currentTip=current.tip_hash??current.tip;if(currentTip!==job.candidate.header.previous_hash||Number(current.height)+1!==Number(job.candidate.header.height)){this.jobs.delete(jobId);throw new Error('Stale share job after chain-tip change')}
    const calculated=await this.candidateHasher(job.candidate,nonce);if(calculated!==hash)throw new Error('Share hash mismatch');const zeroBits=leadingZeroBits(hash);if(zeroBits<job.shareDifficultyBits)throw new Error('Share below target');
    const entry=this.ledger.append({jobId,address:job.address,nonce,hash,shareDifficultyBits:job.shareDifficultyBits,blockDifficultyBits:Number(job.candidate.header.difficulty_bits),height:Number(job.candidate.header.height),previousBlockHash:job.candidate.header.previous_hash});
    let block=null;if(zeroBits>=Number(job.candidate.header.difficulty_bits)){if(typeof this.blockSubmitter!=='function')throw new Error('Block submitter is not configured');block=await this.blockSubmitter({...job.candidate,nonce,hash});this.jobs.clear()}
    return{accepted:true,share:{seq:entry.seq,entryHash:entry.entryHash,zeroBits,targetDifficultyBits:job.shareDifficultyBits},block,payoutCommitment:job.payoutCommitment};
  }
}
