# FAE – Mining Tip Sync & Stale Work Recovery
## Build Colony Execution Plan

Status: PLANNED / EXECUTION-BOUND  
Run date: 2026-09-18  
FAE source revision: `f3561ec8bf53d25c646f2f4c880af506cc1f5a65`  
Build Colony revision: `17979869a85c9f5adf2cef2ceb589a07fcef6239`  
Branch: `colony/mining-tip-sync-plan-001`  
Active gate class: `CAPABILITY_GAP`  
Authority ceiling: `LAB_TEST_AND_CANDIDATE_BROWSER_MINER_WRITE`

## 1. Purpose

Close the gap between FAE's existing chain-tip authority and the browser miner's current behavior.

The desired user contract is:

> Start Mining FAE once. When the chain advances, the miner automatically abandons work based on the old tip, obtains fresh work, and continues without requiring Stop -> Start.

This Lab is specifically about browser-miner continuity under chain-tip advancement. It is separate from Network Recovery & Reorg, which addresses node/network continuity and chain-state recovery.

## 2. Evidence-bound capability gap

At the pinned source revision:

- `mining.js` performs direct mining as `/template -> localPow -> /submit-block`.
- `localPow()` owns a Web Worker that continues hashing until it finds a valid nonce or is explicitly terminated.
- the global frontend refresh loop runs every 7000 ms, but `refresh()` does not invalidate or terminate the active mining Worker when the network tip changes;
- the direct-mining error path recognizes `stale_tip` only after a solved block is submitted;
- `/status` already exposes `height` and `tip_hash`;
- `/submit-block` already rejects a header whose `height` or `previous_hash` no longer matches the authoritative tip;
- backend template semantics are explicitly `snapshot`: mempool arrivals after a template is issued do not by themselves invalidate that template.

Therefore the missing capability is narrow and demonstrated:

```text
authoritative tip information exists
          +
backend stale rejection exists
          +
browser PoW Worker exists
          -
no in-flight tip-driven Worker cancellation
          =
stale-work recovery capability gap
```

## 3. Scope boundary

### In scope

- direct browser mining;
- coordinator/share mining parity where chain-tip advancement can invalidate work;
- work/template identity;
- Worker/session generation identity;
- authoritative tip observation;
- automatic cancellation;
- automatic template reacquisition;
- stale-result race prevention;
- background/resume behavior;
- multi-tab and multi-device correctness;
- optional cross-tab acceleration;
- cancellation-latency measurement;
- regression/adversarial testing;
- browser/device validation;
- release rehearsal for the public testnet client.

### Out of scope

- block-time selection;
- economic parameter changes;
- reward/subsidy/halving changes;
- difficulty algorithm changes;
- consensus-rule activation;
- node reorg policy;
- chain-selection rules;
- wallet custody;
- private-key/seed handling;
- mainnet promotion.

The 300-second block-time candidate may reduce how often templates turn stale, but it is not a dependency and it is not accepted as a substitute for tip-driven cancellation.

## 4. Non-negotiable invariants

1. Network state remains authoritative.
2. A same-device signal is never chain authority.
3. BroadcastChannel, if added, is a hint that triggers authoritative revalidation.
4. Snapshot templates are not cancelled merely because the mempool changed.
5. Tip advancement is identified using chain identity, not UI text.
6. Work identity binds at minimum template `height` + `previous_hash`.
7. Network-tip identity binds at minimum `height` + `tip_hash`.
8. An invalidated Worker generation may not complete or mutate a newer generation.
9. A solved nonce from an invalidated generation must never be submitted as though it were current.
10. Cancellation cannot silently stop mining permanently; recovery must reacquire work and continue while the user remains in mining mode.
11. Stop remains an explicit user stop and is semantically distinct from stale-work cancellation.
12. Direct-mining correctness must not depend on multiple tabs being on one device.
13. Multi-context correctness must pass with cross-tab optimization disabled.
14. Coordinator/share work must preserve its signed-work and receipt verification boundaries.
15. No FAE consensus or economic parameter changes are authorized by this Lab.

## 5. Acceptance metrics

The Lab uses two different latency classes because browser suspension makes a single wall-clock metric misleading.

### 5.1 Local reaction latency

Measured from the instant the miner has authoritative evidence of a tip mismatch until the old Worker is terminated.

Foreground target:

- p95 <= 250 ms.

Synthetic-loaded foreground target:

- p99 <= 1000 ms.

### 5.2 Network detection latency

Measured from the first authoritative endpoint response visible to the miner that contains a new `height + tip_hash` until cancellation.

The observer cadence must be explicitly recorded and tested. The implementation may tune the cadence, but it may not claim success by measuring only post-submission stale detection.

### 5.3 Stale progress after observation

After authoritative mismatch observation:

- zero progress events from the invalidated generation may be admitted into current UI/session state;
- zero solved results from the invalidated generation may be submitted;
- queued old-generation callbacks must be ignored.

### 5.4 Resume safety

For a tab that was backgrounded, throttled, frozen or suspended:

- authoritative tip revalidation must occur before resumed stale work may be accepted or submitted;
- stale Worker state must not gain authority merely because timers were paused;
- `visibilitychange`, `pageshow`, and/or equivalent lifecycle recovery hooks may be used as revalidation triggers.

### 5.5 False-positive protection

Do not cancel when:

- `height` is unchanged;
- `tip_hash` is unchanged;
- only pending transaction selection changed;
- only balance/history/UI state changed.

## 6. Work graph

### MTS-00 — Boundary Freeze

Goal: freeze exactly what this Lab may modify and what it may not.

Outputs:

- Lab authority manifest;
- immutable FAE source revision;
- immutable Build Colony revision;
- allowed write scopes;
- forbidden paths/actions;
- explicit block-time independence statement;
- explicit `public_testnet_promotion_authorized=false` for the planning run.

Gate:

- the Lab can be worked on without changing consensus, economics or active wallet authority.

### MTS-01 — Baseline Reproduction

Depends on: MTS-00.

Goal: turn the observed iPad behavior into deterministic evidence.

Required scenarios:

1. miner A and miner B begin from the same tip;
2. A causes or observes a new block;
3. B receives normal frontend refresh information showing the chain advanced;
4. B's old Worker remains alive;
5. B is shown to continue hashing old work until manual Stop/Start or later stale submission.

Outputs:

- reproduction harness;
- timestamped event trace;
- current stale-work cancellation latency baseline;
- evidence that current `refresh()` does not terminate the Worker;
- evidence that Stop -> Start reacquires `/template`.

Gate:

- bug reproduced without relying on a human timing anecdote.

### MTS-02 — Work Identity and Worker-Generation Instrumentation

Depends on: MTS-01.

Goal: make every mining attempt observable and race-safe.

Introduce explicit identities for:

- mining session;
- work/template;
- Worker generation;
- tip observed at work start.

Minimum work identity:

```text
work_id :=
  network
  + template.height
  + template.previous_hash
  + reward address
  + local generation
```

Instrumentation events should include:

- template requested;
- template accepted;
- Worker started;
- progress;
- tip observed;
- mismatch detected;
- Worker cancellation requested;
- Worker terminated;
- replacement template requested;
- replacement Worker started;
- solution found;
- solution discarded;
- submission attempted;
- submission accepted/rejected.

No private key, seed or secret material may enter telemetry.

Gate:

- every old-generation callback can be attributed and rejected deterministically.

### MTS-03 — Authoritative Tip Observer Contract

Depends on: MTS-01.

Goal: define how a mining session learns that its work is stale.

Primary authoritative source:

- FAE network `/status`, currently exposing `height` and `tip_hash`.

Observer rules:

1. compare network `height + tip_hash` against active work `height - 1 + previous_hash`;
2. a mismatch caused by chain advancement invalidates the work;
3. mempool-only changes do not;
4. observer errors do not silently declare work valid forever;
5. transient network failure is represented separately from stale work;
6. foreground cadence is bounded and measured;
7. lifecycle resume triggers an immediate revalidation;
8. receiving a cross-tab hint triggers authoritative revalidation rather than trusting the hint.

Gate:

- a pure state-machine test proves valid/stale/unknown classifications.

### MTS-04 — Direct Tip-Driven Cancellation

Depends on: MTS-02, MTS-03.

Goal: cancel an in-flight direct PoW Worker as soon as the active work's parent tip is no longer current.

Required behavior:

```text
current work W(parent = H)
        |
authoritative tip becomes H'
        |
H' != H
        v
invalidate generation(W)
        |
terminate Worker(W)
        |
discard queued callbacks(W)
        |
request fresh template
        |
start Worker(W+1)
```

Cancellation is not the same as user Stop.

Recommended semantic separation:

- `USER_STOP`;
- `TIP_INVALIDATED`;
- `WORK_REPLACED`;
- genuine Worker/runtime failure.

Gate:

- deterministic test proves old Worker termination before nonce discovery/submission.

### MTS-05 — Race-Safe Restart and Pre-Submission Freshness Barrier

Depends on: MTS-04.

Goal: prevent cancellation/restart races from reintroducing stale work.

Required protections:

- monotonic generation token or equivalent;
- old `onmessage` handlers cannot mutate current session state;
- old `onerror` handlers cannot stop the replacement session;
- old `powReject` state cannot reject the wrong Promise;
- replacement template is fetched only after invalidation is recorded;
- mining continues automatically if user mining intent remains true;
- immediately before submission, work freshness is checked against the latest authoritative state available to the session;
- if freshness is unknown due to a transient observer failure, the behavior is explicitly defined and tested rather than accidental.

Gate:

- forced callback reordering cannot produce stale submission or terminate the new Worker.

### MTS-06 — Deterministic Regression Harness

Depends on: MTS-02, MTS-03.

Goal: make the miner testable without waiting for real Proof of Work.

Build a test harness with:

- fake Worker;
- controllable progress and solution events;
- deterministic `/template`;
- deterministic `/status`;
- deterministic `/submit-block`;
- controllable timer/lifecycle events;
- generation/event trace assertions.

Core regressions:

- no tip change -> no cancellation;
- tip change -> cancellation;
- cancellation -> automatic replacement;
- old result after cancellation -> ignored;
- old error after replacement -> ignored;
- mempool-only change -> no cancellation;
- user Stop -> no automatic restart;
- stale backend rejection remains recoverable as defense in depth.

Gate:

- regression suite is deterministic and does not depend on mining luck.

### MTS-07 — Rapid-Tip, Load and Network-Failure Adversarial Pass

Depends on: MTS-05, MTS-06.

Scenarios:

- two rapid successive tip changes;
- three or more successive tip changes;
- tip changes while Worker emits progress;
- tip changes just before a valid nonce arrives;
- tip changes between solution and submission;
- observer request timeout;
- observer temporary HTTP failure;
- template fetch failure after cancellation;
- recovery after temporary network outage;
- repeated cancellation/restart without memory/Worker leakage;
- CPU-heavy foreground load.

Gate:

- miner converges to newest available tip and remains live.

### MTS-08 — Background / Throttled / Resume Lifecycle

Depends on: MTS-05, MTS-06.

Scenarios:

- tab backgrounded before tip change;
- tab backgrounded after tip change but before polling callback;
- frozen/suspended timer interval;
- return to foreground after multiple blocks;
- `pageshow` after browser restores page state;
- visibility/focus transitions;
- stale queued Worker event delivered near resume.

Correctness rule:

- browser suspension may delay detection, but it may not allow stale work to regain authority after resume.

Gate:

- first resumed mining action is freshness-safe.

### MTS-09 — Multi-Context Convergence Without Local Coordination

Depends on: MTS-05, MTS-06.

Contexts:

- two independent tabs;
- four independent tabs;
- separate browser contexts on one device where feasible;
- separate devices;
- simulated remote miner;
- miner that discovers the new block;
- miners that did not discover it.

Critical requirement:

- all miners converge by consulting network authority;
- test must pass with BroadcastChannel disabled.

Gate:

- no local-device assumption is required for correctness.

### MTS-10 — Optional Cross-Tab Hint Optimization

Depends on: MTS-08, MTS-09.

Goal: reduce same-origin multi-tab detection delay without changing authority.

Candidate mechanism:

- `BroadcastChannel`.

Safe contract:

```text
tab A observes/produces newer tip
      |
broadcast hint
      |
tab B receives hint
      |
tab B immediately revalidates authoritative /status
      |
only authoritative mismatch cancels work
```

The message may contain a candidate height/hash for diagnostics, but a peer tab's message is not sufficient authority to cancel valid work.

Fallback:

- unsupported/blocked BroadcastChannel -> no loss of correctness.

Gate:

- correctness suite passes with optimization on and off.

### MTS-11 — Coordinator / Share-Work Parity

Depends on: MTS-05, MTS-06.

Goal: ensure signed coordinator work does not become a second stale-work hole.

Existing coordinator work already binds:

- network;
- height;
- previous hash;
- job identity;
- expiry;
- signed coordinator receipt.

Required analysis/tests:

- network tip advances while a share Worker is active;
- coordinator job remains internally signed but chain-parent is no longer current;
- block-capable share result arrives after invalidation;
- stale signed work is not treated as current merely because its signature is valid;
- direct-fallback transition remains race-safe;
- coordinator protocol errors remain distinct from chain-tip invalidation.

Gate:

- coordinator path obeys network-tip freshness without weakening coordinator receipt validation.

### MTS-12 — Latency and False-Positive Acceptance

Depends on: MTS-07, MTS-08, MTS-09, MTS-11.

Measure:

- time from authoritative mismatch observation to Worker termination;
- time from authoritative mismatch observation to replacement Worker start;
- number of admitted stale progress messages after mismatch;
- number of stale submissions after mismatch;
- cancellation count under unchanged tip;
- cancellation count under mempool-only change;
- memory/Worker count after repeated restarts;
- observer request cadence and request overhead.

Required pass criteria:

- foreground local reaction p95 <= 250 ms;
- loaded foreground local reaction p99 <= 1000 ms;
- zero accepted old-generation progress/result after invalidation;
- zero stale submissions after authoritative mismatch observation;
- zero false-positive cancellation in frozen-tip regression corpus;
- no unbounded Worker/listener/timer accumulation.

Gate:

- objective latency/correctness report frozen.

### MTS-13 — Physical Browser / Device Validation

Depends on: MTS-12.

This is the first package where physical-device evidence becomes materially valuable.

Priority matrix:

1. iPad Safari, one tab;
2. iPad Safari, four tabs;
3. second browser/device context if available;
4. desktop browser automation as independent runtime evidence.

Physical scenario must reproduce the user's original condition:

- several tabs mining same height;
- one context advances the chain;
- remaining contexts abandon stale work automatically;
- no Stop -> Start;
- all contexts converge to new tip;
- background/foreground at least one tab;
- capture cancellation-latency trace.

Gate:

- original failure mode no longer reproduces on the physical browser that exposed it.

### MTS-14 — Release Rehearsal

Depends on: MTS-12, MTS-13.

Goal: prove the fix can be promoted without coupling it to unrelated protocol work.

Required checks:

- syntax checks;
- existing client smoke tests;
- new mining-tip-sync tests;
- existing wallet/signing regressions;
- source-manifest consistency where applicable;
- no consensus/economic constant changes;
- diff review proving scope isolation;
- browser smoke;
- deployment preview if available;
- public-testnet promotion remains a separate integration action.

Gate:

- release candidate is independently reproducible and scope-bounded.

### MTS-15 — Terminal Verdict

Depends on: MTS-14.

Allowed terminal verdicts:

- `TIP_DRIVEN_STALE_WORK_RECOVERY_VERIFIED`;
- `SOFTWARE_CORRECT_BUT_PHYSICAL_BROWSER_EVIDENCE_PENDING`;
- `BLOCKED_BY_UNRESOLVED_STALE_WORK_OR_RUNTIME_BEHAVIOR`.

The verdict must include:

- exact FAE revision;
- exact test corpus revision;
- latency report;
- physical-device evidence status;
- unresolved browser/runtime caveats;
- confirmation that block-time choice was not used as the correctness mechanism.

## 7. Parallelization strategy

Build Colony rule:

> Parallelize independence. Serialize shared state.

### Wave A

- MTS-00.

### Wave B

- MTS-01.

### Wave C — parallel

- MTS-02 Work identity/instrumentation.
- MTS-03 Tip observer contract.

### Wave D — partially parallel

- MTS-04 Direct cancellation.
- MTS-06 Regression-harness construction can advance against the frozen MTS-02/MTS-03 contracts.

### Wave E

- MTS-05 Race-safe restart/freshness barrier.

### Wave F — parallel

- MTS-07 Rapid-tip/load/network adversarial.
- MTS-08 Background lifecycle.
- MTS-09 Multi-context convergence.
- MTS-11 Coordinator/share parity.

### Wave G

- MTS-10 Cross-tab hint optimization may run independently and is not a correctness prerequisite.
- MTS-12 Latency/false-positive acceptance after required Wave F evidence is GREEN.

### Wave H

- MTS-13 Physical browser/device validation.

### Wave I

- MTS-14 Release rehearsal.

### Wave J

- MTS-15 Terminal verdict.

Any shared `mining.js` integration is serialized. Independent test fixtures, observer-model tests and device/browser runs may proceed in parallel.

## 8. Failure and retry discipline

Every package carries:

- immutable source revision;
- objective;
- dependencies;
- write scope;
- evidence gate;
- result digest;
- verifier decision bound to exact result;
- integration revision bound to exact verified candidate;
- unresolved failures preserved.

Retries may add evidence but may not erase earlier failures.

If two distinct attempts stop at the same boundary with zero meaningful delta:

1. classify the boundary;
2. use DI if the boundary is not understood;
3. use CII only if evidence supports a generalizable system improvement;
4. do not invent generic FAE work to keep the Lab moving.

## 9. What can proceed without user action

Software work through MTS-12 can be designed to proceed without requiring the user to operate the iPad.

This includes:

- deterministic bug reproduction;
- instrumentation;
- observer design;
- cancellation implementation;
- Worker-generation race hardening;
- regression harness;
- adversarial simulation;
- background lifecycle simulation;
- multi-context simulation;
- coordinator parity;
- latency characterization in available runtimes.

MTS-13 becomes the intentional physical-evidence gate because the original issue was observed in iPad Safari. Physical validation is evidence, not a substitute for deterministic tests.

## 10. Design constraints already decided by evidence

The planning run freezes these conclusions:

### 10.1 Network authority

Correctness is network-driven, not tab-driven.

### 10.2 Cross-tab optimization

Cross-tab messaging can accelerate revalidation but cannot replace network verification.

### 10.3 Template invalidation

The stale predicate is chain-tip identity, not generic UI refresh.

### 10.4 Snapshot semantics

New mempool transactions do not invalidate an existing template merely because a newer transaction set could be constructed.

### 10.5 Block time

180 seconds makes stale turnover more frequent than 300 seconds, but either target must remain correct.

### 10.6 User interaction

Stop -> Start is a diagnostic workaround, not acceptable normal mining behavior.

## 11. Expected implementation shape

This is not yet a frozen code patch, but the smallest credible architecture is:

```text
Mining Intent
     |
     v
Mining Session / generation N
     |
     +---- fetch template ----> WorkIdentity(height, previous_hash)
     |
     +---- start PoW Worker N
     |
     +---- Tip Observer ----> /status(height, tip_hash)
                            |
                            +-- same parent --> continue
                            |
                            +-- mismatch ----> invalidate N
                                               terminate Worker N
                                               fetch fresh template
                                               generation N+1
```

Defense in depth:

- generation token rejects late callbacks;
- stale backend rejection remains supported;
- pre-submit freshness barrier catches observation/submission races;
- lifecycle resume forces revalidation;
- optional BroadcastChannel reduces same-device delay.

## 12. Next executable action

The Colony frontier is intentionally narrow:

```text
MTS-00 Boundary Freeze
          |
          v
MTS-01 Baseline Reproduction
```

Only after both are GREEN may MTS-02 and MTS-03 start.

No production miner behavior, consensus rule, backend consensus semantic, economic constant or block-time parameter should change before those gates are satisfied.
