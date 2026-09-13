import assert from 'node:assert/strict';
import {
  COIN_ATOMS,
  ECONOMIC_V2_300,
  subsidyAtoms,
  issuanceAtomsThroughHeight,
  terminalIssuanceAtoms,
  terminalShortfallAtoms,
  coinbaseSpendableAtHeight,
  candidateManifest,
} from '../node/candidate/economic-v2-300.mjs';

assert.equal(COIN_ATOMS, 100_000_000n);
assert.equal(ECONOMIC_V2_300.authority, 'candidate-not-active-consensus');
assert.equal(ECONOMIC_V2_300.targetSeconds, 300);
assert.equal(ECONOMIC_V2_300.initialSubsidyAtoms, 1_400_000_000n);
assert.equal(ECONOMIC_V2_300.halvingEraBlocks, 430_000);
assert.equal(ECONOMIC_V2_300.theoreticalCapAtoms, 1_204_000_000_000_000n);
assert.equal(ECONOMIC_V2_300.coinbaseMaturityBlocks, 200);
assert.equal(ECONOMIC_V2_300.maxTxPerBlock, 20);

// Era boundaries are height-1 indexed: heights 1..430000 receive 14 FAE.
assert.equal(subsidyAtoms(1), 14n * COIN_ATOMS);
assert.equal(subsidyAtoms(430_000), 14n * COIN_ATOMS);
assert.equal(subsidyAtoms(430_001), 7n * COIN_ATOMS);
assert.equal(subsidyAtoms(860_000), 7n * COIN_ATOMS);
assert.equal(subsidyAtoms(860_001), 350_000_000n);

assert.equal(issuanceAtomsThroughHeight(0), 0n);
assert.equal(issuanceAtomsThroughHeight(1), 14n * COIN_ATOMS);
assert.equal(issuanceAtomsThroughHeight(430_000), 6_020_000n * COIN_ATOMS);
assert.equal(issuanceAtomsThroughHeight(860_000), 9_030_000n * COIN_ATOMS);

// Integer-atom halvings terminate naturally below the theoretical geometric cap.
assert.equal(terminalIssuanceAtoms(), 1_203_999_994_840_000n);
assert.equal(terminalShortfallAtoms(), 5_160_000n);
assert.equal(terminalShortfallAtoms(), 0.0516 * Number(COIN_ATOMS));
assert.ok(terminalIssuanceAtoms() < ECONOMIC_V2_300.theoreticalCapAtoms);
assert.equal(issuanceAtomsThroughHeight(Number.MAX_SAFE_INTEGER), terminalIssuanceAtoms());

// Frozen 200-block maturity convention.
assert.equal(coinbaseSpendableAtHeight(1, 200), false);
assert.equal(coinbaseSpendableAtHeight(1, 201), true);
assert.equal(coinbaseSpendableAtHeight(430_000, 430_199), false);
assert.equal(coinbaseSpendableAtHeight(430_000, 430_200), true);

// DAA binding is a candidate dependency, not a silent reuse of 180-second vectors.
assert.equal(ECONOMIC_V2_300.daaBinding.targetSeconds, 300);
assert.equal(ECONOMIC_V2_300.daaBinding.halfLifeSeconds, 21_600);
assert.equal(ECONOMIC_V2_300.daaBinding.mtpWindow, 11);
assert.equal(ECONOMIC_V2_300.daaBinding.futureDriftSeconds, 90);
assert.equal(ECONOMIC_V2_300.daaBinding.vectors, 'REGENERATE_FOR_300S_BEFORE_ACTIVATION');

const manifest = candidateManifest();
assert.equal(manifest.activationAuthorized, false);
assert.equal(manifest.publicConsensusChanged, false);
assert.equal(manifest.terminalIssuanceAtoms, '1203999994840000');
assert.equal(manifest.terminalShortfallAtoms, '5160000');

assert.throws(() => subsidyAtoms(0), RangeError);
assert.throws(() => issuanceAtomsThroughHeight(-1), RangeError);
assert.throws(() => coinbaseSpendableAtHeight(0, 200), RangeError);

console.log('economic-v2-300-candidate: PASS');
