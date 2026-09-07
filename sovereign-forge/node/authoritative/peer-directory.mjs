import {signEnvelope,verifyEnvelope} from './node-identity.mjs';
import {normalizePeerEndpoint,networkGroupForEndpoint} from './peer-diversity.mjs';

const MAX_DESCRIPTOR_LIFETIME_MS=6*60*60_000;
const MAX_RECORDS=512;
const MAX_ENDPOINTS_PER_IDENTITY=4;
const ID_RE=/^[0-9a-f]{64}$/;

function normalizeCapabilities(values){return[...new Set((Array.isArray(values)?values:[]).map(String).filter(value=>/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)))].sort().slice(0,64)}

export function createPeerDescriptor(identity,{networkId,endpoint,capabilities=[],ttlMs=60*60_000,now=Date.now()}={}){
  if(!identity?.id||!identity?.privateKeyPem)throw new Error('Peer descriptor requires a signing identity');
  if(typeof networkId!=='string'||networkId.length<1)throw new Error('Peer descriptor requires a network id');
  if(!Number.isSafeInteger(ttlMs)||ttlMs<60_000||ttlMs>MAX_DESCRIPTOR_LIFETIME_MS)throw new Error('Peer descriptor lifetime out of bounds');
  const normalizedEndpoint=normalizePeerEndpoint(endpoint),issuedAt=new Date(now).toISOString(),validUntil=new Date(now+ttlMs).toISOString();
  return signEnvelope(identity,'peer-descriptor',{descriptorVersion:1,type:'fairyelf-peer',network:networkId,peerId:identity.id,endpoint:normalizedEndpoint,networkGroup:networkGroupForEndpoint(normalizedEndpoint),capabilities:normalizeCapabilities(capabilities),issuedAt,validUntil});
}

export function verifyPeerDescriptor(envelope,{networkId=null,now=Date.now()}={}){
  const payload=verifyEnvelope(envelope,{kind:'peer-descriptor',maxAgeMs:MAX_DESCRIPTOR_LIFETIME_MS+60_000});
  if(payload.descriptorVersion!==1||payload.type!=='fairyelf-peer')throw new Error('Unsupported peer descriptor');
  if(!ID_RE.test(payload.peerId??'')||payload.peerId!==envelope.signer.id)throw new Error('Peer descriptor identity mismatch');
  if(networkId&&payload.network!==networkId)throw new Error('Peer descriptor network mismatch');
  const endpoint=normalizePeerEndpoint(payload.endpoint),issued=Date.parse(payload.issuedAt),validUntil=Date.parse(payload.validUntil);
  if(!Number.isFinite(issued)||!Number.isFinite(validUntil)||validUntil<=now||issued>now+60_000)throw new Error('Peer descriptor time invalid or expired');
  if(validUntil-issued>MAX_DESCRIPTOR_LIFETIME_MS+1000)throw new Error('Peer descriptor lifetime too long');
  const networkGroup=networkGroupForEndpoint(endpoint);if(payload.networkGroup!==networkGroup)throw new Error('Peer descriptor network-group mismatch');
  return{...payload,endpoint,networkGroup,capabilities:normalizeCapabilities(payload.capabilities)};
}

export class PeerDirectory{
  constructor({networkId,maxRecords=MAX_RECORDS,maxEndpointsPerIdentity=MAX_ENDPOINTS_PER_IDENTITY,now=()=>Date.now()}={}){
    if(typeof networkId!=='string'||!networkId)throw new Error('Peer directory requires network id');
    this.networkId=networkId;this.maxRecords=maxRecords;this.maxEndpointsPerIdentity=maxEndpointsPerIdentity;this.now=now;this.entries=new Map();
  }
  prune(){const now=this.now();for(const[key,entry]of this.entries)if(Date.parse(entry.payload.validUntil)<=now)this.entries.delete(key)}
  register(envelope,{source='gossip'}={}){
    this.prune();const payload=verifyPeerDescriptor(envelope,{networkId:this.networkId,now:this.now()}),key=`${payload.peerId}|${payload.endpoint}`,existing=this.entries.get(key);
    if(existing&&Date.parse(existing.payload.issuedAt)>Date.parse(payload.issuedAt))return existing.envelope;
    const sameIdentity=[...this.entries.values()].filter(entry=>entry.payload.peerId===payload.peerId&&entry.payload.endpoint!==payload.endpoint).sort((a,b)=>a.observedAt-b.observedAt);
    while(sameIdentity.length>=this.maxEndpointsPerIdentity){const oldest=sameIdentity.shift();this.entries.delete(`${oldest.payload.peerId}|${oldest.payload.endpoint}`)}
    this.entries.set(key,{payload,envelope:structuredClone(envelope),source:String(source),observedAt:this.now()});
    while(this.entries.size>this.maxRecords){const oldest=[...this.entries.entries()].sort((a,b)=>a[1].observedAt-b[1].observedAt)[0];if(!oldest)break;this.entries.delete(oldest[0])}
    return envelope;
  }
  merge(envelopes,{source='gossip'}={}){let accepted=0;for(const envelope of Array.isArray(envelopes)?envelopes:[]){try{this.register(envelope,{source});accepted++}catch{}}return accepted}
  descriptors({limit=128}={}){this.prune();return[...this.entries.values()].sort((a,b)=>b.observedAt-a.observedAt||a.payload.peerId.localeCompare(b.payload.peerId)).slice(0,Math.max(1,Math.min(256,limit))).map(entry=>structuredClone(entry.envelope))}
  observations(){this.prune();return[...this.entries.values()].map(entry=>({endpoint:entry.payload.endpoint,identityId:entry.payload.peerId,networkGroup:entry.payload.networkGroup,source:entry.source,descriptorOnly:true,observedAt:entry.observedAt}))}
}
