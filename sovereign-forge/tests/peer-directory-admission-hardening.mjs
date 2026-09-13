import assert from 'node:assert/strict';
import test from 'node:test';
import {PeerDirectory,createPeerDescriptor} from '../node/authoritative/peer-directory.mjs';
import {generateNodeIdentity} from '../node/authoritative/node-identity.mjs';
import {createAuthoritativeV4PeerNodeEclipseCandidate} from '../node/authoritative/fae-v4-peer-node-eclipse-candidate.mjs';

const NETWORK='fairyelf-public-testnet-v4';
const NOW=Date.now();

function descriptor(identity,endpoint,now=NOW){return createPeerDescriptor(identity,{networkId:NETWORK,endpoint,now,ttlMs:3_600_000})}

test('one authenticated gossip source cannot occupy the whole discovery directory',()=>{
  let tick=0;
  const self=generateNodeIdentity();
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:24,maxRecordsPerSource:4,maxRecordsPerNetworkGroup:24,protectedSources:['self'],now:()=>NOW+1000+(tick++)});
  directory.register(descriptor(self,'https://self.operator.example'),{source:'self'});
  for(let i=0;i<14;i++){
    const identity=generateNodeIdentity();
    directory.register(descriptor(identity,`https://node-${i}.group-${i}.example`),{source:'peer:attacker-a'});
  }
  const observations=directory.observations();
  assert.equal(observations.filter(row=>row.source==='peer:attacker-a').length,4);
  assert.equal(observations.filter(row=>row.source==='self').length,1);
  const admission=directory.admissionStatus();
  assert.equal(admission.maxObservedSourceRecords,4);
  assert.equal(admission.records,5);
});

test('one network group cannot occupy the whole discovery directory across many authenticated sources',()=>{
  let tick=0;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:32,maxRecordsPerSource:32,maxRecordsPerNetworkGroup:3,now:()=>NOW+2000+(tick++)});
  for(let i=0;i<12;i++){
    const identity=generateNodeIdentity();
    directory.register(descriptor(identity,`http://203.0.113.${i+1}:8787`),{source:`peer:${i}`});
  }
  const observations=directory.observations();
  assert.equal(observations.length,3);
  assert.ok(observations.every(row=>row.networkGroup==='ipv4:203.0.113.0/24'));
  assert.equal(directory.admissionStatus().maxObservedNetworkGroupRecords,3);
});

test('protected self descriptor survives global churn while untrusted records remain bounded',()=>{
  let tick=0;
  const self=generateNodeIdentity();
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:5,maxRecordsPerSource:5,maxRecordsPerNetworkGroup:5,protectedSources:['self'],now:()=>NOW+3000+(tick++)});
  directory.register(descriptor(self,'https://self.anchor.example'),{source:'self'});
  for(let i=0;i<16;i++){
    const identity=generateNodeIdentity();
    directory.register(descriptor(identity,`https://node-${i}.domain-${i}.example`),{source:`peer:${i}`});
  }
  const observations=directory.observations();
  assert.equal(observations.length,5);
  assert.ok(observations.some(row=>row.identityId===self.id&&row.source==='self'));
});

test('re-gossip cannot downgrade protected self provenance',()=>{
  let tick=0;
  const self=generateNodeIdentity(),directory=new PeerDirectory({networkId:NETWORK,maxRecords:8,maxRecordsPerSource:2,maxRecordsPerNetworkGroup:8,protectedSources:['self'],now:()=>NOW+3500+(tick++)});
  const envelope=descriptor(self,'https://self.protected.example');
  directory.register(envelope,{source:'self'});
  directory.register(envelope,{source:'peer:replayer'});
  const rows=directory.observations().filter(row=>row.identityId===self.id);
  assert.equal(rows.length,1);
  assert.equal(rows[0].source,'self');
  assert.deepEqual(directory.admissionStatus().protectedSources,['self']);
});

test('tightening admission on a populated directory removes excess records immediately',()=>{
  let tick=0;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:32,now:()=>NOW+4000+(tick++)});
  for(let i=0;i<10;i++){
    const identity=generateNodeIdentity();
    directory.register(descriptor(identity,`https://node-${i}.scope-${i}.example`),{source:'peer:single-source'});
  }
  assert.equal(directory.observations().length,10);
  const status=directory.configureAdmission({maxRecordsPerSource:3,maxRecordsPerNetworkGroup:32,protectedSources:['self']});
  assert.equal(directory.observations().length,3);
  assert.equal(status.maxObservedSourceRecords,3);
});

test('eclipse candidate enables admission hardening without changing the public node default',async()=>{
  const node=createAuthoritativeV4PeerNodeEclipseCandidate({
    eclipseDirectoryOptions:{maxRecordsPerSource:7,maxRecordsPerNetworkGroup:5},
    eclipseDiscoveryOptions:{peerDiversityOptions:{minPinnedIdentities:0}},
    peerDiversityOptions:{minPinnedIdentities:0}
  });
  try{
    const status=node.status();
    assert.equal(status.peer_directory_admission.maxRecordsPerSource,7);
    assert.equal(status.peer_directory_admission.maxRecordsPerNetworkGroup,5);
    assert.deepEqual(status.peer_directory_admission.protectedSources,['self']);
    assert.equal(status.peer_view_authority,'eclipse-resistant-candidate-v1');
  }finally{
    await node.close();
  }
});
