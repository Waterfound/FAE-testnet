# Independent Operator Readiness

This package prepares a future independent operator run. It does not manufacture that run.

## Scope

The frozen acceptance contract is `FAE-IOR-ACCEPTANCE-V1-20260928`. Readiness uses the existing hardened P2P v6 Independent Node and its durable recovery path. A successful internal rehearsal is always labeled `READINESS_REHEARSAL_ONLY`.

## External operator procedure

An eligible operator should receive only the public/canonical repository or a verifiable release, the frozen acceptance contract, an explicit eligible peer endpoint, and a fresh run challenge/operator identifier supplied for that run.

From a fresh clone, with Node.js 22+ and Git available:

```bash
REVISION="$(git rev-parse HEAD)"
node lab/independent-operator-readiness/run-operator.mjs \
  --peer "https://<eligible-independent-node>" \
  --expected-source-revision "$REVISION" \
  --challenge "<64-lowercase-hex-run-challenge>" \
  --operator-id "<operator-id>" \
  --out "/tmp/fae-independent-operator-evidence" \
  --evidence-class EXTERNAL_OPERATOR_RUN \
  --attest-independent
```

The output directory must not already exist. The runner creates disposable fresh node state, authenticates a peer, verifies network/genesis identity, waits for real tip progression, performs a controlled restart, proves identity/state/peer recovery, and emits a checksummed machine-readable bundle.

Verify it independently with the exact externally supplied bindings:

```bash
node lab/independent-operator-readiness/verify-evidence.mjs \
  --bundle "/tmp/fae-independent-operator-evidence" \
  --expected-source-revision "$REVISION" \
  --expected-challenge "<same-run-challenge>" \
  --expected-operator-id "<same-operator-id>" \
  --expected-evidence-class EXTERNAL_OPERATOR_RUN
```

A verifier `PASS` means the bundle is structurally and cryptographically admissible under the frozen contract. It does **not** itself adjudicate whether the person was truly independent. Admission of IOR-X remains a separate external-evidence step.

## Clean-room rehearsal

Maintainers can exercise the package without pretending to be an external operator:

```bash
node lab/independent-operator-readiness/run-clean-room-rehearsal.mjs --out /tmp/fae-ior-rehearsal
```

That rehearsal starts a disposable seed plus the real P2P v6 node process from fresh state, observes tip progression, restarts the node and runs the same verifier. Its evidence class is permanently `READINESS_REHEARSAL_ONLY`.

## Forbidden shortcuts

Do not supply a synchronized database, Waterfound shell/session, private project credentials, secret preconfigured images, copied evidence, or undocumented interactive configuration. Missing/tampered/stale/wrong-network/isolated/partial evidence fails closed.

## Authority boundary

This package does not change consensus, economics, activation height, production bootstrap values, mainnet readiness or mainnet authorization.
