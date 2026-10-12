import assert from 'node:assert/strict';
import test from 'node:test';
import {targetFromLeadingZeroBits,targetHex} from '../node/authoritative/difficulty-timestamp-candidate.mjs';
import {
  FULL_TARGET_MIGRATION_STATUS,workFromTarget,legacyBitsWork,legacyTargetWork,mixedChainWork,projectFullTargetBlock,encodeFullTargetBlockCandidate,decodeFullTargetBlockCandidate
} from '../node/authoritative/full-target-migration-candidate.mjs';
import {FULL_TARGET_ACTIVATION_STATUS,validateWorkCommitmentForHeight,mixedActivatedChainWork} from '../node/authoritative/full-target-activation-candidate.mjs';

function sampleCandidate({bits=18}={}){return{header:{network:'fairyelf-public-testnet-v4',height:123,previous_hash:'1'.repeat(64),timestamp_ms:1900000000000,difficulty_bits:bits,miner_address:'faet1candidate',reward_atoms:'1000000000',tx_root:'2'.repeat(64),tx_count:0},nonce:42,hash:'3'.repeat(64),txids:[]}}

test('full-target migration remains explicitly non-authoritative',()=>{assert.equal(FULL_TARGET_MIGRATION_STATUS,'candidate-not-active-consensus');assert.equal(FULL_TARGET_ACTIVATION_STATUS,'candidate-not-active-consensus')});

test('target-derived work exactly preserves every legacy leading-zero work unit',()=>{
  for(let bits=0;bits<=255;bits++)assert.equal(legacyTargetWork(bits),legacyBitsWork(bits),`bits=${bits}`);
});

test('smooth full targets produce monotonic cumulative work between adjacent legacy bit levels',()=>{
  for(let bits=12;bits<28;bits++){
    const easy=targetFromLeadingZeroBits(bits),hard=targetFromLeadingZeroBits(bits+1),middle=(easy+hard)/2n;
    const wEasy=workFromTarget(easy),wMiddle=workFromTarget(middle),wHard=workFromTarget(hard);
    assert.ok(wEasy<wMiddle&&wMiddle<wHard,`bits=${bits}`);assert.equal(wEasy,1n<<BigInt(bits));assert.equal(wHard,1n<<BigInt(bits+1));
  }
});

test('mixedChainWork is continuous across legacy-bit and equivalent full-target records',()=>{
  const legacy=[18,18,19,17].map((difficulty_bits,i)=>({height:i+1,difficulty_bits}));
  const migrated=legacy.map((block,i)=>i<2?block:{height:block.height,target_hex:targetHex(targetFromLeadingZeroBits(block.difficulty_bits))});
  assert.equal(mixedChainWork(legacy),mixedChainWork(migrated));
});

test('full-target block codec is lossless and removes integer difficulty_bits from the migrated header',()=>{
  const candidate=sampleCandidate(),projected=projectFullTargetBlock(candidate,targetFromLeadingZeroBits(candidate.header.difficulty_bits)),encoded=encodeFullTargetBlockCandidate(projected),decoded=decodeFullTargetBlockCandidate(encoded);
  assert.deepEqual(decoded,projected);assert.equal(decoded.header.difficulty_bits,undefined);assert.match(decoded.header.target_hex,/^[0-9a-f]{64}$/);
  assert.throws(()=>decodeFullTargetBlockCandidate(Buffer.concat([encoded,Buffer.from([0])])),/trailing_bytes/);
  assert.throws(()=>decodeFullTargetBlockCandidate(encoded.subarray(0,encoded.length-1)),/truncated_full_target_payload/);
  const wrongMagic=Buffer.from(encoded);wrongMagic[0]^=0xff;assert.throws(()=>decodeFullTargetBlockCandidate(wrongMagic),/magic_mismatch/);
});

test('activation boundary fails closed in both directions and preserves cumulative work exactly at the boundary',()=>{
  const activationHeight=4,chain=[
    {height:1,difficulty_bits:18},{height:2,difficulty_bits:18},{height:3,difficulty_bits:19},
    {height:4,target_hex:targetHex(targetFromLeadingZeroBits(19))},{height:5,target_hex:targetHex(targetFromLeadingZeroBits(20))}
  ];
  const expected=(1n<<18n)+(1n<<18n)+(1n<<19n)+(1n<<19n)+(1n<<20n);assert.equal(mixedActivatedChainWork(chain,{activationHeight}),expected);
  assert.equal(validateWorkCommitmentForHeight(chain[2],{activationHeight}).mode,'legacy-bits');assert.equal(validateWorkCommitmentForHeight(chain[3],{activationHeight}).mode,'full-target');
  assert.throws(()=>validateWorkCommitmentForHeight({height:3,target_hex:targetHex(targetFromLeadingZeroBits(19))},{activationHeight}),/premature_full_target_commitment/);
  assert.throws(()=>validateWorkCommitmentForHeight({height:4,difficulty_bits:19},{activationHeight}),/legacy_bits_forbidden/);
  assert.throws(()=>validateWorkCommitmentForHeight({height:4},{activationHeight}),/full_target_commitment_required/);
});

test('full-target codec preserves activated coinbase commitment fields',()=>{
  const candidate=sampleCandidate();Object.assign(candidate.header,{fee_atoms:'1000',coinbase_root:'4'.repeat(64),coinbase_count:2,coinbase_mode:'pplns-direct'});candidate.coinbase_outputs=[{address:'faet1a',amount_atoms:'500000500'},{address:'faet1b',amount_atoms:'500000500'}];
  const projected=projectFullTargetBlock(candidate,targetFromLeadingZeroBits(18));assert.deepEqual(decodeFullTargetBlockCandidate(encodeFullTargetBlockCandidate(projected)),projected);
});
