# Agent Build Colony — Worker F: Mainnet Rehearsal Package

Status: **software rehearsal only / mainnet not authorized**

Base commit: `02b68016815b3c9e7d2359a408826a790ae5608e`

Worker F closes the software-only mainnet rehearsal/package ceiling. It exists to make a future launch sequence reproducible, inspectable and abortable without turning rehearsal data into consensus authority.

## Candidate economics exercised

The package rehearses the preferred future candidate:

- target interval: **300 seconds**;
- initial subsidy: **14 FAE**;
- halving interval: **430,000 blocks**;
- theoretical maximum supply: **12,040,000 FAE**;
- coinbase maturity: **200 blocks**.

Every one of these values remains `not-authorized`. Worker F does not change the current public-testnet regime and does not choose a live activation height.

## No hidden final values

The checked-in rehearsal template deliberately leaves these final-freeze values unresolved:

- genesis timestamp;
- initial target;
- genesis miner address;
- release artifact digest;
- live activation height;
- bootstrap requirements;
- bootstrap nodes.

The test suite supplies deterministic synthetic values only so the software path can be exercised. In particular, the `.invalid` bootstrap endpoints and the `3 operators / 3 network groups / 1 pinned identity` threshold are test vectors, not proposed production values.

## Genesis rehearsal

A rehearsal genesis is deterministic over its explicit inputs and commits to:

- rehearsal network id;
- height 1;
- zero previous hash;
- timestamp;
- initial target;
- miner address;
- candidate subsidy and schedule metadata;
- empty transaction set.

Changing any committed input changes the genesis commitment. No function in Worker F publishes a real genesis or writes to a live chain.

## Bootstrap rehearsal

Bootstrap readiness is parameterized rather than hard-coded. The caller must explicitly provide required counts for distinct operators, distinct network groups and pinned identities. Duplicate identities/endpoints fail closed.

This models the gate without pretending that the final production bootstrap topology has already been selected.

## Startup sequence

The frozen rehearsal order is:

1. verify release artifact;
2. freeze launch config;
3. derive genesis commitment;
4. start bootstrap in isolation;
5. verify bootstrap diversity;
6. rehearse genesis;
7. verify peer convergence;
8. evaluate go/no-go.

Every generated startup step is marked `dry_run: true` and `authority: rehearsal-only`.

## Abort / rollback semantics

Before genesis publication, an aborted rehearsal may discard ephemeral state and restart from step 1.

After a genesis has been published, Worker F forbids pretending it never existed: evidence must be preserved, that genesis must not be rewritten, and a new rehearsal network/genesis must be chosen if another attempt is required.

This distinction is part of the software gate because launch recovery must not depend on post-hoc chain-history mutation.

## External evidence remains unresolved

The template records the following evidence classes as not yet satisfied:

- physical HFB / RTX + watts evidence;
- representative-device evidence;
- operational soak;
- independent-operator evidence.

A `false` value in `external_evidence_required` means **the evidence is not present in the frozen package**, not that the evidence is optional.

## Permanent HOLD boundary

Even if every software checkbox, every external-evidence checkbox and every final-freeze input is supplied to the rehearsal API, its result remains:

- `candidate_to_authoritative: false`;
- `mainnet_launch_authorized: false`;
- `automatic_go_path: false`;
- `decision: HOLD_FINAL_EXPLICIT_AUTHORIZATION`.

There is intentionally no code path in Worker F that converts evidence completion into launch authority.

## Worker F GREEN gate

F is GREEN only if:

1. its entire diff from the A-D/G/H baseline is additive-only;
2. the mainnet rehearsal module passes syntax validation;
3. genesis commitments are deterministic and input-sensitive;
4. bootstrap diversity and duplicate-identity checks fail closed;
5. the complete startup sequence remains dry-run/rehearsal-only;
6. both pre-genesis and post-genesis abort semantics are proved;
7. a fully satisfied evidence/checklist still cannot authorize launch automatically;
8. full activation, compatibility/replay and network-composition regressions remain green;
9. current public-testnet economics remain unchanged;
10. the 96-hour evidence environment remains untouched.

A GREEN result means **the mainnet rehearsal software package is complete enough to rehearse**, not that FAE is authorized to launch mainnet.

> **Rehearse everything that can be rehearsed. Authorize nothing implicitly. Never rewrite a published genesis.**
