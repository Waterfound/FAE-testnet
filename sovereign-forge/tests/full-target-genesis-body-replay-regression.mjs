import assert from 'node:assert/strict';
import {legacyBlocks} from './legacy-testnet-fixture.mjs';
import {encodeAddress} from '../node/authoritative/address.mjs';
import {hashHex,sha256} from '../node/authoritative/crypto.mjs';
import {freezeActivationPolicy} from '../node/authoritative/activation-reorg-candidate.mjs';
import {activationPolicyDescriptor} from '../node/authoritative/activation-policy-identity-candidate.mjs';
import {mineFullActivationCandidate,appendRehearsedCandidate} from '../node/authoritative/full-activation-rehearsal-candidate.mjs';
import {
  activatedHeaderRecord,
  activatedBlockRecord,
  validateMixedHeaderSequence,
  validateDownloadedBodies
} from '../node/authoritative/full-target-headers-sync-candidate.mjs';

const policy=freezeActivationPolicy({activationHeight:12});
const descriptor=activationPolicyDescriptor(policy);
const miner=encodeAddress(sha256(Buffer.from('post-colony-genesis-body-replay')).subarray(0,20),'faet');
const historical=structuredClone(legacyBlocks);

// Build only the candidate suffix. The historical H1-H11 records are deliberately
// passed through the same full-target headers/body pipeline below; this is the path
// the original Colony C did not exercise because it reconstructed history first.
const t12=historical.at(-1).timestamp_ms+6*60*60_000+180_000;
const m12=mineFullActivationCandidate(historical,policy,{minerAddress:miner,timestampMs:t12,maxNonce:5_000_000});
assert.equal(m12.verdict.ok,true);
let chain=appendRehearsedCandidate(historical,m12.candidate,policy,{nowMs:t12});
const t13=t12+180_000;
const m13=mineFullActivationCandidate(chain,policy,{minerAddress:miner,timestampMs:t13,maxNonce:5_000_000});
assert.equal(m13.verdict.ok,true);
chain=appendRehearsedCandidate(chain,m13.candidate,policy,{nowMs:t13});

const headers=[...historical.map(row=>structuredClone(row)),activatedHeaderRecord(m12.candidate),activatedHeaderRecord(m13.candidate)];
const blocks=[...historical.map(row=>structuredClone(row)),activatedBlockRecord(m12.candidate),activatedBlockRecord(m13.candidate)];

const headerReplay=validateMixedHeaderSequence([],headers,policy,{remotePolicyDescriptor:descriptor,nowMs:t13});
const bodyReplay=validateDownloadedBodies([],headers,blocks,policy,{remotePolicyDescriptor:descriptor,nowMs:t13});
assert.equal(headerReplay.ok,true);
assert.equal(bodyReplay.ok,true);
assert.equal(headerReplay.chain.length,13);
assert.equal(bodyReplay.chain.length,13);
assert.equal(bodyReplay.chain.at(-1).hash,m13.candidate.hash);
assert.equal(headerReplay.work,bodyReplay.work);

// Historical H1-H11 must remain the exact checkpoint encoding: empty body and no
// retroactively injected tx_root/tx_count. Both header and body copies are changed
// together so the failure is specifically the historical-encoding rule, not a
// generic header/body mismatch.
const normalizedHeaders=structuredClone(headers);
const normalizedBlocks=structuredClone(blocks);
normalizedHeaders[0].header_json.tx_root=hashHex([]);
normalizedHeaders[0].header_json.tx_count=0;
normalizedBlocks[0].header_json.tx_root=hashHex([]);
normalizedBlocks[0].header_json.tx_count=0;
assert.throws(
  ()=>validateDownloadedBodies([],normalizedHeaders,normalizedBlocks,policy,{remotePolicyDescriptor:descriptor,enforceFutureDrift:false}),
  /invalid_historical_legacy_block/
);

// A post-checkpoint legacy body still requires the modern commitment format; the
// historical exception is deliberately bounded to immutable checkpoint heights.
const policy14=freezeActivationPolicy({activationHeight:14});
const descriptor14=activationPolicyDescriptor(policy14);
const synthetic12={
  height:12,hash:'f'.repeat(64),previous_hash:historical.at(-1).hash,
  timestamp_ms:historical.at(-1).timestamp_ms+180_000,difficulty_bits:18,reward_atoms:'1000000000',
  header_json:{height:12,network:'fairyelf-public-testnet-v4',previous_hash:historical.at(-1).hash,timestamp_ms:historical.at(-1).timestamp_ms+180_000,difficulty_bits:18,miner_address:miner,reward_atoms:'1000000000',nonce:0},txids:[]
};
assert.throws(
  ()=>validateDownloadedBodies(historical,[synthetic12],[synthetic12],policy14,{remotePolicyDescriptor:descriptor14,enforceFutureDrift:false}),
  /legacy_block_tx_commitment_mismatch|invalid_proof_of_work/
);

console.log(JSON.stringify({
  status:'PASS',
  scope:'post-integration-regression',
  candidate_only:true,
  exact_historical_bodies_through_full_target_path:true,
  genesis_to_h_plus_1:true,
  historical_encoding_preserved:true,
  retroactive_normalization_rejected:true,
  final_tip:m13.candidate.hash,
  attempts:m12.attempts+m13.attempts
}));
