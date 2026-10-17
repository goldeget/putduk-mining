# WS-05 execution contract

Baseline: `develop` `a949388195eaabd9734440c0df180377100a1bcc`.

WS-04 is closed and not `PRODUCT COMPLETE`. Launch verdict remains `NOT LAUNCH READY`.

## Shared ownership

Only the parent lead edits:

- `.github/workflows/ci.yml`
- root `package.json` test scripts
- `playwright.config.ts`
- `playwright.authenticated.config.ts`
- `vitest.worker.config.ts`
- `tests/e2e/fixtures/**`
- `scripts/capture-local-supabase-env.mjs`
- this document and final release evidence

Existing Browser foundation stays on `playwright.config.ts` and `pnpm test:e2e`. Do not fold those smoke tests into the authenticated suite.

## CI jobs

Keep Application gates, Database security gates, and Browser foundation.

Add:

- Authenticated product gates: `supabase start` (not `db start`, which leaves the API stopped), `pnpm db:reset`, `node scripts/capture-local-supabase-env.mjs`, one ephemeral `WITHDRAWAL_DATA_KEY`, Chromium, public app `127.0.0.1:3000`, admin app `127.0.0.1:3100`, `pnpm test:e2e:authenticated`.
- Worker runtime gates: the same full local stack and database reset, then `pnpm test:worker`. Vitest writes `test-results/worker/vitest.json`; `scripts/assert-worker-report.mjs` checks current, nonempty, complete execution and emits the sanitized `test-results/worker/report.json`. CI must upload this actual report as `worker-runtime`; missing evidence fails the job. Focused executions with unselected/skipped tests remain focused evidence, not full worker acceptance.

`playwright.config.ts` does not collect `tests/e2e/authenticated/**`. Authenticated product gates use `playwright.authenticated.config.ts` only.

### Concurrent runtime probes

These probes stay inside existing jobs. They do not add required job names, replace a full suite or change the whole-workflow 20-minute ceiling.

| Existing job | Probe | Required behavior |
| --- | --- | --- |
| Database security gates | `supabase/tests/database/admin_security_auth_replay.sql` | Session replay cannot extend or revive expiry; aged failures and unfinished reservations stop charging admission after 15 minutes, while failures inside the window still deny it. Dated rollback fixtures avoid a 15-minute test wait. |
| Database security gates | `supabase/tests-concurrent/krw_deposit_concurrent_approval.sql` | Two independent sessions approve one KRW deposit without duplicate money. |
| Database security gates | `supabase/tests-concurrent/usdt_deposit_concurrent_approval.sql` | Two independent sessions approve one manual USDT deposit without duplicate money. |
| Database security gates | `supabase/tests-concurrent/safe_mode_concurrent_command.sql` | Competing safe-mode commands preserve the real command boundary. |
| Database security gates | `supabase/tests-concurrent/withdrawal_member_lock_order.sql` | Actual finalize and release wait for the member advisory lock before holding request/wallet rows; a second session proves those rows remain obtainable with `NOWAIT`. Both terminal journals complete and remain balanced. |
| Database security gates | `scripts/assert-economy-policy-reader-concurrency.mjs` | Real publish/read commit, rollback and isolation-level cases preserve the published policy boundary. |
| Worker runtime gates | `scripts/assert-admin-auth-admission-concurrency.mjs` | With four existing failures, 20 simultaneous requests admit exactly one and deny 19; success releases the reservation, repeated failure completion is idempotent, and the fifth failure closes admission. |

The database job resets its disposable database after the ordinary pgTAP suite, then runs all four two-session SQL probes before the policy-reader probe. The withdrawal probe targets only `supabase_db_putduk-mining` or `supabase_db_putduk-mining-clean`, bounds its connection/lock/query waits and disconnects its named sessions on success or failure. Its independent sessions commit synthetic fixtures; do not delete append-only financial history or run it against a persistent database.

The worker job starts the full isolated local stack, resets it and captures validated CLI credentials before the auth-admission probe. That step sets `APP_ENV=test` explicitly; env capture does not set it. The probe rejects non-local API origins and wrong ports/projects before constructing a client and bounds each fetch to 10 seconds while preserving caller cancellation. A unique hashed bucket keeps its append-only test security events separate from other fixtures. Successful reservations are released through the real command; unfinished attempts retain the normal 15-minute budget window, whose expiry is checked by the ordinary pgTAP suite. The disposable runner owns fixture removal; no production cleanup or remote action is authorized by these checks.

## Authenticated E2E 실행 계층 (FAST / FOCUSED / FULL)

개발 루프에서 Authenticated product full gate(수십 분)를 매 수정마다 돌리지 않는다.
assertion·spec·coverage를 줄이지 않고, **수집 범위만** 스크립트로 좁힌다.
`playwright.authenticated.config.ts`의 full regression 설정(`workers: 1`, `fullyParallel: false`, chromium / mobile-chrome / visual-evidence)은 유지한다.
money/auth spec은 공유 DB race를 막기 위해 workers를 올리지 않는다. 무리한 병렬 fixture도 금지한다.

### FAST (변경 직후)

별도 e2e 전체 스위트가 아니다. 변경 직후에는 다음을 쓴다.

1. `pnpm typecheck` / `pnpm lint`
2. 해당 unit / worker 테스트
3. 바뀐 authenticated spec 하나 → 아래 FOCUSED 스크립트, 또는  
   `pnpm test:e2e:auth:one -- tests/e2e/authenticated/<파일>.spec.ts`  
   (`auth:one`은 chromium만; 경로를 넘기지 않으면 chromium 프로젝트 전체가 잡히므로 반드시 파일을 지정한다. skip/삭제용 스크립트가 아니다.)

### FOCUSED (single fix / domain)

| 스크립트 | 수집 | project |
| --- | --- | --- |
| `pnpm test:e2e:auth:smoke` | `public-admin-boundary.spec.ts` | chromium |
| `pnpm test:e2e:auth:admin` | `admin-session-totp.spec.ts` | chromium |
| `pnpm test:e2e:auth:krw` | `first-krw-withdrawal.spec.ts` | chromium |
| `pnpm test:e2e:auth:usdt` | `first-usdt-withdrawal.spec.ts` | chromium |
| `pnpm test:e2e:auth:guards` | `withdrawal-negative-guards.spec.ts` | chromium |
| `pnpm test:e2e:auth:visual` | `success-visual-evidence.spec.ts` | visual-evidence |

기준:

- **single fix** → focused 하나(chromium, 해당 spec, visual 제외).
- **feature batch** → 관련 domain 스크립트를 순차로 묶는다. assertion은 그대로 두고, visual은 UI/CSS 또는 Product Closure checkpoint일 때만 `test:e2e:auth:visual`을 돌린다.
- focused 스크립트는 visual-evidence 파일을 넘기지 않는다. visual은 전용 스크립트와 FULL에만 남긴다.

### FULL (PR merge candidate)

| 스크립트 | 의미 |
| --- | --- |
| `pnpm test:e2e:authenticated` | CI Authenticated product gates가 쓰는 full regression |
| `pnpm test:e2e:auth:full` | 위와 동일 설정·동일 수집(편의 alias) |

FULL은 chromium + mobile-chrome + visual-evidence, `workers: 1`을 유지한다.
CI는 full을 제거하거나 focused로 대체하지 않는다. merge 전 Application / Database / Browser / Authenticated full / Worker **5/5 green**이 필수다.
이 계층만으로 `PRODUCT COMPLETE` 또는 `LAUNCH READY`를 주장하지 않는다.

`capture-local-supabase-env.mjs` reads `supabase status -o env` from stdout and stderr, maps the Supabase CLI 2.113.0 status names (`API_URL` / `api.url`, `PUBLISHABLE_KEY` / `auth.publishable_key`, `SECRET_KEY` / `auth.secret_key`, plus the deprecated anon and service-role tags from that CLI), and writes `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` to `GITHUB_ENV`. It refuses `osrmyjgmpdspdcwqjwuv`, non-local hosts, and https. Secret values are not printed.

Authenticated product gates generate one `WITHDRAWAL_DATA_KEY` with `crypto.randomBytes(32)` base64, store it only in `GITHUB_ENV`, and pass that same value to Playwright, the public app, and the admin app. Playwright does not create a second random key.

Service role may create confirmed users, seed roles, and move test clocks. It must not insert the final welcome conversion, hold, external send, or ledger finalization and then call that a browser result.

## Worktrees after this commit

- A `ws05/admin-auth-security`: admin session enforcement, step-up consumption, TOTP browser flow. Sole migration author.
- B `ws05/user-first-withdrawal`: START to first KRW and USDT withdrawal browser journeys. No migrations.
- C `ws05/authenticated-visual`: authenticated screen polish and screenshots. No schema or money API edits.
- D `ws05/worker-runtime`: worker cycle, `--once`, handlers, and execution tests. No migrations. Ask A if a lease heartbeat RPC is missing.

The current `tests/worker/runtime-evidence.test.ts` only proves the claim entrypoints exist. It is not worker execution evidence. D must add process-level assertions without deleting that floor.

## User-facing mining language

Say `채굴`. Do not use `가상 채굴`, simulated mining, or explain mining with backend, server, ledger, or rule-engine words in user-visible copy. Architecture docs, migrations, workers, and comments stay out of that scan.
