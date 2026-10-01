# FAE — Sovereign Standalone Mining
## Canonical Integration Verification

Date: 2026-10-01  
Disposition: **SOVEREIGN_STANDALONE_MINING_INTEGRATED_MAIN_VERIFIED**

Element 58 — Sovereign Standalone Mining is integrated into canonical `main` and technically verified in the bounded scope described below.

## Canonical integration

Registration:

- PR #269 merge: `ace9821f56dd0bf60cbf7bfa7d8ff38cbb2f1d67`

Implementation:

- PR #270 verified head: `7e12c913cd05e777623c193da0028ed6129d6489`
- canonical merge commit: `785c742dd574936a2460e083e7022eeae5879fdc`
- canonical merge tree: `7c2fc1841268e3f03306f06b945037cf4781b40a`

The merge tree is exactly the synthetic/pre-merge PR tree. No content transformation was required to integrate PR #270.

## Exact-source equivalence

The integrated canonical source preserves the verified candidate's executable/test/workflow blobs exactly:

- `standalone/fae-miner.mjs` -> `b918a306643d83f1d832c72f3b4f0a32d395c5eb`
- `standalone/mining-core.mjs` -> `42c392ad54a3e3c2f446ab79f67948d30b82a73e`
- `standalone/package.json` -> `b106d025ed45bebbcae090eef0be3e29ec56006e`
- `standalone/package-lock.json` -> `6d2bbd954afdf35a67810bb7a0ea8965309677fe`
- `tests/standalone-mining-core.test.mjs` -> `42cec633bfc9a095b93077f80d81edb10b6be257`
- `tests/standalone-miner-behavior.test.mjs` -> `d9d024e73cce3d7e57d085279b1913401a8f2f58`
- `tests/standalone-miner-independent-node.test.mjs` -> `26e345870303818aae7be06e68d507ae7c3d3a7a`
- `tests/standalone-miner-process-restart.test.mjs` -> `fc62830d67e64884f3efabd8a896d023f51a2b5b`
- `.github/workflows/verify.yml` -> `9d0a2ae4ec112a3734809001f0c5d458c2a72c54`

## Post-merge verification

On canonical merge commit `785c742d...`:

- canonical verify — run `36898252194`: **SUCCESS**
- CodeQL — run `36898252463`: **SUCCESS**
- PSR15 — run `36898252307`, attempt 2: **SUCCESS**
- PSR16 — run `36898252354`: **SUCCESS**
- PSR17 — run `36898252370`: **SUCCESS**
- PSR18 — run `36898252427`: **SUCCESS**
- recurring security — run `36898252222`: **SUCCESS**
- cross-lab integration — run `36898252316`: **SUCCESS**

PSR15 attempt 1 is retained as evidence: WB-13 failed while `target_unchanged=true`; the no-source-change rerun passed.

## Proven canonical capability

Canonical `main` now contains a first-class dependency-free Node.js 22+ standalone/headless miner that:

- mines outside the browser;
- accepts a selected FAE node endpoint;
- accepts a public `faet1...` reward address;
- does not require a Wallet, seed phrase, private key, vault, passphrase, signing authority, browser profile or browser session;
- performs Proof of Work locally;
- preserves active public-testnet v4 mining semantics;
- demonstrates deterministic parity against independent Node/WebCrypto computations;
- handles stale work, reconnect, restart and cooperative shutdown;
- persists only secret-free allow-listed configuration;
- has real independent-node mining evidence with reward credited to the supplied public address.

## Scope boundary

`SOVEREIGN_STANDALONE_MINING_INTEGRATED_MAIN_VERIFIED` means **source integrated into canonical main + technical verification**.

It does **not** mean:

- released;
- deployed;
- activated at a height;
- mainnet activated;
- consensus/economics/mining algorithm changed;
- DP6/DP7 selected or activated;
- Wallet cryptography/address/transaction semantics changed;
- paid infrastructure authorized.

Those remain separate authority decisions.

## Terminal state

```text
SOVEREIGN_STANDALONE_MINING_INTEGRATED_MAIN_VERIFIED
```

No further repository-integration work remains for Element 58 within this scope.
