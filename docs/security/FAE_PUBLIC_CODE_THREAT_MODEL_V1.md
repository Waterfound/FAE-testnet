# FAE Public-Code Threat Model v1

Status: PSR-01 candidate for integration  
Source revision: `a6721bb231471873ba069ab5bd6b2c8e5c6df92a`  
Build Colony revision: `17979869a85c9f5adf2cef2ceb589a07fcef6239`  
Workstream: FAE Public-Code Security Readiness  
Security posture: white-box / Kerckhoffs-style

## Frozen security objective

> **FAE must remain secure even if an attacker knows 100% of the source code.**

No security claim may depend on source secrecy, an honest browser/client, hidden validation, undocumented server behavior, or an attacker failing to discover an implementation detail.

This threat model does not grant activation, release, economic, public-testnet-consensus, or mainnet authority.

## Protected assets

The security baseline protects, at minimum:

1. **Consensus correctness** — valid blocks, transactions, fork choice, difficulty, timestamps, activation boundaries and state transitions.
2. **Monetary integrity** — maximum supply, subsidy/reward rules, fee accounting, UTXO conservation, no unauthorized mint or duplicate spend.
3. **Key and wallet safety** — seed/private-key material stays on the user device and does not enter logs, CI, fixtures, Build Colony evidence, coordinator state or backend storage.
4. **State integrity** — canonical chain, UTXO, mempool, peer/trust state and persisted node state survive malformed input, restart, partial failure, recovery and reorg without value creation/destruction.
5. **Network integrity** — peers cannot gain protocol authority through Sybil count, malformed messages, eclipse/isolation, replay, identity substitution or resource abuse.
6. **Mining integrity** — stale/abandoned work cannot mutate consensus state; authoritative network tip, not a local hint, determines whether work is current.
7. **Release/source integrity** — public artifacts must remain attributable to reviewed source, with reproducible inputs, hashes/provenance and candidate-vs-authoritative boundaries preserved.
8. **Availability under bounded attack** — malformed or abusive inputs should fail closed and should not produce avoidable unbounded CPU, memory, storage, connection or retry amplification.

## White-box adversary capabilities

Assume an attacker may:

- read the complete repository, history, public documentation, tests and deployment manifests;
- clone and modify any FAE client, miner or node implementation;
- remove UI checks and call protocol/backend interfaces directly;
- construct arbitrary transactions, blocks, headers, peer messages, HTTP/API requests and serialized state inputs;
- operate many coordinated peers and identities;
- withhold, reorder, replay, delay, duplicate or selectively forward messages;
- attempt eclipse, isolation, partition, stale-view and reconnection attacks;
- create competing forks and trigger reorg/recovery paths;
- exploit timing windows, races, restart boundaries, partial writes and concurrency assumptions;
- attempt malformed-input crashes and CPU/memory/storage/network resource exhaustion;
- submit economically adversarial inputs intended to violate reward, supply, maturity, fee, UTXO or activation rules;
- attempt downgrade, replay, identity substitution or trust-store manipulation where interfaces allow it;
- introduce malicious or vulnerable dependencies, build inputs or release artifacts through the public-code/supply-chain boundary;
- study tests and intentionally target cases not currently covered.

The attacker may combine these capabilities.

## Explicit non-assumptions

FAE security must **not** assume that:

- the browser/client is honest;
- the miner follows UI rules;
- a peer truthfully reports its identity, height, tip, work, address or capabilities unless cryptographically/protocol verified;
- a coordinator or backend response is authoritative merely because it came from an expected URL;
- multiple peers imply independence;
- a successful scanner means the implementation is secure;
- a passing happy-path test covers adversarial behavior;
- a hidden implementation detail protects consensus;
- a stale local template is harmless unless consensus independently rejects it;
- a crash/restart preserves correctness unless recovery is explicitly tested;
- candidate/research code is inactive merely because documentation says so — authoritative-path exclusion must be executable/verifiable.

## Cryptographic and platform assumptions

The baseline may rely on narrow external assumptions, which must be stated rather than hidden:

- standard cryptographic primitives used by the active protocol (including SHA-256 and Ed25519) behave according to their security assumptions;
- secure random generation provided by the supported runtime is not maliciously subverted;
- if the user's operating system/browser process is fully compromised, confidentiality of local wallet secrets is outside what the FAE protocol alone can guarantee;
- if the hosting/provider/GitHub control plane is totally compromised, repository and deployment integrity require external provenance/reproducibility evidence; FAE must avoid turning provider identity into protocol authority;
- denial of all network connectivity by an external actor may prevent liveness, but must not permit invalid state transition or value creation.

Post-quantum migration remains a separate shadow research workstream and is not silently imported into this baseline.

## Trust boundaries

### TB-1 — Wallet / local device ↔ browser application

Untrusted input: user-entered recovery material, imported data, UI events, local storage, browser state.  
Protected asset: private keys, seed phrases, signing intent.  
Rule: key material remains local; browser convenience logic is not a consensus rule.

### TB-2 — Browser/miner ↔ network/backend template and submission APIs

Untrusted input: templates, tip/status observations, API responses, transaction/block submission outcomes.  
Protected asset: mining work identity and transaction intent.  
Rule: network authority is validated by protocol state; cross-tab/local hints are acceleration hints only.

### TB-3 — Transaction/block ingress ↔ consensus/state transition

Untrusted input: all externally supplied transactions, blocks, headers, public keys, signatures, amounts and references.  
Protected asset: canonical state and monetary integrity.  
Rule: malformed or invalid input fails before canonical mutation.

### TB-4 — Peer ↔ peer

Untrusted input: identity assertions, envelopes, peer lists, chain claims, requests and responses.  
Protected asset: fork-choice inputs, peer trust, liveness and resource budget.  
Rule: peer count is not authority; authenticated identity, replay protection, diversity and explicit trust/rotation rules apply where designed.

### TB-5 — Runtime memory ↔ durable persistence / recovery

Untrusted condition: partial write, abrupt stop, stale/corrupt local state, restart during reorg or mempool change.  
Protected asset: chain/UTXO/mempool conservation and deterministic recovery.  
Rule: restart/recovery must not create/destroy value or accept a state that ordinary validation would reject.

### TB-6 — Source repository ↔ CI/build/release artifacts

Untrusted input: dependencies, workflow changes, build environment, artifact substitution, candidate configuration.  
Protected asset: reviewed source identity and release provenance.  
Rule: release evidence must bind artifacts to exact source; scanners and CI providers are evidence producers, not protocol authorities.

### TB-7 — Candidate/lab code ↔ authoritative/live paths

Untrusted condition: accidental import, shared helper drift, configuration error, shadow feature leakage.  
Protected asset: active consensus and economics.  
Rule: research/candidate code must not gain authority by presence, successful tests or deployment alone.

## Attack-surface registry

| Surface | Representative attack classes | Baseline invariant family |
|---|---|---|
| Consensus/state transition | malformed block/tx, invalid PoW, wrong reward, timestamp/difficulty manipulation, activation leakage | CONSENSUS, MONETARY |
| Wallet/keys/signatures | invalid key/signature, derivation mismatch, secret leakage, unsafe recovery | KEYS, AUTH |
| Transaction/mempool | double spend, duplicate inputs, missing/spent input, overflow/format abuse, replay | MONETARY, STATE |
| Mining/templates | stale parent, template race, cross-tab false authority, delayed cancellation | MINING, CONSENSUS |
| Fork choice/reorg | lower-work takeover, equal-work nondeterminism, deep reorg state loss | CONSENSUS, RECOVERY |
| P2P/discovery | Sybil, eclipse, identity substitution, replay, peer flooding, malicious peer lists | NETWORK, AVAILABILITY |
| Persistence/recovery | partial writes, corrupt snapshot, crash mid-transition, stale mempool reconstruction | STATE, MONETARY |
| Browser/frontend | bypassed validation, DOM/local-storage manipulation, hostile API response | KEYS, BOUNDARY |
| API/backend/coordinator | malformed requests, forged coordinator data, trust rotation abuse, rate abuse | AUTH, STATE, AVAILABILITY |
| Build/release/dependencies | dependency compromise, artifact substitution, workflow privilege creep, secret leakage | SUPPLY_CHAIN |
| Labs/candidates | accidental activation, candidate import into authoritative path | AUTHORITY_BOUNDARY |

## Baseline invariants

The following are mandatory fail-closed properties:

- **I-CONS-01** — an invalid block or transaction never becomes canonical.
- **I-MONEY-01** — issued value never exceeds the active maximum supply.
- **I-MONEY-02** — an invalid reward/coinbase is never accepted.
- **I-MONEY-03** — a spend cannot create value; spent/reserved inputs cannot be reused contrary to active rules.
- **I-AUTH-01** — invalid signatures/public-key bindings are never accepted.
- **I-FORK-01** — a lower-work valid chain cannot replace a valid higher-work chain under the active fork-choice rule.
- **I-MATURITY-01** — where coinbase maturity is active, it cannot be bypassed.
- **I-STATE-01** — malformed external input cannot corrupt canonical durable state.
- **I-RECOVERY-01** — crash/restart/recovery cannot create or destroy value and must converge only to a state valid under ordinary rules.
- **I-MINING-01** — stale/abandoned work cannot mutate consensus state.
- **I-DIFF-01** — independent conforming implementations must produce the same consensus result for the same admitted history/input.
- **I-KEY-01** — private keys and seed phrases never enter CI, logs, fixtures, Build Colony evidence or backend persistence.
- **I-P2P-01** — unauthenticated/replayed/tampered peer traffic cannot silently acquire authenticated authority.
- **I-AVAIL-01** — attacker-controlled inputs must be bounded or rejected before avoidable unbounded resource amplification.
- **I-SUPPLYCHAIN-01** — a release claim must be bound to exact reviewed source/provenance; provider identity alone is insufficient.
- **I-AUTHORITY-01** — candidate/shadow/research code cannot become authoritative without explicit activation/release authority.

## Severity model

A finding is **baseline-blocking** if it can plausibly violate any mandatory invariant, leak durable wallet secret material, bypass an explicit authority boundary, or create practical remote resource exhaustion sufficient to prevent normal validation/recovery.

Other findings remain recorded and may be accepted only as explicit residual risk; silence is not acceptance.

## Evidence doctrine

For this workstream:

```text
claim
 -> executable gate where feasible
 -> exact source revision
 -> reproducible result
 -> independent/adversarial review
 -> regression retained after a fix
```

Documentation alone does not satisfy an executable invariant. Static analysis and dependency scanners are defense-in-depth signals. A failure corrected without a retained regression test is incomplete unless a test is technically infeasible and that limitation is documented.

All required runs must pass. Selective retry cannot erase a prior failing run from the evidence record.

## Scope boundary

This model defines the attacker and the properties the FAE security baseline must defend. It does **not** itself claim that every property is already proven.

Coverage is tracked separately in the PSR-02 gate/evidence ledger and later converted into executable hostile gates by PSR-05 through PSR-13.

## PSR-01 exit test

PSR-01 is complete only when this document is integrated on the exact FAE source line and:

- full-source knowledge is explicit;
- honest-client/source-secrecy assumptions are forbidden;
- protected assets and trust boundaries are explicit;
- adversary capabilities cover protocol, network, timing/recovery, DoS and supply-chain classes;
- cryptographic/platform assumptions are bounded and visible;
- mandatory invariant families are named;
- no authority or mainnet readiness is implied.
