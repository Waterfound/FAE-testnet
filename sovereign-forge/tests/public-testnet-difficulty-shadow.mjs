import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {observeDifficultyTimestampShadow,deriveShadowAnchor,DIFFICULTY_TIMESTAMP_SHADOW_STATUS} from '../node/authoritative/difficulty-timestamp-shadow.mjs';
import {medianTimePast,targetHex,targetFromLeadingZeroBits} from '../node/authoritative/difficulty-timestamp-candidate.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/public-testnet-v4-heights-398-414.json',import.meta.url),'utf8'));
const chain=fixture.blocks;

test('frozen public-testnet snapshot is contiguous and matches captured tip identity',()=>{
  assert.equal(chain.length,17);assert.equal(chain[0].height,398);assert.equal(chain.at(-1).height,fixture.captured_tip_height);assert.equal(chain.at(-1).hash,fixture.captured_tip_hash);
  for(let i=1;i<chain.length;i++){assert.equal(chain[i].height,chain[i-1].height+1);assert.ok(chain[i].timestamp_ms>=chain[i-1].timestamp_ms)}
});

test('real-data shadow observation with a post-downtime anchor stays near the live integer target',()=>{
  const anchorIndex=12; // height 410, parent height 409; deliberately after the long 408->409 idle gap.
  const anchor=deriveShadowAnchor(chain,{anchorIndex});assert.equal(anchor.height,410);assert.equal(anchor.parent_time_seconds,Math.floor(chain[11].timestamp_ms/1000));assert.equal(targetHex(anchor.target),targetHex(targetFromLeadingZeroBits(22)));
  const nextTimestamp=chain.at(-1).timestamp_ms+180_000,report=observeDifficultyTimestampShadow(chain,{anchorIndex,header:{timestamp_ms:nextTimestamp},nowMs:nextTimestamp});
  assert.equal(report.status,DIFFICULTY_TIMESTAMP_SHADOW_STATUS);assert.equal(report.next_height,415);assert.equal(report.current_integer_bits,22);
  assert.equal(report.candidate_target_hex,'000003f4dbffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  assert.equal(report.candidate_vs_current_target_delta_ppm,-10879);assert.equal(report.timestamp.ok,true);
});

test('MTP on the real tip is well-defined and the observed chain has no timestamp regressions',()=>{
  assert.equal(medianTimePast(chain),1789087770066);for(let i=1;i<chain.length;i++)assert.ok(chain[i].timestamp_ms>=chain[i-1].timestamp_ms);
});

test('anchor sensitivity demonstrates why activation must pin an explicit post-boundary anchor',()=>{
  const early=observeDifficultyTimestampShadow(chain,{anchorIndex:1});
  const postGap=observeDifficultyTimestampShadow(chain,{anchorIndex:12});
  assert.notEqual(early.candidate_target_hex,postGap.candidate_target_hex);assert.ok(Math.abs(early.candidate_vs_current_target_delta_ppm)>Math.abs(postGap.candidate_vs_current_target_delta_ppm)*10);
});
