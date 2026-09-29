# FAE Visual Language

Canonical exploration/implementation direction: **Direction D — Orange Top / White Field / Blue Circulation**.

Waterfound selected Direction D after rejecting A/B/C as final directions. A/B/C remain historical exploration evidence only.

## Structural thesis

- **Orange Top** = FAE identity + broadcast/network context.
- **White Field** = dominant working surface.
- **Blue Circulation** = live activity, computation, focus and processing.

The implementation must remain recognizable without the logo and must preserve semantic honesty in Mining: a blue activity rail can make computation feel alive, but can never imply deterministic progress toward a block reward.

See:
- `design/direction-d-authority.json`
- `design/direction-d-visual-grammar.md`
- `design/quality-gates.md`
- `design/anti-pattern-registry.json`

## Reusable vs FAE-specific

Potential Waterfound Visual System primitives may later include typography/data treatment, spacing, accessibility, motion grammar, focus states and QA methods.

FAE-specific identity remains specialized: orange topper, ticker behavior, blue-circulation semantics, FAE narrative and eventual symbol/wordmark.

**Generalize proven patterns, not imagined reuse.**

## Execution boundary

Direction selection is resolved. Non-consensus UI implementation may proceed after reconciliation with newest `main`. Consensus, economics, address formats, cryptographic constants, transaction semantics and mining correctness remain outside this workstream.

## Proven implementation references

After Homepage, Wallet, Mining and Explorer QA, the proven cross-product primitives and source-bound reference gallery are recorded in:

- `design/proven-primitives.json`
- `design/reference-gallery.md`
- `docs/FAE_VISUAL_LANGUAGE_VL12_QA.md`

They remain inside FAE until another real product demonstrates reusable value.


## Explorer authority correction

The Direction D Explorer prototype is **not part of the current integration candidate**. Block Explorer authority currently freezes Explorer source writes. Explorer files have been restored to `main`; the prior visual prototype remains evidence-only until a compatible source-write authority is explicitly granted.

## Direction D+ — current authoritative approval candidate

The latest visual candidate is **D+**, derived from Direction D and preserving the already-authoritative structure. It is **not yet the final canonical visual direction** until Waterfound explicitly approves it.

Approval Studio:
- https://fae-direction-d-approval-studio-txbjsu.v2.appdeploy.ai/

Key refinements:
- 100% product / 0% sales opening experience;
- thin orange topper with a single status chip (Connecting… → Testnet online / Mainnet online);
- no separate Public testnet chip below the topper and no Test coins button;
- ticker uses Block Height while preserving the earlier compact information typography;
- compact Wallet/Mining controls at the upper-right in the white zone;
- Mining Overview uses non-redundant operational telemetry;
- Devices bars are small, thin, rectangular, centered, spaced apart, and intentionally surrounded by generous whitespace;
- current works/s stays inside the blue fill; estimated max works/s stays fixed on the right edge of the track;
- blue intensity and fast internal motion communicate live current performance relative to each device's own estimated ceiling;
- Mobile Preview remains at the bottom;
- GitHub and GitBook entry points remain at the bottom.

This D+ branch exists only for approval and must not supersede the verified integration candidate or public-rebrand authority gate until Waterfound approves it.
