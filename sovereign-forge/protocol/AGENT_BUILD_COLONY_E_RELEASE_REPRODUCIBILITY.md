# Agent Build Colony — Worker E: Release & Reproducibility

Status: **release-candidate packaging only / no consensus authority**

Base commit: `02b68016815b3c9e7d2359a408826a790ae5608e`

Worker E closes the software-only release/reproducibility ceiling. It packages the source tree and freezes candidate configuration without promoting any candidate into live consensus.

## Deterministic release artifact

`build-reproducible-release.mjs` reads exactly the Git-tracked source set, sorted by path. For every tracked file it records:

- Git mode;
- byte length;
- SHA-256;
- exact bytes encoded as base64 in the self-contained release bundle.

The bundle contains no local path, wall-clock build time, hostname, runner identity or random value. Source identity is bound only to the Git commit and its committed timestamp. The manifest and release bundle use canonical key ordering.

Outputs:

- `fae-source-release-v1.json` — self-contained deterministic source bundle;
- `manifest.json` — deterministic metadata/checksum manifest;
- `fae-source-release-v1.json.sha256` — release bundle digest.

## Configuration freeze

`release-candidate-config.json` keeps two namespaces deliberately separate:

- **canonical public testnet** — existing 180s / 10 FAE / 600000-block legacy regime;
- **preferred future candidate** — 300s / 14 FAE / 430000-block halving / 200-block coinbase maturity.

The preferred candidate is explicitly `not-authorized`, has no activation height, and cannot be interpreted as live consensus authority by this package.

## Clean-room gate

Worker E is GREEN only if:

1. its entire diff relative to the A-D/G/H baseline is additive-only;
2. the source builder passes syntax and self-verification;
3. every bundled file recomputes to the manifest SHA-256;
4. two builds in different output directories are byte-identical;
5. two independent GitHub checkouts of the same immutable commit create byte-identical bundle, manifest and checksum files;
6. the release config remains candidate-only and mainnet launch remains unauthorized;
7. canonical live public-testnet economics remain unchanged;
8. the generated evidence bundle is preserved as a short-lived CI artifact for inspection.

## Non-goals

E does not claim reproducible Docker image layers, OS packages or third-party binary toolchains. The current FAE node is JavaScript with Node >=22 and no declared external package dependencies, so the strongest useful free/software-only target is exact source-release reproducibility plus config freeze. Binary/container reproducibility can be added later if deployment architecture begins to depend on compiled artifacts.

> **Same commit + clean checkout => same release bytes. Packaging never grants consensus authority.**
