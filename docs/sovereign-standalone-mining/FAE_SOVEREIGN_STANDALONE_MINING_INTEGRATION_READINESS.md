# FAE — Sovereign Standalone Mining
## Post-Retarget Integration Readiness

Date: 2026-10-01  
Disposition: **PR270_POST_RETARGET_GREEN_AWAITING_MERGE_AUTHORITY**

This is an integration-readiness disposition only. It does not authorize PR #270 merge, ready-for-review transition, release, deployment, activation or mainnet.

## Canonical integration state

PR #269 has been integrated into canonical `main` under explicit Waterfound authority.

- PR #269 head: `1efc495ab1c5b3c0439b519a401d89371eb188c7`
- merge commit: `ace9821f56dd0bf60cbf7bfa7d8ff38cbb2f1d67`
- resulting `main` tree: `471f50b3800ee7d0ed43d4144c5ce2b2cbe72996`

The resulting tree is exactly the planning-head tree that was previously proven, so #269 introduced only the Element 58 registration content.

## PR #270 post-retarget state

PR #270 is:

- open;
- **draft**;
- unmerged;
- based on `main`;
- base SHA `ace9821f56dd0bf60cbf7bfa7d8ff38cbb2f1d67`;
- mergeable;
- latest canonical `main` is contained in candidate ancestry.

Immediately after retarget, cross-lab correctly rejected the old ancestry because the candidate did not yet contain the new merge commit. This was resolved by an ancestry-only merge:

```text
1cdbb72bc4b63b4be15683d53469e9ebb4b97fa3
parents:
  df46ad311d7f98ae0f730fc081ea23d0174465dc
  ace9821f56dd0bf60cbf7bfa7d8ff38cbb2f1d67
```

Tree before and after:

```text
0ae6b7dd1be8a371db8eeeabfa96ed237305faa9
```

Therefore **no file content changed** to satisfy the ancestry gate.

## Exact-source equivalence

The verified executable remains:

`305e4ff670649b6c86dafc2bde7d3a74a63c0172`

All executable/test/workflow blobs remain byte-identical:

- `standalone/fae-miner.mjs` -> `b918a306643d83f1d832c72f3b4f0a32d395c5eb`
- `standalone/mining-core.mjs` -> `42c392ad54a3e3c2f446ab79f67948d30b82a73e`
- `standalone/package.json` -> `b106d025ed45bebbcae090eef0be3e29ec56006e`
- `standalone/package-lock.json` -> `6d2bbd954afdf35a67810bb7a0ea8965309677fe`
- `tests/standalone-mining-core.test.mjs` -> `42cec633bfc9a095b93077f80d81edb10b6be257`
- `tests/standalone-miner-behavior.test.mjs` -> `d9d024e73cce3d7e57d085279b1913401a8f2f58`
- `tests/standalone-miner-independent-node.test.mjs` -> `26e345870303818aae7be06e68d507ae7c3d3a7a`
- `tests/standalone-miner-process-restart.test.mjs` -> `fc62830d67e64884f3efabd8a896d023f51a2b5b`
- `.github/workflows/verify.yml` -> `9d0a2ae4ec112a3734809001f0c5d458c2a72c54`

## Post-retarget assurance

Required gates on the reconciled post-retarget candidate:

- canonical verify — run `36895567657`, attempt 4: **SUCCESS**
- CodeQL — run `36895567776`: **SUCCESS**
- PSR15 — run `36895567598`, attempt 2: **SUCCESS**
- PSR16 — run `36895567673`: **SUCCESS**
- PSR17 — run `36895567936`: **SUCCESS**
- PSR18 — run `36895567970`: **SUCCESS**
- recurring security — run `36895567771`: **SUCCESS**
- cross-lab integration — run `36895567920`: **SUCCESS**

Failed attempts were retained rather than erased. The canonical verifier encountered known local socket/fetch harness instability before a full no-code-change success. PSR15 attempt 1 also failed two runtime attacks with `target_unchanged=true`; attempt 2 passed on the same source tree.

## Remaining authority boundary

No technical frontier remains open inside the present authorization.

The only next state transition is a future Waterfound decision on PR #270 merge. Before any such merge, current `main` must be re-resolved; if `main` advances, ancestry, blob identity, mergeability and required CI must be reconciled again.

Terminal state:

```text
PR270_POST_RETARGET_GREEN_AWAITING_MERGE_AUTHORITY
```
