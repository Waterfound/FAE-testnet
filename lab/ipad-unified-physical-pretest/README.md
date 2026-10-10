# iPad Pro M4 — Maximum Inference pre-test and single-session physical campaign

**State as of 2026-10-09: SOFTWARE_READY_TO_RUN / PHYSICAL_NOT_PERFORMED.** Candidate-only, without physical dispatch or canonical integration. Pre-test: 2026-10-08. Frozen RDE contract: `FAE-RDE-ACCEPTANCE-V1-20260928`.

## Result / irreducible information
- **HFB DP6:** historical iPad evidence (2347.012 s / 9872 works / 4.206199 work/s) measures throughput, **not wall energy**. Official work/W needs integrated external Wh over the *same* uninterrupted DP6 run; 30m minimum, 35m preferred. No idle subtraction. WAN/testnet has no role in DP6.
- **RDE mobile ARM:** independent testnet miner workload (SHA256), with 3× (10m warmup + 20m measured), 3× (1m no-mining baseline + 5m warmup + 15m measured), and five genuine Safari background→foreground cycles. Exactly **9180s (2h33m)** before lifecycle. No reuse of HFB work/s for RDE H/s.
- **MTS-12 V3:** **only residual** from physical iPad real foreground to start of authoritative `/status` request <=1500ms. Network RTT is informational, *not included* in local gate. Previous real tip PASS must remain historical; **do not repeat the tip campaign**. Canonical V3 harness originally required a *new* tip PASS to arm resume; separate MTS draft PR #288 adds opt-in `?residualOnly=1` with real Miner A foreground measurement and an explicit historical tip reference. **It is now deployed publicly in an isolated host at exact PR #288 head**; remote reachability confirmed, physical iPad Safari evidence still NOT_RUN.

## Preflight — perform before allocating the long iPad session
1. Check [HFB ASIC Lab](https://fairyelf-fae-asic-lab.vercel.app/) displays **DP6 v0.7, v0.8.4.2**, frozen source hash `fd9ecbb6...`, WASM `26139b84...`; do not hit Start yet.
2. Check [RDE Physical Autopilot](https://fae-rde-physical-autopilot-1lztsf.v2.appdeploy.ai/?deviceClass=mobile_tablet_arm&manufacturer=Apple&mode=PHYSICAL_EVIDENCE). It is public and independent of Vercel auth. `PHYSICAL_EVIDENCE` must remain selected; enter **exact physical model** + public `faet1...` address. Neither private key nor seed. Do not select or lock based on favorable performance.
3. Check [the now-public isolated MTS V3 residual-only host](https://fae-mts12-v3-residual-isolated-2026.vercel.app/lab/mining-tip-sync/mts-12-ipad-acceptance.html?residualOnly=1) on real iPad Safari. It is bound to the exact PR #288 commit c130669d and responds without login externally; old V2/other protected hosts remain prohibited. Confirm loaded miner hash on-device.
4. Confirm [v4 testnet /status](https://wfwwotuhectwknvbvgif.supabase.co/functions/v1/fae-public-testnet-v4/status) has `ok:true`, `network: fairyelf-public-testnet-v4`, valid height/tip. Avoid starting RDE if unavailable.
5. Prepare the one selected iPad: ordinary cooling, stable ambient, near-full charge; connect original charger via **AC wall wattmeter**. Photograph meter model and initial integrated Wh. Do not assume its remaining energy counter was reset.

## Stage HFB — 60m DP6 observational target (frozen 35m preferred), continuous foreground
1. Use the official [ASIC Lab](https://fairyelf-fae-asic-lab.vercel.app/). Record device + iPadOS/Safari, charging, initial thermal state, meter method; do not invent watts upfront.
2. Run **parity and exact WASM SHA-256** before accepting throughput. Start DP6 run only after stable charging; maintain the tab **foreground** for a recommended **60 minutes** (frozen >=2100s preferred, hard minimum 1800s unchanged) and keep all other benchmarks stopped. Record start and end integrated Wh and elapsed seconds on the same interval.
3. Record thermal/end conditions, stop and **Export JSON**. Preserve photo/readings + raw JSON. Compute average W = delta_Wh / elapsed_hours; HFB efficiency only within paired-boundary evidence. Do not infer economic COLLAPSE/WARN from work/W alone.

## Stage RDE — 2h33m + lifecycle
1. Recheck v4 `/status`. Open RDE public harness. Predeclare one real commercial exact iPad model; enter only a public testnet reward address. Verify **PHYSICAL_EVIDENCE** and environment before selection lock, never `REHEARSAL_ONLY`.
2. Start full campaign once. **Keep Safari page alive and foreground during all six timed runs**: 3× (10m+20m) and 3× (1m+5m+15m). Do not run HFB concurrently; do not change model, restart, background, or reload. Do not independently conduct parallel interaction activity: the harness executes the scripted coexistence probe.
3. At lifecycle stage (after timed runs) do **five genuine** background→foreground transitions, as requested by the harness. If iPadOS reloads the page, previously accumulated `state.captures` may be lost: flag session incomplete and do not claim full PASS.
4. Immediately press **Export captures**; save `fae-rde-physical-captures-*.json` in Files and make a second copy. Online iPad harness currently keeps captures **in memory** and does not automatically produce immutable bundles.
5. Transfer JSON to a Node 22+ host (Mac can do this later), run `node lab/representative-device-physical-autopilot/import-browser-portfolio.mjs --file ./fae-rde-physical-captures.json --out ./.rde-imported`. Record verifier output. RDE `energy: UNAVAILABLE` remains admissible for participation only; do not attach HFB watts to SHA256 runs.

## Stage MTS V3 — residual only; currently blocked by harness/access
Using the [public isolated MTS V3 `?residualOnly=1` host](https://fae-mts12-v3-residual-isolated-2026.vercel.app/lab/mining-tip-sync/mts-12-ipad-acceptance.html?residualOnly=1), checking the loaded miner SHA on physical iPad Safari `e75a0640...`, run genuine foreground→`/status` *request start* evidence; require <=1500ms and HTTP 200, zero manual restart/stale. Preserve V3 JSON and separate RTT. **Do not run legacy V2** (measured WAN completion, not local start), and **do not redo the already-PASS real-tip campaign** just to unlock the existing V3 UI.

## Abort / interpretation (precommitted)
- If parity/hash mismatch → HFB invalid, no benchmark; if hidden/timing-gap event during HFB → official sustained eligibility blocked.
- If meter Wh is unpaired, charging is unstable, or watts are estimated → HFB throughput-only, HFB work/W still pending.
- If RDE capture count/durations/lifecycle insufficient or lost after page reload → INCOMPLETE; never reclassify synthetic/historical data as PHYSICAL_EVIDENCE.
- If RDE sustained retention <0.7, p95 ratio >2, or a scripted interaction failed → FAIL; final multi-device portfolio is separate from one-device PASS.
- If V3 local start >1500ms → FAIL; if only WAN time available → NOT_MEASURED; if host protected or re-tip gate blocks → NOT_RUN.
- Distinct HFB/RDE/MTS evidence must remain independently provenance-bound.

## Remaining machine work and current limitations
- Remote no-login fetch of HFB and RDE succeeded; v4 `/status` responded `ok:true`. This verifies page/API **reachability**, not real Safari performance.
- Existing RDE deployed app is READY with zero reported errors; prior software REHEARSAL_ONLY was PASS. Physical evidence remains uncollected.
- **MTS V3 residual-only candidate is implemented in separate MTS draft PR #288**, with separate `FAE_MTS_12_PHYSICAL_IPAD_RESIDUAL_V3` evidence, historical real-tip PASS reference, one Miner A only, and original full V3 behavior unchanged when the query flag is absent. Remote deployment/access verified, physical qualification remains OPEN.
- No production Vercel/Supabase mutation, no consensus/economics/mainnet changes and no new paid spend authorized or performed.

Run: `node lab/ipad-unified-physical-pretest/verify-pretest.mjs`; CI independently verifies this declaration against the frozen RDE/autopilot contracts.

## 2026-10-09 — Sustainable Device Residency extension
**Read [SUSTAINABLE_DEVICE_RESIDENCY.md](./SUSTAINABLE_DEVICE_RESIDENCY.md) BEFORE the physical session** and use [the power ledger CSV](./power-residency-ledger.csv). A 20m ordinary-heavy-load power-source baseline and a 60m continuous HFB DP6 observation, using an iPhone as passive logging device, now test whether battery SOC keeps falling despite suitable external power. RDE's different SHA256 workload is 2h33 and cannot establish DP6 power equilibrium. Precommitted advisory classifications distinguish stable, transient/marginal, continuing decline, environmental invalidity and insufficient evidence; the frozen RDE/HFB gates are untouched. **New planned fixed time = 20+60+153 = 233 minutes (3h53), plus lifecycle/MTS and setup.** Battery 80% charge-limit hysteresis can show 80→75→80 even during ordinary operation; do not misclassify it as FAIL.
