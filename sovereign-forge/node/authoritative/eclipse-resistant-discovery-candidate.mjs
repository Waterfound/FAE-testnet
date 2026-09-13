import {PeerDiversityPolicy,normalizePeerEndpoint,networkGroupForEndpoint} from './peer-diversity.mjs';

const ID_RE=/^[0-9a-f]{64}$/;

function asIdentity(value){const id=String(value||'').toLowerCase();if(!ID_RE.test(id))throw new Error('Peer observation requires a valid identity id');return id}
function asPositiveInt(name,value,fallback){const parsed=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(parsed)||parsed<1)throw new Error(`Invalid ${name}`);return parsed}
function recordKey(identityId,endpoint){return `${identityId}|${endpoint}`}

/**
 * Non-activated authoritative candidate for eclipse-resistant peer discovery.
 * It governs only peer-view retention, probing and liveness accounting. It has
 * no block-validation, consensus, fork-choice, mining or wallet authority.
 */
export class EclipseResistantDiscoveryCandidate{
  constructor({
    pinnedIdentityIds=[],peerDiversityOptions={},maxRecords=512,maxEndpointsPerIdentity=4,
    maxProbeBatch=32,failureBackoffMs=5_000,maxFailureBackoffMs=5*60_000,healthyReprobeMs=60_000,
    now=()=>Date.now()
  }={}){
    this.pinnedIdentityIds=new Set(pinnedIdentityIds.map(asIdentity));
    this.maxRecords=asPositiveInt('maxRecords',maxRecords,512);
    this.maxEndpointsPerIdentity=asPositiveInt('maxEndpointsPerIdentity',maxEndpointsPerIdentity,4);
    this.maxProbeBatch=asPositiveInt('maxProbeBatch',maxProbeBatch,32);
    this.failureBackoffMs=asPositiveInt('failureBackoffMs',failureBackoffMs,5_000);
    this.maxFailureBackoffMs=asPositiveInt('maxFailureBackoffMs',maxFailureBackoffMs,5*60_000);
    this.healthyReprobeMs=asPositiveInt('healthyReprobeMs',healthyReprobeMs,60_000);
    if(this.maxFailureBackoffMs<this.failureBackoffMs)throw new Error('maxFailureBackoffMs must be >= failureBackoffMs');
    if(typeof now!=='function')throw new Error('now must be a function');
    this.now=now;
    this.records=new Map();
    this.diversity=new PeerDiversityPolicy({...peerDiversityOptions,pinnedIdentityIds:[...this.pinnedIdentityIds]});
  }

  normalize(record){
    const endpoint=normalizePeerEndpoint(record?.endpoint),identityId=asIdentity(record?.identityId),now=this.now();
    return{endpoint,identityId,networkGroup:networkGroupForEndpoint(endpoint),source:String(record?.source||'discovered'),pinned:this.pinnedIdentityIds.has(identityId),firstSeenAt:now,lastSeenAt:now,lastProbeAt:0,lastAuthenticatedAt:0,nextProbeAt:0,failures:0,authenticated:false};
  }

  ingest(records){
    let accepted=0;
    for(const raw of Array.isArray(records)?records:[]){
      let incoming;try{incoming=this.normalize(raw)}catch{continue}
      const key=recordKey(incoming.identityId,incoming.endpoint),existing=this.records.get(key);
      if(existing){existing.lastSeenAt=this.now();existing.source=incoming.source;accepted++;continue}
      this.records.set(key,incoming);accepted++;
      this.boundIdentity(incoming.identityId);
      this.boundGlobal();
    }
    return accepted;
  }

  boundIdentity(identityId){
    const rows=[...this.records.entries()].filter(([,row])=>row.identityId===identityId);
    while(rows.length>this.maxEndpointsPerIdentity){
      rows.sort((a,b)=>{
        if(a[1].authenticated!==b[1].authenticated)return a[1].authenticated?1:-1;
        if(a[1].pinned!==b[1].pinned)return a[1].pinned?1:-1;
        return a[1].lastSeenAt-b[1].lastSeenAt||a[0].localeCompare(b[0]);
      });
      const [key]=rows.shift();this.records.delete(key);
    }
  }

  evictionRank(row){if(row.pinned)return 3;if(row.authenticated)return 2;return 1}

  boundGlobal(){
    while(this.records.size>this.maxRecords){
      const candidates=[...this.records.entries()].sort((a,b)=>this.evictionRank(a[1])-this.evictionRank(b[1])||a[1].lastSeenAt-b[1].lastSeenAt||a[0].localeCompare(b[0]));
      const victim=candidates[0];if(!victim)break;this.records.delete(victim[0]);
    }
  }

  probeBatch({limit=this.maxProbeBatch}={}){
    const cap=Math.min(asPositiveInt('probe limit',limit,this.maxProbeBatch),this.maxProbeBatch),now=this.now();
    const eligible=[...this.records.values()].filter(row=>row.nextProbeAt<=now),byIdentity=new Map();
    for(const row of eligible){const previous=byIdentity.get(row.identityId);if(!previous||Number(row.pinned)>Number(previous.pinned)||row.lastProbeAt<previous.lastProbeAt||(row.lastProbeAt===previous.lastProbeAt&&row.endpoint<previous.endpoint))byIdentity.set(row.identityId,row)}
    const groups=new Map();
    for(const row of byIdentity.values()){if(!groups.has(row.networkGroup))groups.set(row.networkGroup,[]);groups.get(row.networkGroup).push(row)}
    for(const rows of groups.values())rows.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||Number(a.authenticated)-Number(b.authenticated)||a.lastProbeAt-b.lastProbeAt||a.identityId.localeCompare(b.identityId)||a.endpoint.localeCompare(b.endpoint));
    const groupNames=[...groups.keys()].sort((a,b)=>{const ap=groups.get(a).some(row=>row.pinned),bp=groups.get(b).some(row=>row.pinned);if(ap!==bp)return ap?-1:1;const aOld=Math.min(...groups.get(a).map(row=>row.lastProbeAt)),bOld=Math.min(...groups.get(b).map(row=>row.lastProbeAt));return aOld-bOld||a.localeCompare(b)});
    const selected=[];let round=0;
    while(selected.length<cap){let added=false;for(const group of groupNames){const row=groups.get(group)[round];if(!row)continue;selected.push({...row});added=true;if(selected.length>=cap)break}if(!added)break;round++}
    for(const row of selected){const stored=this.records.get(recordKey(row.identityId,row.endpoint));if(stored)stored.lastProbeAt=now}
    return selected;
  }

  markProbeResult({identityId,endpoint,ok}){
    const id=asIdentity(identityId),normalized=normalizePeerEndpoint(endpoint),row=this.records.get(recordKey(id,normalized));if(!row)throw new Error('Unknown discovery candidate');
    const now=this.now();row.lastProbeAt=now;
    if(ok){row.authenticated=true;row.failures=0;row.lastAuthenticatedAt=now;row.nextProbeAt=now+this.healthyReprobeMs;return{authenticated:true,nextProbeAt:row.nextProbeAt}}
    row.authenticated=false;row.failures=Math.min(row.failures+1,32);const backoff=Math.min(this.maxFailureBackoffMs,this.failureBackoffMs*(2**Math.min(row.failures-1,16)));row.nextProbeAt=now+backoff;return{authenticated:false,failures:row.failures,nextProbeAt:row.nextProbeAt};
  }

  disconnect(identityId,endpoint){const id=asIdentity(identityId),normalized=normalizePeerEndpoint(endpoint),row=this.records.get(recordKey(id,normalized));if(!row)return false;row.authenticated=false;row.nextProbeAt=Math.min(row.nextProbeAt,this.now());return true}
  authenticatedObservations(){return[...this.records.values()].filter(row=>row.authenticated).map(row=>({endpoint:row.endpoint,identityId:row.identityId,source:row.source}))}
  assessment(){const diversity=this.diversity.evaluate(this.authenticatedObservations()),knownPinned=[...this.records.values()].filter(row=>row.pinned).length,livePinned=new Set([...this.records.values()].filter(row=>row.pinned&&row.authenticated).map(row=>row.identityId)).size;return{ready:diversity.ready,state:diversity.ready?'READY':'HOLD',knownRecords:this.records.size,knownPinned,livePinned,...diversity}}
  snapshot(){return[...this.records.values()].map(row=>({...row})).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||a.networkGroup.localeCompare(b.networkGroup)||a.identityId.localeCompare(b.identityId)||a.endpoint.localeCompare(b.endpoint))}
}
