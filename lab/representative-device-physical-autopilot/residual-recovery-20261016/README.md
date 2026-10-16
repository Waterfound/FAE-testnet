# Steam Deck OLED — RP RDE residual recovery candidate (2026-10-16)

## Status and authority
Candidate-only source; not deployed. Does not alter canonical FAE protocol or existing public harness. Do not treat as available through current public URL. No paid spend or production mutation.

## Evidence source
Operator's original `FAE_RDE_BROWSER_PORTFOLIO_V1` with 4 completed captures:
1–3 pure_mining_sustained, 1 normal_use_coexistence. Lock observed at height 721, exact tested source revision d6c3ac8670806729ec10d026c15317ebb73f4f69.

## Intent
Prevent wasting the existing 111 minutes of physical evidence. Import the original four captures unchanged; require Valve Steam Deck OLED under the same OS/browser profile, original Selection Lock and frozen protocol; execute only normal_use_coexistence #2/#3 and lifecycle_recovery #1 (five genuine hidden → visible transitions). Export one portfolio containing all seven originals and new captures. Original four are not rewritten. Failed partial runs are never appended.

## Controls
- Recovery must be loaded by file before any mining, no new lock creation;
- bound class, device, date order, exact provenance, physical mode and retention checks;
- no duplicate workload execution; prior run IDs retained; chronology monotonic;
- idempotent GET only retry on transient network errors; POST never retried;
- no false assertion that the recovery preview is deployed, canonical, merged or already hardware-tested.

## Risk boundaries / residual tasks
- Candidate unit guards were executed on synthetic positive/negative fixtures. **No real Steam Deck resume execution yet.**
- Offline import checks cannot certify hardware authenticity or prove the original JSON was not tampered with. Official RDE bundle verifier and portfolio admission still required.
- Host software/native sensor continuity is operator-declared; user-agent equality is checked.
- Caution: after restarting the browser on a new candidate URL, do not attempt to use the previous live public page for resume.
- Deployment of an isolated preview is a separate genuine authorization gate; do not modify current public harness without explicit approval.
