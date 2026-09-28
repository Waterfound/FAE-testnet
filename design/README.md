# FAE Visual Language

This directory is the isolated design workspace for **FAE — Visual Language, Art Direction & Rebrand**.

## Architectural split

### Potential Waterfound Visual System primitives

Only patterns proven useful in real FAE surfaces may later be extracted:

- typography scale and data typography;
- spacing rhythm and layout primitives;
- accessibility rules;
- motion grammar;
- focus/interaction conventions;
- component architecture;
- design QA and visual critique methods.

### FAE-specific art direction

These stay specialized unless reuse is demonstrated:

- identity, symbol and wordmark;
- FAE palette;
- mythic/ethereal visual metaphors;
- surface textures;
- brand narrative;
- product-specific composition.

**Generalize proven patterns, not imagined reuse.**

## Current baseline

The public testnet is functional and coherent, but its identity is dominated by dark forest green, mint accents, rounded cards and system UI typography. The goal is not to discard clarity; it is to add a recognizable visual grammar that survives removal of the logo.

## Current execution boundary

Exploration under `design/**` is non-production and non-consensus. Production files such as `index.html`, wallet/mining runtime modules, Explorer runtime and canonical state registries remain untouched until a direction is selected and the branch is reconciled against newest `main`.

## Exploration order

1. Current-state audit
2. Divergent directions
3. Human selection
4. Brand thesis + visual grammar freeze
5. Homepage / Wallet / Mining vertical slices
6. Explorer specialization
7. Responsive, accessibility and browser QA
8. Reference gallery + systemization
9. Serialized canonical integration
