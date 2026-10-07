# FAE Manifesto Editorial Charter

Status: candidate permanent editorial policy  
Scope: public-facing FAE Manifesto language and manifesto-derived narrative material  
Repository: `Waterfound/FAE-testnet`  
Adopted by direction: 2026-10-07  
Consensus / economics / release effect: none

## Purpose

This charter defines the permanent editorial rules for the FAE Manifesto.

The Manifesto exists to explain, in language understandable beyond technical audiences, why FAE matters to people and how its architecture makes that benefit possible. It is not a substitute for the technical documentation, security model, implementation notes, evidence packages, or protocol specifications.

Technical documentation answers:

- what FAE does;
- how it does it;
- which invariants and boundaries apply;
- what evidence supports a claim;
- what remains unresolved.

The Manifesto answers:

- what human problem matters;
- what positive property FAE seeks to preserve;
- how the architecture makes that property possible;
- why that result is valuable to ordinary participants.

A Manifesto claim must remain technically truthful. Editorial simplification must never convert an unresolved hypothesis into an established fact.

## Permanent editorial rules

### 1. Positive before defensive

Lead with the world FAE makes possible, not with the failure mode it is designed to avoid.

Manifesto language SHOULD describe the positive property first: sovereignty, participation, ownership, openness, continuity, accessibility, or human-scale computation.

Defensive rationale MAY inform the writing, but the Manifesto SHOULD NOT be organized as a catalogue of threats, failures, dependencies, or adversaries.

Preferred pattern:

> FAE preserves participant sovereignty by design.

Avoid as a public-facing framing:

> FAE is safe because dependency X or provider Y might fail.

### 2. Property before fragility

Describe durable system properties without unnecessarily exposing operational weak points.

The Manifesto SHOULD explain sovereignty through concepts such as independent validation, participant-controlled keys, reconstructible consensus, permissionless participation, deterministic issuance, and non-custodial ownership.

The Manifesto SHOULD remain deliberately abstract about specific providers, operational dependencies, recovery paths, infrastructure topology, account-bound surfaces, security-sensitive implementation details, or other fragility maps unless disclosure is necessary for a truthful public claim.

This rule does not weaken transparency. Precise implementation, evidence, threat analysis, and reproducibility belong in the appropriate technical documentation.

Preferred pattern:

> FAE is designed so that interfaces may evolve while ownership and protocol rules remain independently verifiable.

### 3. Human before mechanism

Begin with the human consequence, then introduce enough mechanism to make the claim credible.

A non-technical reader SHOULD be able to understand why the property matters before encountering protocol detail.

The normal Manifesto flow is:

`human problem -> positive principle -> FAE mechanism -> human benefit`

Technical mechanisms SHOULD appear where they illuminate the benefit, not merely to demonstrate technical sophistication.

Preferred pattern:

> Ordinary devices should remain meaningful participants. FAE therefore researches Proof of Work around general-purpose hardware and measures real economic and energy behavior rather than assuming specialized compute must dominate.

### 4. Technical enough to be true, simple enough to be shared

The Manifesto MUST remain grounded in real architecture and evidence while remaining understandable to a non-specialist.

It SHOULD:

- preserve the technical idea that makes a statement true;
- avoid unnecessary implementation detail, internal nomenclature, provider names, workflow names, gate identifiers, and operational bookkeeping;
- distinguish demonstrated properties from research goals and hypotheses;
- prefer clear concepts, concrete human consequences, and memorable analogies over internal engineering language;
- remain compatible with the authoritative technical documentation.

A technically sophisticated reader should recognize a real system behind the prose. A non-technical reader should understand why that system matters.

## Editorial treatment of sensitive or fragile details

The Manifesto is not an operational map.

When a concept derives from a fragility, dependency, threat model, recovery mechanism, or infrastructure constraint, public-facing language SHOULD translate that origin into the positive property the architecture preserves.

Examples:

- dependency analysis -> sovereignty and continuity;
- custody risk -> participant ownership;
- infrastructure concentration -> distributed participation;
- specialized-compute pressure -> general-purpose relevance;
- automation failure modes -> human-machine complementarity and evidence-bound progress.

Specific operational details remain in technical documentation at the level required for implementation, audit, reproducibility, and security review.

## Relationship to FAE technical documentation

This charter creates no protocol authority and changes no consensus rule.

If Manifesto language conflicts with authoritative or frozen technical evidence, the technical evidence wins and the Manifesto must be corrected.

The Manifesto MAY simplify.

It MUST NOT fabricate, overstate, conceal the uncertainty of unresolved research, or turn an aspirational design goal into a completed technical claim.

The intended separation is:

> **Documentation: prove what FAE is.**  
> **Manifesto: explain why the world needs it.**

## Editorial review test

Before admitting a passage into the FAE Manifesto, ask:

1. Does it begin from a positive human value or capability?
2. Does it describe the system property without unnecessarily mapping fragility?
3. Can a non-technical reader understand why it matters?
4. Is every technical implication compatible with current evidence and authority?

If any answer is no, the passage should be revised before publication.
