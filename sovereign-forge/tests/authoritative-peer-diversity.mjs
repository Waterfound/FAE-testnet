import assert from 'node:assert/strict';
import test from 'node:test';
import {PeerDiversityPolicy,networkGroupForEndpoint} from '../node/authoritative/peer-diversity.mjs';
import {PeerDirectory,createPeerDescriptor,verifyPeerDescriptor} from '../node/authoritative/peer-directory.mjs';
import {generateNodeIdentity} from '../node/authoritative/node-identity.mjs';

const NETWORK='fairyelf-public-testnet-v4';
const id=n=>n.toString(16).padStart(64,'0');

function peer(endpoint,identityId,{source='discovered'}={}){return{endpoint,identityId,source}}

test('diversity policy groups IPv4 /24, IPv6 /48 and DNS conservatively',()=>{
  assert.equal(networkGroupForEndpoint('https://203.0.113.10:8787'),'ipv4:203.0.113.0/24');
  assert.equal(networkGroupForEndpoint('http://203.0.113.250'),'ipv4:203.0.113.0/24');
  assert.equal(networkGroupForEndpoint('https://[2001:db8:abcd:1::1]:8787'),'ipv6:2001:0db8:abcd::/48');
  assert.equal(networkGroupForEndpoint('https://node-a.example.org'),'dns:example.org');
  assert.equal(networkGroupForEndpoint('https://node-b.example.org'),'dns:example.org');
});

test('many Sybil identities in one network group cannot satisfy eclipse-readiness gate',()=>{
  const policy=new PeerDiversityPolicy({minDistinctIdentities:3,minDistinctNetworkGroups:3,minPinnedIdentities:1,maxPerNetworkGroup:2,pinnedIdentityIds:[id(1)]});
  const records=[peer('http://10.1.2.1:8787',id(1)),...Array.from({length:30},(_,i)=>peer(`http://10.1.2.${i+20}:8787`,id(i+2)))];
  const result=policy.evaluate(records);
  assert.equal(result.ready,false);assert.equal(result.distinctIdentities,31);assert.equal(result.distinctNetworkGroups,1);assert.ok(result.violations.some(v=>v.code==='insufficient_network_diversity'));assert.ok(result.violations.some(v=>v.code==='network_group_concentration'));
  const selected=policy.select(records,{limit:8});assert.ok(selected.length<=2,'one /24 must not dominate selected sync peers');assert.ok(selected.some(p=>p.pinned),'pinned anchor should be preferred within its group');
});

test('three unrelated groups with an out-of-band pinned identity satisfy the diversity gate',()=>{
  const policy=new PeerDiversityPolicy({pinnedIdentityIds:[id(10)]});
  const records=[
    peer('https://node-a.alpha.example',id(10),{source:'operator'}),
    peer('http://198.51.100.20:8787',id(11)),
    peer('http://203.0.113.40:8787',id(12)),
    peer('http://198.51.100.21:8787',id(13)),
  ];
  const result=policy.evaluate(records);assert.equal(result.ready,true);assert.equal(result.distinctIdentities,4);assert.equal(result.distinctNetworkGroups,3);assert.equal(result.pinnedIdentities,1);
  const selected=policy.select(records,{limit:3});assert.equal(selected.length,3);assert.equal(new Set(selected.map(p=>p.networkGroup)).size,3);assert.equal(selected[0].pinned,true);
});

test('one identity across many endpoints counts once and cannot manufacture identity diversity',()=>{
  const policy=new PeerDiversityPolicy({minDistinctIdentities:3,minDistinctNetworkGroups:3,minPinnedIdentities:0,maxPerNetworkGroup:2});
  const records=[
    peer('http://192.0.2.10:8787',id(50)),
    peer('http://198.51.100.10:8787',id(50)),
    peer('http://203.0.113.10:8787',id(50)),
  ];
  const result=policy.evaluate(records);assert.equal(result.distinctIdentities,1);assert.equal(result.distinctNetworkGroups,3);assert.equal(result.ready,false);assert.ok(result.violations.some(v=>v.code==='insufficient_identity_diversity'));
  assert.equal(policy.select(records,{limit:8}).length,1);
});

test('same endpoint claiming two identities is an explicit conflict',()=>{
  const policy=new PeerDiversityPolicy({minDistinctIdentities:0,minDistinctNetworkGroups:0,minPinnedIdentities:0,maxPerNetworkGroup:8});
  const result=policy.evaluate([peer('https://peer.example',id(70)),peer('https://peer.example/',id(71))]);
  assert.equal(result.ready,false);assert.ok(result.violations.some(v=>v.code==='endpoint_identity_conflict'));
});

test('deterministic selection round-robins network groups instead of taking a Sybil-heavy prefix',()=>{
  const policy=new PeerDiversityPolicy({minDistinctIdentities:0,minDistinctNetworkGroups:0,minPinnedIdentities:0,maxPerNetworkGroup:2,pinnedIdentityIds:[id(90)]});
  const records=[
    ...Array.from({length:8},(_,i)=>peer(`http://10.9.8.${i+1}:8787`,id(100+i))),
    peer('http://198.51.100.8:8787',id(90)),
    peer('http://203.0.113.8:8787',id(91)),
    peer('https://peer.delta.example',id(92)),
  ];
  const first=policy.select(records,{limit:4}),second=policy.select(records,{limit:4});assert.deepEqual(first,second);assert.equal(first.length,4);assert.equal(new Set(first.map(p=>p.networkGroup)).size,4);assert.ok(first.some(p=>p.identityId===id(90)));
});

test('signed peer descriptors are short-lived network-bound discovery hints, not anonymous endpoint claims',()=>{
  const identity=generateNodeIdentity(),now=1_800_000_000_000;
  const envelope=createPeerDescriptor(identity,{networkId:NETWORK,endpoint:'https://node-a.example.org/',capabilities:['headers-first','encrypted-peer-channel-v1','headers-first'],ttlMs:3_600_000,now});
  const descriptor=verifyPeerDescriptor(envelope,{networkId:NETWORK,now:now+1000});
  assert.equal(descriptor.peerId,identity.id);assert.equal(descriptor.endpoint,'https://node-a.example.org');assert.deepEqual(descriptor.capabilities,['encrypted-peer-channel-v1','headers-first']);
  const tampered=structuredClone(envelope);tampered.payload.endpoint='https://attacker.example';assert.throws(()=>verifyPeerDescriptor(tampered,{networkId:NETWORK,now:now+1000}),/signature/i);
  assert.throws(()=>verifyPeerDescriptor(envelope,{networkId:'other-network',now:now+1000}),/network mismatch/i);
  assert.throws(()=>verifyPeerDescriptor(envelope,{networkId:NETWORK,now:now+3_700_000}),/expired|time/i);
});

test('peer directory bounds endpoint fanout per identity and exposes descriptor-only observations for diversity scoring',()=>{
  const identity=generateNodeIdentity(),other=generateNodeIdentity(),now=1_800_000_000_000;
  const directory=new PeerDirectory({networkId:NETWORK,maxRecords:8,maxEndpointsPerIdentity:2,now:()=>now+1000});
  for(const endpoint of['http://198.51.100.1:8787','http://203.0.113.1:8787','https://node-x.example.org'])directory.register(createPeerDescriptor(identity,{networkId:NETWORK,endpoint,now,ttlMs:3_600_000}),{source:'peer-gossip'});
  directory.register(createPeerDescriptor(other,{networkId:NETWORK,endpoint:'https://node-y.other.example',now,ttlMs:3_600_000}),{source:'operator'});
  const observations=directory.observations();assert.equal(observations.filter(row=>row.identityId===identity.id).length,2);assert.equal(observations.filter(row=>row.identityId===other.id).length,1);assert.ok(observations.every(row=>row.descriptorOnly===true));
  const descriptors=directory.descriptors({limit:8});assert.equal(descriptors.length,3);
});
