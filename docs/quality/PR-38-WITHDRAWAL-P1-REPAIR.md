# PR #38 — general withdrawal P1 implementation evidence

Date: 2026-09-30. Authorized repository: `goldeget/putduk-mining`.
Blocked baseline: `d6a2e0797acbf61aa827d752e734f3f7f6f028c3`.
Base: `82de2c83ffa59d94b9782cb83162f83fcba42d46` (`develop`).
Protected `main`: `fbea85eebf1084bfc02bf1c452392b20f2f497ce`.

This is implementation and local evidence for an independent re-audit. It is
not merge approval, product completion, performance acceptance or release
approval. Remote Supabase, Cloudflare, DNS and production data were not touched.
The existing PR remains unmerged. Current-head CI evidence belongs in the PR
description after that exact run succeeds; old run `36666158240` is insufficient.

## Confirmed defects and repair

- New material and its registered ID previously produced different logical
  identities. A response-lost committed hold could become a new request on reload.
- The form previously read destination material after awaiting registration,
  when disabled inputs were absent from `FormData`.
- Failed persistent writes previously fell back to memory; a later null read
  could lose the key. Memory could not guarantee reload protection.
- Button disabling did not serialize separate tabs. A second tab's successful
  acknowledgement could clear shared storage while an older tab still retried.

The [lifecycle design](../architecture/WITHDRAWAL-LOGICAL-LIFECYCLE.md) maps the
real form → registration → hold → frozen domain commands → request → balanced
hold → outbox → receipt → member history path. The repair reuses the existing
server `value_fingerprint`; it does not introduce a client money hash or a
second ledger engine.

The server prepares one unresolved record per owner with a random opaque key.
Owner advisory locks, row locks and the partial unique index serialize prepare,
bind, hold and resolution. Registration plus binding and hold plus outcome each
commit atomically. Existing registration and money commands remain authoritative.

The browser snapshots input synchronously before pending or the first await.
Its v2 owner-scoped localStorage record contains only safe lifecycle fields.
Exact write/read-back verification precedes registration and hold. No memory-only
send fallback exists. A known key in an already-open tab is only a reconciliation
pointer: it must resolve a validated server record, not authorize money.

States are PREPARED, DESTINATION_REGISTERED, OUTCOME_UNCERTAIN, CONFIRMED,
DEFINITIVELY_REJECTED and CANCELLED. The 24-hour TTL never silently rotates a
key. Expired uncommitted state needs explicit serialized cancellation; committed
state remains recoverable. Cancellation/rejection checks committed money first.
Exact acknowledgement permits a later legitimate identical withdrawal with a
new random key. An old-key replay still returns its original request.

## Migration and privilege audit

New CLI-generated migration:
`20260930052429_withdrawal_logical_lifecycle.sql`.

- Table `public.withdrawal_logical_requests`: RLS enabled and forced; no raw
  bank number, holder name, wallet address or cipher-envelope column.
- PUBLIC, anon and authenticated table access revoked. service_role receives
  SELECT/INSERT/UPDATE, not DELETE.
- `app_private.withdrawal_logical_record` is the safe serialization helper.
- Four public orchestration RPCs: `prepare_withdrawal_logical_request`,
  `bind_withdrawal_logical_destination`, `hold_withdrawal_logical_request`,
  `resolve_withdrawal_logical_request`.
- All five functions use SECURITY INVOKER and `search_path = pg_catalog`.
  PUBLIC/anon/authenticated EXECUTE revoked; service_role EXECUTE granted.
- No existing RLS policy, function grant, destination protection rule or
  SECURITY DEFINER function was broadened or replaced.
- The frozen `register_*_destination`, `request_*_withdrawal`, hold/release/
  finalize, welcome conversion and ledger definitions are unchanged.

API ownership comes only from verified server authentication. Safe responses
exclude raw/encrypted destination material. Server SQL errors become bounded
Korean copy. Policy selection is server-validated; client amount or cache state
cannot bypass ownership, safe mode, protection, limits, eligibility or balance.

## Real browser / real DB evidence

Preserved evidence is under [pr38-withdrawal-p1-evidence](pr38-withdrawal-p1-evidence/README.md).
JSON was queried before cleanup, scoped by owner, logical key, withdrawal ID and
its related ledger/outbox/receipt IDs. Screenshots are actual Chromium captures,
not mockups. Only synthetic disposable fixtures are included. Sensitive input
controls are masked in the capture helper. Traces, videos, credentials and raw
error-context files are excluded from committed evidence.

| Case | Proven invariant |
| --- | --- |
| KRW new destination + committed hold response loss | Same first/retry key and destination; one request/hold/outbox/receipt; unchanged protection and history |
| USDT new destination + committed hold response loss | Same invariants, with canonical network/address fingerprint preserved |
| KRW and USDT registration response loss | Zero money before recovery; one original destination; explicit registration replay keeps protection/history; final effects 1/1/1/1 |
| Both methods: write throws / read returns null | Submission blocked with safe Korean copy; zero prepare/register/hold calls and zero intent/destination/money effects |
| Multi-tab, close/reopen, stale tab after acknowledgement | Same pending key; acknowledgement in another tab does not make old retry new money |
| A logout → B login | Owner namespaces separate; B's direct hold using A's key denied; A's money unchanged |
| Expired uncommitted intent | No registration/hold until explicit safe cancellation; later intent has a new key |
| Corrupt cache without server state | Fails closed; no replacement key or money |
| Corrupt cache + expired committed server intent | Recovers the old server key; exactly one effect set |
| Later explicit identical withdrawal | New random key allowed only after the original acknowledgement; one effect set per distinct intent |

Destination/protection expectations are unchanged, including first-destination
eligibility and the replacement cooldown. No fake funding or balance calculation
was added. Browser storage fault injection lives only in the test's browser
`Storage.prototype`; no production debug API or failure seam was introduced.

## Local verification

All local Supabase commands were guarded by the fresh repository-scoped
`putduk-mining-pr38-p1` configuration. Its containers/volume were freshly created;
no prior project data was read or reused. Non-default ports 59421/60432 and
3451/3452 avoided existing current-repository services. Temporary local config
and foundation host override are excluded from the commit.

The existing reconciliation pgTAP uses a fixed peer DB hostname. Only this
fresh project's network received matching aliases; other networks/containers
were not inspected or changed.

| Command | Evidence |
| --- | --- |
| `pnpm exec vitest run tests/unit/withdrawal-logical-request.test.ts tests/unit/withdrawal-form-markup.test.ts tests/unit/ws04-security-money.test.ts` | 3 files / 47 tests passed; 37 lifecycle tests |
| `node scripts/run-local-authenticated-e2e.mjs --verify` (`pnpm verify`) | 84 brand assets; formatting/lint/both typechecks; web 44 files / 344 tests; admin 9 files / 40 tests; both production builds and bundle separation passed |
| `pnpm exec supabase db reset --local --yes` | All 45 migrations rebuilt from zero, including the new migration |
| `pnpm db:test` | 17 files / 413 assertions passed, including 43 new lifecycle assertions |
| `pnpm db:lint` | No schema errors, warning-fail gate passed |
| `pnpm db:advisors` | No security issues, warning-fail gate passed |
| `node scripts/run-local-authenticated-e2e.mjs --worker` | 1 file / 17 runtime tests passed |
| Focused withdrawal Chromium | All 13 new P1 cases and the original registered-destination response-loss case passed again after masking, exact effect-ID scoping and tab-close/reopen strengthening |
| `node scripts/run-local-authenticated-e2e.mjs --config playwright.p1-local-foundation.config.ts` (temporary single-server override) | 42/42 passed (33.2 seconds), desktop Chromium and mobile Chrome |
| `node scripts/run-local-authenticated-e2e.mjs --project=chromium tests/e2e/authenticated/first-krw-withdrawal.spec.ts` | Existing KRW first-withdrawal flow passed 1/1 (47.9 seconds), unchanged assertions and timeout |

The final single-web-server regression selection ran all 32 Chromium cases:
31 passed / 1 failed (22.6 minutes). The failure was the existing KRW first-
withdrawal flow's 180-second whole-test timeout. USDT first withdrawal, all five
negative money guards, all four public-admin aliases, wallet/withdrawal hydration,
error-copy isolation, all 14 response-loss/P1 cases and all four withdrawal UX
cases passed. The KRW first flow is rechecked separately without assertion or
timeout changes. A separate retry is not described as a clean 32/32 suite.
The identical isolated KRW command subsequently passed 1/1 (47.9 seconds),
including START, conversion, hold, bank evidence, finalize and wallet history.

Browser foundation initially passed all 42 cases (1.2 minutes). The temporary
configuration composed the default webServer together with the intended local
override, unnecessarily starting two copies of this worktree's app. The pipeline
was stopped before the final verification completed. The temporary configuration
was corrected to use one explicit server instead of concatenating configurations.
The corrected repeat passed 42/42 in 33.2 seconds. The subsequent complete
`pnpm verify` passed: 84 assets, formatting, lint, both typechecks, web 344 tests,
admin 40 tests, both production builds and bundle separation. Canonical CI config
was not changed by this temporary QA correction.

The fresh default-setting full Chromium attempt ran with
`node scripts/run-local-authenticated-e2e.mjs --project=chromium --max-failures=3`:
19 passed, 3 failed, 68 did not run (23.8 minutes). This is **not a full local
pass**. Failures were KYC status-panel disappearance, a welcome-conversion 503
before the USDT withdrawal, and KYC_REVIEW upstream timeout during the cross-
session test's fixture preparation (480-second test timeout; 10.3-minute wall
time). The browser source assertions and canonical CI defaults were not weakened.
The three cases must also be checked in the new exact-head CI. No new skip/fixme/
only or conditional-success branch was introduced.

### Local limitations and unsuccessful attempts

- Initial focused browser attempts hit local Auth/START/read/conversion timeouts
  before the money mutation. Actual fresh-container logs showed SQL statement
  timeout; these attempts are not counted as accepted flows.
- Docker has about 3.826 GiB memory on this host. The focused 14-test pass used
  production `next start` and a disclosed **fresh-local-QA-only** 30-second
  authenticator/authenticated statement timeout (original: 8 seconds). Lock
  timeout, privileges, auth, MFA and application/domain guards were unchanged.
  DB reset restores defaults. Zero-to-latest pgTAP/lint/advisors passed with the
  original 8-second configuration. CI must use unchanged default settings.
- During the two-server default run, Windows reported about 7.73 GiB physical
  memory with only about 0.50 GiB free. Fresh-DB logs recorded authenticator
  statement-timeout cancellation at 07:34:57 and 07:38:35 UTC. These are observed
  local limitations, not permission to reinterpret failed assertions as passes.
- The first full Chromium attempt reused the DB after Worker tests. A remaining
  `WORKER_RUNTIME_PROBE_MISMATCH` invalidated an unrelated admin empty-state
  assertion; an Auth fixture also returned `Database error loading user`.
  The attempt was stopped, not reported as green. Full browser rerun uses a
  separate zero rebuild without Worker fixture contamination.
- The focused browser helper may use the real “다시 열기” recovery link once
  after an unavailable SSR read; it then requires the real form and every money
  assertion. No assertion or error is silently bypassed.
- Existing Next RSC “destination stream closed early”, NO_COLOR/FORCE_COLOR and
  React act-environment warnings remain disclosed. Hydration evidence is limited
  to the gates that explicitly measure it; source/build success is not runtime
  acceptance. This repair does not claim performance acceptance.
- Existing unavailable balance-read UI can show a zero header alongside an
  error panel. This P1 repair does not close that unrelated UX/operational gap.

## Carried forward, not silently closed

P2: live paid-provider AI browser evidence; full winner/loser terminal
reconciliation race evidence; malformed successful welcome payload validation.

P3: mining_sessions SELECT breadth; step-up consumed before ordinary validation;
own-property lookup for special error codes; failed reconciliation-attempt audit
coverage; React act test-environment warnings.

Independent exact-head re-audit is still required. NOT MERGED. NOT PRODUCT
COMPLETE. NOT LAUNCH READY. REMOTE SUPABASE NOT TOUCHED.
