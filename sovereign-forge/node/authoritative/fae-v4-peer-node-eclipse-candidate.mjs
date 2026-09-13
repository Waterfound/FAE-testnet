import {createAuthoritativeV4PeerNode} from './fae-v4-peer-node.mjs';
import {EclipseResistantDiscoveryCandidate} from './eclipse-resistant-discovery-candidate.mjs';

const ID_RE=/^[0-9a-f]{64}$/;

function knownPeer(row,source='known'){
  const identityId=String(row?.identityId||'').toLowerCase();if(!ID_RE.test(identityId))throw new Error('Known peer requires a valid identity id');
  const url=new URL(String(row?.endpoint));if(url.protocol!=='http:'&&url.protocol!=='https:')throw new Error('Known peer endpoint must use HTTP or HTTPS');url.hash='';url.search='';
  return{identityId,endpoint:url.toString().replace(/\/$/,''),source:String(row?.source||source)};
}

/**
 * Non-activated authoritative networking candidate. Consensus and chain
 * validation remain delegated unchanged to createAuthoritativeV4PeerNode().
 * This candidate replaces only peer-view selection/liveness for callers that
 * explicitly instantiate this factory.
 */
export function createAuthoritativeV4PeerNodeEclipseCandidate({
  knownPeers=[],pinnedPeers=[],eclipseDiscoveryOptions={},eclipseDirectoryOptions={},...nodeOptions
}={}){
  const pinned=(Array.isArray(pinnedPeers)?pinnedPeers:[]).map(row=>knownPeer(row,'operator-pinned'));
  const known=(Array.isArray(knownPeers)?knownPeers:[]).map(row=>knownPeer(row,'operator-known'));
  const pinnedIds=[...new Set([...(nodeOptions.pinnedPeerIdentityIds||[]).map(value=>String(value).toLowerCase()),...pinned.map(row=>row.identityId)])];
  const node=createAuthoritativeV4PeerNode({...nodeOptions,pinnedPeerIdentityIds:pinnedIds,syncIntervalMs:0});
  node.directory.configureAdmission({maxRecordsPerSource:64,maxRecordsPerNetworkGroup:32,maxUnverifiedRecords:256,protectedSources:['self'],...eclipseDirectoryOptions});
  const peerView=new EclipseResistantDiscoveryCandidate({...eclipseDiscoveryOptions,pinnedIdentityIds:pinnedIds,peerDiversityOptions:nodeOptions.peerDiversityOptions||{}});
  peerView.ingest([...known,...pinned]);
  let syncRunning=false,syncTimer=null;

  function absorbDirectory(){return peerView.ingest(node.directory.observations())}
  async function probe(row){
    try{
      const result=await node.syncPeer(row.endpoint,{source:row.source||'eclipse-candidate',expectedIdentityId:row.identityId});
      peerView.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok:true});
      node.directory.markAuthenticated(row.identityId,row.endpoint);absorbDirectory();
      return{peer:row.endpoint,peer_id:row.identityId,ok:true,...result};
    }catch(error){
      peerView.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok:false});
      return{peer:row.endpoint,peer_id:row.identityId,ok:false,adopted:false,error:error.code||error.message};
    }
  }
  async function syncPeers({limit=peerView.maxProbeBatch}={}){
    if(syncRunning)return[];syncRunning=true;
    try{absorbDirectory();const rows=peerView.probeBatch({limit}),results=[];for(const row of rows)results.push(await probe(row));return results}finally{syncRunning=false}
  }
  async function syncKnownPeer(row){const normalized=knownPeer(row);peerView.ingest([normalized]);return probe(normalized)}
  function status(){const base=node.status(),eclipseResistance=peerView.assessment();return{...base,peer_diversity:eclipseResistance,eclipse_resistance:eclipseResistance,peer_directory_admission:node.directory.admissionStatus(),peer_view_authority:'eclipse-resistant-candidate-v1'}}
  async function start(){await node.start();if(nodeOptions.syncIntervalMs>0)syncTimer=setInterval(()=>syncPeers().catch(()=>{}),Math.max(5000,nodeOptions.syncIntervalMs));return api()}
  async function close(){if(syncTimer)clearInterval(syncTimer);return node.close()}
  function api(){return{...node,start,close,status,syncPeers,syncKnownPeer,peerView,inner:node}}
  return api();
}
