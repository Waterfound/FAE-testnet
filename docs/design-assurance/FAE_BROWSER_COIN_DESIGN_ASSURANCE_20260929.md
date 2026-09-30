# FAE — Browser-Coin Design Assurance Review

Status: candidate assurance record. This document does not change consensus, economics, DP6, activation height, release authority, deployment authority, or mainnet authority.

## Admission rule

competitor weakness + corresponding FAE premise + insufficient current FAE coverage/evidence + material consequence = candidate improvement

A difference from BrowserCoin is not itself a FAE defect.

## Build Colony run

- source FAE revision: `b00bbebca81a8f1085f7e61beddca862d8b5dfaa`
- Build Colony source tree: `17979869a85c9f5adf2cef2ceb589a07fcef6239`
- run id: `bc2-71a6f1e4cc210352`
- manifest digest: `30089b7cb741ed570d86123e7687057cb5389e88092bbb4a3cd624b063c5fec8`
- schedule: one parallel wave with three bounded Work Packages.

## Admitted bounded hardenings

1. Wallet delivered-code/signing integrity — strengthen existing Wallet + Public Code Security ownership. Current closure is blocked by incomplete canonicalization of the production browser wallet source; the contract fails closed rather than claiming same-origin protection.
2. Long-horizon node survivability — strengthen existing Independent Node/Mainnet Readiness ownership. Current authoritative peer sync exposes a 50,000-block branch ceiling; pruning/archival remains research, not an implied implementation decision.
3. Cold-start infrastructure independence — strengthen existing Peer Isolation/Eclipse + Independent Node ownership. The zero-seed control is explicit; a future PASS must use independently controlled bootstrap roots and later real-WAN evidence.

## Not admitted as new work

- Temporal monetary distribution: existing economic/monetary research owner is sufficient; no economic change is authorized.
- Specialized-hardware resistance: ASIC Lab/DP6 already owns the exact unresolved specialized-bound premise; no duplicate ASIC frontier.
- Normal-use/browser lifecycle parity: Representative Device Evidence + Physical Autopilot already own the physical evidence gap.
- Protocol-governance survivability: bounded evidence reconstruction remains RESEARCH_REQUIRED before any hardening is admitted; no new governance system is created.

## Authority

Builder evidence is not assurer approval. Passing these candidate tests means only that the bounded hardening artifacts are internally consistent and that the identified current limits are reproducible. It does not close the parent Mainnet Readiness gates.
