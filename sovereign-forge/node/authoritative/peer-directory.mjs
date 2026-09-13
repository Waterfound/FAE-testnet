import {signEnvelope,verifyEnvelope} from './node-identity.mjs';
import {normalizePeerEndpoint,networkGroupForEndpoint} from './peer-diversity.mjs';

const MAX_DESCRIPTOR_LIFETIME_MS=6*60*60_000;
const MAX_RECORDS=512;
const MAX_ENDPOINTS_PER_IDENTITY=4;
const ID_RE=/^[0-9a-f]{64}$/;

function normalizeCapabilities(values){return[...new Set((Array.isArray(values)?values:[]).map(String).filter(value=>/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)))].sort().slice(0,64)}
function positiveInt(name,value,fallback){const parsed=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(parsed)||parsed<1)throw new Error(`Invalid ${name}`);return parsed}

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
  constructor({
    networkId,maxRecords=MAX_RECORDS,maxEndpointsPerIdentity=MAX_ENDPOINTS_PER_IDENTITY,
    maxRecordsPerSource=MAX_RECORDS,maxRecordsPerNetworkGroup=MAX_RECORDS,protectedSources=['self'],now=()=>Date.now()
  }={}){
    if(typeof networkId!=='string'||!networkId)throw new Error('Peer directory requires network id');
    this.networkId=networkId;
    this.maxRecords=positiveInt('maxRecords',maxRecords,MAX_RECORDS);
    this.maxEndpointsPerIdentity=positiveInt('maxEndpointsPerIdentity',maxEndpointsPerIdentity,MAX_ENDPOINTS_PER_IDENTITY);
    this.maxRecordsPerSource=positiveInt('maxRecordsPerSource',maxRecordsPerSource,this.maxRecords);
    this.maxRecordsPerNetworkGroup=positiveInt('maxRecordsPerNetworkGroup',maxRecordsPerNetworkGroup,this.maxRecords);
    if(typeof now!=='function')throw new Error('Peer directory now must be a function');
    this.now=now;this.entries=new Map();this.protectedSources=new Set((Array.isArray(protectedSources)?protectedSources:[]).map(String));
  }
  prune(){const now=this.now();for(const[key,entry]of this.entries)if(Date.parse(entry.payload.validUntil)<=now)this.entries.delete(key)}
  isProtected(entry){return this.protectedSources.has(entry.source)}
  evictOldest(entries){
    const candidates=entries.filter(([,entry])=>!this.isProtected(entry)).sort((a,b)=>a[1].observedAt-b[1].observedAt||a[0].localeCompare(b[0]));
    const victim=candidates[0];if(!victim)return false;this.entries.delete(victim[0]);return true;
  }
  boundWhere(predicate,limit){
    while(true){const rows=[...this.entries.entries()].filter(([,entry])=>predicate(entry));if(rows.length<=limit)return;if(!this.evictOldest(rows))return}
  }
  register(envelope,{source='gossip'}={}){
    this.prune();const payload=verifyPeerDescriptor(envelope,{networkId:this.networkId,now:this.now()}),key=`${payload.peerId}|${payload.endpoint}`,sourceName=String(source),existing=this.entries.get(key);
    if(existing&&Date.parse(existing.payload.issuedAt)>Date.parse(payload.issuedAt))return existing.envelope;
    const sameIdentity=[...this.entries.entries()].filter(([,entry])=>entry.payload.peerId===payload.peerId&&entry.payload.endpoint!==payload.endpoint);
    while(sameIdentity.length>=this.maxEndpointsPerIdentity){
      const removable=sameIdentity.filter(([,entry])=>!this.isProtected(entry)).sort((a,b)=>a[1].observedAt-b[1].observedAt||a[0].localeCompare(b[0]));
      const oldest=removable.shift();if(!oldest)break;this.entries.delete(oldest[0]);const index=sameIdentity.findIndex(([candidate])=>candidate===oldest[0]);if(index>=0)sameIdentity.splice(index,1);
    }
    this.entries.set(key,{payload,envelope:structuredClone(envelope),source:sourceName,observedAt:this.now()});
    if(!this.protectedSources.has(sourceName))this.boundWhere(entry=>entry.source===sourceName,this.maxRecordsPerSource);
    this.boundWhere(entry=>entry.payload.networkGroup===payload.networkGroup,this.maxRecordsPerNetworkGroup);
    this.boundWhere(()=>true,this.maxRecords);
    return envelope;
  }
  merge(envelopes,{source='gossip'}={}){let accepted=0;for(const envelope of Array.isArray(envelopes)?envelopes:[]){try{this.register(envelope,{source});accepted++}catch{}}return accepted}
  descriptors({limit=128}={}){this.prune();return[...this.entries.values()].sort((a,b)=>b.observedAt-a.observedAt||a.payload.peerId.localeCompare(b.payload.peerId)).slice(0,Math.max(1,Math.min(256,limit))).map(entry=>structuredClone(entry.envelope))}
  observations(){this.prune();return[...this.entries.values()].map(entry=>({endpoint:entry.payload.endpoint,identityId:entry.payload.peerId,networkGroup:entry.payload.networkGroup,source:entry.source,descriptorOnly:true,observedAt:entry.observedAt}))}
}
