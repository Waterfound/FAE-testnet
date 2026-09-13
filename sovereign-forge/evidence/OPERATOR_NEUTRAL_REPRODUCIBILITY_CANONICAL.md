# Operator-Neutral Reproducibility — Canonical Evidence

Status: **GREEN — operator-neutral surrogate**

Scope: **one man / one machine**. This evidence does not claim an independent human operator, a second physical failure domain, external-WAN proof, or consensus authority.

## Canonical main confirmation

```text
workflow: Full Target Shadow Operator Neutrality
run:      34756102295
job:      103720618524
tested commit: bfcebf75aebe2dbff267a1e27ddf119c86ac1a40
result:   SUCCESS
replays:  5/5 required; 5/5 PASS
```

Final attestation format:

```text
FAE_OPERATOR_NEUTRAL_REPRODUCIBILITY_V1
```

Required properties observed:

```text
independent_human_operator: N/A-by-design
single_physical_runner: true
fixed_replays: 5
all_replays_required: true
all_replays_passed: true
fail_closed: true
separate_verifier_codepath: true
code_identity_bound: true
boot_identity_bound: true
fresh_namespaces_and_volumes_per_replay: true
external_wan_proof: false
consensus_authority: false
```

All five complete replays separately returned PASS for the one-machine failure-domain degraded-network scenario, including isolated network namespaces, absent direct C→B and A↔B paths, deterministic headers/body interruptions, no partial adoption, SIGKILL recovery, fresh-session stronger-work adoption, lower-work rollback rejection, restart while partitioned, six accelerated churn phases, and persisted strong tip.

## Evidence binding

Runner boot ID:

```text
958e59ac-9b83-4d75-a4f3-78691cdcbf45
```

Code hashes recorded by the verifier:

```text
one_machine_harness_sha256:       3c3d1254f7b7d2aab1752de34b9d4319e0c41591304d33c9886453e60e86bfd6
operator_neutral_verifier_sha256: 3f653b8cb9d0c01edec23af9a8750843ca3c2ca7c08cea519ad7bffa7ba5e480
operator_neutral_wrapper_sha256:  6578e5e037f6621c95ffd9d68482392caf216c8a46c1306d849b26d41596cf14
shadow_peer_sha256:               a2b678e10cd91272961c1df4e29103902a253a196915c1111878883174f4b5c5
fault_proxy_sha256:               d33eff94bd5398714fa96240cde7e2ae6fcc169d608d85f6d8356ab05f3f6e4c
```

Retained GitHub Actions artifact:

```text
name:   fae-operator-neutral-evidence-34756102295-1
id:     10317227797
size:   4774 bytes
sha256: 9074e2e31dd45228a6a6423b83c50aa335b852eda2b0f57d769ac41d6f34bb7f
```

## Interpretation

```text
Independent human operator              N/A — excluded by one-man principle
Operator-neutral execution              GREEN
One-machine reproducibility             GREEN
Anti-selection / all-runs-must-pass     GREEN
Separate verifier code path             GREEN
Code/evidence identity binding          GREEN
```

This evidence is additive to the separately established real-WAN, multi-host, multi-region and provider-diversity results. It must not be relabeled as independent-human proof.

No result in this file authorizes or changes consensus, DP6, genesis, PPLNS, tokenomics, testnet authority or mainnet authority.
