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
- Worker runtime gates: the same full local stack and database reset, then `pnpm test:worker`.

`playwright.config.ts` does not collect `tests/e2e/authenticated/**`. Authenticated product gates use `playwright.authenticated.config.ts` only.

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
