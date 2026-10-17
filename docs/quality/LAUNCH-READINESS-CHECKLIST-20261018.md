# PUTDUK MINING — 출시 준비 체크리스트 (2026-10-18)

Status: **LAUNCH READINESS TRACKING** (출시 승인 문서 아님)

Worktree baseline: `C:\Users\PC\Desktop\putduk-mining\.worktrees\cloud-ui-20261012`  
Handoff: `CURSOR_HANDOFF_20261017.md` (2026-10-18 갱신 항목 반영)  
Canonical gates: `docs/quality/DEFINITION-OF-DONE.md`, `docs/product/V1-SCOPE-PRIORITIES.md`, `docs/development/GIT-CI-CD-POLICY.md`

**판정 규칙:** 출시 = V1 범위 전체가 **PRODUCT COMPLETE**. 라우트·API·컴포넌트·단독 스크린샷·로컬 unit green은 출시로 치환할 수 없다.

**증거 라벨:** `PASS` · `PARTIAL` · `OPEN` · `BLOCKED` · `NOT_SAFE_TO_INFER` (`DEFINITION-OF-DONE.md`)

**증거 경로 패턴 (채울 때):**

| 유형 | 패턴 |
| --- | --- |
| Mockup QA (공개) | `D:\PUTDUK-MINING-QA\mockup-ui-audit-20261017-run-03\public-route-capture.json`, `{theme}-{viewport}-{route-index}-{slug}.png` |
| Mockup 원본 | `D:\PUTDUK-MINING-QA\mockup-ui-audit-20261017-run-03\source-desktop\`, `source-mobile\` |
| Matrix / DoD | `docs/quality/VISUAL-ACCEPTANCE-ROUTE-MATRIX-20261018.md` (63경로), `docs/quality/PRODUCT-COMPLETE-MATRIX.md`, `docs/quality/DEFINITION-OF-DONE.md` |
| Local launch verify (2026-10-18) | `docs/quality/LAUNCH-VERIFICATION-LOG-20261018.md`, `launch-verify-*-20261018.log` |
| CI (exact SHA) | `https://github.com/goldeget/putduk-mining/actions/runs/{run_id}` + job artifact 이름 |
| Authenticated E2E | `tests/e2e/authenticated/{domain}.spec.ts`, `test-results/`, `playwright-report/` |
| Visual Lab | `docs/design/visual-lab/benchmark-manifest.json`, `docs/design/visual-lab/references/` |
| Release evidence | `docs/development/GIT-CI-CD-POLICY.md` §8 필드 |

---

## 1. 경영 요약 (Executive)

| 항목 | 상태 (2026-10-18) | Owner |
| --- | --- | --- |
| V1 scope 대비 **PRODUCT COMPLETE** | **OPEN** — matrix상 전 route PARTIAL, PRODUCT COMPLETE 0 (`PRODUCT-COMPLETE-MATRIX.md`) | Product |
| **LAUNCH READY** 선언 | **OPEN** | Product + Eng |
| 목업 대조 (공개 26) HTTP·캡처 JSON | **DONE** — 104행 JSON, screenshot 필드 전부 채움; PNG 104+1 recapture | Eng + Product |
| 로그인 화면 목업 정합 (PUT-9) | **BLOCKED** — 디자인 결정 대기 (`LOGIN-MOCKUP-GAP-DECISION-20261018.md` 옵션 A/B/C) | Product + Eng |
| `/terms`, `/privacy` 법률 본문 | **BLOCKED** — 승인 legal review 본문 없음 | Legal + Product |
| 회원 17 / 관리자 20 PRODUCT QA | **OPEN** — LOCAL_QA·승인 세션 없이 미검증 (handoff) | Eng + Ops |
| Full CI (exact candidate SHA, ≤20분 wall) | **OPEN** — worktree 로컬 full 미실행 | Eng |
| Remote Supabase apply | **OPEN** — mutation freeze 유지 | Eng + Ops |
| Cloudflare activation + DNS | **OPEN** — coupling 승인·inventory 선행 | Ops |

---

## 2. 출시 게이트 (Release gates)

### 2.1 Git · CI · 아티팩트

- [ ] **P0** `git fsck --full` PASS, origin `https://github.com/goldeget/putduk-mining.git` 일치 — Owner: **Eng** — Evidence: `{local SHA}` / `OPEN` (worktree HEAD `411be7eb…`, origin `codex/cloud-ui-recovery-20261012` 대비 **+15** 미 push)
- [ ] **P0** Release candidate가 remote branch에 있고 CI가 **동일 SHA** 검사 — Owner: **Eng** — Evidence: `OPEN`
- [ ] **P0** Whole workflow wall clock **≤ 20분**, 필수 quality job 전부 success (12-shard authenticated + `e2e-app-build` + `ci-budget` 등) — Owner: **Eng** — Evidence: baseline `36975512027` / `9cfc2ef` (~16m); **current candidate OPEN**
- [ ] **P0** Application gates: format, lint, typecheck, unit, member+admin production build — Owner: **Eng** — Evidence: **PARTIAL** — 2026-10-18 worktree `lint` + both builds + vitest 96 tests PASS; full `typecheck`/CI candidate **OPEN**
- [ ] **P0** Database security gates: pgTAP, advisors, concurrent money probes — Owner: **Eng** — Evidence: develop historical runs; **candidate OPEN**
- [ ] **P0** Browser foundation + Korean typography (public/protected) — Owner: **Eng** — Evidence: `PARTIAL` (matrix typography only on subset)
- [ ] **P0** Authenticated product gates: `pnpm test:e2e:authenticated` full inventory 1×/shard — Owner: **Eng** — Evidence: `OPEN`
- [ ] **P0** Worker runtime gates: sanitized `test-results/worker/report.json` artifact — Owner: **Eng** — Evidence: `OPEN`
- [ ] **P1** Release evidence packet (§8): SHA, run IDs, artifact digest, rollback owner — Owner: **Ops + Eng** — Evidence: `OPEN`

### 2.2 Production coupling · 승인

- [ ] **P0** Push/merge/tag/deploy 전 production coupling 분류 (`GIT-CI-CD-POLICY.md` §Production coupling guard) — Owner: **Ops** — Evidence: `UNKNOWN` until inspected → treat as **not safe**
- [ ] **P0** Live mutation(배포, remote DB, Cloudflare, DNS) **명시적 human approval** (target, SHA, effect, rollback) — Owner: **Ops** — Evidence: `OPEN`
- [ ] **P1** 출시 후 repository visibility: owner가 public → private 전환 (정책 §9) — Owner: **Ops** — Evidence: `OPEN`

### 2.3 Supabase (remote)

- [ ] **P0** Apply 직전 project ref **`osrmyjgmpdspdcwqjwuv`** 재확인 — Owner: **Eng** — Evidence: spec PASS / apply `OPEN`
- [ ] **P0** Migration review, expand/contract, recovery plan — Owner: **Eng** — Evidence: local migrations exist; remote `OPEN`
- [ ] **P0** Backup/PITR entitlement + restore rehearsal evidence — Owner: **Ops** — Evidence: `SPEC_ONLY` (`ARCHITECTURE-CLOSURE-AUDIT.md` #33)
- [ ] **P1** Post-apply: RLS/advisors 재검, reconciliation smoke — Owner: **Eng** — Evidence: `OPEN`

### 2.4 Cloudflare · DNS

- [ ] **P0** Account ID **`9dc502d4ef06b3b5374591de6e6933ca`** (`putduk-landing`) 작업 전 검증 — Owner: **Ops** — Evidence: policy PASS / provisioning `OPEN`
- [ ] **P0** Bounded inventory + rollback backup (email, WAF, 기존 integration) — Owner: **Ops** — Evidence: `OPEN`
- [ ] **P0** Staging: reviewed commit artifact + CI + smoke **후** production host 전환 — Owner: **Ops + Eng** — Evidence: `OPEN`
- [ ] **P0** `mining.putduk.com`, `admin.mining.putduk.com` mapping (owner DNS pointer) — Owner: **Ops** — Evidence: `OPEN`
- [ ] **P1** TLS, auth smoke, obsolete integration removal (inventory 확인분만) — Owner: **Ops** — Evidence: `OPEN`

---

## 3. 도메인별 완료 (63 routes — mockup·QA scope)

**경로별 상세 표:** `VISUAL-ACCEPTANCE-ROUTE-MATRIX-20261018.md` (공개 26 PARTIAL · 회원·관리자 37 NOT_RUN · 시각 PASS 0). 아래는 출시 체크용 요약.

열: **F** = FOUNDATION · **Fn** = FUNCTIONAL · **P** = PRODUCT  
2026-10-18 handoff/matrix 기준 — PRODUCT 열은 **전부 OPEN** unless noted.

증거 shorthand: `[QA-D]` = D: mockup run-03, `[E2E]` = authenticated spec, `[MX]` = PRODUCT-COMPLETE-MATRIX

### 3.1 공개 · 비인증 (26)

| Route | F | Fn | P | Priority | Evidence / 메모 |
| --- | --- | --- | --- | --- | --- |
| `/` | PASS | PARTIAL | OPEN | P0 | `[QA-D]` 200; landing copy fix 로컬 미커밋; `[MX]` PARTIAL typography |
| `/login` | PASS | PASS | **OPEN** | **P0** | **PUT-9 GAP**: 목업 `…11_08_08-6.png` vs 공장 장면; `[QA-D]` recapture DONE; hydration 콘솔 **CLOSED** (Playwright `caret:hide` 계측; `LAUNCH-VERIFICATION-LOG-20261018.md` §8) |
| `/signup` | PASS | PARTIAL | OPEN | P0 | `[QA-D]`; terms/privacy **BLOCKED** → 가입 consent 증거 불완전 |
| `/recover` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/find-id` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/support` | PASS | PARTIAL | OPEN | P1 | `[MX]` support partial |
| `/auth/error` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/auth/forbidden` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/auth/update-password` | PASS | PARTIAL | OPEN | P1 | 미인증 → `/recover` (정상); fixture `[E2E]` OPEN |
| `/offline` | PASS | PARTIAL | OPEN | P1 | hydration: 제품 결함 아님으로 정리 (handoff 2026-10-18) |
| `/about` | PASS | PARTIAL | OPEN | P1 | Trust registry; `[QA-D]` |
| `/how-it-works` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/putduk-facts` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/verification` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/mining-rules` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/trial` | PASS | PARTIAL | OPEN | P0 | PUTDUK START 설명; `[QA-D]` |
| `/economy` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/deposit` | PASS | PARTIAL | OPEN | P0 | `[QA-D]` |
| `/withdrawal` | PASS | PARTIAL | OPEN | P0 | `[QA-D]` |
| `/faq` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/status` | PASS | PARTIAL | OPEN | P1 | `[QA-D]` |
| `/changelog` | PASS | PARTIAL | OPEN | P2 | `[QA-D]` |
| `/ai/about` | PASS | PARTIAL | OPEN | P2 | `[QA-D]` |
| `/ai/facts` | PASS | PARTIAL | OPEN | P2 | `[QA-D]` |
| `/ai/faq` | PASS | PARTIAL | OPEN | P2 | `[QA-D]` |
| `/ai/how-it-works` | PASS | PARTIAL | OPEN | P2 | `[QA-D]` |

**공개 횡단 (26 공통):**

- [ ] **P0** 26 × (320/390/834/1440) × (light/dark/system) 목업 또는 Visual Lab diff sign-off — Owner: **Product** — `PARTIAL` (`[QA-D]` only)
- [ ] **P0** Public admin alias 404 (`/admin`, `/manage`, …) — Owner: **Eng** — `[E2E]` `public-admin-boundary.spec.ts` (CI candidate에서 재확인)
- [ ] **P1** Trust copy unit — Owner: **Eng** — **DONE** `tests/unit/trust-content.test.ts` + `public-discovery.test.ts` (12 tests)

### 3.2 회원 · 인증 (17)

로그인 보호 product surface (`tests/typography/route-coverage.json` member product set). **2026-10-18: LOCAL_QA 없음 → browser PRODUCT OPEN.**

| Route | F | Fn | P | Priority | Evidence / 메모 |
| --- | --- | --- | --- | --- | --- |
| `/home` | PASS | PARTIAL | OPEN | P0 | `[MX]` `[E2E]` home-* partial |
| `/start` | PASS | PARTIAL | OPEN | P0 | `[E2E]` start-onboarding-eligibility |
| `/mining` | PASS | PARTIAL | OPEN | P0 | `[MX]` mining PARTIAL; `[E2E]` mining-product |
| `/wallet` | PASS | PARTIAL | OPEN | P0 | `[E2E]` wallet-product |
| `/wallet/deposit` | PASS | PARTIAL | OPEN | P0 | `[MX]` deposit PARTIAL |
| `/wallet/withdraw` | PASS | PARTIAL | OPEN | P0 | `[MX]` withdraw PARTIAL |
| `/events` | PASS | PARTIAL | OPEN | P1 | `[E2E]` events-product |
| `/events/[slug]` | PASS | PARTIAL | OPEN | P1 | fixture OPEN |
| `/events/notices/[slug]` | PASS | PARTIAL | OPEN | P2 | fixture OPEN |
| `/notifications` | PASS | PARTIAL | OPEN | P1 | `[E2E]` notifications-product |
| `/ai` | PASS | PARTIAL | OPEN | P1 | `[E2E]` ai-product |
| `/menu` | PASS | PARTIAL | OPEN | P1 | `[E2E]` menu-product |
| `/menu/account` | PASS | PARTIAL | OPEN | P1 | readiness marker OPEN |
| `/menu/ai` | PASS | PARTIAL | OPEN | P2 | readiness marker OPEN |
| `/menu/notifications` | PASS | PARTIAL | OPEN | P2 | — |
| `/products` | PASS | PARTIAL | OPEN | P1 | `[E2E]` catalog-* |
| `/products/allocation` | PASS | PARTIAL | OPEN | P1 | `[E2E]` catalog-allocation |

**회원 횡단:**

- [ ] **P0** 승인된 LOCAL_QA 절차 + test user로 17 route PRODUCT matrix (states, themes, viewports) — Owner: **Eng + Ops** — **OPEN** (handoff)
- [ ] **P0** P0 money journeys: START → welcome withdrawal (KRW 5,000 cap), deposit, mining settlement UI — Owner: **Eng** — `[E2E]` exists; **PRODUCT OPEN**
- [ ] **P1** Guided onboarding quest → first trial result (no fake progress) — Owner: **Product + Eng** — `PARTIAL`

### 3.3 관리자 (20)

| Route | F | Fn | P | Priority | Evidence / 메모 |
| --- | --- | --- | --- | --- | --- |
| `/login` | PASS | PARTIAL | OPEN | P0 | Visual Lab admin-login 4 captures only |
| `/mfa` | PASS | PARTIAL | OPEN | P0 | fixture OPEN |
| `/reauth` | PASS | PARTIAL | OPEN | P0 | step-up |
| `/session-expired` | PASS | PARTIAL | OPEN | P1 | — |
| `/unauthorized` | PASS | PARTIAL | OPEN | P1 | — |
| `/` (Today) | PASS | PARTIAL | OPEN | P0 | `[E2E]` admin-today |
| `/members` | PASS | PARTIAL | OPEN | P0 | `[E2E]` admin-members-product |
| `/kyc` | PASS | PARTIAL | OPEN | P0 | `[E2E]` admin-kyc-product |
| `/deposits/usdt` | PASS | PARTIAL | OPEN | P0 | `[MX]` FOLLOW_UP canonical table |
| `/deposits/krw` | PASS | PARTIAL | OPEN | P0 | — |
| `/deposits/krw/[id]` | PASS | PARTIAL | OPEN | P1 | fixture OPEN |
| `/withdrawals/krw-bank` | PASS | PARTIAL | OPEN | P0 | `[E2E]` admin-krw-browser-money |
| `/withdrawals/usdt` | PASS | PARTIAL | OPEN | P0 | `[E2E]` admin-usdt-browser-money |
| `/exceptions` | PASS | PARTIAL | OPEN | P0 | `[E2E]` admin-exceptions-* |
| `/restrictions` | PASS | PARTIAL | OPEN | P0 | `[E2E]` admin-restrictions-safe-mode |
| `/economy` | PASS | PARTIAL | OPEN | P1 | `[E2E]` admin-economy-policy |
| `/catalog` | PASS | PARTIAL | OPEN | P1 | operator approval UI |
| `/content` | PASS | PARTIAL | OPEN | P1 | — |
| `/assistant` | PASS | PARTIAL | OPEN | P0 | V1 required (`V1-SCOPE-PRIORITIES.md`) |
| `/ai-conversations` | PASS | PARTIAL | OPEN | P2 | SUPER_ADMIN fixture |

**관리자 횡단:**

- [ ] **P0** AAL2 MFA, step-up, session policy E2E — Owner: **Eng** — `[E2E]` admin-session-totp, admin-withdrawal-step-up
- [ ] **P0** 20 route rendered QA (목업 ZIP 직접 대응 없음 → design system PROPOSED + `[E2E]`) — Owner: **Product** — **OPEN** (handoff)
- [ ] **P1** Operator assistant: read + draft + shared command boundary — Owner: **Eng** — `[E2E]` admin-assistant-*

---

## 4. 비주얼 · 목업 (Visual)

- [ ] **P0** **PUT-9** — 목업 대비 **시각 PASS** (320/390/834, 상태·a11y 매트릭스) — Owner: **Product** — **OPEN** · 경로 인벤토리 초안 **DONE:** `VISUAL-ACCEPTANCE-ROUTE-MATRIX-20261018.md`
- [ ] **P0** Canonical Visual Lab `visual-lab-2026.09.27-v1` gap review (key screens) — Owner: **Product** — Evidence: `docs/design/visual-lab/`
- [ ] **P0** Brand/rank masters: runtime `public/brand/assets.manifest.json`, `public/ranks/rank-01`…`06` — Owner: **Eng** — CI asset gate on candidate
- [ ] **P1** Visual regression + screenshot review (authenticated `success-visual-evidence.spec.ts`, mockup-reference-coverage) — Owner: **Eng** — **OPEN**
- [ ] **P1** Performance budgets (LCP/INP/CLS, mining scene) — Owner: **Eng** — **OPEN**
- [ ] **P2** `.sites/` / `docs/design/generated-masters/*proposed-20261017.png` — reference only, not runtime — Owner: **Product**

**DONE (2026-10-18):** 공개 26 route × 4 theme profile 캡처 JSON 104건 + PNG 정합; `/login` system-light recapture.

---

## 5. 금융 · 법무 · 신뢰 (Money / Legal)

### 5.1 Ledger · money (P0)

- [ ] **P0** Balanced ledger, trial vs real separation, idempotent mutations — Owner: **Eng** — local pgTAP/unit PASS; production `OPEN`
- [ ] **P0** PUTDUK START → one-time KRW conversion **hard cap 5,000**, no funding prerequisite — Owner: **Eng + Product** — `[E2E]` + remote verify `OPEN`
- [ ] **P0** Welcome first withdrawal (KRW/USDT copy: KRW balance basis) — Owner: **Eng** — `[E2E]` first-krw/usdt-withdrawal
- [ ] **P0** Referral auto payout cap (10,000 default split), promotion caps — Owner: **Eng** — rules unit; browser `OPEN`
- [ ] **P0** Outbox + worker: backlog, DLQ, replay runbook — Owner: **Ops + Eng** — worker gate `OPEN`
- [ ] **P1** Treasury reconciliation operator queue — Owner: **Ops** — `OPEN`

### 5.2 KYC · identity

- [ ] **P0** KYC lifecycle + Member 360 source model — Owner: **Eng** — `[E2E]` admin-kyc partial
- [ ] **P0** Withdrawal destination verification, step-up — Owner: **Eng** — `[E2E]` withdrawal-destination-reauth
- [ ] **P1** Phone copy gate (signup availability only) — Owner: **Product** — review on 17 routes

### 5.3 Legal · terms (BLOCKED)

- [ ] **P0** **`/terms`, `/privacy` approved legal body** + versioned consent capture — Owner: **Legal** — **BLOCKED** (handoff: no approved body in repo)
- [ ] **P0** Signup cannot ship as PRODUCT COMPLETE until consent evidence links legal version — Owner: **Legal + Product** — **BLOCKED**
- [ ] **P1** Privacy: wallet/KYC/admin non-indexable, public/protected inventory — Owner: **Eng** — DoD release #14

**금지 (handoff):** 목업의 증권 표현·고정 수익·L5 PRO·DRAFT 카탈로그를 승인 경제값으로 노출.

---

## 6. E2E · QA inventory (WS-05)

Contract: `docs/quality/WS-05-EXECUTION-CONTRACT.md`, `docs/development/E2E-AGENT-WORKFLOW.md`

### 6.1 CI job inventory (merge candidate = 5/5 green)

| Job | Owner | 2026-10-18 |
| --- | --- | --- |
| Application gates | Eng | OPEN on current worktree SHA |
| Database security gates (+ concurrent SQL probes) | Eng | OPEN |
| Browser foundation (`pnpm test:e2e`) | Eng | **LOCAL PASS** 82/82 on `411be7eb` lineage (2026-10-18 WS-05 §9.4 rerun; CI still OPEN) |
| Korean typography public + protected | Eng | PARTIAL (historical develop) |
| Authenticated product gates (12 shard, `E2E_NEXT_START=1`) | Eng | OPEN |
| Worker runtime gates | Eng | OPEN |
| `e2e-app-build` artifact | Eng | OPEN |
| `ci-budget` (20m wall) | Eng | OPEN |

### 6.2 Local prerequisites (2026-10-18)

- [x] **P0** **Docker Desktop** engine ready (`\\.\pipe\dockerDesktopLinuxEngine`) — Owner: **Eng/Ops** — **PASS** (2026-10-18 WS-05 §9.1; Desktop auto-launch + poll)
- [x] **P0** `supabase start` → `node scripts/capture-local-supabase-env.mjs` (+ ephemeral `WITHDRAWAL_DATA_KEY`) — Owner: **Eng/Ops** — **PASS** (2026-10-18 WS-05 §11; `supabase start --ignore-health-check`; API **63421**; capture + key via temp `GITHUB_ENV`)
- [x] **P0** `pnpm test:e2e:auth:smoke` on worktree `411be7eb` + `E2E_NEXT_START=1` — Owner: **Eng** — **PASS** (4/4; attempt **1/2**; `APP_TIMEZONE=UTC` + manual `pnpm start`/`start:admin`; log `launch-verify-e2e-smoke-ws05-20261018-attempt1.log`)
- [x] **P0** Local `pnpm test:e2e` (browser foundation, no Supabase) — Owner: **Eng** — **PASS** 82/82 after killing stale `:3000` (`LAUNCH-VERIFICATION-LOG-20261018.md` §9.4)

### 6.3 Local execution layers (개발 루프)

| Script | Purpose | Owner |
| --- | --- | --- |
| `pnpm test:e2e:auth:last-failed` | 직전 실패만 | Eng |
| `pnpm test:e2e:auth:file -- tests/e2e/authenticated/<file>.spec.ts` | 파일 지정 | Eng |
| `pnpm test:e2e:auth:smoke` / `:admin` / `:krw` / `:usdt` / `:guards` / `:visual` | Domain focused | Eng |
| `pnpm test:e2e:auth:full` | Full regression (merge 전 max 2×/SHA) | Eng |
| `pnpm exec playwright test --config playwright.typography.config.ts` | Typography 63-route declaration | Eng |

### 6.3 Authenticated spec inventory (54 files — domain map)

| Domain | Spec files (representative) | PRODUCT |
| --- | --- | --- |
| Boundary / signup | `public-admin-boundary`, `signup-reconstruction` | OPEN |
| Home / START | `home-start-product`, `home-typography`, `start-onboarding-eligibility`, `home-catalog-materials`, `funded-home-typography` | OPEN |
| Mining | `mining-product`, `member-product-scene` | OPEN |
| Wallet / deposit | `wallet-product`, `deposit-product` | OPEN |
| Withdrawal cluster | `first-krw-withdrawal`, `first-usdt-withdrawal`, `withdrawal-*`, `principal-withdrawal-product`, `welcome-withdrawal-error-copy`, `usdt-manual-full-payout-*` | OPEN |
| Catalog | `products-catalog`, `catalog-*` | OPEN |
| Events / notifications / AI / menu | `events-product`, `notifications-product`, `ai-product`, `menu-product` | OPEN |
| Admin money / ops | `admin-*` (15 specs) | OPEN |
| Visual / mockup | `success-visual-evidence`, `mockup-reference-coverage` | OPEN |
| Support | `support-channel-talk` | OPEN |

- [ ] **P0** Exact candidate에서 full authenticated inventory 1회 + 실패 0 (`--fail-on-flaky-tests`) — Owner: **Eng** — **OPEN**
- [ ] **P0** `db:reset` 직후 full E2E 금지 → focused/`last-failed` 후 stack 안정 시 full — Owner: **Eng** — policy PASS

---

## 7. 명시적 BLOCKED · GAP (handoff)

| ID | 항목 | Owner | 상태 |
| --- | --- | --- | --- |
| B1 | **Login mockup GAP** (PUT-9) — 비주얼/카피/배치 vs 10/4 desktop 목업 | Product + Eng | **BLOCKED** (디자인 결정; `LOGIN-MOCKUP-GAP-DECISION-20261018.md`) |
| B2 | **`/terms`, `/privacy`** — legal review 정본 없음; 가입 설명만으로 대체 금지 | Legal | **BLOCKED** |
| B3 | **Member 17 PRODUCT QA** — LOCAL_QA·승인 test user 없음 | Eng + Ops | **OPEN** |
| B4 | **Admin 20 mockup** — ZIP 직접 대응 없음; PROPOSED 기준 필요 | Product | **OPEN** |
| B5 | **Full CI** on release SHA | Eng | **OPEN** |
| B6 | **Remote Supabase / Cloudflare / DNS** | Ops | **OPEN** (freeze) |
| B7 | **Production coupling UNKNOWN** → remote Git/deploy unsafe until classified | Ops | **OPEN** (Linear **PUT-11** PROD_APPROVAL; repo hooks **0**, environments **0**; auxiliary workflows `cloudflare-compatibility` / `staging-build` YAML 본 run 미검증) |

---

## 8. 병렬 · 직렬 작업 (Workstreams)

| Workstream | 병렬 가능 | 출시 전 직렬 선행 | Owner |
| --- | --- | --- | --- |
| A. UI/mockup gap fix (공개 26, login P0) | B, C, D (로컬) | E (PRODUCT sign-off) | Product + Eng |
| B. Legal terms/privacy | A (placeholder UX only) | **Signup PRODUCT**, release gate | Legal |
| C. Member/admin LOCAL_QA + 17/20 capture | A | Authenticated PRODUCT matrix | Ops + Eng |
| D. Unit/focused E2E + visual specs | A, C | Full CI green | Eng |
| E. PRODUCT-COMPLETE-MATRIX 전 route → P | A–D evidence | **Launch verdict** | Product |
| F. git push + PR + CI (exact SHA) | D (로컬 green 후) | Remote apply/deploy | Eng |
| G. Supabase remote apply | — | F + coupling approval + migration review | Eng + Ops |
| H. Cloudflare staging + smoke | G (DB backward compatible) | DNS cutover approval | Ops |
| I. Release evidence + monitoring + rollback drill | H partial | Production traffic | Ops |

**직렬 critical path (요약):**  
Legal (B2) ∥ UI (A) → LOCAL_QA (C) → DOMAIN PRODUCT (E) → Full CI (F) → Coupling approval → Supabase (G) → Cloudflare/DNS (H) → Release packet (I).

---

## 9. 출시 선언 체크 (최종)

출시 가능 **`LAUNCH READY`** 는 아래 **전부 PASS** 일 때만 Product owner가 서명:

- [ ] **P0** V1 P0 scope (`V1-SCOPE-PRIORITIES.md`) 전 항목 FUNCTIONAL + 해당 UX PRODUCT COMPLETE
- [ ] **P0** 63 routes (26+17+20) PRODUCT column PASS with linked evidence
- [ ] **P0** DEFINITION-OF-DONE release-level 1–18
- [ ] **P0** No **BLOCKED** row remains (§7)
- [ ] **P0** WS-05 CI 5/5 + wall ≤20m on **release SHA**
- [ ] **P0** Remote infra + DNS + smoke + rollback rehearsed
- [ ] **P1** P1 deferrals (if any) documented with flag off + owner (`V1-SCOPE-PRIORITIES.md` release scope rule)

---

## 10. 2026-10-18 스냅샷 (handoff 대비)

| Done | Open |
| --- | --- |
| 104 JSON/PNG mockup capture 정합 | Full CI on candidate |
| `/login` PNG recapture | Login PUT-9 — **BLOCKED** (디자인 결정 문서) |
| `/offline` hydration triage (not product defect) | Terms/privacy **BLOCKED** |
| Vitest trust 12 + domain smoke **84** tests PASS | Member 17 / admin 20 PRODUCT QA |
| `pnpm lint` + `build:web` + `build:admin` PASS (worktree) | Auth member/admin PRODUCT (matrix) |
| Trust landing copy commit `411be7eb` + WS-04/trust vitest spot 30/30 (2026-10-18) | Push/PR/remote/deploy (+15 commits; PR #76 head `0a29487`) |
| Cursor browser `/`, `/login`, `/signup` 200 (dev :3000) | Supabase/Cloudflare/DNS |
| Isolated context + `caret:initial` capture script (D:) | Docker → `auth:smoke` **BLOCKED** |
| `/login` hydration 콘솔 CLOSED (측정 도구; verification log §8) | `LAUNCH-STATUS-SUMMARY-20261018.md` 갱신 주기 |

---

*다음 갱신: exact candidate SHA, CI run ID, §7 BLOCKED 해소 시 evidence link를 채워 넣는다.*
