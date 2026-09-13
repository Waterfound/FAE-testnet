import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { stableStringify } from '../node/authoritative/canonical.mjs';
import { candidateTxDomain } from '../node/candidate/network-boundary-v2-300.mjs';
import {
  CANDIDATE_TX_VERSION, DEFAULT_CANDIDATE_BINDING, emptyCandidateState,
  deriveCandidateAddress, candidateBlockTemplate, candidateBlockHash, appendCandidateBlock,
} from '../node/candidate/fae-v5-300-core.mjs';
import { targetFromHex, hashMeetsTarget } from '../node/candidate/difficulty-timestamp-v2-300.mjs';

export const STEP_MS = 300_000;

// Public, deterministic fixture keys. Never use these addresses for real funds.
export function fixtureWallet(byte) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, byte)]),
    format: 'der', type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return { privateKey, publicKeySpki: spki.toString('base64'), address: deriveCandidateAddress(spki) };
}

export function fixtureTx(owner, inputs, outputs, binding = DEFAULT_CANDIDATE_BINDING) {
  const unsigned = {
    version: CANDIDATE_TX_VERSION, network: binding.network, inputs,
    outputs: outputs.map(output => ({ address: output.address, amount_atoms: String(output.amount_atoms) })),
    public_key_spki: owner.publicKeySpki,
  };
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(stableStringify(candidateTxDomain(unsigned, binding))), owner.privateKey).toString('base64'),
  };
}

export function fixtureNext(state, minerAddress, timestampMs, txids = []) {
  const template = candidateBlockTemplate(state, { minerAddress, timestampMs, txids });
  const target = targetFromHex(template.header.target_hex);
  for (let nonce = 0; nonce < 100_000; nonce++) {
    const hash = candidateBlockHash(template.header, nonce);
    if (hashMeetsTarget(hash, target)) {
      return appendCandidateBlock(state, { ...template, nonce, hash }, { nowMs: timestampMs });
    }
  }
  throw new Error('fixture_pow_bound_exceeded');
}

export function fixtureChain({ height = 200, baseTime = 1_800_000_000_000, miner = fixtureWallet(71) } = {}) {
  let state = emptyCandidateState();
  for (let h = 1; h <= height; h++) state = fixtureNext(state, miner.address, baseTime + (h - 1) * STEP_MS);
  return { state, miner, baseTime };
}
