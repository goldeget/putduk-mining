# WORKROOM replacement — local implementation and evidence

Status: **IMPLEMENTED_LOCAL / NOT_DEPLOYED / FULL_STACK_GATES_PENDING**.

This is the user-authorized full member-product replacement, not the earlier proposal to add a submenu. It implements the current transparent, free WORKROOM simulation. Practice points cannot be deposited, withdrawn or converted into real money. No operational database migration, deployment, push, shared merge, real enrollment, payout or paid infrastructure action occurred.

## Source and preservation

- Repository: `https://github.com/goldeget/putduk-mining.git`.
- Protected original: `C:/Dev/putduk-mining`, HEAD `692e19ed7c66581fdea0c2b7929fda8d2abe9378`, original modified/untracked work preserved.
- Implementation: `C:/Dev/putduk-workroom-20261104`, branch `codex/workroom-replacement-implementation`, baseline `9ccc287c5c05b998a9ad345392e9ff07a03a5836`.
- Source reference: approved WORKROOM `53fd1bf4277d3c8eafd88d7eab7bddadc230eaee`. Sites identity/data were not automatically merged into PUTDUK identities; the existing Site was not changed.
- Backup: `F:/가상대리점/preservation/putduk-before-workroom-20261104/`.
- `FULL-BACKUP-VERIFIED.json`: 32,535 source files, 1,522,231,069 source bytes, 1,373,747,805-byte ZIP, 346,105,390-byte Git all-refs bundle. Every archived source file was checked against its SHA256 manifest; bundle verification passed. Separate dirty tracked bodies and binary patch retained.
- Backups concern source/history/local changes. They are **not** a logical backup of live Auth/customer/financial rows. Live data was not changed. A managed DB recovery point/export remains a cutover prerequisite.
- A spare baseline checkout at `F:/가상대리점/workroom-integration` was created before discovering the volume cannot host dependency junctions; it is not the current implementation checkout.

## Implemented behavior

Member public entry, signup/login surfaces, recovery/loading/offline identity, product shell, navigation, page metadata, icon and PWA chrome now use WORKROOM. Active primary routes are `/workroom`, `/workroom/history`, `/workroom/points`, `/workroom/guide`. Mining/farm/START/product-allocation entry pages redirect away from the old experience; old storage/source is retained for history.

Existing PUTDUK accounts keep their UUIDs, password authentication, profiles and historic rows. A DB-captured pre-cutover cohort opens a workroom without re-registration or invitation. New Auth users require a valid invitation and acknowledgment; invitation use, account creation and the once-only 100,000-P welcome journal share the Auth insert transaction. Existing PUBLIC_V1 identity capture remains in place.

The new additive migration creates eight private tables, checked public RPCs, forced RLS and no raw role writers. START reserves integer practice points 1,000..1,000,000,000 and binds the member-reviewed `expectedVersion`. Rules are frozen per round. Early FINISH evaluates the same public wave/slow/balanced curve at one server time; expiry SYNC uses the exact final result. Stored payload digests/original receipts and unique journal effects protect replay. Read GETs do not mutate settlement.

Admin console supports pattern/ROI/duration/amplitude preview, optimistic versioned save, invitation issue/disable/expiry/usage, user search, reasoned noncash grants, audit records and pagination. It uses the existing verified role/AAL2/live admin session/Origin checks and independent DB authorization. Email/user-editable metadata cannot grant admin access.

Reference prices use fixed provider adapters and explicitly dated fallbacks; they never determine practice or monetary settlements. Providers are time-bounded, coalesced and cached per runtime instance. No live-price claim is made about screenshots, which deliberately use unavailable-reference fixtures.

Original real balances/history remain separate. `/workroom/records` reads the original owner-scoped KRW projection/journal; `/workroom/records/withdraw` retains the existing withdrawal implementation for old actual balances. Old `/wallet` and `/wallet/withdraw` bookmarks map to those archived views. No practice-to-KRW bridge was added. Existing legal/history document bodies are retained, not silently rewritten or re-consented as new terms.

New legacy trial/mining/allocation/deposit/event enrollment/AI web mutations and old operator policy/catalog publishing are retired. Additive SQL closes direct new-allocation, trial-start and public/private event-join RPC privileges. Replacement worker scheduling/claims exclude new monetary mining even when an old option requests it. Pending financial processing and original earned balances are not deleted, recomputed or zeroed. Already-deployed old workers still require explicit cutover handling; local code does not stop remote processes.

## Verification

- Focused WORKROOM + preserved signup/financial unit suites: **14 files / 118 tests passed**; command below. The preservation run includes balanced journal, money provenance, ledger, welcome reward, phone availability failure/recovery, real signup-action seam and current required consent/code tests.
- Member and admin optimized Next builds passed with local-only test configuration; both include TypeScript validation. Re-run final build after any change. Combined Channel Talk bundle guard passed; no configured provider was called.
- Changed-source ESLint passed with zero warnings. Generated `next-env.d.ts` is excluded from explicit file-list lint because ESLint already ignores it; compiler/build checks it.
- `verify-workroom-sql.mjs` passed real embedded PostgreSQL assertions including session denial, one-time welcome credit, invitation rollback/exhaustion, own-user isolation, early curves, replay/no double credit, stale config rejection, grant authorization and direct legacy ACL retirement. Independently imported display helpers matched all three early SQL curve results.
- Chromium rendered the actual current public/signup components and actual member ProductShell/navigation/client at PC1440 and mobile390; no JS errors/document overflow. Real SQL fixture effects covered OPEN/START/early FINISH/history, CONFIG_SAVE/INVITE_CREATE/GRANT/audit. Admin screenshots cover console components, not the full admin shell.
- All browser acceptance is **VISUAL_COMPONENT_FIXTURE / MOCK_AUTH_NOT_REAL_GOTRUE**. Next navigation/auth shims and minimal Auth/session/MFA tables were fixtures. Public signup server-action effects were explicit no-effect mocks. This is not actual GoTrue/email/password/MFA/Next HTTP acceptance.
- Independent review found and closed early-close, stake-range, reviewed-config-version, LG product identity and direct legacy event entry issues. Minor archived-withdrawal retry navigation was also corrected. Review status is LOCAL_SOURCE_REVIEW_ONLY, not release approval.
- Read-only live project/schema inspection confirmed exact ref `osrmyjgmpdspdcwqjwuv`, Seoul, Postgres17, 201 existing migrations through `20261013080342`, required Auth/admin columns and matching economy-helper signature. No WORKROOM RPC/table was present. Original function ACLs were saved outside the repository for a reviewed rollback. This is schema compatibility evidence, not runtime verification or a customer-data backup.

## Reproduce local focused checks

The Windows task checkout reuses existing exact dependencies through local junctions. pnpm12 auto-install rejects that local arrangement; direct Node entrypoints avoid modifying the original dependency tree. A normal clean checkout should install the pinned lockfile normally.

```text
node node_modules/vitest/vitest.mjs run --config vitest.workroom-preservation.config.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p apps/admin/tsconfig.json
node scripts/verify-workroom-sql.mjs <absolute entrypoint of @electric-sql/pglite@0.3.14>
node scripts/workroom-source-integrity.mjs
```

SQL harness driver was installed in a separate task-owned tooling directory, not as a production dependency. The harness uses minimal Auth fixtures plus the exact preexisting economy authority helper; it does not apply the full historical migration chain. Independent-session race tests, native Supabase advisors/lint and actual GoTrue acceptance remain unverified. Docker's daemon was unavailable.

## Release gates still open

1. Current hosted CI admission is frozen to revision201 source/native hashes, exactly201 migrations and its old UI inventory. It cannot accept this202-schema replacement. Do not repin it as if WORKROOM were old revision201. A reviewed successor must preserve historical201 and append new source/native admissions, four checked SECURITY DEFINER functions, invitation-aware fixtures and exact test disposition. Full workflows/schedulers/native adapters must transition together. No current hosted CI pass is claimed.
2. Run full202-schema native financial/auth/worker tests, pgTAP, lint/advisors and true concurrent sessions on fresh isolated Supabase. Keep the mandatory signup trigger enabled and provision valid invitations for historical fixtures. Existing old balances/pending withdrawals need populated-data rehearsal.
3. Verify actual signup/code consumption/email confirmation/login/recovery, real admin MFA/session lifecycle and authenticated Next browser flows without identity mocks. Automatic approval review rejected local Next preview-server startup with only `blocked by policy`; no equivalent server launch was retried. Offline component checks are supplemental evidence.
4. Before any operational apply, confirm exact deployment/runtime, secure managed DB recovery and original ACLs, freeze new signup briefly for the transaction boundary, handle existing active work, replace/pause old monetary workers, and prepare rollback. No failed candidate may be merged or called production-complete.

## Evidence outside the repository

`F:/가상대리점/workroom-browser-evidence/README.md` indexes screenshots/reports. `full-shell-member-pc.png` and `full-shell-member-mobile.png` supersede bare member previews; `actual-public-*` and `actual-signup-*` supersede invalid static-loading diagnostics. Database/admin/member/independent-review/CI-transition reports are sibling `workroom-*-report.md` or `workroom-*-review.md` files. No production identity rows, passwords or secrets were exported into these reports.
