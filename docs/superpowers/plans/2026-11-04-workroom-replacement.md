# PUTDUK Workroom Replacement Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development for scoped implementation and independent review. User approved the replacement design in this chat; proceed without another design approval.

**Goal:** Replace the member-facing mining product with the existing transparent free WORKROOM simulation, preserving all existing identities and historical financial data.
**Architecture:** Existing Next member app and separate admin app retain Supabase authentication and privileges. New Postgres workroom accounts, invitation consumption, immutable rules, practice-point journal and rounds are isolated from all KRW wallets. Legacy mining entrypoints are retired without deleting tables/history.
**Tech Stack:** Existing pinned Next/React/TypeScript/Supabase/Postgres; reuse current WORKROOM appearance and instruments.
**Spec:** Chat-approved replacement design and WORKROOM-PUTDUK-INTEGRATION-AUDIT.ko.md from 2026-11-04.

## Global constraints
- Initial 100000 practice points once. Practice balances are not withdrawable and never connect to the separate KRW wallet. Existing real deposit/withdrawal flows remain available through the existing wallet and manual admin queues.
- Instruments usd,cny,jpy,nvda,tsla,msft,ndx,skh,samsung,lg. FX units include 100 JPY, index unit POINT.
- Patterns wave/slow/balanced; signed roi -50..50 percent; duration integer 30..86400 seconds; amplitude 0..15. Config snapshots freeze on round start; both positive and negative outcomes follow the configured final rate.
- Existing user UUIDs, passwords, profiles and all historical tables/migrations remain untouched.
- New registrations require a valid invitation at the authoritative DB boundary; do not trust editable metadata for privileges or code bypass.
- Existing users can open a workroom without a new signup or referral requirement; eligibility must derive from a DB-captured pre-cutover cohort.
- Verified server identity only. Admin requires existing role/AAL2/live session/origin and DB authority checks.
- No real-money test transactions or paid infrastructure. Deployment and live schema apply require completed native/authenticated acceptance and a verified recoverable backup.
- Original working tree is protected. Implementation worktree C:/Dev/putduk-workroom-20261104. Original C:/Dev/putduk-mining read-only. Scope supersedes old AGENTS paths and prior no-reference rule only for this user-authorized replacement.

## Review focus
- Code-use and signup races; duplicate 100000 grants.
- Retry key changed input vs replay; concurrent close/expiry.
- Existing users and passwords survive unchanged; unconfirmed signup cannot bypass registration.
- Admin authorization independent of user-supplied role or email.
- Legacy automatic monetary mining cannot remain reachable through hidden old APIs or worker scheduling.

## Task 1: Database and domain (database lane)
Own domain/workroom/**, supabase/migrations/<new CLI-generated timestamp>_workroom*.sql, supabase/tests/database/workroom*.sql, tests/unit/workroom-domain.test.ts.
Create CLI migration then additive workroom schema. Preserve old source/migrations. Capture existing member cohort, enforce new signup code consumption atomically; create practice account + welcome journal once. Provide read and mutation RPCs, row locks/unique active round, server-time settlement, integer point results, snapshot configs, request payload digest and original result replay, RLS, no generic grants. All practice effects isolated from actual wallets.
Member RPCs: workroom_read_state() -> State; workroom_member_command(p_operation text,p_request_key text,p_input jsonb) -> State; operations OPEN,START,FINISH,SYNC. START input {instrument,stake,acknowledged:true,expectedVersion:integer}; FINISH {id}; OPEN {} for preserved members; SYNC {} settles due own round, never in GET.
Admin RPC: workroom_admin_command(p_operation,p_request_key,p_input,p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal) -> JSON; operations READ,INVITE_CREATE,INVITE_STATUS,CONFIG_SAVE,POINT_ADJUST. Bind DB authority to current auth user and actual admin session. READ returns users,invites,configs,audit with bounded pagination parameters. Point adjustment requires userId,direction (CREDIT or DEBIT),amount (1..1000000),reason; it writes a signed practice-only ledger entry, rejects overdraft and changed payload replay. Config optimistic version and audit.
Shared contracts in domain/workroom/contracts.ts: WorkroomConfig {instrument:string,pattern:'wave'|'slow'|'balanced',roi:number,duration:number,amplitude:number,version:number}; WorkroomSession {id,instrument,stake,pattern,roi,duration,amplitude,configVersion,started:number,status:'active'|'completed',returned:number|null,profit:number|null,closedAt:number|null}; WorkroomState {member:{id,name,balance,room,createdAt:number}|null,active:WorkroomSession|null,history:WorkroomSession[],ledger:{id,amount,balanceAfter,kind,note,createdAt:number}[],configs:WorkroomConfig[],serverNow:number}. Export WORKROOM_INSTRUMENTS, types and display-only simulationValue/sessionValue helpers. Authority calculation stays in SQL/server. Public practice curve is transparent, no real reward engine imported.
- [ ] Write and run meaningful failing domain/SQL tests.
- [ ] Implement and verify SQL on task-owned local Postgres and two-user/no-anon boundary.
- [ ] Report exact tests and limitations; no remote mutations or commits of others' files.

## Task 2: Member product (member lane)
Own components/workroom/**, app/(product)/workroom/**, components/layout/product-shell.tsx, components/navigation/{product-navigation,mobile-navigation}.tsx, app/page.tsx, app/layout.tsx, app/manifest.ts, app/login/page.tsx, app/signup/page.tsx, app/signup/signup-form.tsx. Read current WORKROOM src/App.jsx/app.css/members.css for fidelity; do not copy Gate or admin ownership model.
Create polished navy/mint responsive member experience in existing product shell; routes /workroom, /workroom/history, /workroom/points, /workroom/guide. Single PUTDUK login, no second signup. Existing member opens once if state.member null; normal new signup already has account. Use GET /api/v1/workroom/state -> {data:State}, POST /api/v1/workroom/command with {operation,input}, Idempotency-Key header; same data envelope, {error:{code,message}} on failure. Persist command key across failed retries, refresh state and SYNC on overdue round. Show explicit simulation/practice disclosure. GET /api/v1/workroom/quotes -> {data:{quotes:{[instrument]:{price,currency,unit,source,asOf,fetchedAt,isFallback}},...}}; tolerate failure independent of rounds. Accessible category selectors and charts, started/running/completed/errors, history and ledger, same theme PC/mobile. Signup form adds required referralCode field and free simulation acknowledgement; parent owns signup action. Remove member mining imagery/copy from active shell/public entry; preserve historical data via authenticated legacy records link if appropriate.
- [ ] Test meaningful ownership/race recovery UI behavior where possible.
- [ ] Format and run focused checks; report exact limitations.

## Task 3: Admin product (admin lane)
Own apps/admin/app/(control)/workroom/**, apps/admin/lib/workroom/**, apps/admin/app/api/v1/admin/workroom/**, apps/admin/components/admin-navigation.tsx, apps/admin/components/admin-rail-menu.tsx, apps/admin/app/(control)/page.tsx, apps/admin/app/layout.tsx, tests/unit/workroom-admin*.test.ts.
Replace default admin landing with workroom console; menus config/invites/users/audit. Preserve access to historical financial records explicitly; remove mining policy/catalog from primary nav. Existing requireAdminPage/requireAdminCommand HIGH_IMPACT_ROLES, same-origin and verified DB sessions. RPC as Task1, authenticated principal client, never email-based superadmin. JSON API GET state and POST command; one persistent idempotency UUID per reviewed submission, reason and expectedVersion. UI config pattern/ROI/duration/amplitude preview, invite generate/disable/copy/expiry/usage, member lookup/manual practice grant, audit and pagination. No money command calls. All Korean premium responsive UI.
- [ ] Write authorization/payload/retry tests before handler implementation.
- [ ] Implement, format, run focused tests/typecheck.

## Task 4: Coordinator integration and verification
Own signup action, login return paths, session/proxy routing, legacy API retirement, worker stop guard, quotes adapter, member API handlers, AGENTS authorization addendum, new source integrity manifest/verification, local test tooling and reports. Back up first; no source edits until backup verified. Preserve old data, no auto wallet changes. New signup passes referralCode as metadata only consumed under DB locks, fails with helpful errors. Retire legacy mining/trial/allocation mutations with 410 and stop all new funding mining schedules/claims in replacement runtime. Keep pending historical financial processing separate. New server endpoints use verified Supabase session, bounded JSON, origin, request key, fail-closed errors. Shared module names/types per tasks above.
- [ ] Verify backup bundle and per-file ZIP hashes; document restoration.
- [ ] Add authorization scope and approved plan in implementation checkout.
- [ ] Verify focused tests, member/admin typecheck, lint/build as available.
- [ ] Independent whole-change review and fix findings.
- [ ] Produce reproducible local signup/code/admin/start/close/retry smoke and PC/mobile screenshots if available.
- [ ] Record precise local/hosted/live boundaries and deployment prerequisites. Do not weaken old tests or label previous CI green as new evidence.


## Integrated review rulings
- START binds the exact reviewed expectedVersion; stale conditions reserve no points.
- FINISH computes the frozen transparent curve at server time; SYNC expires only due rounds.
- Preserve actual balances and existing withdrawal rights through /workroom/records and /workroom/records/withdraw; never convert them to practice points.
- Retire new legacy deposits/event enrollment/AI and operator policy publishing in web paths; additive SQL revokes direct legacy new-participation RPCs. Historical processing remains available.
- Public metadata, offline/PWA/loading/recovery/trust chrome use WORKROOM identity. Existing legal/history document bodies are retained, not silently rewritten into new terms.
- Full source admission extends the immutable201 baseline with a separate candidate manifest; old frozen CI/native fixtures need successor review before release.
