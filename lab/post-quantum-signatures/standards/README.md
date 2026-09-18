# PQ-01 Standards and Evidence Pinning

This directory freezes the standards/evidence inputs used by the FAE Post-Quantum Signature Lab.

## Normative standards

- NIST FIPS 204 — ML-DSA.
- NIST FIPS 205 — SLH-DSA.
- FIPS 204 official potential-updates spreadsheet is treated as required interpretation context because NIST's 2026-07-31 planning note says several minor issues are expected to be corrected in a future update/revision.
- FIPS 205 currently has no equivalent planning note on its final publication page.

## ACVP corpus

The Lab does not track a floating ACVP branch. PQ-01 pins:

`usnistgov/ACVP-Server@975de31eb83d87039ec88934fdc47d8c312b892d`

This is the NIST ACVP-Server commit labeled `RELEASE/v1.1.0.43 including hotfix patches`.

The six pinned sample suites are:

- ML-DSA keyGen / sigGen / sigVer — FIPS204;
- SLH-DSA keyGen / sigGen / sigVer — FIPS205.

For each suite, `registration.json`, `prompt.json`, and `expectedResults.json` are pinned.

## Two-phase freeze

1. **Observe:** fetch every exact resource, compute SHA-256 and byte length, and independently recompute Git blob SHA-1 for ACVP files.
2. **Freeze:** write the observed SHA-256 values back into `sources.json`, change status to `FROZEN`, rerun the same executor, and require byte-for-byte agreement.

A URL alone is not evidence admission.

## Known coverage limitation

Official ACVP samples are not considered exhaustive. Later primitive packages must add malformed-length, truncation, tamper, downgrade, replay, and independent differential cases. PQ-01 only freezes the official baseline; it does not claim complete cryptographic validation.
