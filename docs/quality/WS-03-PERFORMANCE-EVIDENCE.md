# WS-03 performance evidence

Evidence date: `2026-09-27 KST`

This is bounded local evidence for the current WS-03 working tree. It is not field Web Vitals, a production-device result or a `PRODUCT COMPLETE` performance acceptance.

## Build inventory

Measured after the complete `pnpm verify` production build:

| Inventory | Result |
| --- | ---: |
| Public `.next/static/chunks` files | 31 |
| Public `.next/static/chunks` aggregate bytes | 1,392,481 |
| Largest generated chunk | `25n961p03k1wk.js` — 397,296 bytes |
| `public/` runtime files | 87 |
| `public/` aggregate bytes | 8,468,157 |
| Largest public asset | `public/brand/social/putduk-social-square-v1.png` — 1,305,295 bytes |

Aggregate build-directory size is not initial-route payload. The browser transfer measurements below are the narrower route evidence.

## Loopback browser sample

Method:

- optimized `next start` build bound only to `127.0.0.1:4317`;
- synthetic non-production environment values and a non-routable local Supabase URL;
- Chromium `153.0.8010.12`, headless, one fresh context per case;
- no CPU or network throttling;
- Landing `/`, explicit theme, one theme-selector keyboard interaction;
- buffered browser performance entries collected after load and a settling interval.

| Case | LCP | CLS | Max observed interaction event | Long tasks | DCL | Load | Transfer | JS transfer | Image transfer |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop 1440 × 1024, Dark | 724 ms | 0 | 24 ms | 0 / 0 ms | 459 ms | 509 ms | 348,633 B | 154,976 B | 158,002 B |
| Mobile 390 × 844, Light | 272 ms | 0 | 16 ms | 1 / 106 ms | 106 ms | 262 ms | 286,948 B | 151,069 B | 105,192 B |

## Interpretation and acceptance boundary

- The sampled Landing payload and layout stability are promising on this unthrottled loopback host.
- The mobile sample contained one `106 ms` long task, so even this bounded run is not a clean long-task pass.
- The single observed interaction event is not INP. It covers only one theme-selector action and cannot represent real user interaction latency.
- Headless heap readings were not retained because the exposed value was low-fidelity. FPS, production memory behavior and WebGL lifecycle were not proven; the current Landing does not load a WebGL scene.
- No field data, mobile-device trace, slow-network trace, multi-run percentile, authenticated route trace or Chrome DevTools trace artifact exists yet.

Performance remains `PRODUCT COMPLETE = BLOCKED` until representative device/network runs establish LCP, INP, CLS, long-task, memory and any applicable FPS/WebGL budgets without reducing perceived visual quality.
