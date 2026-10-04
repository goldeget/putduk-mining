# PUTDUK Design System

Status: **CANONICAL INDEX**

PUTDUK combines fintech clarity, premium digital/game immersion, consumer-app usability and SaaS information discipline in an original black/gold world. V1 scope is narrow; visual and interaction quality are production-grade.

## Canonical documents

- `PUTDUK-VISUAL-DIRECTION.md` — art direction, reference boundary, mascot, materials and composition.
- `PUTDUK-BRAND-ASSET-SYSTEM.md` — production assets, manifest, responsive formats, accessibility and versioning.
- `PUTDUK-THEME-SYSTEM.md` — semantic Light/Dark/System tokens and testing.
- `PUTDUK-MOTION-EXPERIENCE.md` — truthful motion, selective 3D, fallback and performance evidence.

The canonical images are preserved under `docs/design/visual-references/`. They define quality and art direction only. They are not production copy or runtime assets.

## Core rules

1. Exact Korean brand spelling: `퍼뜩`.
2. Never use text baked into generated images.
3. Use the custom PUTDUK SVG icon system; no emoji as production icons.
4. Consume semantic tokens rather than page-local colors.
5. Gold communicates primary action/progress; it is not applied indiscriminately.
6. Use opaque, legible operational surfaces; glass is rare and purposeful.
7. Preserve realistic material, light, background detail, color and spatial depth
   from the approved references. A 2D/2.5D label does not lower the quality target.
   Capability-based effect limits retain the approved master and every critical
   action; 3D is never required to operate financial or recovery controls.
8. System is the default theme preference; Light and Dark are complete modes.
9. Every screen includes applicable loading, empty, success, warning, error, disabled, offline and reconnect states.
10. Mobile, tablet and desktop share the same critical capability and hierarchy.
11. The public cinematic landing and authenticated application are distinct
    information architectures; protected data never leaks into public shells.
12. Trial and real KRW balances use distinct labels, surfaces and receipts.
13. Promotional presentation never implies funding is required to withdraw an
    eligible PUTDUK START welcome reward.

## Token families

```text
background.*
surface.*
text.*
border.*
brand.*
status.*
world.*
spacing.*
radius.*
shadow.*
motion.*
z_index.*
```

Primary palette:

- carbon black / blue-black canvas;
- warm ivory Light mode;
- pale champagne highlight;
- primary warm gold;
- deep amber shadow;
- ink and warm gray text.

Status colors remain semantic and are never replaced by decorative gold.

## Navigation

Mobile primary navigation:

- 홈;
- 채굴;
- 자산;
- 이벤트;
- 메뉴.

Desktop expands navigation without changing task ownership. Admin navigation is a separate information architecture and authorization surface.

## Accessibility

- WCAG AA contrast for text and controls;
- visible keyboard focus;
- screen-reader names and state;
- generous touch targets;
- text zoom and Korean line-breaking resilience;
- shape/text in addition to color;
- reduced-motion and no-WebGL complete fallbacks.

## Acceptance

Design is done only when the product is recognizably PUTDUK without relying on generic templates, all production copy is real typography, themes and viewports are complete, state truth is preserved, asset verification passes and browser/accessibility/performance evidence meets the release definition of done.
