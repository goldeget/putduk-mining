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

`capture-local-supabase-env.mjs` reads `supabase status -o env` and exports only the local API URL, publishable key, and service-role key. It refuses `osrmyjgmpdspdcwqjwuv`. Keys are not committed.

Service role may create confirmed users, seed roles, and move test clocks. It must not insert the final welcome conversion, hold, external send, or ledger finalization and then call that a browser result.

## Worktrees after this commit

- A `ws05/admin-auth-security`: admin session enforcement, step-up consumption, TOTP browser flow. Sole migration author.
- B `ws05/user-first-withdrawal`: START to first KRW and USDT withdrawal browser journeys. No migrations.
- C `ws05/authenticated-visual`: authenticated screen polish and screenshots. No schema or money API edits.
- D `ws05/worker-runtime`: worker cycle, `--once`, handlers, and execution tests. No migrations. Ask A if a lease heartbeat RPC is missing.

The current `tests/worker/runtime-evidence.test.ts` only proves the claim entrypoints exist. It is not worker execution evidence. D must add process-level assertions without deleting that floor.

## User-facing mining language

Say `채굴`. Do not use `가상 채굴`, simulated mining, or explain mining with backend, server, ledger, or rule-engine words in user-visible copy. Architecture docs, migrations, workers, and comments stay out of that scan.
