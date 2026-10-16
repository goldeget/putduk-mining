# Default funded engine: concrete local implementation proposal

Status: **DISCONNECTED PRIVATE FOUNDATION LOCALLY ACCEPTED / LOCAL SQL, LINT AND SECURITY GATES PASSED / RUNTIME NOT CONNECTED**.

Prepared against the current shared working tree on 2026-10-06. The bounded private
foundation described first is locally installed and tested. Broader interfaces,
columns and runtime branches in the numbered design sections remain proposals
unless explicitly identified as implemented below. No remote
mutation, production activation, rollout or release is authorized by this design.

## Current bounded private foundation (locally applied and verified)

Local migrations `20261006123000`–`20261006123300` implement a smaller private
foundation than the full design below. Root applied the fresh 91-migration history
and passed the actual local SQL, lint and security gates recorded below. This is
acceptance of the disconnected bounded foundation; production activation and
product delivery require their separate runtime, authority and product evidence.

| Private interface                                                    | Accepted input / effect                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activate_default_funding_engine(credit_id, allocation_original_id)` | actual original IDs only; serializes member then wallet, validates published four-receipt policy and complete source coverage, creates activation + ordinal0 cycle + zero initial state + audit/event atomically |
| `prepare_default_funding_job(activation_id)`                         | sealed current state references only; creates one job per state at `available_at = infinity`, with immutable original, audit and disabled event; no automatic caller                                             |
| `process_default_funding_job(job_id, worker_id, attempt_number)`     | server clock and live attempt fence only; exact earned/used/carry receipt, successor state, positive canonical credit/ledger/wallet/source/settlement, audit/events and same-job success in one transaction      |

Supported inputs are exactly one canonical forward principal credit after the
engine epoch, one member-owned sealed allocation already recorded/effective at
that credit confirming exactly100% aggregate allocation, PUBLISHED catalog with explicitly approved neutral empty rules,
neutral V1 defaults, no holds/restorations/corrections/later input changes, no
legacy cycle/segment and no relevant safe-mode/ACCOUNT boundary. The interval
ends at the first cycle end or a later policy publication boundary. Another cycle
or changed input requires its adapter and is rejected. This restriction preserves
a provable common retained age; it does not deny approved nonneutral formulas.

New private facts are forced-RLS append-only tables. Current state is a view of
immutable state receipts. Insert guards recompute the saved exact calculation,
bind member/cycle/policy/job/attempt ownership and enforce successor/carry equality.
Deferred checks require matching SUCCEEDED job/attempt completion before the
captured lease expiry, original audit/event seals and complete positive source
posting. Canonical settlement/segment rows have an explicit earned-receipt
alternative to legacy session/world identities; no fake session/rule is created.
The posting key is derived from the sealed logical job ID, with job + prior-state
uniqueness and immutable interval/input digest; retries return that one original.
Every digest timestamp is an exact integer UTC-microsecond string, so a session
TimeZone change cannot invalidate or duplicate an economic original.
New service INSERT rights on those three canonical tables reject legacy rows and
amounts not bound to the earned original. Legacy `record_mining_settlement`
is explicitly closed by forward migration `20261006123300`. The original
`20260926094853` had granted service EXECUTE; the later table privilege floor
blocked its writes but had not removed that function grant. The first actual
49-file SQL gate exposed this distinction: the new private posting path passed,
while its stricter legacy ACL assertion failed. The forward closure preserves
owner-only historical fixture paths and strengthens the old RLS expectation;
an actual service invocation must fail before input validation or money effects.
Economic job/outbox originals cannot change while operational
lease/status metadata can change.

At a never-held first cycle end, separately accumulated conditional retention is
qualified once under the original cycle/inputs; maintenance is eligible principal
times its approved maintenance rule, independent of BASE allocation/speed/capacity
effects. It is not spendable before that
boundary. The qualifier and closed state prevent repetition. Partial/no-allocation
runtime qualification is outside this first supported case and remains closed.
The pure preview does separate partial-allocation BASE speed from principal-based
conditional maintenance; it does not perform a qualification/payment. Whole-KRW posting
uses exact rational carry, including the `12.73 => 12 + 73/100` regression.

No public command, `complete_system_job` branch, worker type registration, credit
hook, due scheduling, catalog publication or allocation producer is connected.
New engine and credit events stay at infinity with a disabled consumer reason.
The positive SQL fixture is explicitly postgres-owner-only **synthetic catalog /
allocation provenance**. Real deposits, policy reading, canonical job claiming
and private posting are distinguished in the test. This isolates the foundation
without claiming an implemented member allocation flow or production proof.

Root interface review, independent read-only review and the actual fresh local
migration/pgTAP/lint/security gates passed for this bounded foundation. Funded
worker connection, cycle-close/transition/concurrency integration and relevant
product/browser acceptance remain separate gates. The full authenticated
200-test browser suite was active when this evidence was recorded; this document
does not claim its result. Static parsing does not replace actual runtime gates.

## Current local evidence (2026-10-06)

The current candidate passed a fresh local `db:reset` with all **91 migrations**
and `pnpm db:test`: **49 files / 1,622 pgTAP assertions**. `pnpm db:lint` returned
zero issues; security advisors returned zero issues. The exact-math suite passed
**28 assertions** and the private-posting suite passed **72 assertions**, including
the legacy EXECUTE closure's three actual permission-denial/no-wallet-credit/
no-settlement assertions. The source-coverage suite retained all **36 passing
actual-lifecycle assertions** using canonical holds, sends, finalizations and
releases.

The latest unit gate passed **1,648 tests**: 1,241 web and 407 admin. The actual
worker gate passed **20 tests with zero failed, pending or skipped tests**.
Its sanitized final report records `accepted: true`, all20 passed, and zero
failed/pending/todo counts. This report honestly covers the current dirty local
candidate tree; it does not identify a committed or deployed release. The
combined bootstrap also passed its actual protected-source verification.

Task-owned local evidence:

- `/workspace/.putduk-cloud/db-reset-engine-final.log` — fresh 91-migration reset;
- `/workspace/.putduk-cloud/db-test-engine-final.log` — 49 files / 1,622 PASS;
- `/workspace/.putduk-cloud/db-lint-engine-final.log` — empty issue list;
- `/workspace/.putduk-cloud/db-advisors-engine-final.log` — empty issue list;
- `/workspace/.putduk-cloud/final-unit.log` — 1,648 unit tests;
- `/workspace/.putduk-cloud/worker-final-report.json` and
  `/workspace/.putduk-cloud/worker-final-evidence.log` — sanitized current worker acceptance;
- `/workspace/.putduk-cloud/combined-setup-final.log` — actual combined bootstrap.

Migration `20261006121500` now covers verified ordinary mining reservations and
qualified START originals truthfully. These supported withdrawals keep principal
coverage/eligibility unchanged; unknown journals, wallet labels and unproved
withdrawals remain unresolved. No producer, accepted funded accrual, durable
funded cursor/used/carry or funded worker settlement is implemented by that fix.
Concurrency and browser gates for the current commands remain separate evidence
until their applicable actual results are recorded. The worker result above
does not cover a funded job registered in the production runner: that job type
and the existing public completion branch remain disconnected. These local results do not authorize
production activation, remote application or deployment.

## 1. Approved starting case

The original numeric approval remains byte-identical and pinned by its existing
SHA-256 `15ab269dbed2cb3c1da0ad9c8f0f89e787b5a19ecc48f28255d7f09e2b9c5901`.
Authority: [2026-10-03 numeric approval](../../product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md)
and [2026-10-06 follow-up](../../product/ECONOMY-V1-USER-APPROVAL-2026-10-06.md).

A first production-capable consumer can support verified KRW/manual-USDT principal,
a published V1 policy, one member global 30-day cycle, neutral product/user speed,
no campaign/override, confirmed aggregate allocation up to100%, current eligibility,
base reward posting, and a never-interrupted retained portion at cycle close.
Amounts/rates/limits come from verified published policy, never copied numeric seeds.
No active allocation means zero accrual, not an invented100% allocation.
The installed catalog seed is DRAFT and `/products` is read-only. An actual earning
member path therefore additionally needs a published approved catalog + a receipt-bound
member allocation adapter, not merely the arithmetic/default policy reader.

The current pure preview supports the newly approved weighted/multiplicative speed
scope. The first DB consumer can still reject nonneutral runtime effects until
its receipt adapters are implemented/tested; that is a bounded implementation
restriction, not a claim that their economic meaning is unapproved.

Unsupported corrections/reversals, old unclassified source history, missing
activation/assignment proofs, late effective inputs before accepted cursor,
incompatible legacy segments and heterogeneous repeated portion reservations
must return an explicit unresolved/error state and create no money effects.

## 2. What exists, and what cannot be used as a shortcut

| Existing object                             | Valid reuse                                                                                                                   | Required extension / boundary                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `public.funding_principal_lots` / revisions | immutable actual principal originals and effective instants                                                                   | credit/hold-decrease revisions exist; release has its immutable release original but no increase revision; seal both boundary kinds |
| recovery allocations / releases             | exact reserved amount, original lot, original hold and release journals, effective instants                                   | no persistent sub-lot portion identity after heterogeneous ages emerge                                                              |
| `app_private.funding_cycle_windows`         | member-owned half-open cycle identity and immutable normal boundaries                                                         | foundation-generated initial window is not an activation receipt                                                                    |
| `app_private.funding_cycle_segments`        | existing condition/entitlement history location                                                                               | v1 excludes zero principal/status boundaries and floors sub-micro proration; add a v2 exact runtime contract                        |
| `public.mining_settlements` / segments      | canonical reporting now has a locally tested earned-receipt alternative to legacy session/world identity                      | runtime reader/consumer integration remains; never fabricate a legacy session/rule                                                  |
| `public.mining_reward_credits`              | canonical credit-original link now has guarded service INSERT and deferred earned-original completeness                       | private bounded posting is locally tested; no legacy or caller-amount producer grant                                                |
| wallet/ledger/source/outbox                 | existing append-only authority; verified mining/START coverage and private bounded earned-original posting are locally tested | foreground transitions and runtime connection remain; no second ledger, balance table, queue or independent money writer            |
| `public.system_jobs` / attempts             | private sealed funding-job link, fenced atomic effect/completion and immutable accepted completion are locally tested         | jobs remain unavailable at infinity; existing public completion branch/runner registration/due scheduling remain disconnected       |
| `public.complete_system_job(uuid,text)`     | already accepts only job ID and worker identity                                                                               | extend this exact existing command for the new trusted job type; no new public alias                                                |

`record_mining_settlement` accepts caller amount/segments and remains revoked.
It is not an engine entrypoint. `calculateSettlement` and `previewFundingInterval`
currently have no application/worker production caller. Restoring an unsafe grant
or writing directly to `mining_reward_credits` does not supply earned provenance.

## 3. First activation is derivable for a fresh forward credit

The owner approval says minimum principal is100,000 and **“이상이 되는 순간 Tier와
entitlement를 활성화한다”** (lines24–25), and first actual mining activation creates
the anchor (line60). For a fresh canonical principal credit when the verified policy
and eligibility conditions are available, crossing the minimum is the trigger;
the captured original credit + the serialized server effective instant are the
activation proof. No extra choice of economic number or guessed deposit-age
backfill is needed.

Propose `app_private.funding_engine_activations`:
`id`, `user_id UNIQUE`, `trigger_credit_movement_id UNIQUE FK`,
`trigger_principal_revision_id FK`, `policy_publication_id FK`,
`effective_at`, `input_digest`, `audit_id FK`, `source_event_id FK`,
`first_cycle_id UNIQUE FK`, `schema_version`, `recorded_at`.
All references must belong to the member and prove the same threshold-crossing
condition at the same effective instant. All rows are append-only.

Create the activation and ordinal0 window atomically only after receipt-complete
source capture and policy validation. The anchor equals this effective instant,
not a request arrival, login, worker poll time, unpaid deposit request or START.
No active product allocation may leave speed at zero while the approved principal
Tier/entitlement is active. It does not reset the resulting cycle later.

Existing `ensure_funding_cycle_windows` instead selects the earliest historical
lot crossing threshold (`20261004140000`, around230). Replace the runtime branch
with activation-receipt consumption. Keep the existing foundation read/history
for compatibility; never relabel a hypothetical stored window as an activation.
If its ordinal0 conflicts, reject that member as incompatible rather than delete,
reanchor or grant historical earnings. Pre-consumer funded histories have no
activation proof; retrospective activation is outside this fresh-forward case.

## 4. Minimal new state and receipt stores

These are missing engine facts, not replacement money domains.

| Proposed private object            | Fields / constraints                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `funding_engine_state`             | `user_id PK`, `activation_id FK`, `active_cycle_id FK`, monotone `cursor_at`, `entitlement_revision`, exact `reward_carry_num/den`, `last_earned_receipt_id FK`, engine contract version. Carry nonnegative and strictly below1KRW; revision/cursor update only with the corresponding accepted receipt.                                                              |
| `funding_cycle_usage`              | `cycle_id PK FK`, `user_id` ownership FK, exact base/conditional-retention used rationals, exact effective capacity rationals, latest revision/receipt, cycle-close receipt. Used cannot decrease; new cycle starts its own used at0. Retention is separate from spendable money.                                                                                     |
| `funding_earned_receipts`          | immutable ID, member/cycle/condition segment FK, half-open `[from,to)`, prior/next revision, exact base/conditional amounts, disposition (`ACCEPTED`/`NO_ACCRUAL`), original publication/condition/portion digest, engine version, trusted job/attempt FK, carry before/after, audit/event links. Unique member+cycle+interval; same key with changed digest rejects. |
| `funding_engine_jobs`              | `job_id PK FK system_jobs`, member/activation/cycle refs, expected cursor/revision, immutable causation receipt, input contract version; no amount/rate/client date payload. Trusted original references must validate before execution.                                                                                                                              |
| `funding_retention_qualifications` | immutable member+cycle+portion/original-lot attribution, original conditional earned refs, cycle-end proof, exact qualified amount, qualification/disqualification reason. Unique logical qualification. Settlement consumes the original result without recomputing current Tier.                                                                                    |

A confirmed allocation adapter is also required: propose append-only
`funding_allocation_revisions` (member, revision, effective instant, catalog publication,
product/rule identities, individual bps, aggregate bps, actor/owner proof, audit/request
and input digest). Validate PUBLISHED catalog/rules and sum/slot limits. Current
`/products` only reads published catalog, and no member allocation writer/table exists.
Do not seed a100% assignment or turn a DRAFT catalog into economic authority. The
server member allocation action needs a reviewed WS-04 authority mapping before
connection; do not invent a public command alias merely to make a test pass.

Every new fact table has forced RLS, no anon/authenticated grants, and reviewed
service invoker privileges. Mutable state is a projection; append-only receipts
are its reconstructable authority. FK ownership/digest checks must make a forged
or cross-member job/receipt fail before posting.

Use integer-valued PostgreSQL `numeric` numerator/denominator for exact arithmetic
intermediates; `div`/`mod`, no float or intermediate truncation. Normalize fractions
before storing. Keep wallet/ledger whole-KRW bigint. Enforce proven bounds at the
existing micro-bigint source boundary and whole-KRW posting boundary. Do not
pretend legacy `funding_segment_scale_micro` flooring preserves rational carry.

Upgrade `funding_cycle_segments` with a v2 branch for exact capacity/speed/retention
ratios, publication identity/digest, principal input digest, state reason and
entitlement revision. Permit v2 zero-principal/ineligible boundaries without a
fake Tier. Keep v1 row meaning immutable; the producer consumes only receipt-complete
v2 segments. A legacy row cannot become authoritative because it has matching totals.

Fresh principal INCREASE revisions after a hold had a confirmed gross/net labeling
defect. Migration `20261006121400` corrects only fresh capture/guard to as-of net
eligible principal. Original immutable historical revisions remain unchanged;
the future engine must reject an incompatible historical chain rather than
quietly repairing its snapshot or using its gross label as current eligibility.

## 5. Portion clock reconstruction and its exact limitation

For each original lot, consume only immutable verified originals:

- lot credit establishes original amount/effective instant;
- `funding_principal_recovery_allocations` establishes a held amount at the exact
  original hold journal instant, owned by this lot/member;
- `funding_principal_recovery_releases` identifies restoration of that same hold
  at release journal instant; amount and lot mapping come from the original
  allocations, never from a new generic amount;
- finalize permanently keeps that reserved principal excluded; it does not
  subtract available principal a second time.

A portion clock is the union of its eligible half-open intervals, clipped to
activation/cycle boundaries, excluding its own hold ranges. Original effective
age and accumulated eligible time survive release. Clock20 + hold3 remains20;
a never-held sibling advances23. No retroactive held-time retention, new lot,
whole-lot age reset or generic increase is allowed.

A first partial hold from a uniform-age lot is fully derivable. Split its original
portion into reserved/unreserved classes with identical age at the split, linked
to the existing allocation; the release resumes the reserved class prospectively.
Record those derived portion refs/digests in the v2 condition receipt.

**Current immutable rows are insufficient for every repeated partial history.**
After such a release the original lot can contain different accumulated ages.
A later allocation stores only `lot_id + amount`; it does not say which of those
classes was reserved. The existing newest-first contract orders original lots,
not different-age portions inside one original lot. Guessing a within-lot order
can change retention qualification. Aggregate amount×eligible-time is derivable,
but is not proof of an individually qualified portion if age-dependent final
qualification differs. Bound the first consumer to no-hold/uniform-age or
unambiguously identified portions; fail closed for this repeated heterogeneous
case. Future source commands need immutable portion references and a reviewed
within-lot selection contract. This gap does not block the no-hold default case.

## 6. One server calculation and command mapping

Propose a private invoker `app_private.process_funding_engine_job(p_job_id uuid,
p_worker_id text, p_attempt integer)` returning a canonical effect receipt ID.
It accepts no monetary amount, rate, interval target, carry, used or arbitrary
segment JSON. Member/cycle/cursor and approved inputs come from the sealed job
and database originals. Capture one server `clock_timestamp()` after ownership
locks; the worker never supplies a clock.

Extend existing `public.complete_system_job(uuid,text)`:

1. Unlocked identity lookup discovers the sealed job's member. Resolve the
   immutable private link, not an untrusted payload user ID.
2. Take member boundary, then job row lock, validate RUNNING/owner/current attempt/
   unexpired lease and job-original linkage. Existing ordinary job behavior stays.
3. Execute the private funding producer; validate lease/attempt again against the
   actual clock immediately before success. A lost lease rolls back the entire effect.
4. Complete job and attempt in the same transaction as the producer receipt.

No app_private schema exposure is needed (`config.toml` exposes public and
graphql_public only). `workers/runner.mjs` registers the trusted funding tick type;
its handler performs envelope checks and delegates via the existing completion
command. Existing claim/extend/fail commands remain. Separate renewal timers do
not become economic clocks or fencing tokens. Attempt number is the durable fence.

For foreground principal transitions, the same private calculation accepts the
trusted canonical mutation original internally, not a browser amount. It accepts
old-condition accrual up to the serialized change boundary before applying the
new principal/segment. KRW approval, manual-USDT confirmation, principal reservation,
release and finalization stay under their existing canonical names/signatures.
No economic source aliases, public engine RPC or legacy settlement regrant.

Use one DB-derived exact calculation boundary for accepted accrual and the runtime
read/preview adapter. Pure TS stays a reference verifier; production UI/worker
must not each calculate a separate economic truth. If reusing TS as authority is
chosen instead, its snapshot/commit bridge must prove all inputs within one atomic
revision boundary; a service-supplied amount/JSON alone is insufficient.

## 7. Locks, change boundaries and fencing

Global member order for every money/engine transition:

`funding-recovery member advisory -> funding-cycle advisory -> funding-segment advisory
-> funding state/usage/job rows -> owned request/destination rows -> wallet/account rows
-> journal/projection/source/audit/outbox`.

Preserve deterministic component ordering where more than one row is needed.
Claim/renew touches job rows only and must never wait for member locks while
holding them. Initial membership is read without row locks, then re-read after
member serialization. Policy publication must not hold the publication lock and
then sweep member locks; produce a global immutable boundary/event instead.

**Do not add a late AFTER-credit member lock.** Current credit capture runs after
existing money command locks. Canonical KRW/manual-USDT approval must resolve
owner early and take the member advisory lock before their request/wallet locks.
Otherwise worker/member->wallet and credit/wallet->member form a deadlock.
The terminal migration in this lane already makes release/finalize member-first.

Capture a change's authoritative effective instant after that member lock is
obtained, and use that same instant for journal/source/engine boundary. Statement
arrival time captured before waiting can precede an already accepted cursor and
must not be silently treated as a fresh effective event. Existing historical
late originals before cursor fail closed into reconciliation.

Safe-mode publication has its own component advisory boundary and immutable
audit `after_state.starts_at`. Use its validated history, not just the current
boolean, when catching up. Coordinate current-state check/acceptance with that
publication boundary; re-check before financial commit. A future safe-mode
boundary must not be backdated by a waiting statement. Global/current block
can prevent new accrual while allowing settlement only of an already accepted
original according to the existing SETTLEMENT control.

## 8. Cycle attribution and exact once acceptance/posting

Split at cycle end, lot credit/hold/release, policy publication, eligibility,
safe-mode and confirmed assignment boundaries. Every accepted receipt belongs to
one cycle and condition version. Changes at exactly cycle end belong to the next
cycle. Offline catch-up reconstructs anchor-based windows; it never starts a cycle
at poll time or pays unused capacity.

For each interval, calculate exact BASE rate×eligible elapsed, clamp against the
original cycle BASE/global remaining cap, and separately track conditional
retention. Accept receipt + used + cursor/revision + audit/outbox atomically.
Source ambiguity produces no accepted receipt/advance. Verified inactive/no-allocation
intervals can advance with a zero monetary NO_ACCRUAL receipt; no retroactive reward
appears when eligibility resumes.

Post BASE whole KRW from original accepted base + exact carry; store the remainder
across reset. An accepted pending receipt later posted to verified never adds used
again. At cycle close consume only original qualified retention; do not recompute
it using current principal/Tier. Conditional retention is never a spendable balance
before qualification. For the no-hold case, maintained original lot proof and
original segment earnings supply the final qualification; partial/ambiguous cases
remain UNCONFIRMED until the supported portion adapter exists.

Extend canonical settlement headers/segments to explicitly refer to funding cycle
and earned receipts as an alternative to legacy mining-session/world-rule FKs.
Do not fabricate a session or world rule. Add an immutable original-to-credit
link: each funding credit points to accepted/qualified receipt and previous carry
receipt, recording cycle attribution even when a whole KRW includes prior carry.
A zero-whole-KRW receipt creates no zero-valued mining_reward_credit or fake journal.

For a positive credit in ONE transaction:

- canonical settlement result linked to original earned/qualified receipt;
- MINING_REWARD journal: DEBIT existing mining reward expense, CREDIT member KRW liability;
- exactly two equal whole-KRW entries and append-only wallet CREDIT;
- existing `mining_reward_credits`, verified MINING_REWARD source movement,
  existing `MINING_REWARD_CREDITED.v1` original event with canonical request/correlation;
- immutable posting/qualification receipt, carry update and completion state;
- canonical job/attempt completion and deterministic next due work.

Deterministic keys derive from member+cycle+accepted interval+input digest+contract
version, never new random retry keys. Any key collision with mismatching original,
amount/currency/owner/event payload/causation rejects; `ON CONFLICT DO NOTHING`
alone is not receipt recovery. No external send is involved in earning settlement.

The current withdrawal-coverage prerequisite is **implemented and locally tested**
in migration `20261006121500`. Its service-only invoker reader validates exact
immutable mining reservations or the qualified START conversion/CREDIT original,
plus the actual request, balanced HOLD, outbox and receipt. Terminal coverage binds
the existing journal, single genuine wallet debit when finalized, event, audit and
external-send record. Mining terminal source movements remain required; START does
not acquire invented terminal movements. No extra RESERVE, debit or refund is
posted by this adapter. All 36 targeted actual-lifecycle assertions passed,
including unchanged principal/lots/revisions/funding eligibility, terminal retry
parity and fail-closed unclassified wallet/withdrawal/journal cases. Historical
unknown remains unresolved. The bounded private earned-receipt-to-credit producer
is now implemented locally and its 72-assertion posting suite passed. Broader
foreground/cycle/portion adapters, public worker connection and the reconciliation
integration below remain unimplemented.

Extend existing reconciliation to compare earned->used->settlement->journal->wallet
->source->event->carry and report mismatches. Do not auto-repair financial facts.

## 9. Required tests before connecting a worker

1. Real KRW/manual-USDT threshold crossing: one activation/anchor; two concurrent
   credits preserve both originals; START/BONUS/mining CREDIT never activate principal.
2. Pre-consumer/hypothetical window, DRAFT policy/catalog, missing assignment,
   unclassified source and absent activation proof: explicit failure/no credit.
3. Default1x calculation from verified policy, large integers, exact fractional
   accrual,12.73->12+0.73 carry, split vs combined interval equality and carry across reset.
4. Two-session job/foreground credit race, member lock order and post-lock original
   replay; two jobs cannot accept the same cursor interval or exceed remaining cap.
5. Atomic failure injected after earned/used/journal/wallet/source/event stages:
   no partial acceptance, posting, carry or cursor commit.
6. Crash after commit, lease renewal/expiry/reclaim, changed attempt owner and
   stolen fence: original reward once; stale worker cannot complete/cursor overwrite.
7. Midnight-independent30-day half-open boundary, change exactly at end, multi-cycle
   offline catch-up, no unused capacity payout and no reset from withdrawal/redeposit.
8. Unchanged/no-hold retention stays conditional then qualifies once at cycle end;
   final posting does not add used. Supported first partial hold20+3 preserves sibling23/
   reserved20 clocks; original-lot release resumes prospectively; repeated ambiguous
   different-age portion selection explicitly fails instead of resetting age.
9. Known current safe-mode/pause intervals produce zero new accrual; after resume
   no reward for stopped time. SETTLEMENT control rejects posting when applicable.
10. UI/query shows actual committed BASE, unconfirmed retention, carry, capacity,
    used/remaining and receipt revision; no preview-only value labeled earned/verified.
11. Generated MINING_REWARD can use ordinary withdrawal without principal changes;
    unavailable/mixed/other source remains rejected and existing START remains unchanged.
12. Real DB/worker/browser evidence, reconciliation and targeted security gates.
    Pure/reference tests alone do not establish an installed producer.

## 10. Shared files and ordered implementation boundaries

Review/claim ownership before editing:

- new migration lane: activation/state/usage/earned/job/qualification originals;
  extend windows/segments, canonical settlement reporting, `complete_system_job`,
  credit completeness and reconciliation in NEW migrations only;
- canonical `approve_deposit_request` / `confirm_usdt_manual_deposit` / terminal
  functions: early member locks and exact serialized effective instant;
- `domain/mining/funding-entitlement.ts`, `published-policy-reader.ts`,
  `domain/mining/calculate-settlement.ts`: one authority + reference parity;
- `workers/runner.mjs`, worker declarations/reporting, no new queue transport;
- `lib/product/mining-server-display.ts` and member/admin readers: actual receipt DTO;
- database and tests-concurrent plus worker integration/browser evidence;
- WS-04, entitlement, money source/outbox/reconciliation contracts and current-state evidence.

Order: the private receipt/exact-engine foundation and explicit legacy closure
have passed the fresh local SQL/lint/security gates without automatic activation.
Complete separately applicable concurrency and current-command browser gates,
then review/assign the remaining authority mappings and runtime adapters. Prove
the actual connected canonical credit/funded-worker flow on a disposable local
DB; only then wire query/UI and evaluate separate runtime/production enablement
boundaries. Existing owner numeric approval must not be replaced by a
stale “NUMERIC POLICY NOT APPROVED” gate.

The bounded trusted activation, exact earned/used/cursor/carry state,
earned-original balanced posting and fenced atomic private job completion are
locally installed and tested. Minimum missing runtime is a real catalog/allocation
authority producer, zero-allocation activation/later-assignment adapter,
foreground change boundaries, cycle/portion adapters, existing public completion
and worker/scheduling connection, and committed-receipt queries. These are
implementation/mapping work under already approved numeric, source and clock
semantics. Extending `complete_system_job` and the existing
KRW/manual-USDT commands needs reviewed implementation ownership, not a new public
RPC or another approval of those economic numbers. The member allocation action
has no existing command/receipt authority mapping and the current catalog is DRAFT;
its reviewed server action/catalog publication and allocation original remain an
additional integration boundary. No unconfirmed default 100% assignment may be
manufactured. Separately, source-aware principal recovery has private reservation
foundations but no canonical member action that seals an explicit PRINCIPAL
confirmation; ordinary withdrawal is mining-only. Its implementation contract must
map an immutable source-confirmed intent into existing command names before adding
that path. This is a missing command/receipt mapping, not a need to approve another
fee, principal rule or generic fallback. Repeated reservations of different-age
portions and retrospective activation of old incompatible histories remain bounded
unsupported cases until
their original-selection/compatibility contracts are supplied.
