# FAE Cross-Lab Integration Protocol

Status: ACTIVE DEVELOPMENT RULE
Version: 1
Scope: all FAE Labs and bounded engineering branches

## Purpose

Prevent valid work from being left behind, overwritten by a stale branch, or incorrectly described as live merely because one Lab passed its own tests.

The rule is:

```text
Lab verified
!= integrated into canonical main
!= combined-main verified
!= live
```

A Lab may report its own evidence as GREEN without claiming any of the later states.

## Canonical integration sequence

For any Lab result that is intended to become part of the product or canonical engineering state:

1. finish the bounded Lab work and preserve its evidence;
2. resolve the current `main` head;
3. replay/rebase/reconcile the candidate on top of that current `main`;
4. rerun the Lab-specific deterministic checks on the reconciled candidate;
5. merge serially into `main`;
6. run the cross-Lab integration gate on the resulting combined `main` state;
7. only after the exact integrated commit passes may it be called `COMBINED_MAIN_VERIFIED`;
8. a `LIVE` claim requires separate deployment/runtime evidence binding the deployed system to that exact integrated commit or artifact.

## Status vocabulary

- `LAB_VERIFIED` — the Lab's own bounded evidence passed.
- `INTEGRATED_MAIN` — the relevant result is present in canonical `main`.
- `COMBINED_MAIN_VERIFIED` — the current combined `main` passes the integration gate with the other admitted Labs/features present.
- `LIVE` — deployment/runtime evidence proves the exact integrated revision is the version users or nodes are actually running.

Never compress these states into the single word "done".

## Fresh-main rule

A branch that does not contain the latest canonical `main` is not eligible for final integration status.

Before merge, the candidate must include the current `main` ancestry. If `main` advances while a Lab branch is under review, the Lab branch must be reconciled again before final merge.

This is intentionally strict. It prevents the failure mode:

```text
feature A merged
feature B developed from old page/source
feature B merged later
feature A silently disappears or regresses
```

## Combined verification rule

Independent success does not imply combined success:

```text
A PASS + B PASS + C PASS
does not prove
A+B+C PASS
```

The proof target is one exact Git revision containing A+B+C together, followed by the relevant combined checks on that revision.

## Authority

This protocol does not authorize consensus, economics, wallet/address activation, public-testnet promotion, mainnet launch, or deployment.

It only governs engineering integration claims and protects canonical source continuity.

## Live-state rule

Frontend/browser work may become live through the configured deployment path, but `main` membership alone is not a live claim.

Consensus/backend changes remain separately authorized. No ordinary frontend merge may silently activate consensus changes.

## One man, one machine compatibility

This protocol requires serial integration and reproducible checks, not multiple human operators or multiple locations. Independence is supplied by versioned source, bounded Lab evidence, deterministic verification, and exact revision binding.
