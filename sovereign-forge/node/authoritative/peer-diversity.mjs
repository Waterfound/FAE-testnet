import {isIP} from 'node:net';

const ID_RE=/^[0-9a-f]{64}$/;

export function normalizePeerEndpoint(value){
  const url=new URL(String(value));
  if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('Peer endpoint must use HTTP or HTTPS');
  url.hash='';url.search='';
  return url.toString().replace(/\/$/,'');
}
function expandIPv6(input){
  let value=input.toLowerCase().replace(/^\[|\]$/g,'').split('%')[0];
  const ipv4=value.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if(ipv4){const octets=ipv4.split('.').map(Number);if(octets.some(n=>!Number.isInteger(n)||n<0||n>255))throw new Error('Invalid IPv4-in-IPv6 endpoint');const replacement=((octets[0]<<8)|octets[1]).toString(16)+':'+((octets[2]<<8)|octets[3]).toString(16);value=value.slice(0,value.length-ipv4.length)+replacement}
  const halves=value.split('::');if(halves.length>2)throw new Error('Invalid IPv6 endpoint');
  const left=halves[0]?halves[0].split(':'):[],right=halves.length===2&&halves[1]?halves[1].split(':'):[];
  if([...left,...right].some(part=>!/^[0-9a-f]{1,4}$/.test(part)))throw new Error('Invalid IPv6 endpoint');
  const missing=8-left.length-right.length;if((halves.length===1&&missing!==0)||(halves.length===2&&missing<1))throw new Error('Invalid IPv6 endpoint');
  return [...left,...Array(Math.max(0,missing)).fill('0'),...right].map(part=>part.padStart(4,'0'));
}
function conservativeDnsGroup(hostname){const labels=hostname.toLowerCase().replace(/\.$/,'').split('.').filter(Boolean);if(labels.length<=2)return labels.join('.');return labels.slice(-2).join('.')}

export function networkGroupForEndpoint(endpoint){
  const normalized=normalizePeerEndpoint(endpoint),url=new URL(normalized),host=url.hostname.replace(/^\[|\]$/g,'');
  const version=isIP(host);
  if(version===4){const parts=host.split('.');return`ipv4:${parts.slice(0,3).join('.')}.0/24`}
  if(version===6){const parts=expandIPv6(host);return`ipv6:${parts.slice(0,3).join(':')}::/48`}
  return`dns:${conservativeDnsGroup(host)}`;
}

function normalizeObservation(record,pinnedIdentityIds){
  const endpoint=normalizePeerEndpoint(record?.endpoint),identityId=String(record?.identityId||'').toLowerCase();
  if(!ID_RE.test(identityId))throw new Error('Peer observation requires a valid identity id');
  return{endpoint,identityId,networkGroup:networkGroupForEndpoint(endpoint),pinned:pinnedIdentityIds.has(identityId),source:String(record?.source||'unknown')};
}

export class PeerDiversityPolicy{
  constructor({minDistinctIdentities=3,minDistinctNetworkGroups=3,minPinnedIdentities=1,maxPerNetworkGroup=2,pinnedIdentityIds=[]}={}){
    for(const [name,value] of Object.entries({minDistinctIdentities,minDistinctNetworkGroups,minPinnedIdentities,maxPerNetworkGroup}))if(!Number.isSafeInteger(value)||value<0)throw new Error(`Invalid ${name}`);
    if(maxPerNetworkGroup<1)throw new Error('maxPerNetworkGroup must be at least 1');
    this.minDistinctIdentities=minDistinctIdentities;this.minDistinctNetworkGroups=minDistinctNetworkGroups;this.minPinnedIdentities=minPinnedIdentities;this.maxPerNetworkGroup=maxPerNetworkGroup;this.pinnedIdentityIds=new Set(pinnedIdentityIds.map(value=>String(value).toLowerCase()));
    for(const id of this.pinnedIdentityIds)if(!ID_RE.test(id))throw new Error('Pinned peer identity is malformed');
  }
  normalize(records){return(Array.isArray(records)?records:[]).map(record=>normalizeObservation(record,this.pinnedIdentityIds))}
  evaluate(records){
    const observations=this.normalize(records),endpointOwners=new Map(),violations=[];
    for(const peer of observations){const prior=endpointOwners.get(peer.endpoint);if(prior&&prior!==peer.identityId)violations.push({code:'endpoint_identity_conflict',endpoint:peer.endpoint,identities:[prior,peer.identityId]});else endpointOwners.set(peer.endpoint,peer.identityId)}
    const identities=new Set(observations.map(peer=>peer.identityId)),groups=new Map(),pinned=new Set();
    for(const peer of observations){if(!groups.has(peer.networkGroup))groups.set(peer.networkGroup,new Set());groups.get(peer.networkGroup).add(peer.identityId);if(peer.pinned)pinned.add(peer.identityId)}
    const concentrations=[...groups.entries()].map(([group,ids])=>({group,identities:ids.size})).sort((a,b)=>b.identities-a.identities||a.group.localeCompare(b.group)),maxGroupIdentities=concentrations[0]?.identities||0;
    if(identities.size<this.minDistinctIdentities)violations.push({code:'insufficient_identity_diversity',have:identities.size,need:this.minDistinctIdentities});
    if(groups.size<this.minDistinctNetworkGroups)violations.push({code:'insufficient_network_diversity',have:groups.size,need:this.minDistinctNetworkGroups});
    if(pinned.size<this.minPinnedIdentities)violations.push({code:'insufficient_out_of_band_anchors',have:pinned.size,need:this.minPinnedIdentities});
    if(concentrations.some(row=>row.identities>this.maxPerNetworkGroup))violations.push({code:'network_group_concentration',groups:concentrations.filter(row=>row.identities>this.maxPerNetworkGroup)});
    return{ready:violations.length===0,peerRecords:observations.length,distinctIdentities:identities.size,distinctNetworkGroups:groups.size,pinnedIdentities:pinned.size,maxGroupIdentities,concentrationRatio:identities.size?maxGroupIdentities/identities.size:1,groups:concentrations,violations};
  }
  select(records,{limit=8}={}){
    if(!Number.isSafeInteger(limit)||limit<1)throw new Error('Peer selection limit must be positive');
    const normalized=this.normalize(records),byIdentity=new Map();
    for(const peer of normalized){const existing=byIdentity.get(peer.identityId);if(!existing||(!existing.pinned&&peer.pinned)||peer.endpoint<existing.endpoint)byIdentity.set(peer.identityId,peer)}
    const groups=new Map();for(const peer of byIdentity.values()){if(!groups.has(peer.networkGroup))groups.set(peer.networkGroup,[]);groups.get(peer.networkGroup).push(peer)}
    for(const peers of groups.values())peers.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||a.identityId.localeCompare(b.identityId)||a.endpoint.localeCompare(b.endpoint));
    const groupNames=[...groups.keys()].sort((a,b)=>{const ap=groups.get(a).some(peer=>peer.pinned),bp=groups.get(b).some(peer=>peer.pinned);return Number(bp)-Number(ap)||a.localeCompare(b)}),selected=[];
    for(let round=0;round<this.maxPerNetworkGroup&&selected.length<limit;round++)for(const group of groupNames){const peer=groups.get(group)[round];if(peer){selected.push(peer);if(selected.length>=limit)break}}
    return selected;
  }
}
