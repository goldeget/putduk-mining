# Launch verification log — 2026-10-18 (local)

Worktree: `C:\Users\PC\Desktop\putduk-mining\.worktrees\cloud-ui-20261012`  
Branch: `codex/cloud-ui-recovery-20261012`  
Node: **24.21.0** (fnm)  
Operator: automated local verification (no commit / push / merge / deploy / `db:reset` / full auth E2E)

---

## 1. Git / HEAD — 2026-10-18 ~01:41 KST

| Check | Result |
| --- | --- |
| `HEAD` | `9efa9bdab491a11c5d64a2bb66dacf22393d4dc9` — `feat(ui): align product surfaces with approved mockups` |
| Tracking | `codex/cloud-ui-recovery-20261012...origin/codex/cloud-ui-recovery-20261012` (status reported **ahead 7** before fetch; after fetch **14 commits** on `HEAD` not on `origin/codex/cloud-ui-recovery-20261012`) |
| Dirty tree | **YES** — modified: `app/page.tsx`, `lib/trust/public-content.ts`, `tests/unit/trust-content.test.ts`; untracked: `.sites/`, handoff PNGs, `CURSOR_HANDOFF_20261017.md`, etc. |

### PR #76 vs local (`gh pr view 76`)

| Field | Value |
| --- | --- |
| URL | https://github.com/goldeget/putduk-mining/pull/76 |
| State | OPEN |
| Base | `develop` |
| Head branch | `codex/cloud-ui-recovery-20261012` |
| **PR head SHA** | `0a29487ce90d182d67cd2261cd05326aac1dfa97` |
| **Local HEAD SHA** | `9efa9bdab491a11c5d64a2bb66dacf22393d4dc9` |
| Gap | Local is **14 commits ahead** of PR tip (`git log --oneline 0a29487..HEAD` → 14 lines). PR does not include latest local work until push/update. |

---

## 2. Vitest (trust + public discovery) — 2026-10-18 ~01:42 KST

**Command:** `pnpm exec vitest run tests/unit/trust-content.test.ts tests/unit/public-discovery.test.ts`

| Result | Detail |
| --- | --- |
| **PASS** | 2 files, **12/12** tests, ~859ms |
| Artifacts | stdout only (no JSON report) |

---

## 3. ESLint — 2026-10-18 ~01:42–01:45 KST

**Command:** `pnpm lint`

| Result | Detail |
| --- | --- |
| **FAIL** | Exit 1 — `max-warnings=0` |
| Cause | Untracked `.sites/putduk-member-vision-20261017/app.js` — 2 `@typescript-eslint/no-unused-vars` warnings |
| Log | `docs/quality/launch-verify-lint-20261018.log` |

**Note:** Product source lint not isolated in `package.json`; full-repo lint includes untracked `.sites/`. **Follow-up 2026-10-18:** `eslint.config.mjs` `globalIgnores`에 `.sites/**` 추가 → `pnpm lint` **PASS** 재확인.

---

## 4. Production build (member + admin) — 2026-10-18 ~01:45–01:52 KST

| Step | Command | Result | Log |
| --- | --- | --- | --- |
| Member | `pnpm build:web` | **PASS** (~3.1 min compile + TS) | `docs/quality/launch-verify-build-web-20261018.log` |
| Admin | `pnpm build:admin` | **PASS** (~26.7s compile) | `docs/quality/launch-verify-build-admin-20261018.log` |

Member build: 1 Turbopack warning on dynamic `readFileSync` in `scripts/capture-local-supabase-env.mjs` (tracing); not a build failure.

### Documented E2E server mode (not executed end-to-end here)

After successful builds, authenticated smoke expects **prebuilt apps + next start**:

```powershell
Set-Location "C:\Users\PC\Desktop\putduk-mining\.worktrees\cloud-ui-20261012"
# Prerequisites (WS-05): Docker up → `supabase start` → `node scripts/capture-local-supabase-env.mjs` (and ephemeral WITHDRAWAL_DATA_KEY as documented)
$env:E2E_NEXT_START = "1"
# Terminal A — member :3000
pnpm start
# Terminal B — admin :3100 (when spec needs admin boundary)
pnpm start:admin
# Terminal C — smoke only
pnpm test:e2e:auth:smoke
```

---

## 5. E2E auth smoke — 2026-10-18 ~01:52 KST

**Command:** `$env:E2E_NEXT_START="1"; pnpm test:e2e:auth:smoke`

| Result | Detail |
| --- | --- |
| **FAIL (blocked)** | Playwright config exit before tests |
| Error | `NEXT_PUBLIC_SUPABASE_URL is required. CI must provide it. Do not generate a separate fallback key.` |
| Docker | `supabase status` → **Docker daemon not running** (`dockerDesktopLinuxEngine` pipe missing) |
| Log | `docs/quality/launch-verify-e2e-smoke-20261018.log` |

**P0:** Cannot run `test:e2e:auth:smoke` without local Supabase env capture (and Docker).

### WS-05 retry — 2026-10-18 ~02:00 KST

**Operator path:** Docker probe → (if up) project-scoped `supabase start` → `node scripts/capture-local-supabase-env.mjs` → `E2E_NEXT_START=1` → `:3000`/`:3100` next start → `pnpm test:e2e:auth:smoke` only.

| Step | Result | Detail |
| --- | --- | --- |
| Docker daemon | **BLOCKED** | `\\.\pipe\dockerDesktopLinuxEngine` **absent**; `Docker Desktop` process not found; `docker info` / `docker version` **hang** (no server response) |
| `supabase start` | **NOT RUN** | Blocked on Docker |
| `capture-local-supabase-env.mjs` | **NOT RUN** | Blocked on Docker |
| Member `:3000` | **LISTENING** | PID **10152** (pre-existing; `pnpm start` not started this run) |
| Admin `:3100` | **NOT LISTENING** | Would start after Supabase env if Docker were up |
| `pnpm test:e2e:auth:smoke` | **NOT RUN** | Would fail at Playwright env gate without `NEXT_PUBLIC_SUPABASE_URL` |

| Gate | Pass/Fail | Evidence |
| --- | --- | --- |
| E2E auth smoke (WS-05) | **BLOCKED** | No new Playwright run; prior log: `docs/quality/launch-verify-e2e-smoke-20261018.log`; `test-results/` unchanged |

**User action (P0):** Start **Docker Desktop**, wait until the engine is ready (pipe `dockerDesktopLinuxEngine` exists), then re-run WS-05 from `supabase start` in this worktree.

### 5.2 Supabase start failures — 2026-10-18 ~02:08–02:20 KST

| Attempt | Result | Detail |
| --- | --- | --- |
| Parallel `supabase start` (WS-05 agents) | **FAIL** exit 1 | `LegacyContainerCreateError` — race / ghost container `supabase_db_putduk-mining-ci-r2-20261009` |
| `supabase stop` → `supabase start` | **FAIL** | Name conflict on same DB container |
| `docker rm -f supabase_db_…` → `supabase start` | **FAIL** | `LegacyHealthCheckTimeoutError` — kong/auth/… containers missing; REST on `:63421` not ready |
| Log files | | `launch-verify-supabase-start-20261018-ws05.log`, `launch-verify-supabase-start-ws05-20261018.log` |

**P0 (recovery):** worktree에서 `supabase stop` 후, **putduk-mining-ci-r2-20261009** 접두 컨테이너가 남아 있으면 CLI가 안내하는 이름만 `docker rm -f` (전역 inventory 금지). 그다음 **단일** `supabase start` (병렬 start 금지). Ready 후 env capture → smoke.

---

## 6. Optional public UI audit subset — 2026-10-18 ~01:53 KST

**Context:** Port **3000** already listening (PID 10152). D: (`ESD-USB`) available.

**Subset:** `system-light` profile — `/offline`, `/login` only (helper script; canonical capture script is on D:).

| Route | HTTP | consoleErrors | Screenshot |
| --- | --- | --- | --- |
| `/offline` | 200 | none | `D:\PUTDUK-MINING-QA\mockup-ui-audit-20261018-launch-verify\system-light-offline.png` |
| `/login` | 200 | ~~React hydration mismatch~~ → **2026-10-18 triage: Playwright 캡처 오탐** (아래 §8) | `...\system-light-login.png` |

**Artifacts:**

- `D:\PUTDUK-MINING-QA\mockup-ui-audit-20261018-launch-verify\subset-public-route-capture.json`
- `docs/quality/launch-verify-ui-audit-subset-20261018.log`
- Runner: `docs/quality/launch-verify-ui-audit-subset.mjs` (subset only; full matrix remains `D:\PUTDUK-MINING-QA\mockup-ui-audit-20261017-run-03\capture-public-routes.cjs`)

---

## 8. `/login` hydration triage — 2026-10-18 ~02:00 KST

**판정:** 제품 결함 **아님** (Playwright `page.screenshot()` 기본 `caret:hide` 계측 경쟁). `PRODUCT-COMPLETE-MATRIX.md`의 `/wallet/withdraw` hydration **CLOSED**와 동일 분류.

| 조건 | `consoleErrors` (hydration) | 비고 |
| --- | --- | --- |
| Playwright `/login` isolated, **스크린샷 없음** | 0 | |
| Playwright, `screenshot()` **기본 caret** | 1 | diff: hidden `next` + identifier/password input에 `style={{caret-color:"transparent"}}` |
| Playwright, `screenshot({ caret: "initial" })` | 0 | repo E2E·`success-visual-evidence.spec.ts` 패턴 |
| Cursor browser MCP (스크린샷 caret 주입 없음) | 0 | `input[name=next]` SSR markup 정상, inline style 없음 |

**AuthForm 코드:** `app/login/auth-form.tsx` — hidden input은 `name="next"` 1개뿐; 클라이언트 전용 `caret-color`/inline style 없음.

**조치 (측정 도구만):** `docs/quality/launch-verify-ui-audit-subset.mjs`에 `caret: "initial"` 추가. 재실행 로그 `docs/quality/launch-verify-login-hydration-rerun-20261018.log`, JSON `docs/quality/_login-hydration-rerun/subset-public-route-capture.json` — `/login` **consoleErrors []**.

**제품 수정:** 없음 (AuthForm/테마에 `suppressHydrationWarning` 등 fake-fix 금지).

---

## 7. Linear (read-only snapshot)

### PUT-9 — Full Visual Acceptance

- Status: **Backlog** | Priority: Urgent | Labels: `EVIDENCE`, `RELEASE_BLOCKER`
- https://linear.app/putduk-mining/issue/PUT-9/full-visual-acceptance-mockup-truth-vs-browser

### PUT-22 — Cloud Codex UI recovery / integration

- Status: **In Progress** | Priority: High | Parent: PUT-9
- https://linear.app/putduk-mining/issue/PUT-22/cloud-codex-제품-uiux를-최종-기준으로-복구통합전체-수용

### Other `RELEASE_BLOCKER` labels (open)

| ID | Title | Status |
| --- | --- | --- |
| PUT-5 | Authoritative Reward → Balanced Settlement → Wallet Credit | Backlog |
| PUT-6 | Settlement Worker / Retry / Recovery / Reconciliation | In Progress |
| PUT-7 | Authoritative Live Snapshot | Backlog |
| PUT-9 | Full Visual Acceptance | Backlog |
| PUT-10 | Staging Acceptance + Independent Audit + RC Exact SHA | Backlog |
| PUT-11 | Production Authorization → Release → Smoke → Monitoring | Backlog |
| PUT-12 | PostHog Production Observability | In Progress |
| PUT-14 | Supabase Remote Baseline Not Initialized | Backlog |
| PUT-15 | Load / Latency / Capacity Acceptance | Backlog |

---

## P0 failures / blockers (this run)

1. ~~**E2E auth smoke not executed**~~ → **CLOSED (WS-05 §11)** — smoke 4/4 PASS; full authenticated inventory still OPEN.
2. **`pnpm lint` FAIL** — untracked `.sites/` warnings under `--max-warnings=0` (gate noise unless scoped).
3. ~~**`/login` hydration console error**~~ → **CLOSED (Playwright caret 오탐, §8)** — launch UX 제품 리스크 아님.
4. **PR #76 head (`0a29487`) ≠ local HEAD (`9efa9bd`)** — 14 local commits + dirty tree not on PR; RC/CI alignment unknown for this exact tree.
5. **Linear release blockers** (PUT-9 visual acceptance, PUT-10 staging/RC, PUT-11 prod authorization, PUT-14 remote DB, etc.) remain open — not closed by this verification.

---

## Summary table

| Gate | Pass/Fail | Evidence |
| --- | --- | --- |
| Git HEAD verify | OK (with drift notes) | This file §1 |
| Vitest trust + discovery | **PASS** | §2 |
| `pnpm lint` | **PASS** (2026-10-18 ~02:00 KST rerun) | `docs/quality/launch-verify-lint-20261018.log` |
| `pnpm build:web` | **PASS** (2026-10-18 ~02:05 KST rerun) | `docs/quality/launch-verify-build-web-20261018.log` |
| `pnpm build:admin` | **PASS** (2026-10-18 ~02:05 KST rerun) | `docs/quality/launch-verify-build-admin-20261018.log` |
| Vitest domain smoke (9 files, 84 tests) | **PASS** | `docs/quality/launch-verify-vitest-domain-smoke-20261018.log` |
| Prettier (3 dirty + eslint.config.mjs) | **PASS** | — |
| Browser MCP `/`, `/login`, `/signup` | **PASS** (render) | dev :3000; handoff 2026-10-18 |
| `test:e2e:auth:smoke` | **PASS** (WS-05 §11) | `docs/quality/launch-verify-e2e-smoke-ws05-20261018-attempt1.log` |
| UI audit subset | **PARTIAL** (login console → CLOSED §8) | `D:\PUTDUK-MINING-QA\mockup-ui-audit-20261018-launch-verify\` |
| `/login` PUT-9 visual | **BLOCKED** (design decision) | `LOGIN-MOCKUP-GAP-DECISION-20261018.md` |

---

## 9. Launch workstream rerun — 2026-10-18 ~02:06 KST

**Scope:** local only; no commit/push.

| Check | Result |
| --- | --- |
| `packages/domains` | **N/A** — monorepo에 해당 패키지 없음; 대신 `tests/unit` domain smoke 9 files (§ summary table) |
| PUT-9 `/login` | Documented **BLOCKED** — options A/B/C; no visual rewrite |

---

## 10. WS-05 path — 2026-10-18 ~02:40 KST (Docker up, Supabase blocked)

**Worktree:** `cloud-ui-20261012` only · no push/merge/deploy/remote Supabase/Cloudflare · no `db:reset` · no full auth suite · auth smoke max 2 runs → **0 runs**.

### 10.1 Docker probe (3× ~30s apart)

| Attempt | Pipe `dockerDesktopLinuxEngine` | Server |
| --- | --- | --- |
| 1 | absent | `docker info` → pipe missing |
| 2 | (after `Docker Desktop.exe` launch) | hang ~82s then **29.8.2** |
| 3 | **True** | engine ready |

### 10.2 Project-scoped Supabase (`putduk-mining-ci-r2-20261009`, API **63421** / DB **63422**)

| Step | Result | Evidence |
| --- | --- | --- |
| `supabase start` | **FAIL** (multiple retries) | `docs/quality/launch-verify-supabase-start-20261018-ws05*.log` — `LegacyContainerCreateError`, `LegacyDbConnectError`, `LegacyMigrationApplyError`, `LegacyHealthCheckTimeoutError`, `LegacyDbSetupError exit 1` |
| `supabase stop` / `stop --no-backup --yes` | ran between retries | project filter `putduk-mining-ci-r2-20261009` |
| `supabase status -o env` | **FAIL** | DB container missing/unhealthy |
| `node scripts/capture-local-supabase-env.mjs` | **NOT RUN** | needs healthy stack + `GITHUB_ENV` |
| Ephemeral `WITHDRAWAL_DATA_KEY` | **NOT RUN** | blocked with capture |

**판정:** Authenticated WS-05 **HARD BLOCKED** — engine OK, worktree Supabase stack never capturable.

### 10.3 App servers + auth smoke

| Step | Result | Detail |
| --- | --- | --- |
| Stop stale `:3000` PID **10152** | **DONE** | stale `next start` caused false public E2E failures when reused |
| `E2E_NEXT_START=1` + `pnpm start` / `pnpm start:admin` | **NOT RUN** | blocked on Supabase env |
| `pnpm test:e2e:auth:smoke` | **NOT RUN** | Playwright env gate |

### 10.4 Fallback — `pnpm test:e2e` (browser foundation)

| Run | Result | Log |
| --- | --- | --- |
| 1 (reuse :3000 PID 10152) | **FAIL** 73/82 | `docs/quality/launch-verify-e2e-public-20261018-ws05.log` |
| 2 (fresh `pnpm dev`) | **PASS** **82/82** (~3.1m) | `docs/quality/launch-verify-e2e-public-20261018-ws05-rerun.log` |

### 10.5 WS-05 gate table

| Gate | Pass/Fail | Evidence |
| --- | --- | --- |
| Docker engine | **PASS** | §10.1 |
| Local Supabase + env capture | **BLOCKED** | §10.2 |
| `test:e2e:auth:smoke` | **BLOCKED** | §10.3 |
| `pnpm test:e2e` | **PASS** (rerun) | §10.4 run 2 |

**P0 next (superseded by §11):** stabilize Docker → `supabase start` until `supabase status -o env` OK → CI-style capture + withdrawal key → `E2E_NEXT_START=1` → `pnpm test:e2e:auth:smoke` only.

---

## 11. WS-05 execution — 2026-10-18 ~02:52 KST (COMPLETE)

**Worktree:** `cloud-ui-20261012` · HEAD `9efa9bd` · no commit/push/full auth E2E/`db:reset`.

| Step | Result | Evidence |
| --- | --- | --- |
| Docker pipe + Server **29.8.2** | **PASS** | user-confirmed + §10.1 |
| `supabase start --ignore-health-check` | **PASS** | `docs/quality/launch-verify-supabase-start-ws05-20261018-attempt8.log` — migrations + seed; API `http://127.0.0.1:63421` |
| `node scripts/capture-local-supabase-env.mjs` | **PASS** | temp `%TEMP%\\putduk-ws05-github-env.txt` + `GITHUB_ACTIONS=true`; `docs/quality/launch-verify-capture-env-ws05-20261018.log` |
| Ephemeral `WITHDRAWAL_DATA_KEY` | **PASS** | `docs/quality/launch-verify-withdrawal-key-ws05-20261018.log` |
| Stop stale `:3000` | **PASS** | prior dev/start PID cleared |
| `E2E_NEXT_START=1` `pnpm start` + `pnpm start:admin` | **PASS** | `launch-verify-member-start-ws05-20261018.log`, `launch-verify-admin-start-ws05-20261018.log` — requires **`APP_TIMEZONE=UTC`** |
| `pnpm test:e2e:auth:smoke` | **PASS** **4/4** (~7s) | attempt **1/2**; `E2E_REUSE_SERVER=1`; `launch-verify-e2e-smoke-ws05-20261018-attempt1.log` |

**Notes:** 초기 `supabase start`(health check 기본)는 Windows Docker에서 `LegacyHealthCheckTimeoutError`/`LegacyMigrationApplyError`로 여러 번 실패(§10.2). `--ignore-health-check` 단일 실행으로 스택 green. Playwright 1차 실패는 `APP_TIMEZONE` 누락으로 `next start` instrumentation ZodError — UTC 설정 후 재기동·smoke PASS.

| Gate | Pass/Fail | Evidence |
| --- | --- | --- |
| WS-05 local prerequisites | **PASS** | this §11 |
| `test:e2e:auth:smoke` | **PASS** | attempt1 log |

---

## Summary table (additions 2026-10-18 ~02:40 KST)

| Gate | Pass/Fail | Evidence |
| --- | --- | --- |
| `pnpm test:e2e` (local, fresh dev) | **PASS** 82/82 | §10.4 run 2 |
| `test:e2e:auth:smoke` | **PASS** (4/4) | §11 |

---

## 12. E2E automation rerun — 2026-10-18 ~02:50–02:58 KST

**Worktree:** `cloud-ui-20261012` only · **commit authorized** (no push) · no `db:reset` · auth smoke **attempt 1/2**.

| Step | Result | Detail |
| --- | --- | --- |
| Docker **29.8.2** | **PASS** | `docker version` server OK |
| `supabase stop` → `supabase start` | **PASS** | project `putduk-mining-ci-r2-20261009`; API `http://127.0.0.1:63421`; ~65s from backup |
| `node scripts/capture-local-supabase-env.mjs` | **PASS** | temp `GITHUB_ENV` + `GITHUB_ACTIONS=true` (values not logged) |
| Ephemeral `WITHDRAWAL_DATA_KEY` | **PASS** | `write-ephemeral-withdrawal-key.mjs` via temp `GITHUB_ENV` |
| Stale `:3000`/`:3100` cleared | **PASS** | `Get-NetTCPConnection` stop |
| Auth smoke | **PASS** **4/4** (~11.4s) | `E2E_NEXT_START=1`, ports 3000/3100; `node scripts/run-local-authenticated-e2e.mjs --project=chromium tests/e2e/authenticated/public-admin-boundary.spec.ts` (Playwright webServer next start; `APP_TIMEZONE=UTC` via isolated env) |
| `pnpm lint` | **PASS** | ~144s |
| `pnpm build:web` / `build:admin` | **PASS** | post-smoke rebuild |
| Vitest trust + discovery | **PASS** | 12/12 (2 files) |

**Notes:** Member webServer logged `NoFallbackError` on some admin-path probes; smoke assertions still **PASS**. Domain smoke 84 tests not re-run this slice (prior log `launch-verify-vitest-domain-smoke-20261018.log`).

| Gate | Pass/Fail | Evidence |
| --- | --- | --- |
| WS-05 local prerequisites | **PASS** | this §12 |
| Application gates (lint + build + unit trust/discovery) | **PASS** | stdout this run |
| `test:e2e:auth:smoke` | **PASS** | attempt **1/2** |

---

## Summary table (additions 2026-10-18 ~02:58 KST)

| Gate | Pass/Fail | Evidence |
| --- | --- | --- |
| E2E automation §12 (full A+B slice) | **PASS** | §12 |

_End of log._
