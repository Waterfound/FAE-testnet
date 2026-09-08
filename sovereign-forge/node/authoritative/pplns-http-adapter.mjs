import {hashHex,leadingZeroBits} from './crypto.mjs';
import {stableStringify} from './canonical.mjs';
import {ShareCoordinator} from './share-coordinator.mjs';

export const DEFAULT_NETWORK='fairyelf-public-testnet-v4';
export const CANDIDATE_FUNCTION_PATH='/functions/v1/fae-public-testnet-v4-authoritative-candidate';

function normalizeBaseUrl(value,{requireCandidatePath=true}={}){
  const url=new URL(String(value));
  if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('PPLNS adapter requires HTTP(S)');
  url.hash='';url.search='';
  url.pathname=url.pathname.replace(/\/$/,'');
  if(requireCandidatePath&&!url.pathname.endsWith(CANDIDATE_FUNCTION_PATH))throw new Error('PPLNS adapter must target the Authoritative candidate endpoint');
  return url.toString().replace(/\/$/,'');
}
function atomic(v,name){if(typeof v==='string'&&/^\d+$/.test(v))return BigInt(v);if(typeof v==='number'&&Number.isSafeInteger(v)&&v>=0)return BigInt(v);if(typeof v==='bigint'&&v>=0n)return v;throw new Error(`Invalid ${name} atomic value`)}
function requireHash(value,name){if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))throw new Error(`Invalid ${name}`);return value}
function deepEqual(a,b){return stableStringify(a)===stableStringify(b)}

export class AuthoritativePplnsHttpAdapter{
  constructor({baseUrl,networkId=DEFAULT_NETWORK,timeoutMs=8000,requireCandidatePath=true,fetchImpl=globalThis.fetch}={}){
    if(typeof fetchImpl!=='function')throw new Error('PPLNS adapter requires fetch');
    this.baseUrl=normalizeBaseUrl(baseUrl,{requireCandidatePath});this.networkId=networkId;this.timeoutMs=Math.max(1000,Math.min(60_000,Number(timeoutMs)||8000));this.fetchImpl=fetchImpl;
  }
  async request(path,{method='GET',body=null}={}){
    const response=await this.fetchImpl(this.baseUrl+path,{method,signal:AbortSignal.timeout(this.timeoutMs),headers:{'content-type':'application/json'},body:body==null?undefined:JSON.stringify(body)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload?.ok===false){const reason=payload?.error??payload?.reason??`http_${response.status}`;const error=new Error(String(reason));error.status=response.status;error.payload=payload;throw error}
    return payload;
  }
  validateStatus(status){
    if(!status||status.ok!==true)throw new Error('Candidate status is not healthy');
    if(status.network!==this.networkId)throw new Error('Candidate status network mismatch');
    const height=Number(status.height);if(!Number.isSafeInteger(height)||height<0)throw new Error('Candidate status height invalid');
    const tip=String(status.tip_hash??'');requireHash(tip,'candidate tip hash');
    const bits=Number(status.difficulty_bits);if(!Number.isInteger(bits)||bits<1||bits>64)throw new Error('Candidate status difficulty invalid');
    const activation=status.pplns_coinbase_activation_height;
    if(activation!==null&&(!Number.isSafeInteger(Number(activation))||Number(activation)<1))throw new Error('Candidate activation height invalid');
    return{...status,height,tip_hash:tip,difficulty_bits:bits,pplns_coinbase_activation_height:activation===null?null:Number(activation)};
  }
  async status(){return this.validateStatus(await this.request('/status'))}
  async activationReady(status=null){const s=status??await this.status(),h=s.pplns_coinbase_activation_height;return h!==null&&s.height+1>=h}
  validateTemplate(candidate,status){
    if(!candidate||candidate.ok!==true)throw new Error('Distributed template is not healthy');
    const h=candidate.header;if(!h||h.network!==this.networkId)throw new Error('Distributed template network mismatch');
    if(Number(h.height)!==status.height+1)throw new Error('Distributed template height mismatch');
    if(String(h.previous_hash)!==status.tip_hash)throw new Error('Distributed template tip mismatch');
    if(Number(h.difficulty_bits)!==status.difficulty_bits)throw new Error('Distributed template difficulty mismatch');
    const txids=Array.isArray(candidate.txids)?candidate.txids.map(String):[];if(Number(h.tx_count)!==txids.length)throw new Error('Distributed template tx count mismatch');for(const txid of txids)requireHash(txid,'transaction id');
    if(h.tx_root!==hashHex(txids))throw new Error('Distributed template tx root mismatch');
    const payouts=Array.isArray(candidate.payouts)?candidate.payouts:null,outputs=Array.isArray(candidate.coinbase_outputs)?candidate.coinbase_outputs:null;
    if(!payouts||!outputs||!payouts.length||!outputs.length)throw new Error('Distributed template missing coinbase outputs');
    if(!deepEqual(payouts,outputs))throw new Error('Distributed template payout/output mismatch');
    if(h.coinbase_mode!=='pplns-direct')throw new Error('Distributed template coinbase mode mismatch');
    if(Number(h.coinbase_count)!==outputs.length)throw new Error('Distributed template coinbase count mismatch');
    if(h.coinbase_root!==hashHex(outputs))throw new Error('Distributed template coinbase root mismatch');
    if(String(h.miner_address)!==String(outputs[0]?.address||''))throw new Error('Distributed template primary payout mismatch');
    const subsidy=atomic(h.reward_atoms,'subsidy'),fees=atomic(h.fee_atoms??'0','fees'),total=outputs.reduce((sum,o)=>sum+atomic(o?.amount_atoms,'coinbase output'),0n);
    if(total!==subsidy+fees)throw new Error('Distributed template payout total mismatch');
    return{...candidate,header:{...h,height:Number(h.height),difficulty_bits:Number(h.difficulty_bits),tx_count:Number(h.tx_count),coinbase_count:Number(h.coinbase_count)},txids,payouts,coinbase_outputs:outputs};
  }
  async distributedTemplate({weights}){
    const status=await this.status();
    const activation=status.pplns_coinbase_activation_height;if(activation===null)throw new Error('PPLNS multi-output coinbase activation required');
    if(status.height+1<activation)throw new Error(`PPLNS activation height ${activation} not reached`);
    if(!Array.isArray(weights)||!weights.length)throw new Error('PPLNS weights required');
    const candidate=await this.request('/template/pplns',{method:'POST',body:{weights}});
    return this.validateTemplate(candidate,status);
  }
  hashCandidate(candidate,nonce){if(!Number.isSafeInteger(nonce)||nonce<0)throw new Error('Invalid candidate nonce');return hashHex({...candidate.header,nonce})}
  async submitBlock(solution){
    const candidate=this.validateTemplate(solution,await this.status());
    const nonce=Number(solution.nonce),hash=String(solution.hash||'');if(!Number.isSafeInteger(nonce)||nonce<0)throw new Error('Invalid block nonce');requireHash(hash,'block hash');
    const calculated=this.hashCandidate(candidate,nonce);if(calculated!==hash)throw new Error('Block hash mismatch before submission');if(leadingZeroBits(hash)<Number(candidate.header.difficulty_bits))throw new Error('Block proof below network target');
    const body={header:candidate.header,nonce,hash,txids:candidate.txids,coinbase_outputs:candidate.coinbase_outputs};
    const result=await this.request('/submit-block',{method:'POST',body});
    if(result.ok!==true)throw new Error('Candidate block submission was not accepted');if(Number(result.height)!==Number(candidate.header.height))throw new Error('Candidate block response height mismatch');if(String(result.hash)!==hash)throw new Error('Candidate block response hash mismatch');return result;
  }
  async createCoordinator(options={}){
    const adapter=this;
    class LiveAuthoritativeCoordinator extends ShareCoordinator{
      async refreshActivation(){this.multiOutputCoinbaseActive=await adapter.activationReady();return this.multiOutputCoinbaseActive}
      async status(){await this.refreshActivation();return super.status()}
      async createWork(address){await this.refreshActivation();return super.createWork(address)}
    }
    return new LiveAuthoritativeCoordinator({...options,networkId:this.networkId,statusProvider:()=>adapter.status(),distributedTemplateProvider:args=>adapter.distributedTemplate(args),blockSubmitter:solution=>adapter.submitBlock(solution),candidateHasher:(candidate,nonce)=>adapter.hashCandidate(candidate,nonce)});
  }
}
