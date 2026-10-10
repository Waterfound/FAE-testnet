import assert from 'node:assert/strict';
import {preferred} from '../../sovereign-forge/node/authoritative/fae-v4-core.mjs';

function block(hash,bits=18,height=1){
  return{height,hash,difficulty_bits:bits,reward_atoms:'0'};
}
function state(hash,bits=18){return{chain:[block(hash,bits)]}}

const smaller='0'.repeat(63)+'1';
const larger='0'.repeat(63)+'2';
assert.equal(preferred(state(smaller),state(larger)),true);
assert.equal(preferred(state(larger),state(smaller)),false);

const rows=[];
for(const candidates of[1,2,3,4,8,16,32]){
  rows.push({
    attacker_valid_candidates:candidates,
    probability_min_attacker_hash_beats_one_honest_hash:candidates/(candidates+1),
    expected_same_height_valid_work_multiple:candidates
  });
}

console.log(JSON.stringify({
  schema:'FAE_EQUAL_WORK_TIEBREAK_GRINDING_MODEL_V1',
  current_rule:'equal cumulative work -> lexicographically smaller tip hash wins',
  source_behavior_verified:true,
  rows,
  interpretation:[
    'A deterministic smallest-hash tie-break is selectable by a miner that spends additional work searching for multiple valid same-height candidates.',
    'The selection advantage is not free: finding k valid candidates costs about k valid-block work opportunities and competes with extending the private chain.',
    'Whether this improves selfish/stubborn-mining profitability in FAE remains unresolved and must be modeled with frozen DAA, propagation and block-time parameters.'
  ],
  verdict:'TIEBREAK_GRINDING_SURFACE_CONFIRMED__PROFITABILITY_UNRESOLVED',
  authority:'ASSURANCE_ONLY'
},null,2));
