# FAE — Sovereign Standalone Mining
## Project Assurance / Final Integration Checklist

Status: **PREPARED — NOT AUTHORIZED FOR MERGE**

### A. Authority boundary

- [ ] Waterfound explicitly authorizes integration of PR #269.
- [ ] No release/deployment/mainnet authority is inferred from that authorization.
- [ ] PR #270 remains unmerged until its own integration authority is explicit.
- [ ] No ready-for-review transition is performed unless separately authorized or clearly required by the chosen merge path.

### B. Immediately before PR #269 integration

- [ ] Fetch current `main` SHA/tree.
- [ ] If `main != 3ae59d0d013af0ee518f3cfb73c5fcb08394b075`, recompute drift/overlap before proceeding.
- [ ] Confirm PR #269 head remains `1efc495ab1c5b3c0439b519a401d89371eb188c7`.
- [ ] Confirm PR #269 is mergeable.
- [ ] Confirm its diff remains registration-only.
- [ ] Prefer merge-commit semantics for ancestry preservation; do not rebase the candidate as a side effect.

### C. Immediately after PR #269 integration

- [ ] Record new `main` SHA/tree.
- [ ] Confirm Element 58 registration exists.
- [ ] Confirm post-#269 tree is content-equivalent to planning tree `471f50b3800ee7d0ed43d4144c5ce2b2cbe72996`, unless separately explained.
- [ ] Confirm no candidate implementation was accidentally integrated by #269.

### D. Prepare PR #270

- [ ] Retarget PR #270 base from `planning/fae-sovereign-standalone-mining-element` to `main`.
- [ ] Do not rebase merely to make history linear.
- [ ] Recompute mergeability.
- [ ] Fetch new synthetic merge tree.
- [ ] Confirm no unexpected files enter the diff.
- [ ] Confirm executable source blobs remain identical to the verified candidate.
- [ ] Confirm Element 58 status reconciliation is included.
- [ ] Confirm PR remains draft unless Waterfound separately changes that authority state.

### E. Regression / assurance

- [ ] Execute the regression matrix.
- [ ] `verify-canonical-source` green.
- [ ] CodeQL green.
- [ ] PSR15/16/17/18 green.
- [ ] recurring security green.
- [ ] cross-lab integration green.
- [ ] standalone package/core/behavior green.
- [ ] real isolated independent-node mining green.
- [ ] protected Forge snapshot green.
- [ ] no forbidden-scope diff.

### F. PR #270 integration authority

- [ ] Waterfound explicitly authorizes PR #270 merge.
- [ ] Chosen merge method preserves the intended evidence property.
- [ ] If squash/rebase is chosen instead of merge commit, record why and re-establish blob-level source binding before merge.

### G. Post-merge closure

- [ ] Record final `main` SHA/tree.
- [ ] Verify executable blob identities on `main`.
- [ ] Verify Element 58 canonical status no longer says PLANNED/NOT STARTED.
- [ ] Run/observe post-merge canonical verification.
- [ ] Preserve release/deployment/activation/mainnet gates as separate.
