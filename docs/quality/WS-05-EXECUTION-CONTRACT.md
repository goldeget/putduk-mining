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

- Authenticated product gates: local `pnpm db:start`, `pnpm db:reset`, `node scripts/capture-local-supabase-env.mjs`, Chromium, public app `127.0.0.1:3000`, admin app `127.0.0.1:3100`, `pnpm test:e2e:authenticated`.
- Worker runtime gates: the same local database reset, then `pnpm test:worker`.

`playwright.config.ts` does not collect `tests/e2e/authenticated/**`. Authenticated product gates use `playwright.authenticated.config.ts` only.

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
