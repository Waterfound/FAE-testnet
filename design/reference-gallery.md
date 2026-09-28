# FAE Direction D — Reference Gallery

Status: **VL-13 / approved implementation references**

This is a source-bound reference gallery, not a mood board. Each entry points to an implementation that survived product and QA constraints.

## Homepage — identity / broadcast / narrative

Canonical candidate surface:
- `index.html`
- Direction D introduction: **Proof of work, in your hands.**
- Orange topper is the identity/broadcast layer.
- Block / supply / reward / difficulty belong to the horizontal ticker rather than large fixed metric cards.
- White/light field carries the product narrative.
- Blue is reserved for live/action state.

Evidence:
- commit `65a8362310828577f238ab30725124a6734d7aec`
- Visual Language CI run `36479427272`
- public isolated QA run `2ee6a4f4-6b2a-4638-a8a4-8e28b0150528`

## Wallet — ownership / security / traceability

Canonical candidate surface:
- `index.html#panel-wallet`
- heading: **A wallet you hold, not an account you borrow.**
- trust strip: Local keys / Local signing / Traceable.
- recovery, backup, sending and full TXID/history remain visibly subordinate to safety and task clarity, not branding.

Evidence:
- commit `d9fb61cd5ed14c938643c58cc60d88027a042e71`
- Visual Language CI run `36480774355`
- public read-only QA run `00f47615-0b80-4999-8ab2-4e426a87fb41`

## Mining — live computation / semantic honesty

Canonical candidate surfaces:
- `index.html#panel-mining`
- `mining.js` UI-only state hooks.
- heading: **Computation in motion, not a countdown.**
- blue activity rail means active device work only.
- disclosure explicitly states that block discovery is probabilistic.
- no percentage-to-reward, reward ETA or “almost there” language.

Evidence:
- commit `f328959c7b6ca00e0feea18428cb3a36d3ecdc2d`
- Visual Language CI run `36481663906`
- public read-only QA run `7597149b-f672-4099-b7f8-50a0e200dd5f`

## Explorer — observation / neutrality / dense data

Canonical candidate surfaces:
- `explorer/index.html`
- `explorer/styles.css`
- orange broadcast layer + network ticker.
- white/light observation field.
- blue search/action state.
- Read-only and Validated-node boundary remain explicit.
- Height / Issued / Target / Mempool moved out of large fixed cards.

Evidence:
- commit `5a8f336500aa4293b0e7b716caa7ed94f7e094e0`
- Visual Language CI run `36482104280`
- corrected public visual QA run `28f68afb-e3aa-4237-a0f7-a68a2862ffa0`

## Cross-product quality reference

- `docs/FAE_VISUAL_LANGUAGE_VL12_QA.md`
- contrast, focus, reduced motion, mobile breakpoints, ARIA/status semantics and mining honesty are CI-bound.
- `tests/visual-language-contract.mjs` is the executable visual-language contract.

## Reference rule

A future change may differ aesthetically from these exact compositions, but it must preserve the proven grammar unless Waterfound explicitly changes high-order art direction.
