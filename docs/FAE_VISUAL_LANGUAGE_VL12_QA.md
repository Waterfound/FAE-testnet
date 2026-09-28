# FAE Direction D — VL-12 QA

Status: **PASS for admitted Homepage / Wallet / Mining candidate**

## Admitted evidence

- Homepage CI `36479427272` — PASS; isolated QA `2ee6a4f4-6b2a-4638-a8a4-8e28b0150528`.
- Wallet CI `36480774355` — PASS; isolated QA `00f47615-0b80-4999-8ab2-4e426a87fb41`.
- Mining CI `36481663906` — PASS; isolated QA `7597149b-f672-4099-b7f8-50a0e200dd5f`.
- AppDeploy visual QA generated web/mobile snapshots with zero frontend/network errors.

## Deterministic accessibility contract

For the admitted product surface the CI checks:

- primary text / white >= 7:1;
- muted text / white >= 4.5:1;
- active blue / white >= 4.5:1;
- orange-topper foreground >= 4.5:1;
- visible `:focus-visible`;
- `prefers-reduced-motion`;
- mobile breakpoints;
- text + ARIA live status;
- Mining semantic honesty.

Reference ratios:
- #17191d / #ffffff ≈ 17.60:1
- #68707b / #ffffff ≈ 5.01:1
- #1769ff / #ffffff ≈ 4.67:1
- #1a130d / #f47a20 ≈ 6.69:1

## Motion and mining honesty

- Ticker continuous motion is disabled under reduced motion.
- Mining activity motion exists only while work is active.
- The blue rail is explicitly not deterministic progress toward reward.
- No percentage-to-reward, “almost there”, or reward ETA language is admitted.

## Explorer correction

The Direction D Explorer prototype passed visual QA but is **not admitted** because Block Explorer source-write authority is frozen. Its evidence is retained as exploratory only; Explorer source in the integration candidate equals `main`.

## Integration caveat

Before merge, compare against newest `main` and fail closed on any overlap. Public rebrand/production merge remains Waterfound authority.
