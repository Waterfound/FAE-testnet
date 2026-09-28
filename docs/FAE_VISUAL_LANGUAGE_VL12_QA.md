# FAE Direction D — VL-12 Cross-Product QA

Status: **candidate QA package**

Scope: Homepage / Wallet / Mining / Explorer on `colony/fae-visual-language-rebrand-001`.

## Evidence already admitted

- Homepage CI: GitHub Actions run 36479427272 — PASS.
- Homepage public isolated QA: TinyFish run 2ee6a4f4-6b2a-4638-a8a4-8e28b0150528 — suitable to advance; no layout issues.
- Wallet CI: GitHub Actions run 36480774355 — PASS.
- Wallet public read-only QA: TinyFish run 00f47615-0b80-4999-8ab2-4e426a87fb41 — suitable to advance; critical controls and TXID traceability visible.
- Mining CI: GitHub Actions run 36481663906 — PASS.
- Mining public read-only QA: TinyFish run 7597149b-f672-4099-b7f8-50a0e200dd5f — suitable to advance; probabilistic disclosure present; no misleading progress language.
- Explorer CI: GitHub Actions run 36482104280 — PASS.
- Explorer corrected public visual QA: TinyFish run 28f68afb-e3aa-4237-a0f7-a68a2862ffa0 — suitable to advance; orange header, ticker, white field, blue actions and trust boundary confirmed.
- Public isolated QA app: https://fae-direction-d-vl08-qa-ii0d80.v2.appdeploy.ai/
- AppDeploy QA snapshots were generated for web and mobile with zero frontend/network errors.

## Deterministic accessibility contract

The visual-language CI now checks:

- primary text contrast on white >= 7:1;
- muted text on white >= 4.5:1;
- active blue on white >= 4.5:1;
- orange-topper foreground >= 4.5:1;
- visible `:focus-visible` treatment;
- `prefers-reduced-motion` handling in product and Explorer;
- mobile breakpoints in product and Explorer;
- live status regions use text + ARIA rather than color alone;
- Mining activity remains explicitly probabilistic;
- Explorer retains Read-only and Validated-node authority boundaries.

Measured reference ratios:

- #17191d / #ffffff ≈ 17.60:1
- #68707b / #ffffff ≈ 5.01:1
- #1769ff / #ffffff ≈ 4.67:1
- #1a130d / #f47a20 ≈ 6.69:1
- #0c4cc4 / #ffffff ≈ 7.38:1

## Motion

- Network ticker: animated only in normal-motion mode.
- Mining activity rail: animated only while work is active.
- Reduced-motion mode removes both continuous ticker motion and mining activity animation while preserving information/state.
- No reward celebration or casino motion exists.

## Semantic honesty

The blue Mining rail represents device activity only. The UI states that block discovery is probabilistic and that the rail is not progress toward a guaranteed reward. No percentage-to-reward, “almost there”, or reward ETA language is admitted.

## Remaining integration caveat

This QA package validates the isolated visual candidate. Before canonical integration, reconcile once more against the newest `main`, because unrelated FAE work may have advanced shared product files after the earlier VL-07 reconciliation.
