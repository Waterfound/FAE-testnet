# FAE Existing Security Gate & Evidence Inventory v1

Status: PSR-02 candidate for integration  
Source revision: `a6721bb231471873ba069ab5bd6b2c8e5c6df92a`  
Build Colony revision: `17979869a85c9f5adf2cef2ceb589a07fcef6239`

Machine-readable ledger: `docs/security/FAE_EXISTING_SECURITY_GATE_LEDGER_V1.json`

## Inventory rule

**Existence is not proof.**

This inventory separates:

- **canonical PR gates** actually executed by `.github/workflows/verify.yml`;
- **content-inspected canonical gates** whose relevant assertions were inspected during PSR-02;
- **specialized executable evidence** that exists but is not a universal PR gate;
- **discovered workflow/test assets** that receive no PASS credit from path existence alone;
- **explicit gaps** that remain fail-closed.

The exact source tree contains **41 repository workflows** and **100 discovered test/lab executable or evidence assets** under the inventory criteria.

## Strong existing coverage

### Source and release identity

The canonical verification checks:

- `FAE_FORGE_MAIN.sha256`;
- `supabase/SOURCE_MANIFEST.sha256`;
- protected-source SHA-256 reporting;
- equality of deployed `mining.js` and `coordinator-trust.js` with the Sovereign Forge browser snapshot;
- locked `npm ci` for the reference node;
- candidate container buildability.

Specialized release-reproducibility evidence additionally binds repeated byte-identical builds to source commit/tree and per-file SHA-256/Git-object identities. It is useful evidence, but it is not credited as an ordinary canonical PR gate.

### Wallet / browser / coordinator

Canonical verification runs:

- `tests/crypto-compat.mjs`;
- `tests/client-smoke.mjs`;
- `tests/mining-coordinator-smoke.mjs`;
- coordinator trust and rotation smoke tests.

Inspected coverage includes deterministic wallet derivation/recovery using ephemeral test material, watch-only/send boundaries, signed coordinator work/share receipts, malicious payout rejection, identity changes and coordinator equivocation evidence.

### Consensus / economics

Canonical verification runs the authoritative v4 core and activation boundary. Inspected assertions show:

- subsidy/fee accounting without fee inflation;
- UTXO value equals issued supply in the exercised path;
- multi-output coinbase activation fields fail closed before activation;
- live authority remains distinct from candidate activation.

The active implementation also contains the maximum-supply cap, but an explicit near-ceiling exhaustion regression was **not** identified in the canonical PR gate and remains a PSR-05 target.

### Reorg / persistence / recovery

Canonical verification includes historical bootstrap and three-node partition recovery.

Additional specialized evidence includes:

- deterministic differential reorg fuzzing across **128 cases**, with an independent reference comparator and restart replay;
- hard `SIGKILL` process recovery;
- raw-state corruption recovery from durable snapshot.

These specialized assets are valuable but are not all part of `verify.yml`.

### P2P / eclipse / resource controls

Canonical verification includes authoritative P2P security and peer-diversity/eclipse simulations.

Inspected assertions cover:

- signed-envelope tamper rejection;
- expected-peer identity binding;
- encrypted-channel replay/out-of-order rejection;
- network binding;
- explicit trust rotation;
- rate limiting and temporary bans;
- network-group diversity;
- Sybil identities in one group failing readiness;
- one identity across many endpoints counting once;
- endpoint/identity conflicts;
- bounded endpoint fanout.

This is strong P2P coverage, but does not by itself prove cross-surface CPU/memory/storage/network exhaustion resistance.

### Mining / stale work

The dedicated Mining Tip Sync Lab already provides executable contracts for:

- generation-bound work identity;
- rejection of callbacks from invalidated generations;
- stale parent detection;
- observer-behind = UNKNOWN rather than false authority;
- cross-tab signals as non-authoritative revalidation hints.

This remains lab evidence until later gates determine promotion/integration.

## Explicit gaps

The ledger currently records:

1. **Responsible disclosure:** no canonical `SECURITY.md` at the frozen source → PSR-04.
2. **Explicit license:** no `LICENSE` / `LICENSE.md` → PSR-14.
3. **Dependabot:** no repository config → PSR-12.
4. **Dedicated CodeQL workflow:** absent → PSR-12.
5. **Secret-leak repository gate:** none identified; platform-native settings are not inferred → PSR-12.
6. **General malformed-input corpus:** specialized hostile tests exist, but not one corpus spanning every public ingress → PSR-10.
7. **Cross-surface resource-exhaustion gate:** P2P controls are tested, broader budget coverage remains partial → PSR-05..10.
8. **Direct negative transaction-signature corpus:** verification code exists, but canonical negative coverage identified here is incomplete → PSR-06.
9. **Maximum-supply boundary vector:** implementation and documentation exist, but explicit near-ceiling canonical regression remains partial → PSR-05.
10. **Coinbase maturity:** 200-block maturity belongs to the preferred future economic candidate, not active v4; it is not silently treated as an active-v4 gap.
11. **Differential coverage across all consensus-critical paths:** partial; reorg and shadow parity exist, but not every parser/state transition has independent differential verification → PSR-11.

## What PSR-02 does not claim

This inventory does **not** mean FAE is secure because it has many tests.

It establishes a reliable starting map:

```text
existing proven/inspected gates
+ specialized evidence
+ discovered but uncredited assets
+ explicit gaps
= honest baseline for PSR-03+
```

No workflow count, scanner, passing CI run, or test volume grants consensus, release or mainnet authority.

## PSR-02 exit test

PSR-02 is complete on integration if:

- the exact source tree has been inventoried;
- every discovered relevant workflow/test asset is assigned to an attack-surface family;
- canonical vs noncanonical evidence credit is explicit;
- inspected high-value gates are tied to concrete invariant families;
- missing controls are recorded rather than silently assumed;
- no mainnet/security-readiness conclusion is inferred from inventory size.
