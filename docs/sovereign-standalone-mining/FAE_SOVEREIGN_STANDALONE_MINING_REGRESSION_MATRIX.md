# FAE — Sovereign Standalone Mining
## Post-Integration Regression Matrix

This matrix is mandatory after each authorized integration step. It is a verification plan, not merge authority.

| Gate | After #269 | After retarget #270 | After #270 merge | Pass condition |
|---|---:|---:|---:|---|
| Main source identity | required | required | required | observed SHA/tree recorded |
| Element 58 registration | required | required | required | canonical doc present |
| PR #270 mergeability | n/a | required | n/a | mergeable=true or exact blocker identified |
| CLI blob identity | n/a | required | required | `b918a306643d83f1d832c72f3b4f0a32d395c5eb` |
| Mining-core blob identity | n/a | required | required | `42c392ad54a3e3c2f446ab79f67948d30b82a73e` |
| package.json blob | n/a | required | required | `b106d025ed45bebbcae090eef0be3e29ec56006e` |
| package-lock blob | n/a | required | required | `6d2bbd954afdf35a67810bb7a0ea8965309677fe` |
| Forge snapshot integrity | n/a | required | required | protected-source hash verification success |
| Standalone package/core/behavior | n/a | required | required | canonical verifier standalone step success |
| Browser/Node/standalone parity | n/a | required | required | deterministic parity tests success |
| Independent-node real mining | n/a | required | required | accepted block + supplied reward address credited |
| Stale/reconnect/restart/shutdown | n/a | required | required | behavioral tests success |
| Secret-free config | n/a | required | required | security tests/review success |
| verify-canonical-source | recommended | required | required | SUCCESS |
| CodeQL | recommended | required | required | SUCCESS |
| PSR15 Project Assurance | recommended | required | required | SUCCESS |
| PSR16 finding closure | recommended | required | required | SUCCESS |
| PSR17 full baseline | recommended | required | required | SUCCESS |
| PSR18 security verdict | recommended | required | required | SUCCESS |
| recurring security assurance | recommended | required | required | SUCCESS |
| cross-lab integration | recommended | required | required | SUCCESS |
| Forbidden-scope diff | required | required | required | no consensus/economics/algorithm/DP6/Wallet/address/tx-semantics change |
| Release/deployment authority | required | required | required | remains false unless separately granted |

## Known transient-test handling

Two prior no-code-change reruns established that unrelated local-network integration tests can occasionally fail with transient socket/fetch errors.

Rule:

1. Preserve the failed attempt as evidence.
2. Confirm the failure occurs in code not changed by this integration.
3. Permit one no-code-change rerun for a clearly transient socket/fetch boundary.
4. If the same failure repeats, or if the failing code overlaps the integration diff, stop at a genuine gate and do not classify it as transient.

No success may be manufactured by weakening or skipping a required check.
