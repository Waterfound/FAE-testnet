import assert from 'node:assert/strict';
import test from 'node:test';
import {PeerDirectory,createPeerDescriptor} from '../node/authoritative/peer-directory.mjs';
import {generateNodeIdentity} from '../node/authoritative/node-identity.mjs';
import {createAuthoritativeV4PeerNode} from '../node/authoritative/fae-v4-peer-node.mjs';
import {createAuthoritativeV4PeerNodeEclipseCandidate} from '../node/authoritative/fae-v4-peer-node-eclipse-candidate.mjs';

const NETWORK='fairyelf-public-testnet-v4';
const NOW=Date.now();
function descriptor(identity,endpoint,now=NOW){return createPeerDescriptor(identity,{networkId:NETWORK,endpoint,now,ttlMs:3_600_000})}

test('colluding sources across distinct groups cannot consume the authenticated reserve with descriptor-only churn',()=>{
  let tick=0;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:12,maxRecordsPerSource:12,maxRecordsPerNetworkGroup:12,maxUnverifiedRecords:4,protectedSources:['self'],now:()=>NOW+1000+(tick++)});
  const self=generateNodeIdentity(),honest=generateNodeIdentity();
  directory.register(descriptor(self,'https://self.reserve.example'),{source:'self'});
  directory.register(descriptor(honest,'https://honest.stable.example'),{source:'peer:honest-source'});
  assert.equal(directory.markAuthenticated(honest.id,'https://honest.stable.example'),true);

  for(let i=0;i<30;i++){
    const identity=generateNodeIdentity();
    directory.register(descriptor(identity,`https://node-${i}.group-${i}.example`),{source:`peer:colluder-${i}`});
  }

  const rows=directory.observations(),status=directory.admissionStatus();
  assert.ok(rows.some(row=>row.identityId===self.id&&row.source==='self'));
  assert.ok(rows.some(row=>row.identityId===honest.id&&row.authenticated===true));
  assert.equal(status.authenticatedRecords,1);
  assert.equal(status.unverifiedRecords,4);
  assert.equal(status.maxUnverifiedRecords,4);
  assert.equal(status.records,6);
});

test('re-gossip cannot erase authentication or move a verified record into an attacker quota bucket',()=>{
  let tick=0;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:8,maxUnverifiedRecords:3,now:()=>NOW+2000+(tick++)});
  const peer=generateNodeIdentity(),endpoint='https://verified.regossip.example';
  directory.register(descriptor(peer,endpoint,NOW),{source:'peer:first'});
  assert.equal(directory.markAuthenticated(peer.id,endpoint),true);
  const authenticatedAt=directory.observations()[0].authenticatedAt;
  directory.register(descriptor(peer,endpoint,NOW+500),{source:'peer:attacker-bucket'});
  const row=directory.observations().find(record=>record.identityId===peer.id);
  assert.equal(row.authenticated,true);
  assert.equal(row.authenticatedAt,authenticatedAt);
  assert.equal(row.source,'peer:first');
});

test('identity endpoint churn retains an authenticated endpoint before unverified alternates',()=>{
  let tick=0;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:12,maxEndpointsPerIdentity:2,maxUnverifiedRecords:8,now:()=>NOW+3000+(tick++)});
  const identity=generateNodeIdentity(),stable='https://stable.identity.example';
  directory.register(descriptor(identity,stable),{source:'peer:source-a'});
  assert.equal(directory.markAuthenticated(identity.id,stable),true);
  for(let i=0;i<8;i++)directory.register(descriptor(identity,`https://alternate-${i}.identity-${i}.example`),{source:'peer:source-a'});
  const rows=directory.observations().filter(row=>row.identityId===identity.id);
  assert.equal(rows.length,2);
  assert.ok(rows.some(row=>row.endpoint===stable&&row.authenticated===true));
});

test('authenticated retention never bypasses the hard global directory ceiling',()=>{
  let tick=0;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:4,maxUnverifiedRecords:4,now:()=>NOW+4000+(tick++)});
  const retained=[];
  for(let i=0;i<4;i++){
    const identity=generateNodeIdentity(),endpoint=`https://verified-${i}.ceiling-${i}.example`;
    directory.register(descriptor(identity,endpoint),{source:`peer:${i}`});
    assert.equal(directory.markAuthenticated(identity.id,endpoint),true);retained.push(identity.id);
  }
  const extra=generateNodeIdentity();
  directory.register(descriptor(extra,'https://new.unverified.example'),{source:'peer:extra'});
  assert.equal(directory.observations().length,4);
  assert.equal(directory.admissionStatus().authenticatedRecords,4);
  assert.equal(directory.markAuthenticated(extra.id,'https://new.unverified.example'),false,'a descriptor evicted by the hard ceiling cannot be promoted after eviction');
  assert.ok(retained.every(id=>directory.observations().some(row=>row.identityId===id)));
});

test('successful protocol-6 candidate probe promotes the corresponding directory descriptor',async()=>{
  const remote=createAuthoritativeV4PeerNode({host:'127.0.0.1',port:0});
  const victim=createAuthoritativeV4PeerNodeEclipseCandidate({
    host:'127.0.0.1',port:0,
    eclipseDirectoryOptions:{maxRecordsPerSource:8,maxRecordsPerNetworkGroup:8,maxUnverifiedRecords:2},
    eclipseDiscoveryOptions:{peerDiversityOptions:{minDistinctIdentities:0,minDistinctNetworkGroups:0,minPinnedIdentities:0,maxPerNetworkGroup:8}},
    peerDiversityOptions:{minDistinctIdentities:0,minDistinctNetworkGroups:0,minPinnedIdentities:0,maxPerNetworkGroup:8}
  });
  try{
    await remote.start();await victim.start();
    const endpoint=remote.baseUrl();
    victim.directory.register(createPeerDescriptor(remote.identity,{networkId:NETWORK,endpoint,ttlMs:3_600_000}),{source:'peer:seed'});
    assert.equal(victim.directory.observations().find(row=>row.identityId===remote.identity.id)?.authenticated,false);
    const result=await victim.syncPeers({limit:4});
    assert.ok(result.some(row=>row.peer_id===remote.identity.id&&row.ok===true));
    const promoted=victim.directory.observations().find(row=>row.identityId===remote.identity.id);
    assert.equal(promoted?.authenticated,true);
    assert.ok(promoted.authenticatedAt>0);
    assert.equal(victim.status().peer_directory_admission.authenticatedRecords,1);
  }finally{
    await victim.close();await remote.close();
  }
});

test('generic directory keeps previous default capacity semantics unless authenticated-retention is opted in',()=>{
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:9});
  const status=directory.admissionStatus();
  assert.equal(status.maxUnverifiedRecords,9);
  assert.equal(status.maxRecords,9);
  assert.deepEqual(status.protectedSources,[]);
});
