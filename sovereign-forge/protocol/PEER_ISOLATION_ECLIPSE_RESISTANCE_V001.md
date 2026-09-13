# FAE — Lab Peer Isolation & Eclipse Resistance v0.0.1

Status: candidate; lab only; no consensus authority; no deployment.
Base: `3e2ed24` on `Waterfound/FAE-testnet/main`.
Protocol frozen before the first candidate test run, 2026-09-13.

## Question

Can the local peer manager distinguish recent verified outbound contact from
discovery hints and historical authentication, preserve locally configured
recovery routes, and retry within explicit resource budgets after isolation?

The existing node has signed discovery descriptors, identity continuity,
encrypted sessions, diverse selection and independently validated chain sync.
Its authenticated peer observations do not currently expire or record failed
outbound contact. This Lab adds a separate candidate policy and exercises it
through the existing node API. It does not change the authoritative modules,
wallet, mining, monetary parameters or fork choice.

## Frozen invariants

| ID | Requirement | Evidence required in this stage |
| --- | --- | --- |
| PI-01 | Hints, inbound claims and cached identities confer no fresh outbound evidence. | Unprobed candidates remain ISOLATED; unsolicited completions are rejected. |
| PI-02 | Evidence expires; failed contact invalidates it immediately. | TTL boundary and failure transitions; only a new completed probe restores evidence. |
| PI-03 | Count one identity once and use transport address groups. | Alias deduplication; mapped IPv4 equivalence; DNS names alone cannot supply diversity. |
| PI-04 | Local anchor configuration is distinct from discovery data. | Hints cannot grant pinning, replace configured endpoints or consume their reserved capacity. |
| PI-05 | A discovery source has bounded influence. | Quotas use the live source's transport group; same-group identities share a quota. |
| PI-06 | Candidate storage, admission work and probes are bounded. | Capacity, per-call limits, attempt-window budget, concurrent leases and expiry. |
| PI-07 | Retries progress after temporary failure without repeated immediate attempts. | Capped backoff, rotating probes, stale completion rejection and recovery. |
| PI-08 | Healthy observation does not survive a process restart. | A fresh policy instance starts without liveness, including for locally pinned peers. |
| PI-09 | Ordering is not public identity/endpoint order. | Local keyed ordering, deterministic fixtures and input-order invariance. |
| PI-10 | Peer health never grants consensus authority. | Real local sessions use the existing validation path; chain and monetary code unchanged. |
| PI-11 | Several local peers are one local transport group. | Three real loopback nodes must remain DEGRADED for diversity. |
| PI-12 | Evidence cannot be promoted beyond its scope. | Machine-readable scope flags remain false for WAN, operator independence and proven eclipse resistance. |

## Candidate boundary and defaults

The policy performs no I/O and accepts no instruction from a remote peer.
Only a local adapter may complete a leased outbound probe, after the existing
node has verified the peer identity and completed its encrypted sync attempt.
An advertised address or network group must never be passed as a measured
transport address. DNS requires an address observed by that adapter; unresolved
names remain one unknown group. Prefix grouping remains a heuristic, not an
ASN or independent-operator certificate.

Default budgets: 64 discovered candidates plus 16 configured candidates;
8 discovered candidates per source group and destination group; 2 per claimed
identity; 64 hints examined per call; 4 concurrent probe leases; 8 attempts per
10-second window. Successful contact is fresh for 120 seconds and eligible for
refresh after 30 seconds. Failed attempts back off from 1 to 60 seconds; a
probe lease expires after 10 seconds. Unrefreshed discovery candidates expire
after 10 minutes. Selection allows 8 peers, at most 2 per transport group,
and requires 3 identities, 3 known groups and 1 locally pinned identity for
`DIVERSE_LOCAL_EVIDENCE`.

Anchor probes receive a periodic reserved opportunity. Other opportunities
rotate by least recent attempt and transport group, so an unavailable anchor
cannot monopolize a one-slot budget. The keyed order is local and ephemeral;
fixed keys are used only to reproduce offline test fixtures.

Anchors are local operator choices, not a global FAE authority or a peer vote.
A matching self-issued identity proves key control only. Even a passing local
diversity assessment does not prove honest ownership or absence of eclipse.
No peer count or status changes the rules for chain acceptance.

The first transport adapter is restricted to exact loopback endpoints of
nodes created within the test. It does not dial hints or take target URLs from
the command line. Failure is introduced by a real local node shutdown and
restart; synthetic fixtures exercise policy boundaries without network I/O.
Virtual time is used for expiry/backoff, so durations are not WAN measurements.
The adapter serializes its rounds and retains that lock until the underlying
transport operation settles. Lease expiry invalidates late evidence; it does
not abort the underlying sync. Cancellable transport deadlines remain an
integration gate, and are not claimed by the scheduling budget tests.

## Evidence and promotion

Run the unit invariants and the local transport integration with:

```sh
node --test sovereign-forge/tests/peer-isolation-policy.mjs sovereign-forge/tests/peer-isolation-loopback.mjs
```

For the scope check, all 22 tests, the six-phase evidence check and hashed
runtime/source records, run `node sovereign-forge/tests/run-peer-isolation-lab.mjs`.
It writes `tests.tap`, `loopback.json` and `summary.json` to a temporary directory
or the local path specified by `FAE_PEER_ISOLATION_OUTPUT`. The dedicated CI
workflow repeats that gate on Node.js 22 and preserves its output as an artifact.

Local passing tests qualify only the candidate's modeled invariants and the
local adapter. Promotion requires a reviewable integration into the actual
discovery/sync/relay scheduler, DNS/socket binding and redirect handling,
durable hint/anchor handling, and independent network/operator evidence.
Existing Network Recovery & Reorg results are complementary; they do not
automatically satisfy this Lab's gates. This stage is not the local ceiling.

## Design references

Bitcoin Core's documented choice to seek outbound connections across available
networks supports using connection diversity as a defensive goal. It does not
validate this candidate's thresholds or prove operator independence:
[Bitcoin Core 26.0 P2P release notes](https://bitcoincore.org/en/releases/26.0/).
FAE-specific inputs are the base commit's `peer-diversity.mjs`,
`peer-directory.mjs`, `peer-trust.mjs` and `fae-v4-peer-node.mjs`.
