# FAE Direction D — Reference Gallery

Status: **VL-13 / admitted references with authority correction**

This is a source-bound implementation reference set. Only surfaces that are both technically verified **and authority-admitted** count as canonical candidate references.

## Homepage — admitted

- `index.html`
- **Proof of work, in your hands.**
- Orange topper + horizontal network ticker.
- White/light working field.
- Blue live/action semantics.

Evidence:
- commit `65a8362310828577f238ab30725124a6734d7aec`
- Visual Language CI `36479427272`
- isolated QA `2ee6a4f4-6b2a-4638-a8a4-8e28b0150528`

## Wallet — admitted

- `index.html#panel-wallet`
- **A wallet you hold, not an account you borrow.**
- Local keys / Local signing / Traceable.
- Recovery, backup, send and full TXID/history remain explicit.

Evidence:
- commit `d9fb61cd5ed14c938643c58cc60d88027a042e71`
- Visual Language CI `36480774355`
- isolated QA `00f47615-0b80-4999-8ab2-4e426a87fb41`

## Mining — admitted

- `index.html#panel-mining`
- `mining.js` is unchanged from the frozen main/MTS baseline.
- Activity state is derived presentation-only in `index.html` using the existing Stop-button enabled state.
- **Computation in motion, not a countdown.**
- Blue rail means active device work only.
- Block discovery explicitly remains probabilistic.

Evidence:
- commit `f328959c7b6ca00e0feea18428cb3a36d3ecdc2d`
- Visual Language CI `36481663906`
- isolated QA `7597149b-f672-4099-b7f8-50a0e200dd5f`

## Explorer — exploratory, NOT admitted

A Direction D Explorer prototype passed visual CI/QA, but later integration review discovered that the Block Explorer authority contract currently has:

- `explorer_application_write_authorized=false`
- BE-05 `source_writes_frozen=true`

Therefore the prototype is **not part of the integration candidate**. `explorer/index.html` and `explorer/styles.css` were reverted exactly to `main`.

Prior exploratory evidence is retained for future use:
- prototype commit `5a8f336500aa4293b0e7b716caa7ed94f7e094e0`
- CI `36482104280`
- visual QA `28f68afb-e3aa-4237-a0f7-a68a2862ffa0`

It may be revived only after compatible Block Explorer source-write authority is explicitly granted.

## Cross-product quality reference

`docs/FAE_VISUAL_LANGUAGE_VL12_QA.md` now distinguishes admitted Homepage/Wallet/Mining QA from non-admitted Explorer exploratory evidence.

## Rule

Technical PASS cannot override an authority freeze. Evidence survives; admission does not.
