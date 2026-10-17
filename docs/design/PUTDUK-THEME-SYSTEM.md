# PUTDUK Theme System

Status: **CANONICAL FOUNDATION**

## 1. Modes

PUTDUK supports three user preferences:

- `system` — default; follows `prefers-color-scheme`;
- `dark` — cinematic blue-black/gold flagship mode;
- `light` — clean white/ink operational mode with the same restrained gold.

Theme is presentation state only. It never changes mining, settlement, wallet, event or authorization behavior.

## 2. Resolution contract

```text
stored preference (system | light | dark)
→ system media query when preference = system
→ resolved theme (light | dark)
→ semantic CSS tokens
→ matching theme-aware asset variant
```

The preference may be stored locally before authentication and copied to an authenticated profile preference later. Server-rendered markup must avoid a misleading flash: a small reviewed bootstrap script may apply a saved preference before paint. If storage is unavailable, `system` remains the complete fallback.

## 3. Semantic palette

| Semantic role | Dark | Light |
| --- | --- | --- |
| canvas | blue-black `#020a14` | cool white `#f8f8f8` |
| subtle background | `#07111d` | `#eff1f3` |
| elevated background | `#0d1a28` | `#ffffff` |
| primary text | `#f1f4f7` | `#161b21` |
| secondary text | `#b7c3d0` | `#58616b` |
| tertiary text | `#97a5b5` | `#717b86` |
| primary gold | `#f4c76c` | `#94600f` |
| strong gold | `#c58b35` | `#744b0b` |
| quiet gold surface | `#2b251c` | `#f6ead0` |

Primary actions use a shared metallic gold gradient and dark readable label in
both modes; decorative and inline gold text uses the mode-specific accessible
brand tokens above.

State colors remain semantic and are independently contrast-tested. Do not recolor danger, success or warning into decorative gold.

## 4. Asset selection

- Dark carbon surfaces use `*-dark.*` symbols, lockups and app icons.
- Light ivory surfaces use `*-light.*` variants.
- System-safe transparent art may remain constant when its outline and contrast are verified.
- Theme switching must not trigger large scene downloads when a CSS surface treatment is sufficient.

## 5. Component rules

- Components consume semantic tokens only; no page-local brand hex values.
- Primary actions use solid gold/ink with an explicit hover, active, disabled and focus state.
- Elevated surfaces are opaque enough to maintain text readability; blur is optional and restrained.
- Data tables and forms prioritize contrast and density over cinematic atmosphere.
- Charts use shape, label and pattern in addition to color.
- Skeletons preserve layout and use low-contrast neutral motion; reduced motion removes shimmer.

## 6. Accessibility gate

- Text and interactive controls meet WCAG AA contrast for their actual size and weight.
- Focus is visible in both modes and not encoded by color alone.
- Forced-colors mode retains control boundaries and labels.
- A 200% text zoom and browser text-size increase must not hide critical actions.
- Theme choice is keyboard and screen-reader operable.

## 7. Test matrix

Every release-candidate route is checked in:

```text
System-light × System-dark × forced Light × forced Dark
× mobile × tablet × desktop
× default × loading × empty × error/offline where applicable
```

Automated screenshots are a regression aid, not a substitute for contrast and keyboard checks.
