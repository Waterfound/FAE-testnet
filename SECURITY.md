# Security Policy

## Security principle

FAE is developed under a public-code security model:

> **FAE must remain secure even if an attacker knows 100% of the source code.**

Please report vulnerabilities that could violate consensus, monetary integrity, wallet/key safety, state integrity, network integrity, mining integrity, release/source integrity, authority boundaries, or availability under attacker-controlled input.

## Reporting a vulnerability

**Do not disclose exploit details, secret material, private keys, seed phrases, or a working attack in a public issue, pull request, discussion, or commit.**

Preferred private reporting path:

1. On this repository, use GitHub's **Report a vulnerability** / private vulnerability reporting flow when that option is available in the Security tab.
2. If that private option is not exposed to you, use the repository maintainer's publicly listed GitHub profile contact method **only to request a private channel**. Do not include sensitive vulnerability details in a public message.

A useful private report should include, when safe to do so:

- the affected component or file;
- the exact source revision tested;
- the security property or invariant that may be violated;
- prerequisites and attacker capabilities;
- minimal reproduction steps or a reduced proof of concept;
- observed versus expected behavior;
- impact;
- whether the issue appears remotely exploitable;
- any proposed regression test.

Never include real wallet seed phrases or reusable private keys. Use test-only ephemeral material.

## Supported security scope

Security reports are in scope when they affect the current repository or its documented build/deployment boundary, including:

- consensus and state transitions;
- monetary rules, rewards, fees and UTXO accounting;
- wallet derivation, recovery, keys and signatures;
- transaction validation and mempool behavior;
- mining templates, stale work and coordinator validation;
- P2P identity, discovery, eclipse resistance and protocol messages;
- fork choice, reorg, persistence and recovery;
- browser/frontend trust boundaries;
- API/backend/coordinator input handling;
- build, dependency, CI, release and provenance boundaries;
- accidental promotion of candidate, shadow or lab code into authoritative behavior.

Research-only or candidate code may still be security-relevant if it could cross an authority boundary or contaminate an active path.

## Out of scope for a vulnerability claim by itself

The following do not, by themselves, establish a security vulnerability:

- knowledge of public source code;
- a local modification that only makes the attacker's own client behave incorrectly;
- expected loss of liveness when all network connectivity is externally denied;
- breaking a standard cryptographic primitive only by assuming the primitive itself is already broken;
- testnet FAE having no monetary value;
- a scanner warning without a demonstrated or technically plausible security consequence.

These may still be useful engineering reports and can be discussed without being classified as vulnerabilities.

## Disclosure handling

FAE uses an evidence-first process.

A reported vulnerability should be mapped to an attack surface and security invariant. When a fix is technically feasible to test, the fix is not considered complete until an executable regression test is retained.

Public disclosure should be coordinated after the issue has been understood and an appropriate fix or explicit blocker has been established. Do not assume that a passing scanner or a successful CI run closes a security finding.

No report, fix, test, review, or advisory grants consensus activation, economic-policy, release, or mainnet authority.

## Severity

A finding is baseline-blocking if it can plausibly:

- make an invalid block or transaction canonical;
- create, destroy, duplicate, or unauthorizedly redirect value;
- bypass an active maturity or authorization rule;
- expose durable wallet secret material;
- violate fork-choice or recovery correctness;
- allow unauthenticated/tampered traffic to acquire authority;
- cross a candidate/shadow-to-authoritative boundary;
- substitute an unreviewed artifact for reviewed source;
- cause practical remote resource exhaustion that prevents normal validation or recovery.

Other findings remain recorded and are handled according to their demonstrated impact.

## No bug bounty commitment

This repository does **not** currently promise a monetary bug bounty, reward, reimbursement, or payment for vulnerability reports.

Any future bounty program would be announced separately and would not be implied by this policy.

## Security references

The current public-code security baseline is defined by:

- `docs/security/FAE_PUBLIC_CODE_THREAT_MODEL_V1.md`
- `docs/security/FAE_EXISTING_SECURITY_GATE_LEDGER_V1.json`
- `docs/security/FAE_ATTACK_SURFACE_MATRIX_V1.json`

These documents describe threat assumptions, evidence status, attack surfaces and invariants. They do not claim mainnet readiness.
