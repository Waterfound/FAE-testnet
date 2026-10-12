import assert from 'node:assert/strict';
import test from 'node:test';
import {PeerDirectory,createPeerDescriptor} from '../node/authoritative/peer-directory.mjs';
import {generateNodeIdentity} from '../node/authoritative/node-identity.mjs';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {createAuthoritativeV4PeerNodeEclipseCandidate} from '../node/authoritative/fae-v4-peer-node-eclipse-candidate.mjs';

const NETWORK='fairyelf-public-testnet-v4';
const NOW=Date.now();
function descriptor(identity,endpoint,now=NOW){return createPeerDescriptor(identity,{networkId:NETWORK,endpoint,now,ttlMs:3_600_000})}

test('one transient failure preserves authenticated retention and the second consecutive failure demotes it',()=>{
  let tick=0;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:8,maxUnverifiedRecords:4,authenticationFailureThreshold:2,now:()=>NOW+1000+(tick++)});
  const peer=generateNodeIdentity(),endpoint='https://liveness.decay.example';
  directory.register(descriptor(peer,endpoint),{source:'peer:seed'});
  assert.equal(directory.markAuthenticated(peer.id,endpoint),true);

  const first=directory.markProbeFailure(peer.id,endpoint);
  assert.deepEqual(first,{found:true,demoted:false,failures:1});
  let row=directory.observations().find(record=>record.identityId===peer.id);
  assert.equal(row.authenticated,true);
  assert.equal(row.consecutiveProbeFailures,1);

  const second=directory.markProbeFailure(peer.id,endpoint);
  assert.deepEqual(second,{found:true,demoted:true,failures:2});
  row=directory.observations().find(record=>record.identityId===peer.id);
  assert.equal(row.authenticated,false);
  assert.equal(row.consecutiveProbeFailures,2);
  assert.equal(directory.admissionStatus().authenticatedRecords,0);
  assert.equal(directory.admissionStatus().unverifiedRecords,1);
});

test('a later successful probe restores retention and clears the failure streak',()=>{
  let tick=0;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:8,maxUnverifiedRecords:4,authenticationFailureThreshold:2,now:()=>NOW+2000+(tick++)});
  const peer=generateNodeIdentity(),endpoint='https://liveness.recover.example';
  directory.register(descriptor(peer,endpoint),{source:'peer:seed'});
  directory.markAuthenticated(peer.id,endpoint);
  directory.markProbeFailure(peer.id,endpoint);
  assert.equal(directory.markAuthenticated(peer.id,endpoint),true);
  const row=directory.observations().find(record=>record.identityId===peer.id);
  assert.equal(row.authenticated,true);
  assert.equal(row.consecutiveProbeFailures,0);
  assert.equal(row.lastProbeFailureAt,0);
});

test('re-gossip cannot erase a liveness-failure streak',()=>{
  let tick=0;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:8,maxUnverifiedRecords:4,authenticationFailureThreshold:2,now:()=>NOW+3000+(tick++)});
  const peer=generateNodeIdentity(),endpoint='https://liveness.regossip.example';
  directory.register(descriptor(peer,endpoint,NOW),{source:'peer:first'});
  directory.markAuthenticated(peer.id,endpoint);
  directory.markProbeFailure(peer.id,endpoint);
  directory.register(descriptor(peer,endpoint,NOW+500),{source:'peer:replayer'});
  const row=directory.observations().find(record=>record.identityId===peer.id);
  assert.equal(row.authenticated,true);
  assert.equal(row.consecutiveProbeFailures,1);
  assert.equal(row.source,'peer:first');
});

test('demoted stale retention re-enters the unverified budget and can be displaced',()=>{
  let tick=0;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:6,maxUnverifiedRecords:1,authenticationFailureThreshold:2,now:()=>NOW+4000+(tick++)});
  const stale=generateNodeIdentity(),fresh=generateNodeIdentity();
  const staleEndpoint='https://stale.retained.example';
  directory.register(descriptor(stale,staleEndpoint),{source:'peer:stale'});
  directory.markAuthenticated(stale.id,staleEndpoint);
  directory.register(descriptor(fresh,'https://fresh.unverified.example'),{source:'peer:fresh'});
  directory.markProbeFailure(stale.id,staleEndpoint);
  const result=directory.markProbeFailure(stale.id,staleEndpoint);
  assert.equal(result.demoted,true);
  const rows=directory.observations();
  assert.equal(rows.length,1);
  assert.equal(rows[0].identityId,fresh.id);
  assert.equal(directory.admissionStatus().unverifiedRecords,1);
});

test('real candidate liveness path demotes only after two failed protocol-6 probes',async()=>{
  const remote=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:0});
  const victim=createAuthoritativeV4PeerNodeEclipseCandidate({
    host:'127.0.0.1',port:0,
    eclipseDirectoryOptions:{maxRecordsPerSource:8,maxRecordsPerNetworkGroup:8,maxUnverifiedRecords:4,authenticationFailureThreshold:2},
    eclipseDiscoveryOptions:{peerDiversityOptions:{minDistinctIdentities:0,minDistinctNetworkGroups:0,minPinnedIdentities:0,maxPerNetworkGroup:8}},
    peerDiversityOptions:{minDistinctIdentities:0,minDistinctNetworkGroups:0,minPinnedIdentities:0,maxPerNetworkGroup:8}
  });
  let remoteClosed=false;
  try{
    await remote.start();await victim.start();
    const endpoint=remote.baseUrl(),identityId=remote.identity.id;
    victim.directory.register(createPeerDescriptor(remote.identity,{networkId:NETWORK,endpoint,ttlMs:3_600_000}),{source:'peer:seed'});
    const promoted=await victim.syncPeers({limit:4});
    assert.ok(promoted.some(row=>row.peer_id===identityId&&row.ok===true));
    assert.equal(victim.directory.observations().find(row=>row.identityId===identityId)?.authenticated,true);

    await remote.close();remoteClosed=true;
    const first=await victim.syncKnownPeer({identityId,endpoint});
    assert.equal(first.ok,false);
    let row=victim.directory.observations().find(record=>record.identityId===identityId);
    assert.equal(row.authenticated,true);
    assert.equal(row.consecutiveProbeFailures,1);

    const second=await victim.syncKnownPeer({identityId,endpoint});
    assert.equal(second.ok,false);
    row=victim.directory.observations().find(record=>record.identityId===identityId);
    assert.equal(row.authenticated,false);
    assert.equal(row.consecutiveProbeFailures,2);
    assert.equal(victim.status().peer_directory_admission.authenticationFailureThreshold,2);
  }finally{
    await victim.close();if(!remoteClosed)await remote.close();
  }
});

test('generic directory does not opt into practical liveness demotion by default',()=>{
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:9});
  assert.equal(directory.admissionStatus().authenticationFailureThreshold,Number.MAX_SAFE_INTEGER);
});
