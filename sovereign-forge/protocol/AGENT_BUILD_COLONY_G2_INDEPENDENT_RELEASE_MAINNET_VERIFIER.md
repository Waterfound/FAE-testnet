# Agent Build Colony — G2 Independent Release/Mainnet Verifier

Status: **independent verification only / no consensus or mainnet authority**

Frozen implementation baseline: `20a37c26125c5a11ba4c6808c1b4e1d6a07afd88`

G2 verifies the integrated Worker E v2 reproducible source-release layer and Worker F v2 mainnet rehearsal layer without modifying either implementation. Its job is to answer a narrower question: do the release and rehearsal claims still hold when checked from an independent evidence path?

## Independence model

G2 does not reuse F v2's Git-tree reconstruction algorithm as its primary oracle. Instead it asks Git directly:

- `git rev-parse HEAD` for the source commit;
- `git rev-parse HEAD^{tree}` for the source tree;
- `git ls-tree -r --full-tree HEAD` for the committed file set, modes and object ids;
- `git cat-file blob` for the committed bytes.

It compares that Git-native view against the E v2 artifact and manifest file by file, then cross-checks the release binding produced by F v2 against the independently derived values.

## Frozen ownership history

The verifier also freezes the exact additive integration scopes:

- E v2 may contain only its release workflow, protocol, release config, deterministic builder and E v2 test;
- F v2 may contain only its workflow, rehearsal candidate module, protocol, rehearsal template and F v2 test;
- G2 itself is additive and verifier-only.

Unexpected historical scope expansion is a verifier failure, even if executable tests still pass.

## Release verification

G2 independently proves:

1. artifact and manifest SHA-256 values match their bytes;
2. the checksum file matches the artifact;
3. the embedded and standalone manifests agree;
4. source commit and source tree equal Git's current immutable values;
5. every file path exists in the Git tree with the declared mode and object id;
6. artifact bytes exactly equal `git cat-file blob` bytes;
7. per-file SHA-256 and length agree;
8. the frozen release config leaves the future 300s / 14 FAE / 430000 / maturity-200 candidate unauthorized while current public-testnet authority remains 180s / 10 FAE / 600000.

Only after these independent checks does G2 compare F v2's verified release binding with the Git-oracle result.

## Mainnet rehearsal verification

G2 independently checks that:

- all production-specific template fields remain unresolved;
- `live_activation_height` is a real final-freeze requirement;
- a fully populated synthetic freeze and all synthetic external-evidence booleans still produce `HOLD_FINAL_EXPLICIT_AUTHORIZATION`;
- the rehearsal package digest can be recomputed independently from its canonical body;
- every startup step remains dry-run and rehearsal-only;
- the package is bound to the exact source commit/tree and release artifact/manifest digests.

## Regression and authority gates

Before G2 can be GREEN it reruns:

- Worker E v2 executable evidence;
- Worker F v2 executable evidence;
- the post-Colony compatibility/replay regression;
- state-transition oracle/core differential evidence;
- network-composition oracle/runtime differential evidence;
- the integrated original Colony H gate.

It separately freezes the live v4 economic constants and permanent HOLD markers.

## Authority boundary

A GREEN G2 result means only that E v2 and F v2 were independently reproduced and their provenance/authority claims matched an independent Git oracle. It does not activate a candidate, select a production launch height, authorize mainnet, or convert rehearsal evidence into consensus authority.

> **Builders may describe their outputs. G2 asks Git and the independent evidence path whether those descriptions are true.**
