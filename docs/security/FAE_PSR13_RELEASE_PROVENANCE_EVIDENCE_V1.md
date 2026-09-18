# FAE PSR-13 — Reproducible Build & Release Provenance

Status: candidate complete pending canonical verification, dedicated PSR-13 workflow and integration  
Bound source: `53531a1f61cf190760e3234831ebab07c1dc9c27`

## What is being proven

PSR-13 separates two claims that should not be conflated.

### Source release

The existing `FAE_SOURCE_RELEASE_V2` builder reads bytes directly from Git commit blobs, requires a clean tracked worktree, records the source commit/tree, hashes every file with SHA-256 and carries the Git object id/mode for every blob.

The existing Colony E verifier is promoted into the public-code security baseline. The dedicated PSR-13 workflow additionally checks out the exact candidate twice into different clean-room paths, builds the package independently and requires byte-identical:

- `fae-source-release-v2.json`;
- `manifest.json`;
- `fae-source-release-v2.json.sha256`.

The existing G2 verifier is also replayed. It independently treats Git as the source oracle and verifies artifact bytes, Git object ids, modes, hashes, release config and permanent authority fences.

### Container input provenance

The historical Sovereign Forge Dockerfiles remain byte-identical.

A new root-level lock freezes the Node base input at:

`node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5`

For Linux/amd64 the recorded platform manifest is:

`sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96`

The PSR-13 workflow generates temporary Dockerfiles from each protected historical Dockerfile, replacing only the exact tag-only `FROM` line with the immutable digest-pinned reference. All four variants must build successfully.

This proves the container **base input is immutable for the verified build path**. It does **not** claim that two complete OCI image builds are byte-identical.

## Runtime evidence

`scripts/psr13-release-provenance.mjs` emits `FAE_PSR13_RUNTIME_EVIDENCE_V1` containing the Git commit/tree, release artifact and manifest hashes, file count, container-lock hash/base digest and observed Node/Git versions.

## Authority boundary

Everything remains candidate-only. Passing PSR-13 cannot:

- publish or activate a release;
- change consensus or economics;
- promote candidate code to authoritative code;
- authorize mainnet.

## Exit

PSR-13 becomes GREEN only when:

1. the canonical workflow passes the PSR-13 local provenance contract on the exact candidate;
2. the dedicated `psr13-release-provenance` workflow passes clean-room reproduction, Git-oracle verification and all pinned container builds;
3. the exact candidate integrates without stale binding.

On GREEN, PSR-15 White-Box Attack Campaign becomes READY.
