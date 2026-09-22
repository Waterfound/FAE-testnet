export const COIN_ATOMS = 100_000_000n;

export const ECONOMIC_V2_300 = Object.freeze({
  authority: 'candidate-not-active-consensus',
  networkId: 'fairyelf-public-testnet-v5-candidate-300s',
  targetSeconds: 300,
  initialSubsidyAtoms: 1_400_000_000n,
  halvingEraBlocks: 430_000,
  theoreticalCapAtoms: 1_204_000_000_000_000n,
  coinbaseMaturityBlocks: 200,
  maxTxPerBlock: 20,
  daaBinding: Object.freeze({
    family: 'anchored-asert-style-full-target',
    targetSeconds: 300,
    halfLifeSeconds: 6 * 60 * 60,
    mtpWindow: 11,
    futureDriftSeconds: 90,
    arithmetic: 'integer-only',
    targetRepresentation: 'uint256-full-target',
    vectors: 'protocol/DIFFICULTY_TIMESTAMP_V2_300_VECTORS.json',
    crossRuntimeValidation: 'node22+python3',
  }),
});

export function subsidyAtoms(height) {
  if (!Number.isSafeInteger(height) || height < 1) throw new RangeError('height must be a positive safe integer');
  const era = Math.floor((height - 1) / ECONOMIC_V2_300.halvingEraBlocks);
  if (era >= 63) return 0n;
  return ECONOMIC_V2_300.initialSubsidyAtoms >> BigInt(era);
}

export function issuanceAtomsThroughHeight(height) {
  if (!Number.isSafeInteger(height) || height < 0) throw new RangeError('height must be a non-negative safe integer');
  if (height === 0) return 0n;

  let remainingBlocks = BigInt(height);
  const eraBlocks = BigInt(ECONOMIC_V2_300.halvingEraBlocks);
  let reward = ECONOMIC_V2_300.initialSubsidyAtoms;
  let issued = 0n;

  while (remainingBlocks > 0n && reward > 0n) {
    const blocks = remainingBlocks < eraBlocks ? remainingBlocks : eraBlocks;
    issued += blocks * reward;
    remainingBlocks -= blocks;
    reward >>= 1n;
  }

  return issued > ECONOMIC_V2_300.theoreticalCapAtoms
    ? ECONOMIC_V2_300.theoreticalCapAtoms
    : issued;
}

export function terminalIssuanceAtoms() {
  let reward = ECONOMIC_V2_300.initialSubsidyAtoms;
  const eraBlocks = BigInt(ECONOMIC_V2_300.halvingEraBlocks);
  let issued = 0n;
  while (reward > 0n) {
    issued += reward * eraBlocks;
    reward >>= 1n;
  }
  return issued;
}

export function terminalShortfallAtoms() {
  return ECONOMIC_V2_300.theoreticalCapAtoms - terminalIssuanceAtoms();
}

// Frozen maturity convention: a coinbase created at height H may first be
// consumed by a block at height H + 200. Mempool admission for nextHeight N
// uses the same predicate with N as spendHeight.
export function coinbaseSpendableAtHeight(createdHeight, spendHeight) {
  if (!Number.isSafeInteger(createdHeight) || createdHeight < 1) throw new RangeError('createdHeight must be positive');
  if (!Number.isSafeInteger(spendHeight) || spendHeight < 1) throw new RangeError('spendHeight must be positive');
  return spendHeight >= createdHeight + ECONOMIC_V2_300.coinbaseMaturityBlocks;
}

export function candidateManifest() {
  return {
    authority: ECONOMIC_V2_300.authority,
    networkId: ECONOMIC_V2_300.networkId,
    targetSeconds: ECONOMIC_V2_300.targetSeconds,
    initialSubsidyAtoms: ECONOMIC_V2_300.initialSubsidyAtoms.toString(),
    halvingEraBlocks: ECONOMIC_V2_300.halvingEraBlocks,
    theoreticalCapAtoms: ECONOMIC_V2_300.theoreticalCapAtoms.toString(),
    terminalIssuanceAtoms: terminalIssuanceAtoms().toString(),
    terminalShortfallAtoms: terminalShortfallAtoms().toString(),
    coinbaseMaturityBlocks: ECONOMIC_V2_300.coinbaseMaturityBlocks,
    maxTxPerBlock: ECONOMIC_V2_300.maxTxPerBlock,
    daaBinding: ECONOMIC_V2_300.daaBinding,
    activationAuthorized: false,
    publicConsensusChanged: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(candidateManifest(), null, 2));
}
