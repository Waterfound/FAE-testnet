import assert from 'node:assert/strict';
import test from 'node:test';
import {EclipseResistantDiscovery} from '../node/lab/peer-isolation-eclipse-candidate.mjs';

const id=n=>n.toString(16).padStart(64,'0');
const peer=(endpoint,identityId,source='gossip')=>({endpoint,identityId,source});

test('descriptor flood cannot evict the out-of-band anchor',()=>{
  let now=1_900_000_000_000;
  const anchor=id(1),discovery=new EclipseResistantDiscovery({pinnedIdentityIds:[anchor],maxRecords:24,maxEndpointsPerIdentity:2,now:()=>now});
  discovery.ingest([peer('https://anchor.operator.example',anchor,'operator')]);
  for(let i=0;i<400;i++){
    now+=1;
    discovery.ingest([peer(`http://10.${Math.floor(i/240)}.${Math.floor(i/16)%15}.${(i%240)+1}:8787`,id(i+10))]);
  }
  const snapshot=discovery.snapshot();
  assert.equal(snapshot.length,24,'directory remains bounded');
  assert.ok(snapshot.some(row=>row.identityId===anchor&&row.pinned),'pinned anchor survives descriptor churn');
  assert.equal(snapshot.filter(row=>row.pinned).length,1);
});

test('probe ordering is pinned-first and spreads across network groups under Sybil pressure',()=>{
  let now=1_900_100_000_000;
  const anchor=id(2),discovery=new EclipseResistantDiscovery({pinnedIdentityIds:[anchor],maxRecords:128,maxProbeBatch:8,now:()=>now});
  discovery.ingest([peer('https://anchor.alpha.example',anchor,'operator')]);
  discovery.ingest(Array.from({length:40},(_,i)=>peer(`http://10.7.9.${i+1}:8787`,id(100+i))));
  discovery.ingest(Array.from({length:8},(_,i)=>peer(`https://node-${i}.group-${i}.example`,id(200+i))));
  const batch=discovery.probeBatch({limit:8});
  assert.equal(batch.length,8);
  assert.equal(batch[0].identityId,anchor,'out-of-band anchor is probed before ordinary discovery records');
  assert.ok(new Set(batch.map(row=>row.networkGroup)).size>=7,'probe budget is not consumed by one Sybil-heavy network group');
  assert.ok(batch.filter(row=>row.networkGroup==='ipv4:10.7.9.0/24').length<=1,'first probe round does not let one /24 dominate');
});

test('multi-group Sybils cannot turn readiness GREEN while the pinned anchor is unavailable',()=>{
  let now=1_900_200_000_000;
  const anchor=id(3),discovery=new EclipseResistantDiscovery({pinnedIdentityIds:[anchor],failureBackoffMs:100,maxFailureBackoffMs:1_000,healthyReprobeMs:10_000,now:()=>now});
  const records=[peer('https://anchor.beta.example',anchor,'operator'),peer('http://198.51.100.20:8787',id(31)),peer('http://203.0.113.20:8787',id(32)),peer('https://ordinary.gamma.example',id(33))];
  discovery.ingest(records);
  for(const row of discovery.probeBatch({limit:8}))discovery.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok:row.identityId!==anchor});
  const held=discovery.assessment();
  assert.equal(held.ready,false);assert.equal(held.state,'HOLD');assert.equal(held.livePinned,0);
  assert.ok(held.violations.some(v=>v.code==='insufficient_out_of_band_anchors'));

  now+=101;
  const retry=discovery.probeBatch({limit:8});assert.ok(retry.some(row=>row.identityId===anchor),'failed anchor is retried after bounded backoff instead of disappearing');
  const anchorRow=retry.find(row=>row.identityId===anchor);discovery.markProbeResult({identityId:anchorRow.identityId,endpoint:anchorRow.endpoint,ok:true});
  const recovered=discovery.assessment();assert.equal(recovered.ready,true);assert.equal(recovered.state,'READY');assert.equal(recovered.livePinned,1);
});

test('an authenticated attacker set does not starve an untried independent feeler',()=>{
  let now=1_900_300_000_000;
  const anchor=id(4),discovery=new EclipseResistantDiscovery({pinnedIdentityIds:[anchor],maxProbeBatch:4,healthyReprobeMs:60_000,now:()=>now});
  const initial=[peer('https://anchor.delta.example',anchor,'operator'),peer('http://198.51.100.30:8787',id(41)),peer('http://203.0.113.30:8787',id(42))];
  discovery.ingest(initial);
  for(const row of discovery.probeBatch({limit:4}))discovery.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok:true});
  assert.equal(discovery.assessment().ready,true);

  discovery.ingest([peer('https://fresh.independent.example',id(43),'gossip')]);
  const feeler=discovery.probeBatch({limit:4});
  assert.ok(feeler.some(row=>row.identityId===id(43)),'fresh independent candidate receives probe budget while healthy peers wait for re-probe');
});

test('identity fanout is bounded even when one signer advertises many network locations',()=>{
  let now=1_900_400_000_000;
  const identity=id(50),discovery=new EclipseResistantDiscovery({maxEndpointsPerIdentity:2,maxRecords:20,peerDiversityOptions:{minPinnedIdentities:0},now:()=>now});
  for(let i=0;i<12;i++){now+=1;discovery.ingest([peer(`https://endpoint-${i}.fanout-${i}.example`,identity)])}
  assert.equal(discovery.snapshot().filter(row=>row.identityId===identity).length,2);
  const assessment=discovery.assessment();assert.equal(assessment.distinctIdentities,0,'descriptor presence alone is not counted as authenticated diversity');
});

test('disconnecting the anchor degrades readiness fail-closed until a fresh successful probe',()=>{
  let now=1_900_500_000_000;
  const anchor=id(60),discovery=new EclipseResistantDiscovery({pinnedIdentityIds:[anchor],healthyReprobeMs:10_000,now:()=>now});
  discovery.ingest([peer('https://anchor.zeta.example',anchor,'operator'),peer('http://198.51.100.60:8787',id(61)),peer('http://203.0.113.60:8787',id(62))]);
  for(const row of discovery.probeBatch({limit:8}))discovery.markProbeResult({identityId:row.identityId,endpoint:row.endpoint,ok:true});
  assert.equal(discovery.assessment().ready,true);
  assert.equal(discovery.disconnect(anchor,'https://anchor.zeta.example'),true);
  const held=discovery.assessment();assert.equal(held.ready,false);assert.equal(held.state,'HOLD');assert.equal(held.livePinned,0);
  const retry=discovery.probeBatch({limit:8}).find(row=>row.identityId===anchor);assert.ok(retry);
  discovery.markProbeResult({identityId:retry.identityId,endpoint:retry.endpoint,ok:true});
  assert.equal(discovery.assessment().ready,true);
});
