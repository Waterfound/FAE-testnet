# FAE-LRP-001 | Preventive Candidate Claims Gate

**PASSIVE / CANDIDATE ONLY.** This is a source-bound technical claim guard, **not a legal opinion**, certification, BCB/CVM authorization, mainnet gate or commercial-release permission.

Source-locked canonical main: `6d0c3956fdf72cd2e7543eee2539397ed5c0e699`. The 13-feature `perimeter.json` separates technical observations from possible legal triggers. `release-gate.mjs` verifies Git blob IDs and source predicates against exact committed objects (`git show`), not mutable working-tree text, and checks pinned README/main UI/Explorer HTML snapshots, explicit dynamic-surface NOT-VERIFIED inventory and a candidate proposal. Missing source objects or proof fail closed. Negative whole-system claims (no exfiltration, no custody, no legal duties) are **not** established by presence of a few source fragments.

### Source facts and ownership
- Canonical `wallet.js` persists private JWK via `localStorage` without at-rest encryption. The Wallet #266 IndexedDB AES-GCM proposal is an **unmerged candidate**. Repair belongs to Wallet / Privacy P0.
- Local Ed25519 signing in `wallet-crypto.js` is observable; whole-stack noncustody is not proved. The hosted signed-tx submission endpoint is **not automatically equivalent to a regulated custodian**. Any commercial provider-service role requires case-specific review.
- PPLNS coordinator source exists; `PPLNS_COINBASE_ACTIVATION_HEIGHT=null` in reviewed main. Pool launch, economics, payment security and operational classification remain with HPA-UC-001 / PCC-001.
- Active v4 testnet parameters differ from documented **future** 9 FAE/630k economic designs. No mainnet activation inference.
- Provider logs, telemetry, user data handling, and live runtime are not fully examined; Privacy P0 owns detailed repair.

### Normative boundary at 12 October 2026
Consult official source URLs in `perimeter.json`: Lei 14.478/2022, Decreto 11.563/2023, BCB 519/520/521 (2025), BCB 589 (2026), Parecer CVM 40, Lei 6.385/1976, LGPD and CDC. BCB 589 amends 520 art. 91 from 1 October 2026 and states 6 November 2026 for the specified relationship restriction; other 589 amendments take effect 1 January 2027. These conditions concern regulated activities when applicable, **not automatically software distribution or own PoW mining**.

### Reproduction on a full GitHub checkout
```sh
node lab/legal-perimeter/release-gate.test.mjs
node lab/legal-perimeter/release-gate.mjs lab/legal-perimeter/perimeter.json lab/legal-perimeter/proposal.example.json
node lab/legal-perimeter/candidate-boundary.test.mjs
node lab/legal-perimeter/candidate-boundary.mjs
node lab/legal-perimeter/source-to-runtime.test.mjs
```
The second command needs the original main Git objects; CI uses a full checkout. Source-to-runtime bounded VM tests execute real pinned `sendFAE()` and hosted `submitTx()` function bodies with stubbed APIs and injected secret sentinels; they do not prove full-stack absence of exfiltration or a deployed runtime. `explorer/app.mjs`, `core.js`, `wallet.js`, `mining.js` runtime-rendered copy and unpublished manifesto remain explicitly outside verified live public-claims coverage. CI runs only for changes touching this candidate area/workflow; no scheduler, mainnet activation, release or canonical required status is created. A green check establishes only technical claims consistency in the **reviewed** scope, not compliance.

Adversarial assurance includes rejections of false approvals, guaranteed returns, inactive PPLNS, unverified encryption and whole-stack custody claims, fabricated mainnet claims, wrong commit, missing source, altered Git blob and unverified public README assertions. Explicit negations and neutral technical discussion are permitted; the grammar cannot replace manual review of other publicity or future interfaces.

### Future specialist questions (not active gate)
Who operates the node/pool and for whom? Can an operator direct third-party assets or payouts? Is a service offered for remuneration? Which jurisdictions and audiences are targeted? Are tokens offered with rights or promises relying on others' efforts? Which log/personal-data processing takes place? Exact responses require future technical and legal fact gathering.

**No merge, activation, commercial release, contact with regulators, contract, spend or permission change is authorized by this PR.**
