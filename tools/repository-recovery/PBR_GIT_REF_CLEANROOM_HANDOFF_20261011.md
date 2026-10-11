# PBR-001 — Git reference clean-room rehearsal (isolated candidate)

**Date:** 2026-10-11. **Parent:** FAE recovery control PR #289, exact SHA `90e3132e4e9e68f9860b48392f70c6ecccb5bc2f`. This is a *separate child draft*, not a PBR-001 operational promotion.

## Real existing evidence (read-only provider inspection)

The GitLab private backup-control project `waterfound-group/Waterfound-project` successfully ran its scheduled pipeline [2935655832](https://gitlab.com/waterfound-group/Waterfound-project/-/pipelines/2935655832) on 2026-10-11. Two jobs passed: `repository_mirror` and `off_host_recovery_artifact`. Its mirrored `main` pointed to FAE GitHub main `6d0c3956fdf72cd2e7543eee2539397ed5c0e699` when read, and the on-provider `control/prove-off-host.sh` actually clones a generated bundle, checks its `HEAD` SHA and Git tree, runs `fsck --full --strict`, canonical SHA manifest checks and source tests.

**Crucial limitation:** these successful jobs already prove a *local HEAD restore* and source checks, not reconstruction of every Git ref into a replacement GitHub environment or the recovery of GitHub permissions, branch-protection rules, issues/PRs, GitHub Actions, credentials and secrets.

## Additional implemented closure candidate

`verify-bundle-all-refs-cleanroom.sh` consumes an off-host artifact trio (`fae-recovery.bundle`, `recovery-manifest.txt`, `recovery-bundle.sha256`) **without network calls**. It compares the expected SHA256, checks a self-contained bundle and its Git objects, creates two *new ephemeral local bare repositories*, reconstructs **all** refs/heads, refs/tags and refs/notes and compares exact SHA/ref pairs after each hop. The head ref's commit/tree must match the frozen manifest. Any missing/extra ref, bundle tampering or malformed input fails closed. Ref names and any sensitive source URL are **never logged** in failures.

`selftest-bundle-all-refs-cleanroom.sh` creates an independent synthetic source with two branches, an annotated tag and Git note; tests both successful full-ref reconstruction and missing-ref/checksum attacks. The read-only candidate workflow runs that fixture. These tests **do not** substitute for running the same verifier on the actual GitLab archived bundle. No live GitLab pipeline was changed or triggered; no remote write, billing expansion, GitHub cleanup, credential handling or provider mutation occurred.

## Remaining genuine gates

1. In an independently authorized and funded/free eligible ephemeral environment, fetch the **actual retained GitLab off-host artifact trio**, verify SHA and run the exact full-ref script. Preserve the provider run ID, original artifact SHA, source refs digest, restored SHA/tree, stdout and program exit code; a synthetic pass alone is not enough.
2. Restore to a **separately isolated GitHub namespace/repository** using minimum authority. Verify remote Git ref parity, settings, permissions, protections, Actions configuration, PR/issue reconstruction (where export exists), provenance and safe rollback; do not recreate live credentials automatically.
3. Repeat reliably, measure true scheduled mirror freshness against the configured <=60 minute bound, and verify independent weekly rehearsal with historical snapshots. Only then can the intended PBR-001 terminal restoration authority be reviewed.

**Verdict:** `CANDIDATE_GIT_REFS_CLEANROOM_HARNESS__ACTUAL_OFF_HOST_ARTIFACT_REPLAY_PENDING__FULL_GITHUB_RESTORATION_NOT_PROVEN`.
