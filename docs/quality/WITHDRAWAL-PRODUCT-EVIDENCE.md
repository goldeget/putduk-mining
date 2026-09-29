# Withdrawal Product Evidence — `/wallet/withdraw`

Status: **PARTIAL product evidence (not PRODUCT COMPLETE, not LAUNCH READY)**

Lane: `parallel/withdrawal-product`  
Scope: member withdrawal product presentation and browser evidence only.  
WS-06 money path (admin KRW/USDT browser money, hold/finalize/ledger commands) was **not rewritten**.

## Proven in this lane

| Area | Evidence |
| --- | --- |
| Loading / route error | `loading.tsx`, `error.tsx` with recovery CTA |
| Empty history | "아직 출금 요청이 없어요" |
| Validation / submit error recovery | aria-invalid amount; hold API 503 → Korean feedback, no raw relation leak |
| Status matrix labels | REQUESTED/HELD/REVIEWING/PROCESSING/EXTERNAL_SENT_RECORDED/COMPLETED/REJECTED/CANCELLED UI labels |
| Unauthorized return path | `/login?next=%2Fwallet%2Fwithdraw` |
| Themes | light / dark / system |
| Viewports | 390 / 834 / 1440 screenshots under `test-results/withdrawal-product/` |
| Keyboard / focus | amount field focus ring |
| Reduced motion | transition ≤ 0.02s; no infinite main animations |
| Hydration | console hydration annotations must stay `[]` (closed hydration must not regress) |
| Copy lock | KRW balance withdrawal; no user USDT balance wording |
| Offline / reconnect | product shell `ConnectivityStatus` (shared); no financial mutation replay invented here |

## Visual Lab

Canonical benchmark file present:

`docs/design/visual-lab/references/benchmark-v2026-09-27/benchmark--withdrawal--desktop-1440--dark--default.webp`

This lane captures production-route screenshots for 390/834/1440 × light/dark.  
Manual side-by-side gap closure against the full Visual Lab matrix (tablet light, mobile light, non-default states) remains **OPEN**. Do not treat screenshot existence as Visual Lab PASS.

## Performance notes

`test-results/withdrawal-product/route-timing.json` records next-dev/start navigation timing and script transfer size.  
This is a bounded observation, **not** a release performance acceptance gate.

## OPEN

1. Unsafe fault injection for route error / query failure browser paths (leave OPEN; do not invent unsafe harnesses).
2. Full Visual Lab difference review and visual regression baseline promotion.
3. Performance acceptance percentiles (INP/LCP/memory) under production-like start.
4. Completed first-withdrawal receipt/receipt states beyond existing WS-05 money E2E.
5. Shared CI wiring for `withdrawal-product.spec.ts` (see SHARED_FILE_REQUEST).
6. Local authenticated browser run in this lane: Docker daemon pipe was unavailable (`dockerDesktopLinuxEngine` missing). Unit markup tests passed. Re-run `pnpm test:e2e:auth:withdrawal-product` after local Supabase is up; CI Authenticated job is the remote browser gate once the shared Playwright config request is applied (file is still discovered under `tests/e2e/authenticated/`).

## HUMAN_DECISION_REQUIRED

| Item | Reason |
| --- | --- |
| KRW BANK INSTRUCTION SOURCE | Operator-facing KRW bank receipt/instruction copy and any user-visible bank account numbers must come from an approved instruction source. This lane does **not** invent account numbers or bank transfer instructions. |
| Economy / catalog / rank thresholds | Unchanged; out of lane. |

## SHARED_FILE_REQUEST

Do not edit these shared files from this lane. Request maintainers to:

1. `playwright.authenticated.config.ts`
   - Add `withdrawal-product` to the member-money-only webServer regex.
   - Add `**/withdrawal-product.spec.ts` to `mobile-chrome` `testIgnore` (viewport matrix is self-contained).
2. `docs/quality/PRODUCT-COMPLETE-MATRIX.md` — append this evidence to `/wallet/withdraw` PARTIAL row; do **not** mark PRODUCT COMPLETE.
3. `docs/quality/RELEASE-READINESS-MATRIX.md` — no launch claim; optional evidence pointer only.

## Explicit non-claims

- PRODUCT COMPLETE: **no**
- LAUNCH READY: **no**
- WS-06 money path rewrite: **none**
- Remote Supabase / Cloudflare / DNS / secrets / develop merge: **none**
- Migration / GRANT / RLS / service_role changes: **none**
