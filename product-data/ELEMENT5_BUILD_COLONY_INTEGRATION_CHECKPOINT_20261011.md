# FAE — Element 5 | Build Colony integrated candidate handoff

**Date:** 2026-10-11  
**Owner:** Element 5 — Complete User Journey  
**State:** candidate engineering, not merged, not a public product, not mainnet.  
**Source:** existing read-owner [PR #294](https://github.com/Waterfound/FAE-testnet/pull/294); composed from [Explorer #299](https://github.com/Waterfound/FAE-testnet/pull/299) and [Wallet public observer #302](https://github.com/Waterfound/FAE-testnet/pull/302).

## Build Colony decomposition and serialized shared-state rule

| Role | Admissible activity | Shared-state constraints |
|---|---|---|
| A: Explorer read E2E | Actual isolated v4 PoW and Ed25519 transfer, six read endpoints, tip coherence | Owned by #299; never edit consensus or authoritative node |
| B: Public Wallet read observer | Three selected public contexts, late-response invalidation, known zero versus unknown, external lock | Owned by #302; never handle seed, passphrase, PIN or signing |
| C: Integrated candidate | Compose A+B on a new branch, run all source tests and a single live-node cross-surface scenario | **This branch.** No merge into #294, #299, #302, main or approved Studios |
| D: Evidence/closure recorder | Exact head, CI log, residuals, human/physical gates | Report only proven statuses, never fabricated background session |
| E: Real authored UI / vault adapter | Wire one approved family to an independently validated node, with real Wallet vault identity | **Separate future implementation** needing exact vault source and art review |

**Execution classes:** A/B/C GitHub commits and CI are real work; this table is the *Build Colony coordination/decomposition*, not proof that a separate native Build Colony orchestrator ran. Durable Execution was evaluated by its documented provider-neutral contract; no autonomous persistent GE Session is implied by creating GitHub branches.

## What the current candidate actually tests

- The original six Explorer GET endpoints of the independently validating isolated node, which legitimately accepts two *locally solved* active-v4 PoW blocks and a locally signed transfer.
- The original source-bound Wallet public observer accepts only `walletId` + `address`, with read results bound to the status `network + selected height + selected tip hash`.
- The new **joint E2E** switches between recipient, sender and a separate unfunded third context against that **same actual node**. It checks a zero observed recipient before the transfer, recipient funds after accepted confirmation, correct sender mining reward, zero on the third public address, and lock/unlock clearing rather than reusing previous funds.
- Unit tests from both source candidates remain included; current CI gate is `node --test product-data/*.test.mjs`.

This **does not** prove that three mnemonic/passphrase identities were created in PR #266, nor that the approved Wallet Studio, PIN cryptography, local vault persistence or actual customer signing has been integrated.

## Evidentiary ceilings and next serial step

1. Record exact GitHub Actions outcome and any transient or deterministic failure. No local claim of live GUI testing.
2. Exercise multi-tip/reorg/partition cross-surface identity invalidation under an isolated node before product status claims.
3. Bind **one** approved authored Studio surface to live *isolated* provenance-checked read data and recheck negative space, precise meaning of flowing blue and reduced-motion semantics without fake records.
4. Admit PR #266 cryptographic vault interface and VR-09 W01–W29 **on its own exact-source security tests**, then connect public Wallet observations behind real vault identity/lock. Never treat `setVaultLocked(false)` as authentication.
5. Verify user journey and real browser/physical Safari separately; a complete on-chain Wallet, release and mainnet still require distinct authority.

**No iPad blocker for this wave:** physical HFB/RDE/MTS/Safari and other device evidence remain explicit independent gates. No provider setup, paid spend or One Man Side action is demanded.

**Closure rule:** only the *integrated read-contract candidate* may become `DONE_TECHNICAL_CANDIDATE` after exact-head green regression results. The whole Element 5 remains open until real UI and vault integration is proven and separately admitted.
