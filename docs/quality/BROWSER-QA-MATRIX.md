# PUTDUK Browser QA Matrix

Status: **REQUIRED / AUTOMATION PARTIAL**

## Supported matrix

| Class | Browser/runtime | Viewport baseline | Input |
| --- | --- | --- | --- |
| Mobile iOS | current Safari and previous major | 320×568, 390×844, 430×932 | touch, virtual keyboard |
| Mobile Android | current Chrome and previous major | 360×800, 412×915 | touch, back navigation |
| Tablet | Safari iPadOS + Chrome Android | 768×1024, 820×1180, landscape | touch, keyboard where available |
| Desktop | Chrome, Edge, Firefox current/previous; Safari current | 1280×720, 1440×900, 1920×1080 | keyboard, mouse |
| Installed PWA | iOS home screen + Android/desktop install | representative mobile/desktop | standalone lifecycle |

The exact current/previous versions are frozen in each release record. “Latest” without a captured version is not evidence.

## Critical journey matrix

| Journey | P0 assertions |
| --- | --- |
| Public entry | canonical metadata, real Korean copy, responsive hero, theme, trust navigation |
| Sign-up | validation, duplicate candidate, password confirmation, terms version, verification boundary |
| Sign-in/recovery | session rotation, safe error copy, recovery completion, account state |
| PUTDUK START | eligibility, one start, server-time resume, quota/time termination, idempotent settlement |
| Mining | authoritative status, refresh/reconnect, rule boundary, duplicate settle protection |
| Wallet | ledger-derived summary, pagination, empty/error, ownership isolation |
| Deposit | request creation, duplicate prevention, operator approval, audit and reflected ledger |
| Withdrawal | validation, hold/review, rejection/approval, idempotency, audit |
| Events/notices | date targeting, deep link, expired state, non-empty baseline content |
| Push/PWA | permission timing, subscribe/unsubscribe, icon/badge, click route, offline shell, upgrade |
| PUTDUK AI | authenticated ownership, factual context, genuine streaming, cancel/retry/refresh, no mutation |
| Admin | MFA gate, role matrix, deposit/withdrawal/exception queues, confirm/reason/audit |
| Trust/discovery | canonical facts, sitemap/robots/structured data, status/changelog consistency |

## State coverage

Each applicable journey runs in:

```text
first use · returning use · loading · empty · success · validation error
server error · timeout · duplicate submit · refresh · offline · reconnect
session expiry · unauthorized ownership · reduced motion · large text
Light · Dark · System-light · System-dark
```

## Automation layers

1. **Unit/contract:** calculations, state machines, allowlists, schemas and idempotency keys.
2. **Database:** constraints, RLS, grants, functions, concurrency and pgTAP.
3. **Browser E2E:** real route behavior with controlled accounts/data.
4. **Visual regression:** stable states at representative breakpoints/themes.
5. **Accessibility:** automated scan plus keyboard/screen-reader manual pass.
6. **Performance:** measured LCP/INP/CLS, long tasks, asset bytes, 3D FPS/memory.
7. **Production smoke:** read-only/public checks followed by a bounded synthetic account flow where approved.

## Visual and performance baselines

- Screenshot baselines are versioned by browser, viewport and theme.
- Dynamic stars, time and identifiers are stabilized or masked deliberately.
- A changed baseline requires review; snapshots are never mass-accepted to make CI green.
- Core Web Vitals target the “good” thresholds at the 75th percentile.
- Critical-route JavaScript, LCP image bytes, 3D bundle/texture bytes and peak memory receive route-specific budgets before release.
- 3D cannot block primary controls and must fall back completely when unavailable.

## Evidence record

For each release retain exact:

- commit SHA and deployment/version ID;
- browser, OS/device and viewport;
- test run and artifact IDs;
- database migration/version state;
- screenshots, videos, console/network failures and traces;
- failures, waivers (P1 only), owner and expiry.

Current repository status: the Playwright foundation smoke suite exists, but the full authenticated, cross-browser, visual, accessibility, PWA and performance matrix is not yet implemented. It must not be reported as passed.
