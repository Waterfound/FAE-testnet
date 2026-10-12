import {createAuthoritativeV4PeerNode} from '../authoritative/fae-v4-peer-node.mjs';
import {EclipseResistantDiscovery} from './peer-isolation-eclipse-candidate.mjs';

const ID_RE=/^[0-9a-f]{64}$/;

function normalizeKnownPeer(row,source='operator-known'){
  const identityId=String(row?.identityId||'').toLowerCase();
  if(!ID_RE.test(identityId))throw new Error('Known peer requires a valid identity id');
  const endpoint=new URL(String(row?.endpoint));
  if(endpoint.protocol!=='http:'&&endpoint.protocol!=='https:')throw new Error('Known peer endpoint must use HTTP or HTTPS');
  endpoint.hash='';endpoint.search='';
  return{identityId,endpoint:endpoint.toString().replace(/\/$/,''),source:String(row?.source||source)};
}

/**
 * Gate-2 research composition. The underlying chain-validation and protocol-6
 * implementation remains the authoritative implementation; only discovery,
 * liveness accounting and probe scheduling are supplied by the Gate-1 lab
 * candidate. This module is not a production entrypoint.
 */
export function createPeerIsolationProtocol6Candidate({
  knownPeers=[],pinnedPeers=[],discoveryOptions={},...nodeOptions
}={}){
  const normalizedPinned=(Array.isArray(pinnedPeers)?pinnedPeers:[]).map(row=>normalizeKnownPeer(row,'operator-pinned'));
  const normalizedKnown=(Array.isArray(knownPeers)?knownPeers:[]).map(row=>normalizeKnownPeer(row));
  const pinnedIds=[...new Set([...(nodeOptions.pinnedPeerIdentityIds||[]).map(value=>String(value).toLowerCase()),...normalizedPinned.map(row=>row.identityId)])];
  const node=createAuthoritativeV4PeerNode({...nodeOptions,pinnedPeerIdentityIds:pinnedIds});
  const discovery=new EclipseResistantDiscovery({...discoveryOptions,pinnedIdentityIds:pinnedIds});
  discovery.ingest([...normalizedKnown,...normalizedPinned]);

  function absorbDirectory(){return discovery.ingest(node.directory.observations())}

  async function probe(row){
    try{
      const result=await node.syncPeer(row.endpoint,{source:row.source||'eclipse-gate2',expectedIdentityId:row.identityId});
      discovery.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok:true});
      absorbDirectory();
      return{peer:row.endpoint,peer_id:row.identityId,ok:true,...result};
    }catch(error){
      discovery.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok:false});
      return{peer:row.endpoint,peer_id:row.identityId,ok:false,adopted:false,error:error.code||error.message};
    }
  }

  async function syncPeers({limit=discovery.maxProbeBatch}={}){
    absorbDirectory();
    const batch=discovery.probeBatch({limit}),results=[];
    for(const row of batch)results.push(await probe(row));
    return results;
  }

  async function syncKnownPeer(peer){
    const row=normalizeKnownPeer(peer);discovery.ingest([row]);return probe(row);
  }

  function status(){return{...node.status(),eclipse_resistance:discovery.assessment()}}
  async function start(){await node.start();return api()}
  async function close(){return node.close()}
  function api(){return{start,close,baseUrl:node.baseUrl,status,syncPeers,syncKnownPeer,getState:node.getState,replaceState:node.replaceState,identity:node.identity,directory:node.directory,discovery,inner:node}}
  return api();
}
