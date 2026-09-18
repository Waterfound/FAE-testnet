# Agent Build Colony — Worker E v2: Release & Reproducibility

Status: **release-candidate packaging only / no consensus authority**

Base commit: `cfd08a88f0f4f2e66560811cdd7eac6f8eec9cf9`

Worker E v2 closes the software-only source-release reproducibility ceiling after the A–D/G/H Colony and the post-integration differential hardening pass.

## Why v2 exists

Worker E v1 correctly targeted deterministic source packaging, but its builder enumerated Git-tracked paths while reading bytes from the working tree. A locally modified tracked file could therefore be packaged while the manifest still named the unchanged `HEAD` commit.

E v2 removes that provenance ambiguity.

## Source authority

The package is built from **Git commit blobs only**:

1. `HEAD` identifies the source commit and tree;
2. `git ls-tree -r HEAD` defines the complete source set and Git modes;
3. `git cat-file blob <object>` supplies every packaged byte;
4. every blob is bound by Git object id and SHA-256;
5. the manifest binds the complete source tree and commit.

The builder also refuses any staged or unstaged tracked modification. Untracked files are outside release authority and are never enumerated by the commit tree.

## Deterministic outputs

`build-reproducible-release.mjs` creates:

- `fae-source-release-v2.json` — self-contained source bundle;
- `manifest.json` — deterministic source metadata and checksums;
- `fae-source-release-v2.json.sha256` — bundle SHA-256.

No absolute checkout path, wall-clock build time, runner identity, hostname or random value enters the serialized release bytes. Source date is the immutable commit timestamp.

## Clean-room evidence

The gate requires:

- same-checkout repeated build equality;
- two independent GitHub checkouts of the exact commit to produce byte-identical bundle, manifest and checksum;
- every bundled byte to reconstruct its declared Git blob id and SHA-256;
- a third checkout with a tracked-file modification to be rejected before any artifact is created;
- the complete Worker E v2 delta to be additive-only relative to the hardened Colony baseline.

## Configuration freeze

`release-candidate-config.json` separates current authority from the preferred future candidate:

- canonical public testnet: 180 s, 10 FAE initial subsidy, 600,000-block halving era;
- preferred candidate: 300 s, 14 FAE, 430,000-block halving era, 200-block coinbase maturity, theoretical 12,040,000 FAE maximum supply.

The preferred candidate has no activation height and remains explicitly `not-authorized`. Packaging cannot turn it into consensus authority or authorize mainnet launch.

## Ceiling statement

E v2 claims reproducibility only for the committed FAE source release. It does **not** claim reproducible operating-system images, third-party binary distributions or hardware behavior. Those are outside the current JavaScript source-release ceiling.

> **Commit names the tree. Tree names the blobs. Blobs name the bytes. Dirty tracked state is rejected. Packaging grants no authority.**
