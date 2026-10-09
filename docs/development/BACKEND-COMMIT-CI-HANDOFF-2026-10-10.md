# Backend review R2: commit and CI handoff

## Authority and scope

The owner explicitly authorized reviewed commits, GitHub push and CI completion on 2026-10-09. The target is only `goldeget/putduk-mining`, feature branch `codex/backend-review-r2-ci-20261009`, with a PR to `develop`. Merge, deployment, remote database changes, real payouts, paid AI requests and authentication changes remain unauthorized.

The original Desktop source and earlier review checkouts remain protected. This branch starts at `c08a59c20213c85a166f4338539804603faa5e69`. It integrates the 66 explicitly inventoried R2 paths, preserving their original bytes in seven commits. Temporary `.putduk-cloud` helpers, raw archives, credentials, caches, generated output and unreviewed historical lanes are excluded. The original administrator Korean record-label changes already exist in the newer candidate; they are not reapplied over later work.

## Reviewed source and changes

The preserved R2 source manifest digest is `a4bb9fe048e54cde09d8487715c60c5de4c4e213deb14b74f6e30caf138e4463`. These commits retain the reviewed work:

| Concern | Commit |
| --- | --- |
| Common AI admission and fallback | `5d25593f5b905b612a38a005c62c1a6215b37072` |
| Administrator conversation context | `cb578a83189010fb4dd411686eaa3b73cfcb6843` |
| Coupled financial scheduler/referral/cash flow | `57edd751e6c0f8ae2d9db4db0c65c0ce9ec788fb` |
| Withdrawal coverage aggregate | `6eefa1d6f074d7294d9e48435da9bf7c56315504` |
| Push acknowledgement validation | `ef6c1da934bd9c7faa1067cfb4674324637ec6d1` |
| Member-facing public facts | `6c39efe40ad7b1616b2cfc482dc14ee1322b82b3` |
| Native roster and final182 source binding | `73b0ed285f597a0e019d05a44b113e8627f53771` |

The subsequent CI repair retains all 182 earlier migration files and all five frozen source maps. A forward-only migration removes two unused declarations, explicitly casts the fixed JSON literal and corrects notification-copy volatility to STABLE. Function signatures, owners, ACLs, qualification rules, financial posting and consent boundaries remain intact.

The CI source successor is `tests/e2e/fixtures/principal-review-r2-ci-source.json`, pinned by the existing guard. It binds 183 migrations and 29 runtime/configuration files. It retains rejection of missing, extra, altered, caller-rehashed and escaped sources. The project identity is `putduk-mining-ci-r2-20261009`, API `127.0.0.1:63421`; configuration and the browser guard use the same identity. These values identify disposable test infrastructure, never a hosted database.

The home-page desktop grid rule moves from a global-only CSS Modules selector into global CSS without changing its selector, declaration or breakpoint. This resolves the production bundler's pure-selector restriction while retaining layout intent.

SQL files retain their reviewed bytes across Windows and Linux. Git attributes recognize CRLF line endings as line endings. One specifically named, already-applied principal migration retains its historical blank-line space; its digest is preserved. Ordinary trailing-space, conflict-marker and exact-diff checks remain enabled.

## Remote action coupling

Read-only checks on the exact repository and exact Supabase project `osrmyjgmpdspdcwqjwuv` found GitHub Pages disabled, no repository webhooks/environments/deployments, and Supabase production deployment and automatic PR branching both disabled. Installed apps are ChatGPT Codex Connector, Cursor and Supabase. No integration settings were changed. The feature push/PR is isolated from production deployment. Recheck before merge or any later action; this is not deployment approval.

## Evidence and remaining boundaries

Before CI repair, the current local full unit run passed 2,487 tests with four existing opt-in skips. This is baseline evidence, not CI acceptance of the later commit. An overlapping repeat hit resource-related asset-test timeouts and was not accepted. Final CI must provide independent exact-candidate results, all required jobs/artifacts and whole-attempt duration within 20 minutes. Do not combine jobs from different attempts, weaken assertions or accept flaky retries.

Review evidence is stored separately under the authorized QA volume in `backend-commit-ci-20261009-2352`. Source snapshots and earlier QA records remain unchanged. CI is pending at the time this handoff is written; use the PR's actual final checks and the separate final delivery receipt for the observed outcome.

Cash configuration remains disabled. The controlled-history referral stage-two test does not prove a natural 24-hour journey. Source preservation, unit tests and CI do not establish Cloud-original fidelity, complete product journeys, production financial approval or launch readiness.

## First CI findings

At head `c0c340c34ea782616549a9a9fc97ef305f3a494c`, run `37949831402` passed Application, production build, worker, exact-diff and server-lifecycle gates. The public typography lane executed all 119 current tests with 110 screenshots, zero hydration findings and zero unexpected failures. Its count assertion still required the older 115-test inventory. The workflow now requires exactly 119, retaining the 110 screenshot count and every failure/flaky/skip check; the dependency graph, eight shards and 20-minute ceiling are unchanged.

The foundation test also expected the old signup title `계정 만들기`. The canonical current signup experience renders `회원가입`. The corrected test requires that exact level-one heading and the accessible signup form, retaining all field and consent checks. These are corrections to stale CI contracts, not product redesign or reduced acceptance.

The native suite executed 5,147 assertions successfully, but the remaining 33-assertion reconciliation file failed before its first assertion. Its same-server dblink fixture cast an `inet` address to text, retaining `/32` and producing an invalid host. It now uses `pg_catalog.host(inet_server_addr())` to obtain the same server's bare IP. The exact-project fallback, real second session, lock contention and all 33 assertions are retained. PostgreSQL documents both representations in its [network address functions](https://www.postgresql.org/docs/17/functions-net.html).
