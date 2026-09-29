# FAE Direction D — Frozen Visual Grammar

Status: **VL-07 / FROZEN FOR IMPLEMENTATION**

Authority: Waterfound  
Direction: **Orange Top / White Field / Blue Circulation**

## Brand thesis

FAE should feel like a clear working environment for a sovereign public network: open, precise, calm, materially alive and accessible to ordinary devices. It should not look like a crypto casino, an exchange, a generic dark Web3 dashboard, or a sterile corporate portal.

The visual identity is carried by three structural roles rather than by decorative effects:

- **Orange Top** — identity, broadcast and network context.
- **White Field** — the dominant work surface: readable, spacious and product-first.
- **Blue Circulation** — whatever is live, active, processing, focused or flowing.

The test remains: **if the logo is removed, the interface should still look like FAE.**

## Color semantics

### Orange / topper
Orange belongs primarily to the top broadcast layer. It may appear in small identity echoes, but it is not the generic warning color and must not flood every interactive control.

### White / field
White and very light neutral surfaces are the default product environment. Information hierarchy comes from typography, spacing, rules and selective containment—not a wall of cards.

### Blue / circulation
Blue means *alive*: active computation, live network activity, focus, loading, selected interaction, sync or progress feedback.

Blue must never imply:
- guaranteed mining progress;
- probability of imminent reward;
- a countdown to a block;
- “almost won” or jackpot semantics.

## Orange topper + ticker grammar

The topper is a high-recognition FAE signature. Network facts such as block height, issued supply, reward, difficulty and network state flow horizontally as a calm continuous ticker.

Rules:
- content remains text-readable and compact;
- no large fixed metric balloons are the primary network presentation;
- repetition is allowed to preserve continuity;
- motion must be slow enough to scan;
- hover/focus may pause where supported;
- `prefers-reduced-motion` turns the ticker into a static horizontally scrollable strip;
- status is never communicated by color alone.

## Layout grammar

- light-first;
- large white working field;
- strong but compact orange top region;
- generous negative space between major tasks;
- thin neutral rules preferred over nested cards;
- cards only when containment has semantic value;
- corners restrained rather than bubble-like;
- critical wallet actions remain visually sober.

## Typography

Primary UI:
- system sans stack for speed, platform familiarity and product clarity.

Data:
- UI monospace for addresses, TXIDs, hashes, block facts and machine state.

Hierarchy:
- page/section headings: compact, high weight, tight tracking;
- body: readable and neutral;
- metadata/ticker: small, high-legibility, semibold/monospace where data-bound;
- avoid huge decorative display type that reduces operational density.

No external font dependency is required for the first implementation.

## Component tone

Buttons:
- blue primary for active user action;
- white/neutral secondary;
- destructive red only when semantically destructive;
- orange is identity first, not the default button color.

Status:
- combine wording/iconography with color;
- blue for live/in-progress;
- green remains available for confirmed success;
- amber/red remain semantic warning/error colors without competing with the orange brand layer.

## Mining activity grammar

Mining presents **ongoing participation**, not deterministic progress.

The blue activity rail:
- may visually fill or circulate to make work feel alive;
- must be labeled as activity/work, not completion percentage;
- may reset/loop without implying failure;
- must not display “x% to reward” or ETA to success;
- must explain that proof-of-work discovery is probabilistic;
- stops when mining stops;
- reduced-motion mode preserves state without animated travel.

Recommended language:
- “Local work active”
- “Device contributing”
- “Proof-of-work activity”
- “Block discovery is probabilistic”

Prohibited language:
- “87% to reward”
- “Almost there”
- “Reward in…”
- “Progress to next block”

## Motion grammar

Motion is informational:
- ticker = network circulation;
- blue activity rail = device work;
- concise state transitions = system response.

Avoid decorative floating, glow loops, parallax and reward celebration.

## Product specialization

### Homepage
Narrative and orientation. Explain sovereign, open, non-custodial, general-purpose-device PoW without becoming a marketing template.

### Wallet
Ownership, security, confidence and transaction traceability dominate. Recovery material receives maximum restraint and contrast.

### Mining
Participation, computation and ongoing work. Blue circulation is strongest here, but never casino-like.

### Explorer
Observation, transparency, neutrality and dense-data legibility. It may inherit the orange topper and blue live-state language while using denser information layouts.

## Accessibility floor

Before integration:
- measure relevant text/control contrast;
- verify keyboard focus;
- ensure status does not rely on color alone;
- verify reduced-motion ticker/activity behavior;
- preserve readable security copy at mobile widths.

## Anti-pattern additions

- orange used as generic alert everywhere;
- blue used as pseudo-probability or guaranteed mining progress;
- frantic ticker motion;
- white corporate blandness without FAE identity;
- finance-terminal imitation;
- large metric balloons replacing the ticker;
- animation without state meaning;
- critical wallet actions visually subordinated to branding.

## D+ approval refinements — pending final authority

These refinements are authoritative for the current approval candidate, while final canonical promotion remains pending Waterfound approval.

### Product-first entry

The opening screen is the product itself. No marketing hero or sales-oriented landing state precedes Wallet/Mining interaction.

### Topper and ticker

- orange topper remains thin;
- it contains the sole network-status chip;
- states: Connecting…, Testnet online, and on mainnet Mainnet online;
- remove the separate Public testnet chip below the topper;
- remove Test coins from the topper;
- ticker label is Block Height, preserving the prior compact font/sizing.

### Focused product modes

Small Wallet and Mining buttons sit at the upper-right of the white product zone. Wallet mode shows only wallet-focused panels; Mining mode shows only mining-focused panels.

### Multi-device mining telemetry

The Devices card is deliberately spacious. Device icons remain left-aligned, while the performance bars are small, thin, rectangular and centered with generous blank space.

For each device:
- current executed works/s appears inside the blue fill;
- estimated focused-mining ceiling works/s remains fixed at the right edge of the track;
- fill length tracks current output relative to that device's own estimated ceiling;
- blue becomes stronger/electric near high utilization and lighter as output falls;
- internal motion remains fast and visibly alive while works execute, slowing/settling when output falls;
- none of this communicates progress toward a guaranteed reward.
