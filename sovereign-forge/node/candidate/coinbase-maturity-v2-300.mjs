import { ECONOMIC_V2_300 } from './economic-v2-300.mjs';

export const COINBASE_ORIGIN = 'coinbase';
export const TRANSACTION_ORIGIN = 'transaction';

function positiveHeight(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(`${label} must be a positive safe integer`);
  return n;
}

function amountString(value) {
  const amount = BigInt(value);
  if (amount <= 0n) throw new RangeError('amount_atoms must be positive');
  return amount.toString();
}

export function coinbaseMaturesAtHeight(createdHeight) {
  return positiveHeight(createdHeight, 'createdHeight') + ECONOMIC_V2_300.coinbaseMaturityBlocks;
}

export function materializeCoinbaseOutputs({ blockHash, height, outputs }) {
  const createdHeight = positiveHeight(height, 'height');
  if (typeof blockHash !== 'string' || !/^[0-9a-f]{64}$/.test(blockHash)) throw new TypeError('invalid blockHash');
  if (!Array.isArray(outputs) || outputs.length < 1) throw new TypeError('coinbase outputs required');

  return Object.fromEntries(outputs.map((output, index) => {
    const outpoint = `${blockHash}:${index}`;
    return [outpoint, {
      outpoint,
      address: String(output.address),
      amount_atoms: amountString(output.amount_atoms),
      created_height: createdHeight,
      origin: COINBASE_ORIGIN,
      coinbase_matures_at_height: coinbaseMaturesAtHeight(createdHeight),
      spent: false,
      spent_by: null,
    }];
  }));
}

export function materializeTransactionOutput({ outpoint, address, amountAtoms, createdHeight }) {
  const height = positiveHeight(createdHeight, 'createdHeight');
  if (typeof outpoint !== 'string' || outpoint.length < 3) throw new TypeError('invalid outpoint');
  return {
    outpoint,
    address: String(address),
    amount_atoms: amountString(amountAtoms),
    created_height: height,
    origin: TRANSACTION_ORIGIN,
    spent: false,
    spent_by: null,
  };
}

export function spendabilityAtHeight(utxo, spendHeight) {
  const height = positiveHeight(spendHeight, 'spendHeight');
  if (!utxo || typeof utxo !== 'object') return { ok: false, error: 'missing_input' };
  if (utxo.spent) return { ok: false, error: 'spent_input' };

  if (utxo.origin === COINBASE_ORIGIN) {
    const created = positiveHeight(utxo.created_height, 'coinbase created_height');
    const expectedMaturity = coinbaseMaturesAtHeight(created);
    if (Number(utxo.coinbase_matures_at_height) !== expectedMaturity) {
      return { ok: false, error: 'coinbase_maturity_metadata_mismatch', expectedMaturity };
    }
    if (height < expectedMaturity) {
      return {
        ok: false,
        error: 'immature_coinbase',
        createdHeight: created,
        spendHeight: height,
        maturesAtHeight: expectedMaturity,
        remainingBlocks: expectedMaturity - height,
      };
    }
  } else if (utxo.origin !== TRANSACTION_ORIGIN) {
    return { ok: false, error: 'unknown_utxo_origin' };
  }

  return { ok: true };
}

export function assertInputsSpendableAtHeight(utxos, inputOutpoints, spendHeight) {
  if (!utxos || typeof utxos !== 'object') throw new TypeError('utxos required');
  if (!Array.isArray(inputOutpoints) || inputOutpoints.length < 1) throw new TypeError('inputs required');
  const seen = new Set();
  for (const outpoint of inputOutpoints) {
    const key = String(outpoint);
    if (seen.has(key)) throw Object.assign(new Error('duplicate_input'), { code: 'duplicate_input', outpoint: key });
    seen.add(key);
    const verdict = spendabilityAtHeight(utxos[key], spendHeight);
    if (!verdict.ok) throw Object.assign(new Error(verdict.error), { code: verdict.error, outpoint: key, ...verdict });
  }
  return true;
}

export function mempoolSpendHeight(tipHeight) {
  const tip = Number(tipHeight);
  if (!Number.isSafeInteger(tip) || tip < 0) throw new RangeError('tipHeight must be a non-negative safe integer');
  return tip + 1;
}

export function spendableOutputsForAddress(utxos, address, spendHeight) {
  const wanted = String(address);
  return Object.values(utxos || {})
    .filter(utxo => utxo?.address === wanted && spendabilityAtHeight(utxo, spendHeight).ok)
    .map(utxo => ({
      outpoint: utxo.outpoint,
      amount_atoms: String(utxo.amount_atoms),
      created_height: Number(utxo.created_height),
      origin: utxo.origin,
    }));
}
