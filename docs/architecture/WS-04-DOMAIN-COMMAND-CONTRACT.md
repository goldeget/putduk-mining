# WS-04 Domain Command Contract

Status: **CANONICAL P0 API / SCHEMA NAME SOURCE**

This document freezes the public command names, separation rules, and evidence
boundaries for WS-04. Later agents **B** and **C** must consume these names and
must not invent schema, columns, or public function aliases. Agent **A**
implements them in a **new** migration only. Applied migrations must not be
edited.

Existing `withdrawal_destinations.destination_type` already includes
`KRW_BANK` and `USDT_ADDRESS`. That migration stays untouched.
`USDT_ADDRESS` is an **active V1 withdrawal destination**, not dormant.

Safe mode and the existing `claim_outbox_events`, `claim_system_jobs`, and
`run_financial_reconciliation` commands remain. Reconciliation records
mismatches and does not auto-repair. The worker entrypoint will live under
`workers/` later; this contract commit does not add the worker.

2026-10-03 safe-mode integrity extension: `setSafeModeAction` remains the
existing server entrypoint. Its versioned `SAFE_MODE` audit INSERT is the
single transaction command under `docs/architecture/SAFE-MODE-COMMAND.md`.
A private invoker trigger records control state, audit receipt, outbox and the
logical key atomically. No public RPC alias or duplicate domain table is added.

2026-10-03 money-source extension: the owner approved remaining Eligible
Funding Principal, excluding every bonus and mining reward. The canonical
contract is `docs/architecture/MONEY-SOURCE-PROVENANCE.md`. Existing KRW and
manual-USDT approval names and payloads stay frozen. A new append-only
`public.money_source_movements` projection links original balanced journal,
wallet and versioned outbox receipts; it never edits balances or backfills
ambiguous history. Capture/coverage evidence does not activate mining or
complete source-aware withdrawals. Existing withdrawal command names are
retained; no guessed generic withdrawal source or public RPC alias is allowed.

If a welcome withdrawal policy row is absent, a later migration may seed only
the already approved no-funding KRW 5,000 ceiling. Do not activate DRAFT
catalog rows or invent economic values. Any value not already contracted is
`HUMAN_DECISION_REQUIRED`.

### Phase 2 catalog and allocation command extension (2026-10-07)

The user-authorized Phase 2 implementation adds these canonical entrypoints;
they are not aliases for a ledger writer or the legacy settlement function:

- `public.read_product_catalog_review_state`: operator-bound review of the
  draft snapshot, exact content digest, revision and approval/publication history.
- `public.manage_product_catalog`: explicit `PREVIEW`, `APPROVE`, `PUBLISH`
  operations against one catalog ID, expected revision and exact preview digest.
  Trusted arguments bind the verified actor, live admin application session,
  authentication session and AAL2. Approval and publication additionally consume
  their one-use step-up proof atomically with the logical operation receipt,
  audit and outbox event. The API origin guard is mandatory; database authority
  validation is independent. A completed same-key replay returns its original
  receipt; a changed payload is rejected.
- `public.confirm_funding_allocation`: authenticated member confirmation of a
  published catalog, expected allocation revision and selected product/rule
  IDs with exact integer allocation basis points. Its explicit operation is
  `READ` or `CONFIRM`: READ requires every mutation argument to be null and
  returns only the owner's safe revision, catalog and selection projection;
  missing confirmation fields never become an implicit successful read. The
  confirmation request supplies product IDs and allocation basis points; the
  database derives the exact approved rule IDs without exposing rule payloads.
  The owner comes exclusively
  from the verified authenticated database identity. The command accepts no
  owner override, reward, purchase price, fee, client effective time or settlement
  amount. It seals an append-only allocation original with member audit and
  outbox provenance under the member lock, then applies its server-time boundary
  through the private engine adapter in the same transaction. If that adapter
  cannot prove the transition, the entire confirmation fails without an effect.
  This one narrow member writer is `SECURITY DEFINER`, with a fixed `pg_catalog`
  search path and fully qualified internal references. EXECUTE belongs only to
  `authenticated`; PUBLIC, anon and service-role execution are revoked. It
  validates `auth.uid()` and `auth.role()` without granting members direct
  private-table, audit, event or policy-reader privileges. The definer context
  does not replace signed member authority or the private adapter's proof checks.

These interfaces implement the existing operator-approved catalog workflow and
global allocation contract. They do not approve the seeded draft identities,
sources or visuals and do not authorize production publication or remote writes.
Published snapshots and their children remain immutable. A seed digest is not
an operator preview or approval receipt. Existing unapproved immutable rule
originals cannot be rewritten into approval evidence. The bounded neutral rule
adapter requires an explicit operator attestation of the unchanged 1.00x rule;
unrecognized effects are rejected rather than interpreted as an empty rule.
The actual migration and tested receipt schemas define the implemented argument
types; command existence alone is not functional or product-completion evidence.

---

## 1. Separated flows

### 1.1 Phone signup history

- No SMS, no SMS vendor, no paid identity vendor.
- Do not set or display `verified_phone_at` as SMS verification or phone
  ownership verification.
- The current unique index on `user_identity_profiles.phone_e164` is **not**
  historical proof of past signup phones.
- Agent **A** must add an append-only signup phone history of normalized E.164
  values covering current and past identities for START / re-signup abuse
  detection, with database race protection.
- Availability requires both a live check and a final submit check.
- Rate limit applies.
- Enumeration-resistant result only: `AVAILABLE` or `UNAVAILABLE`. Never return
  account id, name, or email.
- User copy is signup availability, not phone authentication. Never
  `휴대폰 인증`, SMS verified, or phone ownership verified.

### 1.2 USDT manual deposit

Not a withdrawal destination and not an internal USDT wallet.

Flow:

1. Show the admin-configured deposit address and network.
2. User sends USDT externally.
3. User submits identification for the transfer.
4. Admin manually confirms.
5. Credited KRW posts as a balanced `DEPOSIT` ledger transaction into the real
   KRW wallet, with notification and audit.

Forbidden:

- blockchain auto-verify;
- exchange / market price API;
- automatic FX;
- user USDT balance;
- direct `wallet.balance` mutation.

Required request snapshots (immutable after create):

- `deposit_address_snapshot`
- `network_snapshot`

Later instruction-config changes must not rewrite past requests.
Uniqueness: `(network, deposit tx_hash)`. Persist `ledger_transaction_id` on
confirmation. Deposit tx hashes are a **different uniqueness domain** from
withdrawal tx hashes.

### 1.3 Withdrawal methods against the real KRW wallet

`KRW_BANK` withdrawal and `USDT_ADDRESS` withdrawal are both active V1 methods
against the real KRW wallet. There is **no** user USDT balance.

### 1.4 Welcome reward first withdrawal

- Cap: KRW 5,000.
- No prior funding required.
- May be requested as `KRW_BANK` or `USDT_ADDRESS`.
- Choosing USDT still holds and finalizes the **KRW** ledger.
- External USDT send remains manual.

---

## 2. Withdrawal hold

When a withdrawal request becomes an acceptable `REQUESTED` state, the KRW
amount is reserved from available balance into pending / held withdrawal using
**ledger-first** balanced immutable hold / reservation entries. This is **not**
a `wallet.balance` mutation.

While held, that KRW cannot be withdrawn again or spent by another money
command.

- **Complete:** held amount becomes finalized withdrawal.
- **Reject / cancel:** ledger-based release / reversal exactly once.

Duplicate click, concurrency, and retry must not double-hold or double-release.

---

## 3. Shared state machine, method-specific evidence

Shared states:

```text
REQUESTED / HELD
  → ADMIN_PROCESSING
  → EXTERNAL_SENT_RECORDED
  → LEDGER_FINALIZED / COMPLETED

REJECTED  (with release; before EXTERNAL_SENT_RECORDED only)
CANCELLED (with release; before EXTERNAL_SENT_RECORDED only)
```

`EXTERNAL_SENT_RECORDED` is shared. Evidence columns / payloads are **not**
shared.

### USDT_ADDRESS evidence only

- `network`
- `tx_hash`
- `actual_usdt_amount`
- conversion evidence / value **only if** the operator actually used one
  (never from a price API; do not invent a default rate)
- `operator`
- `sent_at`

### KRW_BANK evidence only

- external bank transfer reference / evidence appropriate to a manual KRW
  transfer (do **not** require `network` or `tx_hash`)
- `actual_krw_amount`
- `operator`
- `sent_at`

After `EXTERNAL_SENT_RECORDED`, retry must not instruct or perform another
external send. Retry finalizes the KRW ledger idempotently only. The same rule
applies to KRW bank manual send and USDT manual send.

### USDT withdrawal destination protection

- server-side network / address pairing and basic format validation;
- change history;
- step-up on sensitive change;
- cooldown / protection window;
- masked display normally; full address only at confirmation;
- audit.

Never store deposit admin addresses in the same row model as user withdrawal
destinations.

---

## 4. Frozen public command names

Use these public function names. **Do not add aliases.**

### Phone

```text
public.normalize_signup_phone(p_raw text) returns text
public.signup_phone_availability(p_raw text) returns text
  -- only AVAILABLE or UNAVAILABLE
```

### USDT deposit

```text
public.set_usdt_deposit_instructions(
  p_address text,
  p_network text,
  p_actor uuid,
  p_reason text,
  p_request_id uuid
)

public.submit_usdt_manual_deposit(
  p_user_id uuid,
  p_network text,
  p_tx_hash text,
  p_sent_usdt_amount numeric,
  p_idempotency_key text
)
  -- Must copy current instructions into deposit_address_snapshot
  -- and network_snapshot.

public.confirm_usdt_manual_deposit(
  p_deposit_id uuid,
  p_credited_krw bigint,
  p_actor uuid,
  p_reason text,
  p_idempotency_key text
)
  -- Posts balanced DEPOSIT once. Integer atomic KRW. No float balances.
```

### Destinations

```text
public.register_krw_bank_destination(
  ... encrypted payload fields, step-up, cooldown
)

public.register_usdt_withdrawal_destination(
  p_user_id uuid,
  p_network text,
  p_address text,
  ...
)
```

Exact encrypted payload field lists for `register_krw_bank_destination` follow
existing destination encryption patterns; agents must not invent a parallel
destination table for deposits.

### Withdrawals

```text
public.request_krw_withdrawal(
  p_user_id uuid,
  p_destination_id uuid,
  p_amount_krw bigint,
  p_idempotency_key text
)
  -- Holds immediately. Destination must be KRW_BANK.

public.request_usdt_withdrawal(
  p_user_id uuid,
  p_destination_id uuid,
  p_amount_krw bigint,
  p_idempotency_key text
)
  -- Holds KRW immediately. Destination must be USDT_ADDRESS.
  -- Does not create a USDT balance.

public.record_krw_external_send(
  p_withdrawal_id uuid,
  p_bank_reference text,
  p_actual_krw_amount bigint,
  p_actor uuid,
  p_sent_at timestamptz,
  p_idempotency_key text
)

public.record_usdt_external_send(
  p_withdrawal_id uuid,
  p_network text,
  p_tx_hash text,
  p_actual_usdt_amount numeric,
  p_conversion_evidence jsonb,
  p_actor uuid,
  p_sent_at timestamptz,
  p_idempotency_key text
)

public.finalize_withdrawal_ledger(
  p_withdrawal_id uuid,
  p_actor uuid,
  p_idempotency_key text
)
  -- Idempotent. Refuses if external send is not recorded.
  -- Never triggers another external send.

public.release_withdrawal_hold(
  p_withdrawal_id uuid,
  p_actor uuid,
  p_reason text,
  p_idempotency_key text,
  p_disposition text
)
  -- p_disposition is REJECTED (operator rejection) or CANCELLED
  -- (user/operator cancellation). Reject/cancel only before
  -- EXTERNAL_SENT_RECORDED. After external send, release is forbidden.
```

### KYC

Use existing statuses: `PENDING`, `IN_REVIEW`, `APPROVED`, `ON_HOLD`,
`REJECTED`, `REQUIRES_RESUBMISSION`.

```text
public.open_kyc_case
public.submit_kyc_documents
public.review_kyc_case
```

### Admin session

Admin sessions are separate from public user sessions. Never authorize from
`user_metadata`.

```text
public.register_admin_session
public.revoke_admin_session
public.revoke_all_admin_sessions
public.issue_admin_step_up
public.consume_admin_step_up
```

### Existing retained commands

```text
public.claim_outbox_events
public.claim_system_jobs
public.run_financial_reconciliation
```

---

## 5. Later agent file ownership

Do not implement these seams in the parent contract commit. Ownership for
implementation agents:

| Agent | Owns | Must not |
| --- | --- | --- |
| **A** | new `supabase/migrations`, `supabase/tests/database`, `workers/`, domain packages, `lib/security`, `apps/admin/lib/auth` | edit applied migrations; invent alternate public command names |
| **B** | app pages and `components/product` only | domain logic, migrations, withdrawal/deposit route handlers |
| **C** | `apps/admin/app` UI only (port 3100) | edit `apps/admin/lib/auth/policy.ts` |
| **D** | `tests/e2e` and `docs/quality` evidence | weaken tests to pass |

AI durable conversation is **P1**: agent **A** owns any future table; agent
**B** must not create schema. Missing AI conversation schema must not block
P0 delivery.

---

## 6. Acceptance invariants (contract-level)

- Phone history is append-only and race-safe; availability results never leak
  identity.
- USDT deposit is manual, snapshot-backed, KRW-ledger credited, and never a
  user USDT wallet.
- Withdrawal hold is ledger-first; available KRW cannot be double-spent while
  held.
- Shared withdrawal states; method-specific evidence only.
- After external send, retries finalize ledger only—never re-send.
- Deposit and withdrawal tx-hash uniqueness domains stay separate.
- Deposit admin addresses never share the user withdrawal destination row
  model.
- Public command names above are frozen; no aliases.

## 7. Approved economy policy storage extension (2026-10-03)

The owner's new V1 operating values are the exact approved JSON under
`docs/product/economy-v1-approved-2026-10-03.json`. The single new canonical
service-only command is `public.manage_economy_policy_version(text, text,
text, uuid, text, timestamptz, uuid, uuid, text, text, text, text, text)`.
Its operations are CREATE, PREVIEW, APPROVE and PUBLISH. The exact argument
names, administrator proof boundary, immutable receipts, forward-only
effective schedule and seed provenance are frozen in
`docs/architecture/ECONOMY-POLICY-VERSION-CONTRACT.md`.

The separate canonical administrator query is
`public.read_economy_policy_version_state(uuid, uuid, text, text, text)`.
It is service-only, INVOKER, and verifies the current administrator role,
server AAL2 result and bound session before returning policy/revision/timeline
data. Its exact envelope is fixed in the same contract. Never expose
`app_private` via PostgREST or fake an administrator session for an engine
reader. The separate unattended engine/worker query is
`public.read_effective_economy_policy(p_effective_at_microseconds bigint)`.
Its exact envelope and historical event-time boundary are frozen in
`docs/architecture/ENGINE-POLICY-READER-CONTRACT.md`. It requires the actual
`service_role`, uses INVOKER and a fresh READ COMMITTED snapshot under the
publication lock, and verifies the original four publication receipts. Its
policy provenance never establishes funding coverage or money authority.

The read-only entitlement qualification foundation is
`app_private.read_funding_entitlement_foundation(uuid)`. It is service-only,
INVOKER, and not a public command or an alias of an existing money command.
It sums remaining W1 principal lots, reads
`public.read_effective_economy_policy(bigint)`, and returns the published
tier with separate base and unconfirmed retention amounts. Retention is not
a verified balance. The function posts no ledger credit, does not release
`POLICY_CONSUMER_NOT_ENABLED`, and does not allocate a partial principal
recovery across lots. Product multipliers, slot counts, campaign caps, cycle
runtime, segment proration, capacity exhaustion, mining production and
settlement are outside this function.

The separate cycle-window foundation is
`app_private.ensure_funding_cycle_windows(uuid)` and
`app_private.read_funding_cycle_foundation(uuid)`. Both are service-only,
INVOKER, and not public commands or aliases of a money command. Storage
appends one user-level half-open window at a time. The anchor is the
`effective_at` of the first W1 principal lot whose running remainder meets
the published minimum. `cycle_end` is that start plus the published
`cycleDays` measured as exact 24-hour days. Later lots and tier changes
inside the window do not move the stored start, end, or earlier lot
`effective_at`. The next window opens only at the prior `cycle_end`, and
older rows stay. The read does not insert. Neither function posts a ledger
credit, releases `POLICY_CONSUMER_NOT_ENABLED`, confirms retention, or
allocates a partial principal recovery. Segment proration, capacity
exhaustion, mining production, and settlement stay outside these functions.
This storage is not `PRODUCT COMPLETE`.

The separate segment foundation is
`app_private.ensure_funding_cycle_segments(uuid)` and
`app_private.read_funding_segment_foundation(uuid)`. Both are service-only,
INVOKER, and not public commands or aliases of a money command. Ensure
reuses the W3 window and the W2 integer portion. The first segment freezes
the cycle-start principal, tier, economy rule version, `effective_at` and
`effective_until`. A later deposit does not rewrite that row or the stored
window. It appends one segment for the remaining interval through the same
`cycle_end`. The appended qualification is the new condition's remaining
entitlement minus the previous condition's remaining entitlement, using an
integer microsecond proportion. It is not the new condition's full cycle
amount. Base and retention stay separate, and retention stays `UNCONFIRMED`.
Sub-micro-KRW remainder is not stored as `reward_carry`. Neither function
posts a ledger credit, releases `POLICY_CONSUMER_NOT_ENABLED`, confirms
retention, or allocates a partial principal recovery. A principal decrease
does not split a segment. Capacity exhaustion, speed, mining production and
settlement stay outside these functions. This storage is not
`PRODUCT COMPLETE`.

The separate pending read is
`app_private.read_funding_reward_pending(uuid)`. It is service-only,
INVOKER, and not a public command or an alias of a money command. It has no
reward-amount argument. It reads stored segment principal, the stored base
and retention proration, the segment policy version, and the stored cycle
window. Applied speed is that policy's stored default speed. Elapsed time is
scaled inside each segment window with integer basis points, then capped by
the stored base and the remaining capacity. Speed does not increase that
capacity. A zero remaining capacity stays closed. Retention stays
`UNCONFIRMED` and is not added to pending. The result is a pending figure,
not an accepted receipt, used increment, ledger credit, wallet projection,
or `reward_carry`. It does not release `POLICY_CONSUMER_NOT_ENABLED`.
Campaign boost, product multiplier, and override combination stay out
because those stored inputs do not exist. Settlement and worker recovery
stay outside this function. This read is not `PRODUCT COMPLETE`.

The initial approved numeric configuration is exact seed data, not a
permanent economic ceiling. Administrators can change supported numbers,
including rates, thresholds, campaign/multiplier limits, slots and future
fee amounts through newly approved future policy versions. Integer
accounting, source separation, carry, global allocation and immutable
historical results remain fixed.

This command stores policy versions only. It adds no alternate mining,
deposit, withdrawal, wallet, source movement or settlement writer. The
existing names and separation rules above remain authoritative. Approved
policy publication does not establish principal coverage, activate the
economic engine or approve a product/catalog selection.

## 8. Current source coverage correctness (2026-10-06)

The current ordinary `request_krw_withdrawal` / `request_usdt_withdrawal` paths
reserve verified `MINING_REWARD` only; insufficient mining does not fall back to
principal. Qualified START retains its existing no-funding, KRW 5,000 ceiling and
zero-fee conversion/withdrawal path. Principal recovery is a separate explicit
confirmation contract and is not enabled by the ordinary mining command.

`app_private.non_principal_withdrawal_coverage_verified(public.withdrawal_requests)`
and `app_private.withdrawal_coverage_entries_verified(uuid,uuid,bigint,text)` are
service-only INVOKER readers with a fixed path. They bind source coverage to exact
immutable mining reservations or qualified START conversion originals, the existing
balanced hold/request/event/receipt, and actual terminal journal/audit/event/send
and finalized wallet debit. They add no monetary writer, public RPC alias, source
backfill, HOLD debit or synthetic refund. Existing mining terminal source receipts
remain required; qualified START does not acquire fabricated movement rows.

Migration `20261006121500` retains summary schema 2 and the separate available,
held, recovered and cumulative principal values. Unknown originals still return
UNRESOLVED with principal NULL. The actual canonical lifecycle regression passed
36 SQL assertions; the full current local pgTAP baseline passed 47 files / 1,522
assertions and DB lint passed. These facts do not activate funded mining. The
trusted funded producer/cursor/used/carry/earned posting and worker completion
integration remain unimplemented; `record_mining_settlement` stays revoked.
