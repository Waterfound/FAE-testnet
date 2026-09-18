import assert from 'node:assert/strict';
import test from 'node:test';
import {runFallbackObserverTick} from '../lab/stability-soak-v3/fallback-observer-core.mjs';

const nodes=[
  {name:'node-a',url:'https://a.example'},
  {name:'node-b',url:'https://b.example'},
  {name:'node-c',url:'https://c.example'}
];

test('observer preserves node-local first-seen timestamps while collecting at low cadence',async()=>{
  const captured=[];
  const payloads=new Map(nodes.map((n,i)=>[
    n.url,
    {
      events:{ok:true,last_seq:1,events:[{seq:1,event:'FAE_V3_TIP_FIRST_SEEN',node:n.name,boot_id:`boot-${i}`,height:12,hash:'a'.repeat(64),first_seen_ms:1000+(i*125),at:new Date(1000+(i*125)).toISOString(),at_ms:1000+(i*125)}]},
      meta:{ok:true,boot_id:`boot-${i}`,status:{height:12,tip_hash:'a'.repeat(64)}}
    }
  ]));
  const result=await runFallbackObserverTick({
    nodes,state:{},nowMs:60_000,
    fetchJson:async url=>{
      const base=url.split('/v3/')[0],p=payloads.get(base);
      if(url.includes('/v3/events'))return p.events;
      if(url.includes('/v3/meta'))return p.meta;
      throw new Error('unexpected_url');
    },
    appendEvents:async rows=>captured.push(...rows)
  });
  assert.equal(result.failed,false);
  const seen=captured.filter(e=>e.event==='FAE_V3_TIP_FIRST_SEEN');
  assert.equal(seen.length,3);
  assert.deepEqual(seen.map(e=>e.first_seen_ms),[1000,1125,1250]);
  assert.ok(seen.every(e=>e.observer_collected_at_ms===60_000));
});

test('observer uses conservative upper bound and fails when a transport gap could exceed 180s',async()=>{
  const captured=[];
  const state={
    'node-a':{last_seq:0,last_success_ms:0,outage_open_ms:60_000,fail_emitted:false},
    'node-b':{last_seq:0,last_success_ms:181_000,outage_open_ms:null,fail_emitted:false},
    'node-c':{last_seq:0,last_success_ms:181_000,outage_open_ms:null,fail_emitted:false}
  };
  const result=await runFallbackObserverTick({
    nodes,state,nowMs:181_001,
    fetchJson:async url=>{
      if(url.startsWith('https://a.example'))throw new Error('offline');
      if(url.includes('/v3/events'))return{ok:true,last_seq:0,events:[]};
      return{ok:true,boot_id:'b',status:{height:11,tip_hash:'b'.repeat(64)}};
    },
    appendEvents:async rows=>captured.push(...rows)
  });
  assert.equal(result.failed,true);
  const fail=captured.find(e=>e.event==='FAE_V3_FAIL'&&e.node==='node-a');
  assert.equal(fail.reason,'observer_transport_gap_upper_bound_exceeded');
  assert.equal(fail.duration_ms,181_001);
  assert.equal(fail.bound_ms,180_000);
});

test('recovery at an upper bound of exactly 180s remains admissible',async()=>{
  const captured=[];
  const state=Object.fromEntries(nodes.map(n=>[n.name,{last_seq:0,last_success_ms:0,outage_open_ms:60_000,fail_emitted:false}]));
  const result=await runFallbackObserverTick({
    nodes,state,nowMs:180_000,
    fetchJson:async url=>url.includes('/v3/events')?{ok:true,last_seq:0,events:[]}:{ok:true,boot_id:'x',status:{height:11,tip_hash:'c'.repeat(64)}},
    appendEvents:async rows=>captured.push(...rows)
  });
  assert.equal(result.failed,false);
  assert.equal(captured.filter(e=>e.event==='FAE_V3_FAIL').length,0);
  assert.equal(captured.filter(e=>e.event==='FAE_V3_OBSERVER_TRANSPORT_RECOVERED').length,3);
});
