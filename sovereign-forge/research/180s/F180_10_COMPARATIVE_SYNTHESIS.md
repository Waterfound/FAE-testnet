# F180-10 — Comparative Synthesis: 180 / 300 / 600

This synthesis is evidence-only. It does **not** select a winner, change the 300s research incumbent, modify public-testnet consensus, or authorize mainnet.

| Dimension | 180 s | 300 s | 600 s |
|---|---|---|---|
| Authority | Active public testnet | GREEN research incumbent | YELLOW challenger |
| Mean block wait model | 180 s | 300 s | 600 s |
| P95 1-conf wait model | 539 s | 899 s | 1,797 s |
| Same 20 tx/block nominal ceiling | 0.111 tx/s | 0.0667 tx/s | 0.0333 tx/s |
| Equal-issuance payout sigma vs 180 | 1.00× | 1.291× | 1.826× |
| First-order race at 5 s delay | 2.74% | 1.65% | 0.83% |
| Fast 0.1 s vs slow 5 s accepted-event proxy | +2.76% | +1.65% | +0.82% |
| P(>=1 block during 208 s isolation) | 68.5% | 50.0% | 29.3% |
| Direct DAA evidence | Yes: active v4 | No: v2 proxy | No: v2 proxy |

## Interpretation

**180 s has a real participation/UX advantage** in this evidence set: more frequent confirmations and solo reward events, and lower payout variance at the same miner share.

**180 s also carries more network-timing pressure**: fixed latency and fixed outages consume a larger fraction of a block interval. The effect is small at the ~128 ms historical propagation P95 reported in V1/V2, but grows materially in multi-second tails.

The active 180s DAA is the largest implementation-specific warning. It converged under the frozen honest hash-rate shocks, but integer leading-zero-bit difficulty is coarse: a converged deterministic regime can lie from about 127.3 s to 254.6 s around a nominal 180 s target, and the seeded stable-hash study showed persistent retarget noise.

The +120 s active timestamp rule is DAA-sensitive. The paired adversarial model did not demonstrate a relative miner-share advantage, so this remains WARN rather than a material-risk finding.

The decisive gap is still **natural/direct evidence**. V1/V2 were failed runs; zero stales/reorgs inside them cannot be promoted to PASS, and their raw authoritative result bundle was not located during this run. P99 and statistically adequate natural stale/fork confidence remain missing.

Therefore the software-only synthesis is:

**NO_MATERIAL_RISK_PROVEN_BUT_180S_REMAINS_UNDER_EVIDENCED_FOR_MAINNET_GRADE_CLAIM**

That is not a terminal verdict until independent verification and the external-evidence gate are resolved.
