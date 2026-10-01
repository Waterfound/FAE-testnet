# FAE — Authorship Grammar Propagation Readiness

Status: **TECHNICALLY_CLOSED_READINESS / PROPAGATION_NOT_AUTHORIZED**  
Date: 2026-10-01  
Authority owner: Waterfound  
Evidence branch: `docs/fae-authorship-propagation-readiness-20261001`

## Mission

Prepare the Visual Language system for later, separately authorized propagation of the approved FAE authorship grammar without performing any target-surface rewrite now.

Preserved thesis:

> **FAE must feel like a living instrument of computation.**

Supporting rules:

- Every visible element must feel intentional, not generated.
- **Intent before identity.**
- Mining = movement.
- Wallet = rest.
- Blue = computation/activity.
- Green = confirmed/received/safe.
- Orange = identity/energy.
- Cross-surface consistency means shared grammar, not cloned layout.

No production, main-merge, public-deployment or target-propagation authority is created by this document.

---

## 1. Evidence reconstruction

### Canonical main

Current observed `main`:

- revision: `3ae59d0d013af0ee518f3cfb73c5fcb08394b075`
- current product `index.html` blob: `23148e9fbbcf5a4eea82f7277a267ab5e40f1838`
- current `wallet.js` blob: `7ab3ac9a24a7a42228ee11cfbefa15ddcd52b7e5`
- current `mining.js` blob: `fb98057341adca6f1f53b681e1094ef6fcb97e1f`
- current `explorer/index.html` blob: `5130efd7e3625e81e52517fb9a834697ebf6fc1f`

The canonical product remains visually older than Direction D/D+.

### Direction D / PR #265

PR #265 — **Visual Language: Direction D integration candidate**

- state: open / draft / mergeable
- branch: `colony/fae-visual-language-rebrand-001`
- head: `2ffa8dbbd4ed9b32d5593e6462f7c3486e18603c`
- product `index.html` blob: `a643c1d6cf6ec8b4d483516c14cbdeb7506598ec`
- `wallet.js`: byte-identical to current canonical main
- `mining.js`: byte-identical to current canonical main
- Explorer source reverted to canonical `main` because Explorer source-write authority is frozen.

Exact-head observed gates on PR #265:

- Visual Language Lab — GREEN
- cross-lab-integration-gate — GREEN
- verify-canonical-source — GREEN
- public-code-security-recurring-assurance — GREEN
- CodeQL — GREEN

Direction D establishes:

- Orange Top;
- White Field;
- Blue Circulation;
- light-first product field;
- semantic rather than decorative motion;
- probabilistically honest mining activity;
- Wallet / Mining product specialization.

### Direction D+

Operational source authority for later approved-reference work:

- branch: `design/fae-direction-d-plus-approval`
- revision: `6719a825b6e12a38824af3edfd03851b5d62eb1c`
- parent: PR #265 head `2ffa8db...`
- D+ product `index.html` is still byte-identical to Direction D: `a643c1d6cf6ec8b4d483516c14cbdeb7506598ec`

Therefore D+ is currently **authority/design refinement, not a newer product implementation**.

D+ refinements include:

- 100% product / 0% sales entry;
- thin orange topper;
- single network status chip inside topper;
- remove separate Public testnet chip;
- remove Test coins;
- ticker label `Block Height`;
- compact upper-right Wallet / Mining mode controls;
- Mining Overview;
- Devices telemetry;
- current work rate left / estimated capacity right;
- activity strength mapped to actual device performance, never reward progress.

Authority-state note: `design/direction-d-plus-approval-candidate.json` still records final canonical promotion as pending, while downstream Wallet and Mining reference work explicitly bind `6719a825...` as their visual source authority. This is a **documentation / promotion-state distinction**, not permission to merge or deploy D+.

### Mining Authored Reference / PR #268

PR #268 — **Visual Language: Mining authored reference — Composition Pass 1**

- state: open / draft / mergeable
- branch: `design/fae-mining-authored-reference-001`
- current head: `a949e913990e13a0b907891a729b5c7b2086547b`
- source authority: D+ revision `6719a825...`
- approved reference artifact:
  `design/mining-authored-reference/composition-pass-1.html`
- artifact blob:
  `6aa1fa3711700874c2440d59d28b4005549775db`

Completed frontiers:

`MAR-00 → MAR-01 → MAR-02 → MAR-03 → MAR-04 → MAR-05 → MAR-06 → MAR-07`

Final approval:

- approval commit: `2633c90e7c5b3cd3eb85198d049d1cb038eb9016`
- approved reference pre-receipt candidate: `82af546d8e108333bf01d4d80110c7080eeb3983`
- `propagation_authority=false`
- `production_authority=false`
- `main_merge_authority=false`

The approved reference demonstrates the authored target character:

- one dominant Current work rate object;
- continuous computation field;
- quiet Mining Overview rail;
- thin device instrument traces;
- blue state-derived computation;
- green accepted-work confirmation;
- stable geometry across active / paused / empty / error;
- no card-grid default;
- no decorative glow;
- no reward-progress fiction.

PR #268 current gates:

- Visual Language Lab — GREEN
- verify-canonical-source — GREEN
- public-code-security — GREEN
- CodeQL — GREEN
- cross-lab-integration-gate — RED only at
  **Require candidate to contain latest canonical main**;
  checkout and runner materialized successfully, and combined verification was skipped after that containment check failed.

This failure is an integration-age boundary, not evidence that the approved reference itself failed its visual gates.

### CII authorship-grammar extraction / PR #21

CII repository:
`Waterfound/Continuous-Improvement-Intelligence-CII`

PR #21:

- title: `CII: learn FAE authorship grammar from approved Mining reference`
- state: open / draft / mergeable
- branch: `cii/fae-mining-authorship-grammar-001`
- head: `c97b3caa86870dc5b53937cd3aa5bf384d8e8dab`
- extraction status: `EXTRACTED_ADVISORY_ONLY`

Extracted families:

1. spatial grammar;
2. motion grammar;
3. semantic color;
4. typography hierarchy;
5. state behavior;
6. quiet / active contrast;
7. iconography;
8. interaction timing;
9. anti-patterns;
10. authorship invariants.

Preservation handoff:

- `status=READY_FOR_SYSTEM_PRESERVATION`
- `automatic_target_write=false`
- `automatic_production_change=false`
- target implementations must translate the grammar to each surface's semantic role;
- literal Mining composition copying is prohibited.

Current CII gate remains unresolved:

`EXTRACTION_MATERIALIZED__EXTERNAL_CI_GATE`

Latest observed Verify CII run:

- run: `36666757776`
- Node 22: failure before steps
- Node 24: failure before steps
- `steps=null`
- no checkout
- no npm install
- no tests
- no deterministic demo
- no candidate code failure proven

This readiness package **does not treat that gate as resolved**.

### Wallet / PR #266

PR #266 — **Wallet: persistent encrypted multi-wallet vault + verified onboarding**

- state: open / draft / mergeable
- branch: `build-colony/wallet-persistent-vault-20260928`
- current head: `8708b03866f42cf84ba2d01908caec4238928e70`
- base: D+ authority branch
- terminal technical state remains:
  `FAE_WALLET_PERSISTENT_VAULT_READY`

Current functional blobs:

- `index.html`: `bdf23653b7f59a5608f2a3167ff7b50932d38ce6`
- `wallet.js`: `6ef6532eb6b20b4c84b90c030e74288641a0c0ef`
- `wallet-vault.js`: `9e594dbd97317b39bd4e29743cef606393dbd384`
- `wallet-signing-intent.js`: `66e24d5a3b9f6fb415322a4e0de9e0e323b1724d`
- `wallet-transactions.js`: `1e9c9f72f6d8e9c8e338d3acbf418f832cd826d2`
- `wallet-crypto.js`: `184d207b6017976b32e650f4ca184d3f06a2c8b4`
- `mining.js`: `fb98057341adca6f1f53b681e1094ef6fcb97e1f`

All current observed PR #266 gates are GREEN:

- Wallet Persistent Vault candidate
- Visual Language Lab
- public-code-security-recurring-assurance
- cross-lab-integration-gate
- verify-canonical-source
- CodeQL

Important drift after the older PR-body checkpoint `6e202d...`:

- signing-intent review / substitution hardening was added;
- `index.html` and `wallet.js` therefore changed;
- `wallet-vault.js` remained byte-identical;
- `mining.js` remained byte-identical.

Any later Wallet authorship translation must start from the **current functional Wallet head**, not from `424b667...` or `6e202d...`.

### Explorer

Current Explorer source remains canonical / non-Direction-D:

- `explorer/index.html` blob:
  `5130efd7e3625e81e52517fb9a834697ebf6fc1f`

Explorer authority currently has:

- `explorer_application_write_authorized=false`
- source writes frozen in the current Block Explorer authority chain
- public / live binding remains separately gated

Therefore Explorer may be included in readiness analysis only. No authorship propagation branch for Explorer is admissible now.

---

## 2. Real visual drift matrix

| Surface | Real current state | Authorship drift |
| --- | --- | --- |
| canonical product / main | older dark product source | HIGH — has not admitted Direction D, D+ or authored Mining grammar |
| Direction D candidate | orange / white / blue product candidate | MEDIUM — establishes identity but still predates D+ and authored-reference refinements |
| D+ product source | byte-identical to Direction D product source | HIGH relative to its own documented refinements — D+ is not implemented in product source |
| Mining reference | final approved authored reference | NONE for the reference itself |
| production Mining surface | Direction D-level product presentation | HIGH — authored reference is isolated and not translated into production |
| Wallet candidate | strong functional candidate with Direction D shell | HIGH in authorship — functionality is advanced; visual grammar has not been translated to Wallet = rest |
| shared network shell | Direction D ticker/topper exists only in candidate lineage; D+ refinements absent | HIGH |
| Explorer | older canonical Explorer + write freeze | HIGH but BLOCKED by authority |

Specific D+ → product drift observed in both D+ product source and current Wallet candidate:

- marketing/hero vocabulary still present;
- Public testnet element still present;
- Test coins still present;
- ticker does not yet use `Block Height`;
- compact upper-right Wallet / Mining D+ control pattern absent;
- Mining Overview absent;
- Devices telemetry absent;
- authored Current work rate instrument absent.

The Mining authored reference contains the intended authored equivalents and intentionally removes the generic/card-heavy expression.

---

## 3. Surfaces requiring authorship-grammar absorption

### A. Shared Product Shell / Network Context

Role:

- identity;
- global network context;
- mode switching;
- circulation.

Target expression:

- Orange = identity / system energy;
- compact ticker = network circulation;
- blue only for live/focus/processing;
- status legible without color;
- white field remains dominant;
- no marketing hero before product;
- no redundant Public testnet / Test coins product chrome.

### B. Wallet

Role:

**rest, possession, security, presence.**

Wallet is the strongest cross-surface proof that the grammar generalizes rather than merely copies Mining.

Target expression:

- quiet continuous field;
- dominant ownership / balance / active-wallet state rather than KPI cards;
- security-critical recovery and signing states visually sober;
- green only for confirmed receipt / safe completion;
- state changes preserve geometry;
- no ambient motion;
- no Mining composition literal copy.

### C. Production Mining

Role:

**movement, computation, activity, energy, flow.**

Target expression is already proven by the approved reference, but production has not absorbed it.

Required translation:

- bring relationships and state behavior from the approved reference into the real product;
- do not rebuild or redesign the reference;
- preserve real miner semantics and DOM/runtime contracts;
- blue activity must be caused by real computation;
- accepted work uses brief green event semantics;
- pause / empty / error remain spatially stable.

### D. Network / Circulation behavior

Role:

**distributed response and circulation.**

This is partly the shared shell and partly dynamic network state.

Target expression:

- calm horizontal facts;
- network activity without finance-terminal styling;
- explicit Connecting / online / unavailable states;
- reduced motion retains readable state;
- no decorative pulse unrelated to live state.

### E. Explorer

Role:

observation, transparency, neutrality, dense-data legibility.

Needs eventual authorship translation, but current authority makes it **NOT ADMISSIBLE** for implementation.

---

## 4. Recommended propagation order

The order below is a readiness recommendation only. No propagation is authorized by this package.

### P0 — Shared D+ shell baseline

Not a CII target translation by itself; this is the structural prerequisite needed before per-surface authorship work.

Establish only:

- product-first entry;
- topper/status;
- ticker naming;
- focused Wallet / Mining controls;
- shared typography / spacing / focus / reduced-motion foundations.

Do not redesign Wallet or Mining during P0.

### P1 — Wallet authorship translation

First true cross-surface propagation target.

Reason:

- it tests the strongest semantic contrast with Mining;
- proves that the grammar can produce **quiet possession** rather than simply reproduce Mining movement;
- PR #266 already provides the functional/security source owner and regression bank.

### P2 — Production Mining translation

Translate the already-approved authored Mining reference into the real product surface.

Reason:

- reference semantics are already settled;
- this step should be integration, not art-direction discovery.

### P3 — Network circulation refinement

After Wallet and Mining share a stable shell, refine cross-mode network response and circulation behavior without reopening either surface composition.

### P4 — Explorer

Only after compatible Explorer source-write authority exists.

---

## 5. Dependency graph

```text
Direction D selection
  └─ PR #265 Direction D candidate
       └─ D+ authority source @ 6719a825...
            ├─ Wallet functional candidate PR #266 @ current head
            └─ Mining Authored Reference
                 └─ MAR-00..MAR-07 complete
                      └─ Waterfound final reference approval
                           └─ CII grammar extraction PR #21
                                ├─ grammar materialized
                                └─ EXTERNAL_CI_GATE unresolved

Before any target write:
  CII canonical/system-preservation gate
            AND
  explicit propagation authority
            AND
  exact target-source freeze
            ↓
  P0 Shared D+ shell
            ↓
  P1 Wallet review gate
            ↓
  P2 Mining production review gate
            ↓
  P3 Network circulation review gate

Explorer:
  separate source-write authority gate
            ↓
  later Explorer authorship candidate
```

The CII external gate and propagation-authority gate are independent. Neither is silently treated as satisfied by the other.

---

## 6. Authorship invariants to preserve

### System preservation core

- FAE reads as an instrument / object / system, not a website template.
- Every prominent element has a reason tied to state, hierarchy, ownership, computation or circulation.
- Identity survives removal of FAE name and logo.
- Silence is designed.
- Activity is state-derived.
- Operational depth is felt before it is explained.
- Restraint and omission are part of identity.
- Shared grammar does not mean repeated layout.
- Documentation follows proven authorship; it does not substitute for it.

### Semantic color

- Orange: FAE identity / system-level energy / attention.
- Blue: computation / circulation / active flow.
- Green: confirmed positive event / receipt / accepted / safe completion.
- Neutral / white: silence / stability / ownership / clarity.

Never:

- blue as reward probability;
- orange as generic warning everywhere;
- decorative gradients/glow;
- crypto-neon;
- alarm-heavy error styling.

### Motion

- real state → motion;
- quiet state → motion settles;
- input → state change → brief response → quiet baseline;
- property transition preferred over structural re-layout;
- reduced motion preserves meaning.

### Spatial grammar

- continuous primary field before card grid;
- one dominant state object;
- negative space carries hierarchy;
- secondary operational information stays subordinate;
- borders only for semantic boundaries;
- asymmetry allowed when it clarifies hierarchy.

---

## 7. Anti-patterns that must fail review

Reject:

- card inside card;
- rounded rectangle as default container;
- SaaS KPI grid as default IA;
- generic Web3 landing page;
- hero sections on operational product screens;
- feature marketing inside the product;
- many tiny status pills;
- purple/cyan decorative gradients;
- glassmorphism;
- decorative glow;
- finance-terminal imitation;
- boilerplate subtitles;
- random circuitry / fantasy / AI-futurist decoration;
- constant motion unrelated to state;
- reward ETA / percent-to-block / almost-won semantics;
- security-critical Wallet actions visually subordinated to brand treatment.

Recognition test:

> Remove the logo and FAE name. If the surface becomes a generic AI / SaaS / crypto dashboard, it fails.

---

## 8. Exact integration boundaries

### Shared file: `index.html`

This is shared state between Wallet, Mining and network shell and therefore **must be serialized**, not independently rewritten in parallel.

Allowed under a later visual authority:

- layout;
- CSS;
- semantic grouping;
- typography;
- visual state treatment;
- accessibility labels where semantics are preserved;
- product-mode presentation.

Must preserve unless separately authorized and regression-proven:

- DOM IDs / event hooks consumed by current runtime;
- network API semantics;
- wallet action semantics;
- mining action semantics;
- transaction/history semantics.

### Wallet-owned implementation

Treat current PR #266 head as functional source owner.

Visual propagation must not silently modify:

- `wallet-crypto.js`
- `wallet-vault.js`
- `wallet-signing-intent.js`
- `wallet-transactions.js`
- address / derivation behavior
- signing review / substitution guard
- persistence / migration semantics
- send / receive / TXID semantics

If `wallet.js` must change solely to support a visual state, the change must be separately visible and the full Wallet regression bank rerun.

### Mining-owned implementation

During visual propagation, `mining.js` is a protected semantic/runtime surface.

Preferred requirement:

- byte-preserve the exact authoritative miner runtime across the visual candidate.

Any required change to mining runtime is outside Visual Language authority and must fail closed into a separate owner/gate.

### Explorer

No writes under current readiness:

- `explorer/**` remains frozen for this workstream until compatible Explorer authority is explicit.

### Protocol / consensus / security boundaries

Visual Language must not alter:

- consensus;
- economics;
- block validity;
- fork choice;
- protocol identity;
- address format;
- transaction validity;
- cryptographic constants;
- wallet key custody;
- mining algorithm;
- release / activation / mainnet;
- `sovereign-forge/node/authoritative/**`;
- `sovereign-forge/protocol/**`;
- `sovereign-forge/release/**`;
- `core.js`;
- `supabase/**`.

---

## 9. Regression requirements for later target candidates

### Every surface

Required:

- Visual Language contract;
- recognition test without logo/name;
- anti-pattern scan;
- keyboard focus;
- contrast;
- non-color-only state;
- reduced motion;
- mobile width legibility;
- source / candidate identity binding;
- cross-lab integration;
- canonical-source verification;
- public-code security;
- CodeQL where applicable.

### Wallet-specific

Rerun on the exact combined candidate:

- New Wallet staged generation;
- exact 24-word re-entry;
- Recovery + optional passphrase;
- persistent encrypted IndexedDB vault;
- Add / Switch / Remove;
- active Wallet persistence;
- active derived-address persistence;
- duplicate suppression;
- legacy migration fail closed;
- authenticated ciphertext tamper failure;
- missing / different wrapping-key failure;
- mining-switch refusal;
- Wallet Transaction UX;
- full TXID/history;
- signing-intent substitution regression;
- reviewed intent → signed payload binding;
- no seed/private-key backend transmission;
- no plaintext passphrase persistence.

### Mining-specific

Required:

- exact miner-runtime blob binding;
- start / pause / resume / stop causality;
- stale-work behavior unchanged;
- reward-address behavior unchanged;
- no deterministic reward progress;
- activity settles when computation stops;
- accepted work uses discrete confirmation;
- empty and error states retain stable geometry;
- reduced motion;
- existing mining/runtime regression bank;
- canonical source / integration gates.

### Network / shell-specific

Required:

- Connecting / online / unavailable semantics;
- status text not color-only;
- ticker readable;
- reduced-motion ticker readable/static-scrollable;
- Block Height / Supply / Reward / Difficulty remain factual network data;
- no duplicate or promotional testnet chrome;
- mode switching does not mutate Wallet or Mining state unexpectedly.

### Explorer-specific, when authority exists

Required in addition:

- Block Explorer Lab;
- read-only identity visible;
- expected testnet identity;
- network mismatch fail closed;
- mutation methods rejected;
- no Wallet / mining / signing / send controls;
- independent-node binding requirements remain intact.

---

## 10. Candidate branch / PR strategy after authority

**No target branch or propagation PR is created by this readiness run.**

When propagation is explicitly authorized:

1. Freeze exact current source revisions again.
2. Create one serialized shared-state lineage because `index.html` is common.
3. Do not branch Wallet and Mining UI rewrites independently against the same `index.html`.

Recommended stacked strategy:

### Candidate 0 — shared shell

`design/fae-authorship-shell-001`

Base:

- exact then-current functional source chosen by reconciliation;
- bind D+ authority revision;
- bind approved Mining reference artifact blob;
- bind CII grammar digest/revision.

Scope:

- shared shell only.

### Candidate 1 — Wallet

`design/fae-authorship-wallet-001`

Base:

- approved/green shell candidate;
- exact current Wallet functional source owner reconciled first.

Scope:

- Wallet translation only;
- own Waterfound review gate.

### Candidate 2 — Mining production

`design/fae-authorship-mining-product-001`

Base:

- approved/green Wallet candidate.

Scope:

- translate the already-approved Mining reference into product;
- no Mining art-direction restart;
- miner runtime preserved.

### Candidate 3 — Network circulation

`design/fae-authorship-network-001`

Base:

- approved/green Mining product candidate.

Scope:

- shared network behavior only.

### Explorer

Separate lineage only after Explorer authority is compatible.

No candidate above may imply:

- main merge authority;
- production authority;
- public deployment authority;
- mainnet authority.

---

## 11. Current gates

### External gate

CII PR #21:

`EXTRACTION_MATERIALIZED__EXTERNAL_CI_GATE`

Unresolved.

### Authority gate

Mining final approval explicitly records:

`propagation_authority=false`

Therefore target writes remain closed.

### Explorer authority gate

Explorer source writes remain frozen.

---

## 12. Terminal readiness disposition

```text
VISUAL_STATE_RECONSTRUCTED
DRIFT_MATRIX_CLOSED
TARGET_SURFACES_IDENTIFIED
PROPAGATION_ORDER_DEFINED
DEPENDENCY_GRAPH_DEFINED
AUTHORSHIP_INVARIANTS_FROZEN
ANTI_PATTERNS_FROZEN
INTEGRATION_BOUNDARIES_DEFINED
REGRESSION_REQUIREMENTS_DEFINED
BRANCH_PR_STRATEGY_DEFINED
TARGET_PROPAGATION_NOT_EXECUTED
```

Terminal classification:

**READINESS_TECHNICALLY_CLOSED__CII_EXTERNAL_GATE_UNRESOLVED__PROPAGATION_AUTHORITY_FALSE__EXPLORER_AUTHORITY_FROZEN**

No further autonomous target-surface work is admissible until a relevant gate changes.
