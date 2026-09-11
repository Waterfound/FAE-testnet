# FAE Full-Target Header + Cumulative-Work Migration

Status: **candidate-not-active-consensus**

This package defines how the Difficulty + Timestamp candidate can eventually leave integer `difficulty_bits` without creating a chain-selection discontinuity. It is deliberately isolated from `fae-v4-core.mjs` and does not activate a new header, PoW rule or fork-choice rule.

## Key invariant: legacy work is preserved exactly

For a full 256-bit target `T`, candidate block work is:

`floor(2^256 / (T + 1))`

The current legacy target represented by `b` leading-zero bits is exactly:

`T_b = 2^(256-b) - 1`

Therefore:

`floor(2^256 / (T_b + 1)) = 2^b`

which is exactly the current v4 `chainWork` contribution. This gives FAE a mathematically exact bridge: historical blocks do not gain or lose work merely because later blocks use smooth full targets.

## Candidate header migration

The research codec preserves the current-v4 semantic block fields but replaces the one-byte integer `difficulty_bits` commitment with a canonical **32-byte unsigned big-endian target** (`target_hex` at the object boundary). The target is encoded as raw 32 bytes in the binary candidate codec, not as text.

The migration is fail-closed at an explicit future activation height:

- before activation: `difficulty_bits` is required and `target_hex` is forbidden;
- at/after activation: `target_hex` is required and `difficulty_bits` is forbidden;
- mixed or missing commitments are rejected;
- cumulative work sums legacy `2^bits` and post-activation `floor(2^256/(target+1))` in one integer domain.

No activation height is selected by this package.

## Why this is separate from Consensus v3 shadow codec

The existing Consensus v3 work proves strict binary serialization and dual-validation parity for the current v4 semantics. This package answers a different question: how to encode the *new smooth target* and migrate fork-choice work without silently quantizing back to integer bits. The two gates must remain separate until an explicit activation package composes them.

## Gates still required

- public-testnet shadow telemetry using real chain history and the full-target candidate;
- explicit activation height and ASERT anchor selection;
- dual-validation across the activation boundary;
- reorg/fork-choice adversarial tests spanning pre/post-activation blocks;
- multi-host soak + chaos + WAN + independent-operator validation;
- mainnet parameter ratification.
