# PUTDUK Visual Direction

Status: **CANONICAL / APPROVED ART DIRECTION**

Asset version: `2026.09.27-v1`

## 1. Canonical references

The following files are immutable visual references for this greenfield product:

| Reference | Role | SHA-256 |
| --- | --- | --- |
| `docs/design/visual-references/putduk-brand-master-reference.png` | Brand, mascot, premium app/PWA, Earth-atmosphere and black/gold material direction | `c3b9363be5f5c0cb212e87ae5d7b49fcf5ba5105858367f40e91ef6999077512` |
| `docs/design/visual-references/putduk-rank-master-reference.png` | Mining-world immersion, planetary rank-emblem hierarchy and cinematic quality bar | `b91a1e9bc64456a6d7c73861c7cfa8512eb976867fb112cdecdd083648a80f96` |

These references define visual quality and art direction. They do **not** define final copy, product claims, rank benefits, economic values, or implemented scope. They remain separate from optimized runtime assets and must never be served directly by the application.

## 2. Non-negotiable Korean copy rule

The exact Korean brand spelling is **퍼뜩**.

Generated pixels are never a copy source. All Korean copy—including `퍼뜩`, slogans, buttons, rank names, notices and labels—must be rendered as real HTML/CSS text or, where a fixed identity mark is required, as reviewed SVG text/path content. Do not crop, trace or reuse misspelled text from a generated mockup.

## 3. Brand thesis

PUTDUK is a trusted digital mining world, not a speculative-crypto theme. Its visual language joins:

- fintech-level clarity and evidence;
- premium digital/game immersion;
- large consumer-app usability;
- SaaS-grade information hierarchy;
- a proprietary PUTDUK mascot and planetary system.

The emotional sequence is **dark space → warm discovery light → a clear next action → a recorded result**. Black establishes scale and focus. Gold represents earned progress, not decoration. The Earth horizon represents a shared world. The mascot humanizes system guidance without making the interface childish.

## 4. Signature visual grammar

### Black space

- Prefer blue-black and carbon-black fields over flat pure black.
- Use depth through restrained vignettes, star density and material separation.
- Keep content regions legible; atmospheric art must never sit directly behind long-form copy without a contrast layer.

### Warm gold

- Gold is the primary action and progression color.
- Use a tonal ladder from pale champagne highlights to deep amber shadow.
- Metallic effects require a directional light model, not arbitrary gradients on every card.
- Reserve intense bloom for hero moments, active mining and rank elevation.

### Earth and orbit

- Earth is a world anchor, not a financial-market metaphor.
- Gold city lights and orbital paths communicate participation and continuity.
- The horizon can frame a hero, splash, rank transition or milestone; it should not repeat on every surface.

### Mascot

- The canonical silhouette is a compact premium mining robot with a two-leaf sprout, gold helmet, single headlamp and black glass face.
- Expression is conveyed through minimal face-light geometry and body pose.
- The mascot guides, celebrates and explains. It must never impersonate an operator, promise returns or obscure a critical warning.
- Full mascot renders are selective; the simplified sprout-miner symbol is used for compact product identity.

### Planetary ranks

- Rank art uses a centered planet, orbital ring, material progression and controlled light intensity.
- Runtime rank assets are neutral `rank-01` through `rank-06`. Names, requirements and benefits are separate versioned data and real typography.
- Increasing visual intensity must not imply financial yield or guaranteed value.

## 5. Composition and hierarchy

1. One dominant story per viewport.
2. One primary action per state.
3. Use a disciplined 8-point spacing rhythm with optical corrections for Korean type.
4. Dense operational screens prioritize tables, state labels and evidence over atmospheric art.
5. Mobile retains the same hierarchy; it does not become a stack of unrelated cards.
6. Desktop may add negative space and wider scenes, but not additional critical actions unavailable on mobile.

## 6. Typography

- Korean UI: Pretendard Variable or a metrically reviewed equivalent, with system fallbacks.
- Latin utility/data: a restrained grotesk or monospace only where scanning improves.
- Headlines use weight, scale and line breaks—not baked image copy.
- Korean body copy targets comfortable 1.6–1.8 line height and avoids excessive tracking.
- Numeric values use tabular figures in ledger, settlement and admin contexts.

## 7. Theme behavior

- `System` is the default preference.
- `Dark` is the cinematic flagship expression.
- `Light` uses warm ivory, ink and restrained gold; it is not an inverted dark theme.
- Theme choice must preserve contrast, state semantics and asset intent.
- Detailed token and persistence rules are defined in `PUTDUK-THEME-SYSTEM.md`.

## 8. Motion and dimension

- Normal product UI is 2D/2.5D.
- High-quality 3D is limited to mining scenes and high-value rank/world moments.
- Motion explains state, continuity or spatial hierarchy. It never delays a transaction.
- Reduced motion, low-power and WebGL-unavailable modes receive complete static experiences.
- Detailed budgets and fallbacks are defined in `PUTDUK-MOTION-EXPERIENCE.md`.

## 9. Prohibited outcomes

Do not ship:

- generic starter-template layouts;
- emoji as production icons;
- rainbow crypto gradients or constant neon glow;
- excessive glassmorphism;
- random gradient cards;
- cute-game styling that weakens trust;
- generated-image text used as UI copy;
- rank visuals that state unapproved rewards;
- motion that hides latency or fabricates progress;
- dark-only assets with unreadable light-mode fallbacks.

## 10. Review gate

A visual deliverable passes only when:

- it clearly belongs to PUTDUK without relying on a logo;
- all visible copy is real and the exact spelling `퍼뜩` is preserved;
- hierarchy works at 320 px, tablet and desktop widths;
- dark, light and system behavior is intentional;
- focus, contrast, text scaling and reduced-motion behavior pass;
- loading, empty, error, offline and recovery states are designed;
- asset selection follows the manifest and responsive delivery rules;
- visual richness does not compromise truthful system state.
