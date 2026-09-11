import assert from 'node:assert/strict';
import test from 'node:test';
import {DIFFICULTY_TIMESTAMP_SHADOW_STATUS,deriveShadowAnchor,observeDifficultyTimestampShadow} from '../node/authoritative/difficulty-timestamp-shadow.mjs';

function scheduledChain({count=12,bits=18,baseMs=1_900_000_000_000}={}){
  return Array.from({length:count},(_,i)=>({height:i+1,timestamp_ms:baseMs+i*180_000,difficulty_bits:bits,hash:String(i+1).padStart(64,'0')}));
}

test('shadow observer is exactly neutral on an on-schedule constant-difficulty chain',()=>{
  const chain=scheduledChain(),anchor=deriveShadowAnchor(chain,{anchorIndex:1}),nextTimestamp=chain.at(-1).timestamp_ms+180_000;
  const observed=observeDifficultyTimestampShadow(chain,{anchor,header:{timestamp_ms:nextTimestamp},nowMs:nextTimestamp});
  assert.equal(observed.status,'observer-only-not-consensus');assert.equal(observed.status,DIFFICULTY_TIMESTAMP_SHADOW_STATUS);assert.equal(observed.candidate_status,'candidate-not-active-consensus');
  assert.equal(observed.next_height,13);assert.equal(observed.candidate_vs_current_target_delta_ppm,0);assert.equal(observed.candidate_target_hex,observed.current_integer_target_hex);assert.equal(observed.timestamp.ok,true);
});

test('shadow observer reports an easier candidate target after sustained schedule lag without changing chain state',()=>{
  const chain=scheduledChain();const before=structuredClone(chain),anchor=deriveShadowAnchor(chain,{anchorIndex:1});
  for(let i=4;i<chain.length;i++)chain[i].timestamp_ms+=600_000;
  const observed=observeDifficultyTimestampShadow(chain,{anchor,nowMs:chain.at(-1).timestamp_ms});
  assert.ok(observed.candidate_vs_current_target_delta_ppm>0);assert.deepEqual(chain.slice(0,4),before.slice(0,4));assert.equal(observed.status,'observer-only-not-consensus');
});

test('shadow timestamp failure is telemetry only and is returned instead of mutating/rejecting the authoritative chain',()=>{
  const chain=scheduledChain(),snapshot=structuredClone(chain),anchor=deriveShadowAnchor(chain,{anchorIndex:1}),now=chain.at(-1).timestamp_ms+180_000;
  const observed=observeDifficultyTimestampShadow(chain,{anchor,header:{timestamp_ms:now+90_001},nowMs:now});
  assert.equal(observed.timestamp.ok,false);assert.equal(observed.timestamp.error,'timestamp_too_far_future');assert.deepEqual(chain,snapshot);
});

test('anchor derivation fails closed when parent context is unavailable or index is invalid',()=>{
  assert.throws(()=>deriveShadowAnchor(scheduledChain({count:1})),/shadow_anchor_requires_two_blocks/);
  assert.throws(()=>deriveShadowAnchor(scheduledChain(),{anchorIndex:0}),/shadow_anchor_index_out_of_range/);
});
