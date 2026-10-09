# Local event and device push recovery

This is a newly reviewed implementation from this repository's recovered source,
approved user requirements and source-bound existing writers. It is not an exact
byte restoration of missing Cloud SQL. Remote Supabase, Cloudflare, Git publication,
production execution, paid AI and actual money remain outside this Local phase.

## Command extensions and boundaries

`participate_published_event(p_event_id uuid, p_revision_id uuid,
p_idempotency_key uuid, p_request_id uuid)` is the approved single member command.
It binds the authenticated subject to the current immutable published/approved
content revision, schedule, current account and risk state. Participant original,
audit, completed logical idempotency and `EVENT_PARTICIPATION_JOINED.v1` are atomic.
Service-role actor overrides and direct participant grants are absent. Public
`event_member_content` exposes reviewed Korean content only, with member RLS.

The existing `complete_outbox_event` command retains its name and two arguments.
It now has closed, lease-owned consumers for a genuine join original and for
`DEPOSIT_CONFIRMED.v1`, `TRIAL_REWARD_CONVERTED.v1`, and
`WITHDRAWAL_COMPLETED.v1`. Worker JavaScript preflights these exact envelopes;
the DB validates actual domain rows, balanced journals, owner and business clock.
An outbox row or caller-provided eligibility flag is insufficient evidence.

Nonmoney policies are private, versioned and default disabled. The Local QA
approval helper has no public command alias or client/service EXECUTE grant. An
owner-controlled native fixture must install the exact fresh Local identity and
perform actual bound AAL2/TOTP operator review with a one-shot grant. Only
explicit BADGE and PROFILE_TITLE snapshots are implemented. Award uniqueness,
participant advancement, audit, reward outbox and the notification original are
one transaction. Original source and approval evidence are sealed; safe member
award grants expose only `id`, `event_id`, `reward_kind`, `title_ko`, `created_at`.
Notification opt-out suppresses the notification without removing the award.

The approved service-only device extensions are:

- `claim_notification_push_deliveries(worker text, batch int, lease_seconds int)`
- `settle_notification_push_delivery(delivery uuid, worker text, lease_token uuid,
  attempt int, status text, http_status int, error_code text)`

These public SQL invokers call private closed definers with current SQL role and
JWT service proof. Device lease tokens and attempts fence stale workers. Keys and
endpoints have no client/private-table SELECT grant. Claim rechecks recipient,
explicit opt-in, current subscription, account/risk, quiet hours, current source
revision and the actual nonmoney award notification seal. Only this connected
`event_rewards` family currently ships into the device queue; other families fail
closed. A refreshed subscription is protected against an old endpoint's 410 by
the claimed key digest. UNKNOWN persists an append-only receipt and bounded
retry; an expired lease records UNKNOWN before reclaim. Maximum attempts are 12.

The existing aggregate IN_APP receipt means durable notification persistence.
Per-device HTTP 201/202 means provider ACCEPTED. Neither means an installed
device displayed a notification, and neither writes DELIVERED evidence.

## Source and validation

The migrations dated `20261008210940` through `20261008213107` implement the
member join, closed join consumer, Local QA nonmoney policy/evaluator, source-bound
notification and per-device leases. SQL proposals from the Admin lane were
reviewed and integrated by the single migration owner, with invoker/public
boundaries, minimal grants and actual native validation.

Current targeted native evidence lives in the finance worktree's ignored
`test-results/local-recovery/` and approved QA run storage. Targeted cases are:

- Member participation: 28 checks, including actual canonical claim/complete,
  logical replay, source immutability, expired schedule and crossed subject.
- Nonmoney original: 46 checks, including actual canonical deposit → closed
  Worker completion → BADGE → notification, opt-out suppression, RLS/privacy,
  exact source proofs and a forced notification failure rolling back award,
  participant advancement and reward outbox.
- Device delivery: 68 checks, of which 41 are inherited nonmoney checks and 27
  are device cases. These use synthetic HTTP outcomes and synthetic owned
  subscription keys only; actual network sends and installed-device proof are 0.
  They cover disjoint lease claims, wrong/stale worker, response-loss replay,
  UNKNOWN/expired lease, refreshed-key 410, revocation, quiet hours and privacy.
- Worker source dispatch, device outcomes and Local runtime boundaries: 37
  unit cases; no network or DB fixture writes. Settlement failures never resend
  to conceal uncertain delivery. Individual devices are claimed immediately
  before sending rather than pre-leasing an entire sequential batch.

`workers/push-runtime.mjs` is a separate explicit Local entrypoint. It requires
development/test mode, this checkout's fresh loopback/project allowlist, the
independent `PUTDUK_PUSH_SEND_APPROVED=true` opt-in and the existing canonical
VAPID server configuration (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT`). It validates the P-256 pair before leasing, consumes the shared
Node RFC8291/RFC8292 transport core, and prints operational counts only. It is not
invoked by the generic runner and has not been executed with real shipping here.

## Unclosed acceptance

Four required original producer bridges remain absent in the verified source:
`MINING_STARTED.v1`, `MINING_SETTLEMENT_COMPLETED.v1`, `TRIAL_COMPLETED.v1`,
`REFERRAL_REWARD_PAID.v1`. They fail closed and have not been registered as JS
handlers. An event name in documentation is not a producer. Actual referral
reward payment remains a separate missing sole-writer flow.

Twenty Local NONE content publications are not twenty completed reward missions.
Production operator approval, CASH amounts/caps/budgets, absent source producers,
actual membership mission qualification for all twenty variants, external push
shipping and installed-device display remain unproven. Marketing/digest families
are not made complete by this connected nonmoney path. Device two-backend
concurrency and full twelve-attempt terminal evidence remain pending.

Supabase CLI whole DB lint currently cannot connect through host port 61422
(`LegacyDbConnectError`). A scoped native `plpgsql_check` fallback found four
function warnings and multi-table-trigger unreachable-branch record warnings.
The warnings are tracked separately; an older CLI PASS is not reused. A follow-up
function-literal consistency migration is being tested. Final exact-source fresh
reset, full native chain and full Worker suite remain required before promoting
these targeted observations to complete reproducibility. No fake migration
history entry or production readiness claim is used.
