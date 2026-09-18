# FAE Canonical State

Status: living context registry for FAE engineering work  
Last reviewed: 2026-09-18  
Repository: `Waterfound/FAE-testnet`

## Purpose

This file is a small living registry for the current accepted FAE state. It is not a replacement for consensus specifications, frozen evidence, release manifests, or lab reports.

Before making a consequential FAE engineering decision, read the current version of this file from `main` and then follow the referenced source artifacts. If an older conversation conflicts with this registry, do not rely on the stale conversation. If this registry conflicts with a referenced authoritative or frozen source artifact, the source artifact wins and this file should be corrected.

Frozen historical evidence must remain frozen. Update this file only when an accepted parameter, candidate, gate, or authority state materially changes.

## Current live public-testnet authority

Authoritative network:

- network: `fairyelf-public-testnet-v4`
- target block interval: 180 seconds
- initial subsidy: 10 FAE/block
- halving era: 600,000 blocks
- maximum supply: 12,000,000 FAE
- premine / treasury / administrative mint: none

The live public testnet has not been silently migrated to the future economic candidate.

Primary references:

- `README.md`
- `sovereign-forge/release/software-only-ceiling-freeze.json`
- `sovereign-forge/node/authoritative/fae-v4-core.mjs`

## Preferred future economic candidate

Current preferred research candidate:

- target block interval: 300 seconds
- initial subsidy: 14 FAE/block
- halving era: 430,000 blocks
- hard monetary ceiling / theoretical geometric maximum: 12,040,000 FAE
- base unit: 100,000,000 atoms = 1 FAE
- coinbase maturity: 200 blocks = 16h40m at 300 seconds

Atom-exact Pure Halving arithmetic from 14 FAE and 430,000-block eras yields:

- exact maximum scheduled issuance: 12,039,999.94840000 FAE
- permanently unissued remainder under the 12,040,000 FAE hard ceiling: 0.05160000 FAE = 5,160,000 atoms

Authority status:

- research incumbent / preferred future candidate
- not active public consensus
- candidate selection does not equal activation
- activation height: not selected
- candidate -> authoritative: false
- mainnet launch authorized: false
- public consensus changed: false
- Focused Red Team L3 required before any activation package can advance

Block-time research disposition:

- 300s: GREEN research incumbent
- 600s: YELLOW challenger, not selected
- 900s: CLOSED for the current branch

Primary references:

- `sovereign-forge/protocol/ECONOMIC_BLOCK_TIME_V2_LAB.md`
- `sovereign-forge/protocol/ECONOMIC_BLOCK_TIME_V2_PRE_L3_CEILING.md`
- `sovereign-forge/release/software-only-ceiling-freeze.json`

## Software ceiling

The H2 serialized integration freeze reached:

`SOFTWARE_ONLY_PRE_MAINNET_CEILING_REACHED`

The accepted H2 meaning is narrow:

- software-only work available before new external evidence was exhausted at that freeze;
- this does not claim mainnet readiness;
- newly discovered external evidence may reopen only the affected boundary;
- no candidate receives production, consensus, or launch authority from H2.

Frozen H2 baseline:

`745faec3c2ee3fd214199b60293f46e7b9d5a92b`

Primary references:

- `sovereign-forge/protocol/AGENT_BUILD_COLONY_H2_FINAL_SERIALIZED_INTEGRATION.md`
- `sovereign-forge/release/software-only-ceiling-freeze.json`

## External evidence gates

Current admitted state:

- physical HFB / RTX + watts evidence: unresolved
- representative-device evidence: unresolved
- operational soak: unresolved; no PASS should be inferred from elapsed time or a partial run
- independent-operator evidence: unresolved

A fresh operational soak may be admitted only after its complete frozen window and predefined gates are satisfied. Do not convert a partial or interrupted run into PASS.

## Final production freeze still unresolved

The H2 freeze still leaves production-specific values unselected, including:

- production activation height
- bootstrap requirements
- bootstrap nodes
- final release artifact and manifest digests
- final release source commit/tree
- final production genesis values required by the release package

These must remain unset until their own evidence and explicit authority gates are satisfied.

## Working rule for future conversations and automations

For FAE work:

1. resolve this file from current `main`;
2. inspect the referenced source artifact for the boundary being changed;
3. treat old conversation context as informative, not authoritative, when it conflicts with current canonical repository state;
4. never update frozen historical evidence merely to make it look current;
5. update this living registry after an accepted, evidence-backed state change;
6. never infer activation, mainnet authority, or candidate promotion from research status alone.
