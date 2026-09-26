# PUTDUK Theme System

Status: **CANONICAL FOUNDATION**

## 1. Modes

PUTDUK supports three user preferences:

- `system` — default; follows `prefers-color-scheme`;
- `dark` — cinematic black/gold flagship mode;
- `light` — warm ivory/ink operational mode.

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
| canvas | carbon black `#070706` | warm ivory `#f8f4ea` |
| subtle background | `#0e0c09` | `#f1eadb` |
| elevated background | `#15120d` | `#fffdf8` |
| primary text | `#f8f2e4` | `#17130d` |
| secondary text | `#b8ad98` | `#605643` |
| tertiary text | `#817765` | `#81745e` |
| primary gold | `#f6c85b` | `#9b650d` |
| strong gold | `#d99a2b` | `#7c4b06` |
| quiet gold surface | `#3a2810` | `#f0ddb0` |

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
