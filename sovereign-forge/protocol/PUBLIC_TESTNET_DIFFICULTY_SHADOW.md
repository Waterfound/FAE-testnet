# FAE Public-Testnet Difficulty + Timestamp Shadow — first real-data snapshot

Status: **observer-only / candidate-not-active-consensus**

Source: the live FAE public-testnet `fae_v4_blocks` table. The frozen regression fixture covers heights **398–414** and tip hash `000003f706dc5c4f615ff9894cd3f4612ed63c1e9e0a1fc085d3817dbbbc66fd`.

At capture time the full public-testnet history contained **414 blocks**. Across that history there were **0 timestamp regressions**, **0 equal-parent timestamps**, a minimum observed inter-block interval of **1.871 s**, median **12.339 s**, and maximum **272,821.429 s (~75.8 h)**. This is a highly bursty testnet history, not a stationary production workload.

## Shadow result at the captured tip

For a research anchor at **height 410**, whose parent is height 409, the 6-hour ASERT candidate evaluates height 414 to target:

`000003f4dbffffffffffffffffffffffffffffffffffffffffffffffffffffff`

The live v4 integer target at the tip is 22 leading-zero bits. The candidate target is only **-10,879 ppm (~-1.088%)** versus that current target, i.e. very close despite using smooth full-target arithmetic.

This anchor is intentionally after the very long idle gap between heights 408 and 409. Anchoring much earlier produces a radically easier candidate target because ASERT correctly interprets the long no-block period as missing hash power. That is not an ASERT failure; it is evidence that the activation anchor must be explicit and tied to the activation boundary rather than inherited casually from old testnet history.

## What this closes — and what it does not

This closes the first **real-chain snapshot regression**: the shadow observer now has frozen public-testnet evidence in CI rather than only synthetic chains. It does **not** close continuous public-testnet shadow observation, because one frozen tip cannot establish long-run behavior.

The next useful step is therefore an observer telemetry path that records candidate target, current target, anchor identity, MTP status and deltas for successive real public-testnet blocks without changing block acceptance. Multi-host Independent Node soak/WAN remains a separate later gate.
