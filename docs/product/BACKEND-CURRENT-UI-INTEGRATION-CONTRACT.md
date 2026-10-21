# Backend current contract for member and administrator UI integration

Status: **BACKEND CONTRACT DRAFT / UI_INTEGRATION_PENDING / LOCAL HTTP PARTIAL / CURRENT193 ACCEPTANCE PENDING / EXECUTION_PAUSED_BY_USER**.

This document records the current server integration boundary for a separate UI/UX
owner. It approves no design, screen implementation, economic value, production
publication, payment, deployment or GitHub operation. Existing screens, layouts,
styles and animation remain protected. Backend completion and release completion
are separate decisions.

## 1. Source and evidence boundary

Reviewed checkout: `C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011`.
Source HEAD: `e220356be85a56e21e3469023b19b0c2fd4aebba`.
The relevant server changes include uncommitted work; HEAD alone does not identify
the complete candidate. The coordinator must bind its final evidence to actual
source hashes, migration inventory and protected-file comparison.

This document combines static contract review with the coordinator's preserved
local execution records; it is not proof of a production deployment. The previous 191-migration native
record is 103 SQL files / 5,457 assertions passing, as recorded in the preserved
backend handoff. That historical result does not prove a later candidate, actual
HTTP/Auth transport, or later successors. The current LOCAL_QA candidate has 193
source migrations: preserved 191 plus referral nonmoney bridge
20261011110300 and nonmoney award acknowledgement 20261011112058. Its exact local
source/profile and applied-set checks passed in the guarded HTTP record, and
focused native tests passed (5 files / 408 assertions). Preserve the earlier
current193 deposit-approval503 failure. A later current193 result recorded53 PASS
and2 FAIL records: the deposit/Auth/ledger/Worker boundary passed, while catalog
PREVIEW replay failed and stopped the remaining continuation. After Docker restart,
the resume failed owned-DB preflight before any HTTP/DB/Worker command. Execution
checks are now paused by the user's latest instruction; static code/contract review
continues. These layers remain separate in section11, and earlier success cannot
be reused as acceptance of a later candidate or the full mining/withdrawal flow.

No inferred remote migration state or live content count is asserted here.
Statements such as “implemented”, “published” and “verified” must identify code,
local database, local HTTP, hosted CI or production separately.

## 2. Authority, authentication and response conventions

- Member identity comes from the verified server Supabase client. `getClaims`
  verification falls back to `getUser` when claims cannot be confirmed. A request
  body, localStorage owner, user metadata or UI-selected member cannot grant
  authority. See [member identity](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/lib/auth/session.ts:18).
- Administrator commands validate Origin, actual user and claims, current role,
  AAL2 and the bound administrator application session. Sensitive commands also
  require their existing step-up proof. A member session is insufficient. See
  [administrator boundary](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/apps/admin/lib/auth/principal.ts:179).
- Authenticated reads and financial responses are private/no-store. Do not cache
  them as PWA offline authority. Loading, absent data, unauthorized, unavailable,
  stale state and an uncertain mutation outcome are different facts.
- The existing response envelopes are **not uniform**. Member helpers return
  `{data: ...}` or `{error:{code,message}}`; administrator withdrawal commands
  return `{ok:true,sendId}`, `{ok:true,ledgerTransactionId,status}` or
  `{ok:false,code}`. Clients must parse each actual contract rather than silently
  treating HTTP 200, truthiness or an arbitrary `id` as proof of success. See
  [member envelope](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/lib/api/http.ts:12) and
  [administrator withdrawal receipt](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/apps/admin/app/api/v1/admin/withdrawals/command/route.ts:174).
- Do not expose service-role keys, operator UUIDs, step-up tokens, private source
  maps, economic rule payloads, raw bank material or internal exceptions to a UI
  or AI response. The server and DB retain the authoritative private originals.

## 3. Money and time invariants

All authoritative money inputs and outputs retain decimal integer strings. Use
BigInt for validated integer handling; do not coerce financial amounts into
floating-point Number, calculate rewards in animation, or round an intermediate
server amount. Micro-KRW accrual, whole-KRW ledger amounts and exact carry are
separate values. Display rounding never changes an input or receipt.

The real member wallet is KRW. Manual USDT deposits credit a confirmed KRW ledger
transaction; USDT withdrawals settle against the KRW wallet. There is no member
USDT wallet balance to invent. Wallet total, available and held are separate;
principal, mining reward, START and BONUS provenance must remain separate.
See [wallet projection](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/domain/wallet/wallet-read.ts:91).

Platform fees are permanently zero under the user's latest instruction. Preserve
sealed historical receipts. Existing fee-bearing pending requests cannot be
rewritten to make old history look fee-free; the existing cancellation/release
and a new zero-fee request are the supported forward path where permitted.
See [zero-fee boundary](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/supabase/migrations/20261011001444_permanent_zero_fee_policy.sql:3).

Server UTC instants determine eligibility, publication, expiry and receipt
boundaries. V1 member display uses Asia/Seoul. A 30-day cycle is an exact 720-hour
window, not a calendar month or a client timezone calculation. Added funding,
withdrawal, refresh and login do not create a new anchor. Capacity, speed, used,
pending, verified and retention qualification are separate authoritative facts.

## 4. Member API and read seams

| Interface | Current contract | UI integration boundary |
| --- | --- | --- |
| `GET /api/v1/wallet/summary` | Verified owner, KRW-only wallet snapshot; read has no money effect | Parse total/available/held strings; preserve unavailable instead of inventing zero |
| `POST /api/v1/deposits` | Verified owner, Idempotency-Key, positive amountAtomic string, existing create_deposit_request command | Submitted request is not an approved deposit or mining qualification |
| `POST /api/v1/deposits/usdt` | Verified owner, Idempotency-Key, network/transaction identification/amount; existing manual-deposit command | Submitted transfer is not chain auto-verification or KRW credit |
| `GET/POST/PATCH /api/v1/withdrawals/intents` | Durable owner-bound logical lifecycle; RECOVER, prepare, CONFIRM/CANCEL/REJECT, exact readback | Keep a logical key through uncertainty; distinguish ordinary v2 from source-bound principal v3 |
| `POST /api/v1/withdrawals/destinations` | Existing encrypted destination command, reauthentication/protection checks | Do not persist raw destination material as a recoverable financial record |
| `POST /api/v1/withdrawals/hold` | Existing logical HOLD command, exact owner/key/method/destination/amount readback | A confirmed request ID follows successful authoritative readback; uncertain response does not authorize a replacement request |
| `POST /api/v1/withdrawals` | Legacy path returns LEGACY_WITHDRAWAL_FLOW_RETIRED | Do not reintroduce the legacy money command |
| `GET /api/v1/products/catalog` | Complete authenticated published snapshot across KR_STOCK/US_STOCK/ETF/GOLD/SILVER/CRYPTO | Keep native category; malformed latest data is an error, not older fallback or omission |
| `/api/v1/products/allocation` | Existing sole allocation writer validates published catalog, rules, principal, slots, integer bps, identity and idempotency | Do not add a parallel allocation or client reward calculator |
| `POST /api/v1/events/participation` | Verified member JWT, same-origin, strict bounded input, owned participation readback | GUIDE is not joinable; JOIN, cash terms and campaign availability are separate contracts |
| `GET /api/v1/trust/member-faq` | Verified member JWT invokes parameterless read_member_faq; approved due DTO only | data:null is valid absence/not-due/expiry; do not show unapproved draft or older expired fallback |
| Mining display server seam | Server-only readOwnMiningServerDisplay invokes read_own_mining_server_display | **SERVER_SEAM_PRESENT / DEDICATED_HTTP_API_PENDING** in this reviewed inventory; do not declare the complete mining feature absent |

Code anchors:
[deposit](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/app/api/v1/deposits/route.ts:16),
[USDT deposit](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/app/api/v1/deposits/usdt/route.ts:20),
[intents](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/app/api/v1/withdrawals/intents/route.ts:82),
[HOLD](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/app/api/v1/withdrawals/hold/route.ts:124),
[mining server reader](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/lib/product/read-mining-server-display.ts:24).

The dedicated mining HTTP entry in this table is a delivery gap, not approval to
expose private engine internals or create a second mining implementation. The UI
owner must consume the reviewed server seam or a separately verified adapter.
Actual HTTP coverage must explicitly identify which path was exercised.

Wallet response compatibility: account `updatedAt` is **null**, because the live
wallet_balance_snapshots projection has no persisted `updated_at` column. Treat
this field as nullable; omit a last-update claim when it is null. Account creation
time and HTTP read time are not ledger update time. The server reads only real
snapshot columns and preserves balance/available/held string fields. See
[wallet route](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/app/api/v1/wallet/summary/route.ts:26) and
[nullable field](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/app/api/v1/wallet/summary/route.ts:53).

Administrator deposit approval returns `{data:{ledgerId}}`, where `ledgerId` is
the **wallet ledger ID**. The corresponding double-entry journal is a separate
`deposit_requests.ledger_transaction_id`; do not compare the returned wallet ID
with that journal ID. Preserve both actual linkages for reconciliation and use
the journal ID for ledger_entries. See
[approval response](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/apps/admin/app/api/v1/admin/deposits/approve/route.ts:117).

## 5. Withdrawal lifecycle, recovery and manual payment

The durable browser-facing operation preserves one logical key and exact payload
through PREPARED, DESTINATION_REGISTERED, OUTCOME_UNCERTAIN and CONFIRMED. Financial
request state and browser acknowledgement state are different facts. An expired
uncommitted intent requires safe explicit resolution; a committed withdrawal must
remain recoverable. Browser reset does not cancel server state.

Ordinary withdrawal uses the existing v2 record. Principal recovery supplies the
explicit confirmation `{version:1,source:"PRINCIPAL",confirmed:true}` and receives
v3 with the immutable source confirmationId. PATCH resolution of v3 binds that
same confirmationId. Do not use principal as an automatic fallback for insufficient
mining rewards. See [principal confirmation schema](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/app/api/v1/withdrawals/intents/route.ts:29) and
[source-bound resolution](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/app/api/v1/withdrawals/intents/route.ts:218).

The shared financial flow is request/held, administrator processing,
EXTERNAL_SENT_RECORDED, then LEDGER_FINALIZED/COMPLETED. Cancel/reject releases
ledger hold exactly once only before external send. External-send recording and
finalizing the ledger are separate existing commands, even when a later UI gives
the operator a simple guided workflow.

The operator verifies and manually sends the full requested KRW amount, then
records that transfer in the administrator server flow. The platform does not
initiate the bank transfer. actualKrwAmount must equal the requested amount.
Partial or fee-deducted payment cannot complete that request. USDT send evidence
uses its own network/tx hash/actual USDT fields; do not ask for bank evidence on
USDT or chain evidence on KRW. Do not invent an automatic FX rate.
See [full-payment enforcement](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/supabase/migrations/20261011003244_krw_manual_full_payout_completion.sql:20).

After external send, a retry performs original-receipt recovery or ledger
finalization only. It must never prompt another external payment, release the
held money, generate a new send key or claim failure means nothing committed.
The administrator command confirms the external-send receipt and separately
confirms terminal request/ledger linkage before returning success.

| Observed result | Meaning and permitted next action |
| --- | --- |
| 401 UNAUTHENTICATED | Obtain a verified identity; no financial command retry as another owner |
| 403 ORIGIN_DENIED / MFA_REQUIRED / STEP_UP_REQUIRED / session denial | Satisfy the existing authorization requirement; a UI flag cannot bypass it |
| 400 INVALID_* / INVALID_IDEMPOTENCY_KEY | Correct invalid input before a new operation; do not discard a possibly committed original |
| 409 insufficient/source unavailable/conflicting state | Explain the exact server conflict; do not reinterpret it as principal permission or successful payment |
| 503 WITHDRAWAL_RECONCILIATION_REQUIRED / UNCONFIRMED / COMMAND_FAILED, timeout or lost response | Retain the original key and payload, recover/read back authoritative state; block replacement money effects while uncertain |
| Confirmed original receipt | Display that original result once; acknowledge the exact withdrawal ID before opening a legitimate later request |

These codes are endpoint-specific. Do not derive a global retry policy from status
alone. The UI integration must cover pending, success, definitive rejection and
result unknown, with reload/multi-tab/account-switch recovery preserved.

## 6. Mining display and Worker contract

The current strict runtime display differentiates ACTIVE and STOPPED, stop_reason,
state_revision, condition_revision, evaluated_at, authoritative allocation/speed
and accepted receipt facts. It retains capacity/used/remaining, exact reward carry,
and retention UNCONFIRMED separately. Absence of readable state is UNKNOWN rather
than an invented low tier, zero reward or completed cycle.
See [runtime DTO](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/lib/product/mining-server-display.ts:34).

Scenes and timers may render confirmed progress; they cannot create accrual,
settlement, a new cycle, ledger credit or a reward claim. Client frame rate,
visibility and local time do not establish financial eligibility. Capacity
increases must preserve existing used, reward receipts and the cycle boundary.
HOLD and release preserve server source/portion semantics; no backdated reward
is inferred from a resumed animation.

Worker orchestration keeps existing bounded claims, leases, fencing, retry budget,
sole money writer, atomic ledger/outbox receipts and reconciliation. A notification
or provider delivery failure must not trigger another money credit. Local synthetic
fixture evidence is distinct from actual external payment or production delivery.
The coordinator must prove the required HTTP-originated effect reaches the DB and
necessary Worker/ledger path; a successful mock handler or native SQL assertion
alone does not prove that connection.

## 7. Catalog, CMS, FAQ and source approval

The following paragraph records the original backend-first browser boundary:

The six-category server catalog keeps all products. legacyUi READY/UI_PENDING is
a capability diagnostic, not an economic decision or automatic publication gate.
Existing UI still has five-category compatibility. ETF publication needs separate
UI compatibility validation and explicit operator approval. Preserve the original
eleven neutral DRAFT products; no new ETF identities or economics are approved by
this document. See [catalog contract](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/docs/product/CATALOG-SERVER-CONTRACT.md:16).

The 2026-10-21 local candidate adds six-category member browse compatibility:
the published parser, filters, labels and neutral ETF decoration retain mixed
snapshots without reclassification or omission. `legacyUi.READY` describes browse
decoding/display only. Selected ETF mining scenes still require their independent
reviewed identity/visual binding; `ETF_BASKET` remains `DECISION_REQUIRED`. This
change adds no seed, ETF publication, world mapping, economics or financial
writer. The original boundary above is preserved as historical evidence; current
compatibility and remaining gates are detailed in
[the current catalog contract](CATALOG-SERVER-CONTRACT.md).

EVENT/NOTICE/FAQ reuse the reviewed CMS command/state path, operator AAL2/session,
step-up, exact revision/digest, idempotency, audit, outbox and uncertain-result
readback. FAQ is DRAFT to PREVIEWED to APPROVED to PUBLISHED; ARCHIVE is supported,
CANCEL is rejected. Schedule/expiry use DB time. Source provenance does not grant
approval authority or prove a subsequently edited body equals original source.

The final 191 read_member_faq boundary is a narrow reviewed definer, with actual
authenticated identity, active member and account checks. The DTO contains only
contentId/revisionId/revision/title/summary/locale/audience/entries/publishedAt/
expiresAt/sourceDigest. Drafts, operator/audit/step-up/private source paths are not
member fields. The latest due snapshot is chosen before expiry validation; an
expired current revision does not reveal an older revision. PUBLIC static FAQ
remains a separate unchanged path. FAQ notification fanout is not implied.
See [FAQ contract](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/docs/product/MEMBER-FAQ-SERVER-CONTRACT.md:24).

POST /api/content/source/preview is read-only SOURCE_EXTRACTIVE / DRAFT_ONLY with
canPublish:false, canExecute:false, providerCalled:false and
registrationExecuted:false. It validates the pinned original revision, byte size,
SHA256 and Git blob SHA. Its output never registers or publishes original drafts.
Later catalog-ops content deltas remain a distinct proposal version.

## 8. Events and referral missions: different evidence populations

Original launch-content at ba9ed931f756488ce4f67f945cffad9552842c09 contains 30 event,
26 notice and 68 FAQ proposals. Exactly 20 original event proposals fit the current
ALL_MEMBERS/NONE informational GUIDE contract. They do not create participation or
reward claims. Remaining target segments, pending policy decisions, unresolved
notice variables and original approval/schedule gates must not be widened or erased.

The separate synthetic QA population of 20 BADGE/TITLE reward missions repeats
seven qualification predicates. That is not evidence of 20 distinct production
campaigns, funded cash rewards, approved budgets or publication. The historical
bridge status was 18 connected and two referral nonmoney missions pending. The
193 successor source adds those two connections and explicit nonmoney award
acknowledgement. Focused local native tests passed at that layer; current193
actual HTTP/Worker completion and production availability remain unverified.
Cash referral settlement/notification evidence does not substitute for nonmoney
qualification and award originals. Record actual resulting receipts, duplicate
protection, authorization and Worker recovery in section 11.

GUIDE requests return 409 EVENT_GUIDE_NOT_JOINABLE. Content CTA allowlisting is
separate from notification deep-link allowlisting and grants no command authority.
Member cash terms or LOCAL_QA activation do not authorize production campaigns.
See [guide request guard](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/lib/events/participation-handler.server.ts:64) and
[source population boundaries](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/docs/product/CONTENT-SOURCE-PREVIEW-CONTRACT.md:34).

## 9. AI and notifications

AI chat has separate authentication/session/origin checks, owned conversation and
history, bounded input, admission/quota, request identity, SSE and abort/error
handling. Duplicate request IDs, quota exhaustion, unknown audit persistence and
provider failures are distinct states. Existing retry semantics and durable
request records must be preserved; restarting a stream is not financial authority.
AI cannot approve a deposit, settle mining, override permissions or record payment.
No paid provider call is authorized by a configured key or this contract.
See [AI route](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/app/api/v1/ai/chat/route.ts:85).

Notification preferences, device permission, subscription registration, server
acceptance and actual delivery are separate facts. A UI cannot report delivered
because a setting was saved, and a failed notification cannot repeat money effects.
Actual provider/Worker delivery evidence remains separate from API acceptance.

## 10. Historical documents and latest overrides

Historical documents remain unchanged. They preserve decisions and implementation
snapshots, not an automatically current status matrix. For current integration:

- WS-04-DOMAIN-COMMAND-CONTRACT.md lines 38/53 mention the older 74-definer roster.
  The reviewed final 191 FAQ reader extends the roster to 75. The current193 candidate
  must supply its own exact approved roster evidence; do not infer a count here.
- The same document lines 556–557 allow future fee changes under its old policy.
  That statement is **superseded by the user's permanent-zero-fee instruction**
  and migration 20261011001444. Never reintroduce configurable positive fees.
- Sealed economic-policy metadata still contains `futureFeeSource:
  SAME_WITHDRAWAL_SOURCE_ONLY` in economy-policy.ts line 93. Preserve that
  immutable historical schema field; its presence does not authorize positive
  fees or override the permanent-zero-fee withdrawal enforcement.
- MINING-ENTITLEMENT-CYCLE-CONTRACT.md includes old RUNTIME NOT CONNECTED and
  activation/producer gaps. Those entries are historical snapshots. Current code
  and exact later native/HTTP/Worker evidence determine current implementation
  status; neither the old gap nor a new document proves a feature absent or done.
- The latest user instruction is BACKEND FIRST with design not finally approved.
  Older UI-first or mockup approval interpretations do not authorize UI changes.

## 11. Coordinator validation record and release gates

These results were inspected from preserved coordinator artifacts on 2026-10-11.
The document editor did not run HTTP, Docker, SQL or tests. Preserve failed runs
and exact source identities when recording a subsequent successful repair.

| Verification layer | Current record | Required evidence |
| --- | --- | --- |
| Static API/contract review | VERIFIED for the cited read scope | Actual file bytes/lines and coordinator source manifest |
| Historical native candidate191 | Recorded 103 files / 5,457 PASS; not rerun by this document author | Preserved run log and exact 191 source boundary |
| Current193 source and local DB set | VERIFIED exact guard checks in current193 HTTP record | Preserve pinned manifest/profile and source hashes; does not mean all scenarios passed |
| Current193 native referral/nonmoney focus | VERIFIED 5 files / 408 assertions PASS | Full current193 native suite and independent roster/advisor review remain pending |
| Real local Auth and member HTTP | VERIFIED for actual exercised requests in latest current19353-PASS partial run | Later full continuation remains incomplete; successful deposit does not prove withdrawal |
| Real local administrator HTTP/Auth/MFA/step-up | VERIFIED actual current193 deposit approval/retry and authorization denials | Session/TOTP/application session/step-up are distinct from fixture role or KYC setup |
| HTTP to deposit Worker and balanced ledger | VERIFIED current193 deposit path in latest53-PASS record | Journal2 entries/netAtomic0, single journal/outbox, Worker7 claimed/7 completed, owned deposit processed and second pass no duplicate; funding/mining/withdrawal not covered |
| Original content preparation | DRAFT_ONLY / publication not asserted | Pinned-original comparison, approved policy/CTA/schedule/target review and registration gate |
| Historical focused unit regression | VERIFIED preserved summary:3 files / 66 PASS before later guard/fixture changes | Historical result does not accept the current source guard |
| Current four-file unit regression | PARTIAL / FAILED_TIMEOUT:94 tests,90 PASS/4 timeout, exit1 | LOCAL_QA31/33, canonical26/28, Worker29/29, wallet4/4; failure stderr records20000ms timeout, not full acceptance |
| New independent local DB migration | VERIFIED migration artifact exit0 | New native task project is separate from the HTTP project; entire native suite has not yet passed |
| Current local types/lint/full backend regression | PENDING completed coordinator evidence; execution paused | Preserve partial/failed logs and resume only under the user's later execution instruction |
| Canonical193 CI consumer code | CODE_WRITTEN / execution acceptance pending | Separate adapter/shard configuration and preserved historical191 fixture do not prove hosted CI success |
| Current hosted CI | NOT_RUN asserted here | Approved candidate push plus actual CI run/commit/results; local tests are not hosted CI |
| UI integration/rendering/design acceptance | UI_INTEGRATION_PENDING | Separately approved designs, later screen integration and actual rendered/E2E evidence |
| Production DB/publication/payment/deployment | No authorization granted here | Each operation's separate explicit approval and actual execution/readback |

### 11.1 Actual completed deposit boundary and preserved failure

- [Earlier HTTP/Auth result](D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011/HTTP_AUTH_RESULT_20261011112343093.json),
  UTC2026-10-11T11:24:11.451Z / KST20:24:11.451: **34 PASS / 0 FAIL**, earlier191
  DB after wallet route correction. Real member Auth and administrator password
  action/TOTP/AAL2/application session/step-up, owner RLS denial, same-key deposit
  creation/approval, wallet-ledger and journal linkage, balanced journal, single
  deposit outbox, real outbox Worker18 claimed/18 completed, owned event processed,
  and second-pass no-duplicate were checked. Catalog HTTP200 with an empty catalog
  and FAQ HTTP200 with absent content do not prove published product/FAQ flows.
- [Current193 guarded HTTP result](D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011/HTTP_AUTH_RESULT_20261011113642696.json),
  UTC2026-10-11T11:38:23.620Z / KST20:38:23.620: **24 PASS / 2 FAIL records**.
  The two failure records are deposit approval HTTP503
  `DEPOSIT_APPROVAL_FAILED` and its consequent `SUITE_ERROR`; they are not two
  independently reproduced defects. The coordinator separately read back
  AWAITING_TRANSFER and journal count0 for that synthetic deposit, so no approved
  financial effect was observed. That readback is coordinator-reported pending
  inclusion in a durable result artifact. Do not retry under a replacement key
  or assume every503 in another case means nothing committed.
- [Later current193 partial HTTP result](D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011/HTTP_AUTH_RESULT_20261011120043741.json),
  UTC2026-10-11T12:03:44.885Z / KST21:03:44.885: **53 PASS / 2 FAIL records**.
  Real deposit approval and retry, owner isolation, balanced journal2 entries/net0,
  single journal/outbox, wallet HTTP200, actual outbox Worker7 claimed/7 completed,
  owned deposit acknowledgement and second-pass no duplicate passed. First KRW/USDT
  destination reauthentication/registration and owned mature readback passed.
  KYC and withdrawal-policy fixtures are setup only, not administrator KYC or
  production policy approval evidence. A new synthetic catalog reached real admin
  PREVIEW HTTP200; original-receipt retry failed, followed by consequent SUITE_ERROR.
  These are two failure records for one stopping check, not two proven product defects.
- [Focused native log](D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011/focused-20261011113252691.log):
  **5 files / 408 assertions PASS**, including referral stage2 controlled history.
  Controlled30-day fixture facts do not prove that30 real days elapsed or that a
  real HTTP-originated30-day lifecycle completed.
- [Focused unit execution summary](D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011/UNIT_VALIDATION_66.json),
  collected UTC2026-10-11T11:34:30Z: **3 files / 66 tests PASS, exit0**, with
  `--maxWorkers=1 --testTimeout=20000`. Actual completion session16023/chunk9c6a5d
  was summarized into this JSON; no separately saved raw stdout exists. Earlier
  session6174 had source-boundary33 cases,28 PASS/5 timeout at default5000ms while
  copying fixtures. Assertion logic was unchanged. Mock RPC Worker cases are not
  native/HTTP/real Worker evidence and are not hosted CI.
- [Independent new local migration result](D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011/clean-native-migration-20261011114446677.json),
  UTC2026-10-11T11:45:21.691Z: migration mode exit0/error:null in
  `putduk-mining-backend-native-20261011-11`. This records migration application;
  full native193 and later HTTP acceptance still require completed result files.

Current193 executed guard manifest SHA256:
`8957473c3170a41ca19835fc39a73542921dcd71abad4a58261ff7a760bda922`;
execution profile SHA256:
`5767adadaf2e4f96e8db557ea61de4de53a4eae7a3f635c8c972a3ee13f62046`.
The exact script pins at
[backend HTTP source guard](C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011/scripts/backend-http-local-source.mjs:15)
and actual result agree. LOCAL_QA profile is task project
`putduk-mining-backend-patch-20261011`, API65421, DB65422, member HTTP3451 and
administrator HTTP3452. Local project/port labels are scope guards, not deployment
evidence. Original CI/source guards remain distinct; this profile cannot authorize
unreviewed source or production execution.

### 11.2 Actual partial continuation and execution pause

**CONTINUATION_PARTIAL / CURRENT193_FULL_RESULT_PENDING / EXECUTION_PAUSED_BY_USER**.
The isolated QA continuation source exists
at `D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011/http-withdrawal-continuation.mjs`.
Its code now reuses the original catalog proof with the same command key/payload
and checks changed-proof rejection separately (lines203–230). This harness repair
is **FIXED_NOT_RERUN**, not proof of successful catalog replay or a product bug fix.
No successful completed mining, KRW/USDT withdrawal or principal HTTP continuation
is asserted in this revision.

| Scenario to update from actual run | Current status | Required readback |
| --- | --- | --- |
| First destination real reauthentication/registration/maturity | VERIFIED KRW_BANK and USDT_ADDRESS in53-PASS record | Real Auth200, destination201 and owned mature DB readback; remaining withdrawal flow not proved |
| Canonical KYC and withdrawal-policy preparation | VERIFIED synthetic setup only / administrator HTTP and operating approval NOT_TESTED | setupOnly/adminHttpKycVerified:false and notPolicyApprovalEvidence:true; no existing policy edits |
| New isolated catalog draft and PREVIEW | PARTIAL:insert-only synthetic setup and real admin PREVIEW200 PASS | Existing11 drafts unchanged in setup record; synthetic setup is not operating product approval |
| Catalog original-receipt retry | FAIL in preserved53-PASS run / harness FIXED_NOT_RERUN | Same original proof/key/payload repair requires actual replay and changed-proof rejection when execution resumes |
| Catalog APPROVE/PUBLISH/due member read | NOT_TESTED after stopping PREVIEW replay check | Exact revision/digest, actual receipts and due member read; no production publication |
| HTTP allocation to funding Worker | NOT_TESTED in successful continuation | Actual owned succeeded job and strict funded runtime; batch0 is not completion |
| Earned mining reward withdrawal KRW/USDT | NOT_TESTED in successful continuation | Real earned source, HOLD/original recovery, synthetic send receipt/final journal; insufficient actual earned source remains BLOCKED |
| Principal recovery KRW/USDT | NOT_TESTED in successful continuation | Real member v3 confirmation, exact source amount change, original request/journal and terminal readback |
| Full real30-day cycle / bank or blockchain payment | NOT_TESTED | Dedicated approved conditions; synthetic receipts and controlled history do not satisfy this layer |

[Post-restart preflight failure](D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011/HTTP_RESUME_PREFLIGHT_FAILURE_20261011_1300.json),
UTC2026-10-11T13:02:47.772Z / KST22:02:47.772, is
ENVIRONMENT_PREFLIGHT_FAILED_HTTP_NOT_RUN. `OWNED_DB_REQUIRED` failed at the owned
Docker status/label gate. Next servers, Auth fixtures, HTTP requests, DB reads/writes,
Worker cycles and payments were all0; source193 and DB193 guards were not reached.
The harness did not expose the raw inspect cause. Parent-observed daemon500 is
separate evidence, not a proven source-code defect. Four Next-generated files
matched their resume baseline. This attempt produced no normal HTTP result.

The user's latest instruction pauses execution checks. Continue read-only/static
code and contract review. Resume requires the user's later execution instruction,
verified exact owned Docker DB status/labels, actual source193/profile and DB applied
set, preserved originals/Next baseline, and actual Auth; do not use fabricated proof
or skip a failed guard. Preserve all failures and attach a new exact result when
resumed. A repaired candidate must not inherit any earlier run's success.

The independent file review at UTC13:05 preserved609/609 UI hashes,42/48 original
uncommitted hashes, and6 authorized delta paths whose original snapshots all match
the phase baseline. Five SQL delta hashes still matched12:29; the historical191
unit fixture had a later authorized correction. HEAD stayed equal. The Git index
binary hash changed since baseline, but staged raw diff is empty and all2035
index path/mode/OID/stage entries match HEAD. Writer and binary-change cause are
UNKNOWN; stat-cache/extensions are only SUSPECTED. Do not call the index byte hash
unchanged or restore it. See
[file preservation](D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011/CONTRACT_PRESERVATION_INDEPENDENT_CURRENT.json)
and [index forensic evidence](D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011/GIT_INDEX_BINARY_INDEPENDENT_REVIEW.json).

Every completed scenario record should include UTC/KST collection time, candidate
source identity, owned local project/ports, synthetic fixture identity without
credentials, HTTP method/path/status/code, DB/ledger/Worker effect counts, retries,
failure evidence and limitations. Do not store passwords, session cookies, JWTs,
service keys, raw user records or private financial material in this document.

UI handoff is ready only for the contracts verified at that layer. Backend
verification continues independently of parallel mockup work. No screen code
integration occurs until the user-approved later UI phase.

## Static release findings after execution was stopped

Collected UTC 2026-10-11T13:14:02.559Z. Local source review only; no new HTTP/SQL/Worker/provider execution. See `BACKEND_STATIC_FINDINGS.json` and the independent financial/AI reviews in D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/http-auth-20261011. These findings block blanket backend acceptance and do not authorize UI or operating changes.

- BFF-01/BFF-02: the current USDT send API accepts an enum network and positive six-decimal amount with optional generic conversionEvidence. Static SQL review found no comparison to the registered destination network and no mandatory typed evidence of the full KRW request value. Finalize uses the recorded receipt and debits the request KRW amount. Network validation and operator manual-conversion/full-payment evidence must be resolved before accepting this path. Actual underpayment/wrong-network execution was NOT_TESTED. Permanent fee zero and operator manual transfer remain the approved policy; automatic FX/chain sending is not authorized.
- BFF-03: WITHDRAWAL_REQUESTED.v1, WITHDRAWAL_EXTERNAL_SENT.v1 and WITHDRAWAL_HOLD_RELEASED.v1 are emitted but unregistered in the current Worker and preserved DB consumer. Generic claim plus unsupported-type permanent failure leads to DEAD_LETTER in static code. This is an asynchronous event compatibility gap, not proof that HOLD or the money journal fails. Consumer purpose and original-bound acknowledgement/notification must be reviewed together; a JavaScript whitelist alone is insufficient.
- BFF-04/BFF-05: AI recordFailure ignores the failAiRequest RPC error result; persistence failure impact is SUSPECTED and not reproduced. Production generative-provider activation is blocked; static guidance and owned-state read tools exist. Model/history/atomic-turn documentation drift must be reconciled against approved source intent.

UI_INTEGRATION_PENDING. The above future server changes are NEEDS_REVIEW and are not an approved UI implementation contract. Runtime tests remain stopped at the user request; resume requires a later user instruction and healthy exact isolated scope.


## 2026-10-11 출금·Worker·AI 오류 패치 후보 (실행 검증 보류)

- 이 절은 기존193 검증 시점 이후의 로컬195 migration 후보와 서버 코드를 설명한다. CODE_WRITTEN / RUNTIME_NOT_TESTED / UI_INTEGRATION_PENDING. 기존 PASS 결과를 이 후보의 검증으로 재사용하지 않는다.
- 플랫폼 수수료는 영구0, 운영자가 실제 전액 수동 송금 후 기록·완료한다. API가 송금하거나 환율을 결정하지 않는다.
- 새 USDT 송금의 conversionEvidence는 strict8field v1이다: version=1, basis=OPERATOR_MANUAL_FULL_PAYOUT, withdrawalId=원본UUID(lowercase), requestedKrwAmount=요청KRW정수문자열, actualUsdtAmount=실제USDT양수 canonical소수문자열(최대6자리), network=등록시점REGISTERED네트워크, feeKrw='0', fullPayoutConfirmed=true. 실제환율·체인검증 증명이 아닌 운영자 전액 지급 확인이다. FX기준/견적/회원고지 정책은 별도확정 필요.
- 기존 opaque/null 증빙의 정확한 송금receipt 재조회는 보존한다. 새INSERT와 미완료→LEDGER_FINALIZED/COMPLETED 전이는 등록네트워크·typed증빙을 DB trigger로 검사한다. 기존미완료 증빙부족은409 운영검토로 남기며 원본영수증수정·재송금·자동backfill 금지. 이미완료된 원장 재조회는 불변이다.
- network원본부족/불일치 및 typed증빙누락/불일치는 관리자JSON API 409와 식별 가능한 USDT_* 오류코드로 반영한다. ADMIN/AAL2/session/one-use step-up·멱등성원본경로를 보존한다.
- WITHDRAWAL_REQUESTED.v1 / WITHDRAWAL_EXTERNAL_SENT.v1 / WITHDRAWAL_HOLD_RELEASED.v1: Worker strict envelope후 DB가 기존원장/receipt/audit와 ownedlease를 대조하여 withdrawal_lifecycle_ack.v1 receipt만 남긴다. 이3개 ACK는 금융변경·송금·추가보상·알림전송을 하지 않는다. 기존WITHDRAWAL_COMPLETED 소비 경로와 nonmoney award193경로는 보존한다. 과거DEAD_LETTER는 자동재생/DB변경하지 않는다.
- AI 실패·취소 RPC 반환오류/예외를 감사저장실패로 드러내고 SSE abort/listener/close를 보장한다. 대화저장 여부와 감사완료 여부를 구분한다. production provider/paid-call 차단은 유지한다.
- 193의 exact source fixture/runtime pin은 역사적 증거로 그대로 보존한다. 이후변경은 closed guard가 승인하지 않는 새후보이다. 실행재개 전195 migration집합/서버hash에 대한 독립 source boundary와 CI소비자 검증이 필요하다. 기존핀갱신/우회로 승인된것처럼 만들지 않는다.
- 새 SQL·unit은 작성만 했으며 apply/typecheck/lint/HTTP/Auth/Worker/DB/E2E/CI는 이번단계에서 실행하지 않았다.

외부근거: D:/PUTDUK-MINING-QA/backend-engine-patch-20261011/contract-gap-fixes/FINAL_PATCH_REPORT.md. Linear PUT-23 / PUT-6 / PUT-8 / PUT-25에 근거와 검증대기를 기록한다.

### LOCAL-195 최종 정적 대조 제한

기존 관리자 USDT action은 conversion_evidence를 `{note: ...}`/null로 포장하므로 strict v1 전액 확인을 제출하는 화면 연결은 UI_INTEGRATION_PENDING이다. 자동 확인 또는 UI 변경은 없다. 신규 USDT 정상 fixture adapter와195 source boundary/CI 증거는 검증 대기이며191/193 pin을 변경하지 않았다.

AI 완료 감사5초와 후속 실패 감사/owned readback 공유5초는 전체 HTTP deadline이 아니다. 정상 append/admission/history, 보조 저장의 timeout 이후 late commit은 별도 검증 경계다. saved:false는 receipt 미확인, saved:true는 확인된 원본 대화 receipt 보존이다. 전체 실행 검사는 NOT_TESTED다.
