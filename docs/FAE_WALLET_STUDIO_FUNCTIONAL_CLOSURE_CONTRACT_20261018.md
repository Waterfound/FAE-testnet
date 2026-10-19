# FAE Wallet — authored Studio functional closure contract

**Candidate only** · owner: FAE Product Shell + Wallet ACTIVE · single integrator: PR #272.

## Verified source split

- `design/approved-wallet-vr08-studio/` is the eight-file **immutable** source from the Waterfound-accepted Studio version `1791582226769`. Editing it to accommodate a feature is forbidden.
- `design/wallet-studio-functional/` is the **candidate** read-only Studio-first integration. Its current `Empty` scene reads the IndexedDB vault; its `Active` scene decrypts and matches the stored public identity. Creation and Recovery remain previews.
- `index.html` with `wallet.js`, `wallet-vault.js`, `wallet-crypto.js`, `wallet-signing-intent.js`, `wallet-transactions.js`, `core.js` and `mining.js` is the existing **functional owner**. Browser tests cover onboarding, backup/recovery, transactions and simulated network responses there. These operations are **not yet** bound to the approved Studio. Do not infer production completeness from mocked network tests.
- The earlier VR-09 Product + Wallet screenshot is useful as a **feature inventory only**; its card/form layout is rejected.

## Studio layout contract

| Existing scene | Function to bind | How to preserve composition | Truth/security gate |
| --- | --- | --- | --- |
| Empty: `.empty-primary` and `.empty-aside` | New Wallet / Recovery Wallet entry | Preserve the blank ownership canvas and two terse choices | Read local vault before showing; no implicit wallet |
| Creation: `.creation-layout` | Generate, reveal offline backup, confirm all 24 words, encrypted commit | Progressive disclosure inside existing primary/aside; never mount a full dashboard | Existing crypto owner, no entropy/phrase in logs/screenshot/URL; exact re-entry and postcommit readback |
| Recovery: `.recovery-composition` / `.word-grid` | 24-word phrase, optional passphrase, address review and explicit admission | 24 positions within the existing recovery sheet; one clear action at a time | Check checksum, derived address, passphrase and encrypted vault readback |
| Active: `.active-composition` / `.balance-field` | Authenticated identity and verified balance | Keep balance as focal number; unknown balance remains em dash | Canonical network + public key binding, no fake/zero-on-error balance |
| Active: `.wallet-rail` | Multiple Wallets, address selection, removal | Wallet rail, not new floating cards; progressive disclosure for destructive operation | Local encrypted vault, selected address consistency, mining conflict check |
| Active: `.flow-strip` and transaction activity | Confirmed/pending/unknown transfers, honest limited coverage | Restrained authored marks; no synthetic transaction history | Backend response provenance, address/time matching, pending/confirmed distinction |
| Active: `.action-detail` | Receive address, guarded Send | Reuse detail region; no modal maze or separate page architecture | User intent → local signing → verify submitted transaction ID; no auto-send |
| FAE Mining identity | Maintain authored blue normal-use/PoW coherence | Independent mining composition; no wallet-dashboard injection | Actual work only, no fictitious rewards; active mining must guard switch/send when needed |

## Serial integration gates

1. **DFR-03:** Wire *New Wallet* to existing BIP39 and encrypted vault; real local browser test: no implicit generation, backup visible only after click, no admission before exact 24-word confirmation, wrong words fail, reload recovers encrypted Wallet, no key leakage.
2. **DFR-04:** Wire *Recovery Wallet* in recovery sheet; optional passphrase derives distinct address; verify before admission; test wrong phrase, invalid checksum, wrong address, replay and reload.
3. **DFR-05:** Bind real `/balance` and `/transactions` only for the authenticated selected public address using existing trust semantics; unavailability ≠ 0; no stale data across Wallet switch; disclose limited history coverage.
4. **DFR-06:** Bind `wallet-rail` to real vault wallets/addresses; persistence, add/switch/remove, mining coherence and recovery tests, all within the rail.
5. **DFR-07:** Bind receive/send to existing signing-intent and transaction owners; deliberate signed operation, no automatic broadcast or false confirmation, error/interruption/reconciliation evidence.
6. **DFR-08:** Re-run native Chromium layout/pixel comparisons after **each** bound scene at 1440/834/390, including genuine Active; also focus navigation, screen reader semantics, reduced motion, no seed in artifacts, long addresses and error states.
7. **DFR-09:** Separate Waterfound visual acceptance of the final *working* product. CI GREEN never grants approval or permission to merge/release.

## Reuse-first engineering rule

Do **not** clone crypto routines or import the Studio demo runtime `vr11.ts` to simulate success. Do not add generic panels, second shells, large recovery dashboards, or extra feature families. First identify the smallest existing functional primitive, adapt its input/output to the existing Studio scene, test the real effect, then compare visuals. If it breaks visual harmony, correct the adapter / progressive disclosure, not the frozen Studio.

**Operations:** candidate-only writes to PR #272, no consensus/economics, native persistent runtime repin, provider/credential change, production deploy, release, main merge or new portfolio slot. General Execution planning or source checkpoint does not imply native Durable provider dispatch. Existing FAE Visual Continuation is recurring supervisory continuity; productive wake and cold-restart evidence require their own receipts.

## This run's independent repair

The Active read-only bridge now rejects cross-network Wallet metadata and public-key mismatches against the decrypted account before it reveals the authenticated scene. It does not alter key material or blockchain ownership semantics. The native browser and unit tests are independent acceptance gates. `DFR-03` remains **PENDING** until actual creation code passes real tests.
