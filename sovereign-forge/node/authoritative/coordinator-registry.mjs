import {verifyEnvelope} from './node-identity.mjs';

const MAX_COORDINATORS=256;
const MAX_DESCRIPTOR_LIFETIME_MS=24*60*60_000;

function normalizeEndpoint(value){const url=new URL(value);if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('Coordinator endpoint must use http or https');url.hash='';url.search='';return url.toString().replace(/\/$/,'')}

export function verifyCoordinatorDescriptor(envelope,{networkId=null}={}){
  const payload=verifyEnvelope(envelope,{kind:'coordinator-descriptor',maxAgeMs:MAX_DESCRIPTOR_LIFETIME_MS});
  if(payload.descriptorVersion!==1||payload.type!=='fairyelf-share-coordinator')throw new Error('Unsupported coordinator descriptor');
  if(!payload.coordinatorId||payload.coordinatorId!==envelope.signer.id)throw new Error('Coordinator identity mismatch');
  if(networkId&&payload.network!==networkId)throw new Error('Coordinator descriptor network mismatch');
  const issued=Date.parse(payload.issuedAt),validUntil=Date.parse(payload.validUntil);
  if(!Number.isFinite(issued)||!Number.isFinite(validUntil)||validUntil<=Date.now())throw new Error('Coordinator descriptor expired');
  if(validUntil-issued>MAX_DESCRIPTOR_LIFETIME_MS+60_000)throw new Error('Coordinator descriptor lifetime too long');
  return {...payload,endpoint:normalizeEndpoint(payload.endpoint)};
}

export class CoordinatorRegistry{
  constructor({networkId}){this.networkId=networkId;this.entries=new Map()}
  prune(){const now=Date.now();for(const [id,entry] of this.entries)if(Date.parse(entry.payload.validUntil)<=now)this.entries.delete(id)}
  register(envelope){
    this.prune(); const payload=verifyCoordinatorDescriptor(envelope,{networkId:this.networkId}),existing=this.entries.get(payload.coordinatorId);
    if(existing&&Date.parse(existing.payload.issuedAt)>Date.parse(payload.issuedAt))return existing.envelope;
    this.entries.set(payload.coordinatorId,{payload,envelope:structuredClone(envelope),observedAt:Date.now()});
    while(this.entries.size>MAX_COORDINATORS){const oldest=[...this.entries.entries()].sort((a,b)=>a[1].observedAt-b[1].observedAt)[0];if(!oldest)break;this.entries.delete(oldest[0])}
    return envelope;
  }
  merge(envelopes){let accepted=0;for(const envelope of Array.isArray(envelopes)?envelopes:[]){try{this.register(envelope);accepted++}catch{}}return accepted}
  list(){this.prune();return [...this.entries.values()].sort((a,b)=>b.observedAt-a.observedAt).map(entry=>structuredClone(entry.envelope))}
}
