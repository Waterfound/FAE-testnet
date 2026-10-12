# Fairyelf (FAE) public testnet v4 — canonical consensus

This document describes the rules enforced by the live `fairyelf-public-testnet-v4` node as of 2026-09-03. The code in `supabase/functions/fae-public-testnet-v4/` and `node/fae-node.mjs` is the executable reference.

## Network constants

| Parameter | Canonical testnet v4 value |
|---|---:|
| Network id | `fairyelf-public-testnet-v4` |
| Base unit | 100,000,000 atoms = 1 FAE |
| Maximum supply | 12,000,000 FAE |
| Initial subsidy | 10 FAE/block |
| Target block interval | 180 seconds |
| Initial difficulty | 18 leading zero bits |
| Difficulty retarget interval | 20 blocks |
| Difficulty bounds | 12–28 bits |
| Max adjustment / retarget | ±2 bits |
| Halving era | 600,000 blocks |
| Transactions / block | max 20 |
| Address HRP | `faet` |

**Important:** 600,000 blocks is the rule in the currently running v4 testnet. A proposed move to 700,000 blocks is not part of this canonical snapshot until it is deliberately activated as a protocol upgrade.

## Canonical serialization and hashing

Objects are canonicalized recursively by sorting object keys lexicographically. Arrays retain order. The canonical value is encoded with JSON serialization and UTF-8.

`FAE_HASH(x) = SHA256(SHA256(UTF8(canonical_json(x))))`

Hashes are represented as lowercase 64-character hexadecimal strings.

## Proof of Work

A valid block hash must have at least `difficulty_bits` leading zero bits. The block hash is computed from the complete canonical header with `nonce` included.

The live browser miner currently receives a server template and searches nonces locally with WebCrypto. Proof of Work is not performed by ChatGPT, Vercel or Supabase.

## Difficulty adjustment

For the first block, difficulty is 18 bits. Otherwise the previous block's difficulty carries forward except when the next height satisfies:

`next_height % 20 == 1`

At a retarget, the node looks at the most recent 20 blocks (19 time intervals):

- expected time = `180 × 19` seconds
- actual time = timestamp(last) − timestamp(first)
- delta = `round(log2(expected / actual))`
- delta is clamped to `[-2,+2]`
- resulting difficulty is clamped to `[12,28]`

## Subsidy and supply

For height `h >= 1`:

`era = floor((h - 1) / 600000)`

`subsidy = 10 FAE >> era`

The final reward may be reduced to the remaining supply so total issuance never exceeds 12,000,000 FAE.

## Block header

A template commits at minimum to:

- `network`
- `height`
- `previous_hash`
- `timestamp_ms`
- `difficulty_bits`
- `miner_address`
- `reward_atoms`
- `tx_root`
- `tx_count`

`nonce` is added by the miner before hashing.

A submitted block is valid only if it extends the node's current tip, uses the node-computed difficulty and subsidy, has a timestamp not older than the previous block and not more than 120 seconds in the future, commits to the exact transaction list, and satisfies PoW.

## Snapshot template semantics

Templates use **snapshot semantics**. Transactions that arrive after a miner requested its template do not invalidate that miner's PoW. The transactions committed by the template must still be pending and valid when the block is accepted.

## Transaction v2

A transaction has:

- `version: 2`
- `network`
- one to 64 input outpoints
- one to 16 outputs
- Ed25519 public key in SPKI/base64 form
- Ed25519 signature in base64 form

The signed payload is:

```json
{
  "domain": "FAIRYELF_TX_V2",
  "network": "...",
  "inputs": ["..."],
  "outputs": [{"address":"faet1...","amount_atoms":"..."}],
  "public_key_spki": "..."
}
```

`txid` is `FAE_HASH(full_transaction)` including the signature.

## Addresses

FAE v4 addresses are Bech32m-like lower-case addresses with HRP `faet`. The payload is the first 20 bytes of `SHA256(public_key_spki)`. The checksum constant is Bech32m `0x2bc830a3`.

## UTXO state

Mining rewards create outpoint `<block_hash>:0`.

Transaction outputs create `<txid>:<output_index>`.

For a transaction to enter the mempool, every input must exist, be unspent, belong to the signing address, and not already be reserved by another pending transaction. Output value may not exceed input value. The difference is the transaction fee.

## Independent-node fork choice

The original Supabase-backed public testnet serializes block acceptance in one database transaction and therefore did not need a distributed fork-choice rule.

The independent node implementation adds the following network-layer fork choice while preserving block validity rules:

1. Fully validate the candidate chain from genesis.
2. Prefer greater cumulative work, where per-block work is represented by `2^difficulty_bits`.
3. If cumulative work is exactly equal, prefer the lexicographically smaller tip hash as a deterministic temporary tie-break.

The tie-break does not make an invalid block valid; it only lets independently operated nodes converge when two valid equal-work branches exist.

## Protocol vs infrastructure

Consensus must not depend on Vercel, Supabase, ChatGPT or any single operator. Those are deployment choices. A compliant implementation can use any language/storage/network transport if it reproduces the rules above.
