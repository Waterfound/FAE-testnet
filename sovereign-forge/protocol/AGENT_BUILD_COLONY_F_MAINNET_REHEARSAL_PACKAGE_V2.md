# Agent Build Colony — Worker F v2: Mainnet Rehearsal Package

Status: **software rehearsal only / mainnet not authorized**

Base commit: `92088ac1d60043f870b2e1eec06d7a0817325896` (Worker E v2 integrated)

Worker F v2 closes the software-only mainnet rehearsal/package ceiling by binding every rehearsal to a verified Worker E v2 source release. It does not activate consensus, select production launch values, authorize mainnet, or promote the preferred economic candidate.

## Why v2 exists

Worker F v1 modeled genesis, bootstrap, startup and abort semantics correctly, but accepted a caller-supplied release SHA-256 without independently verifying the Worker E release bundle. It also allowed `final_freeze_complete` to become true without requiring `live_activation_height`, even though that value remained unresolved in the checked-in template.

F v2 removes both ambiguities.

## Release evidence binding

A rehearsal package can only be built from the exact binding object returned by `verifyReleaseEvidence()`.

The verifier requires all of the Worker E v2 outputs:

- `fae-source-release-v2.json` bytes;
- separate `manifest.json` bytes;
- checksum-file text;
- expected artifact SHA-256;
- expected manifest SHA-256;
- expected source commit;
- expected source tree.

It then proves:

1. artifact and manifest digests match the externally locked values;
2. the checksum file matches the artifact digest;
3. embedded and separate manifests are identical;
4. every bundled file matches byte length, SHA-256 and Git blob object id;
5. the flattened file set reconstructs the expected Git source-tree object exactly;
6. the frozen Worker E release config remains candidate-only and preserves current public-testnet authority;
7. the expected source commit and source tree match the release claims.

A copied or caller-fabricated object with the same fields is not accepted as a verified binding.

## Final-freeze inputs

The checked-in template keeps all production-specific values unresolved:

- genesis timestamp;
- initial target;
- genesis miner address;
- release artifact digest;
- release manifest digest;
- release source commit;
- release source tree;
- release config digest;
- live activation height;
- bootstrap requirements;
- bootstrap nodes.

F v2 now requires `live_activation_height` to be a positive integer before `final_freeze_complete` can become true. No value is selected by the software itself.

## Candidate economics exercised

The rehearsal continues to exercise the preferred future candidate only as non-authoritative test data:

- target interval: **300 seconds**;
- initial subsidy: **14 FAE**;
- halving interval: **430,000 blocks**;
- theoretical maximum supply: **12,040,000 FAE**;
- coinbase maturity: **200 blocks**.

Current public-testnet authority remains 180 seconds / 10 FAE / 600,000 blocks.

## Genesis and bootstrap rehearsal

Genesis remains deterministic over explicit inputs and commits to its network id, timestamp, target, miner, reward schedule and empty transaction set.

Bootstrap readiness remains parameterized. Duplicate identity or endpoint fails closed, and readiness requires caller-specified diversity thresholds. Checked-in `.invalid` endpoints and synthetic thresholds are test vectors only.

## Startup sequence

The frozen v2 rehearsal sequence is:

1. verify release bundle;
2. verify release source tree;
3. freeze launch config;
4. derive genesis commitment;
5. start bootstrap in isolation;
6. verify bootstrap diversity;
7. rehearse genesis;
8. verify peer convergence;
9. evaluate go/no-go.

Every step remains `dry_run: true` and `authority: rehearsal-only`.

## Abort semantics

Before genesis publication, ephemeral rehearsal state may be discarded and the sequence restarted from step 1.

After genesis publication, the package forbids rewriting or pretending the published genesis did not exist. Evidence must be retained and another rehearsal network/genesis selected if a restart is needed.

## Permanent HOLD boundary

Even with:

- a valid reproducible release;
- all software gates true;
- all external-evidence booleans true;
- every final-freeze field populated;

F v2 still returns:

- `candidate_to_authoritative: false`;
- `mainnet_launch_authorized: false`;
- `automatic_go_path: false`;
- `decision: HOLD_FINAL_EXPLICIT_AUTHORIZATION`.

There is intentionally no automatic transition from rehearsal readiness to launch authority.

## Ceiling statement

F v2 is GREEN only if Worker E v2 reproduces first, the release evidence is independently revalidated, Git-tree reconstruction succeeds, tampered source bytes fail closed, genesis/bootstrap/startup/abort tests pass, post-Colony regression gates remain GREEN, and live authority remains untouched.

> **Rehearsal may prove readiness. It never grants authority. A launch package must identify the exact release bytes, manifest, commit and tree it rehearsed.**
