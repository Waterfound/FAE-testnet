# Agent Build Colony — Worker E: Release & Reproducibility

Status: **release-candidate packaging only / no consensus authority**  
Authority reconciliation addendum: **2026-10-11 — superseded 14/430k eliminated from future-design namespace**

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
- **authoritative future monetary design (not active)** — the 2026-10-06 Waterfound decision: 9 FAE start, 630,000-block eras, 45% subsidy reduction / 55% retention, 12.6M hard ceiling, with atom-floor terminal issuance 12,599,999.811 FAE. The exact authority record is on canonical FAE main (2026-10-06).
- **still-research-only final choices** — 300s block target and 200-block maturity are historical research incumbents, not production-selected parameters; DAA/timestamp, fees/security budget, activation and genesis remain unfrozen.
- **superseded historical candidate** — 14 FAE / 430,000-block halving / 12.04M package remains only in the explicitly deprecated historical field.

The future monetary **design** is human-authoritative for its specified tokenomics only, and explicitly not the live testnet or a mainnet release. This historical Worker E source branch does **not** contain the 2026-10-06 authority record; it must be rebound to a current canonical exact source tree before any final release attempt. The final block target and maturity remain separately unresolved. The package cannot be interpreted as permission to change live consensus.

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
