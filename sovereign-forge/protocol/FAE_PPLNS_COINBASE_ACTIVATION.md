# FAE PPLNS / multi-output coinbase activation gate

Status: **candidate / inactive** until `PPLNS_COINBASE_ACTIVATION_HEIGHT` is ratified to one fixed public-testnet height.

This gate reconciles the recovered Consensus Authoritative 0.7 design with the existing `fairyelf-public-testnet-v4` chain without rewriting history.

## Invariants preserved

- Existing blocks before activation retain the exact v4 scalar reward semantics and hashes already accepted by the network.
- Maximum newly issued supply remains 12,000,000 FAE.
- `reward_atoms` continues to mean scheduled newly issued subsidy. It is the quantity counted by issuance/cap accounting.
- Validated transaction fees are **not issuance**. At and after activation they are transferred into coinbase outputs, consistent with the Authoritative constitution: coinbase value equals scheduled subsidy plus validated transaction fees.
- Coinbase may have 1–256 positive outputs.
- The sum of all coinbase outputs must equal exactly `reward_atoms + fee_atoms`.
- Each output must use a valid `faet1...` public-testnet address.
- Direct mining remains valid as a one-output coinbase.
- Delayed-PPLNS may use multiple outputs. The coordinator never needs a payout private key and cannot redirect a candidate after PoW because miners hash a header committing to the payout set.
- The browser/miner must retain direct-PoW fallback when coordinators fail or are not configured.
- Cumulative-work fork choice, historical bootstrap compatibility and detached-transaction reorg recovery remain unchanged.

## Post-activation header commitment

At activation and later, a block header additionally commits to:

- `fee_atoms` — sum of validated fees of the exact committed regular transaction list;
- `coinbase_root` — canonical FAE double-SHA256 of the normalized coinbase output array;
- `coinbase_count` — number of coinbase outputs.

The full normalized `coinbase_outputs` array travels with the block submission/feed record. A validator recomputes the root/count and the exact output sum before accepting the block.

`miner_address` remains in the v4 header for compatibility. For ordinary direct mining it is the sole payout address. For a distributed candidate it is a deterministic primary display address and does not grant control over the remaining coinbase outputs.

## UTXO identity

Pre-activation reward output remains `<block_hash>:0`.

Post-activation coinbase outputs are `<block_hash>:<output_index>`. A one-output direct block therefore preserves the same index form.

## Activation procedure

1. Keep `PPLNS_COINBASE_ACTIVATION_HEIGHT=null` while source integration and regression testing are incomplete.
2. Verify old v4 blocks, current direct mining, transactions, 3-node partitions/reorg recovery and new multi-output candidate tests together.
3. Deploy activation-capable node/backend/browser code **before** the activation height while the gate remains inactive.
4. Select a fixed future public-testnet height with enough rollout margin and ratify it in source; never use per-node environment configuration as consensus law.
5. Re-run the complete suite and deploy the ratification commit.
6. At/after the fixed height, verify a one-output direct block and a multi-output delayed-PPLNS block across independent validators.

## Not activated by this document

The binary consensus codec v3 remains candidate-only. This activation does not change the 180-second target, the current network id, maximum supply, transaction-v2 signatures or cumulative-work fork choice.
