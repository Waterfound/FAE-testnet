# Threat model — v0.0.1

## Protected properties

- Frozen exercises cannot change unnoticed after results are known.
- A target revision cannot drift between freeze and run.
- A passing score cannot hide a critical collapse or missing critical evidence.
- Mutation is deterministic and genealogically attributable.
- Active holdout content cannot enter the regression corpus through normal engine APIs.
- Evidence tampering is detectable through canonical digests and a hash-chained learning ledger.
- Campaign data cannot request shell interpretation or escape the target root.
- Red-team code cannot acquire consensus authority by configuration.

## In-scope adversaries

- accidental post-hoc editing or data shopping;
- malicious or malformed campaign/catalog input;
- duplicate IDs, taxonomy drift and genealogy cycles;
- path traversal and shell injection attempts;
- timeout/output flooding by a target process;
- false PASS through score averaging;
- holdout leakage through tracked paths or learning proposals;
- evidence deletion, reordering, mutation or unsafe raw-output capture;
- nondeterministic mutation replay.

## Explicit limits

v0.0.1 is not a container, VM, kernel sandbox, network firewall, formal verifier, or independent external audit. A permitted target command is code execution with the current user's privileges. Only reviewed campaigns should be run. The engine strips ambient secrets from child environments, but the target may still read files available to that user.

The system measures the exercises it contains. It cannot prove absence of unknown vulnerabilities and cannot certify FAE mainnet readiness.
