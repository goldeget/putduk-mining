# Economy policy version contract

Status: policy storage foundation. This contract does not activate funding,
cycles, mining settlement, catalog allocation or source-aware withdrawals.

## Authority and exact source

The owner's new 2026-10-03 approval is recorded in
`docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md`. The initial policy stores
the exact UTF-8 bytes of `docs/product/economy-v1-approved-2026-10-03.json` as
`manifest_text`, its SHA-256 as `manifest_digest`, and its parsed JSONB as
`config`. `config_digest` is SHA-256 of UTF-8 PostgreSQL `config::text`.
These two digests are deliberately different. `approval_evidence_digest`
also binds the approval document's exact UTF-8 bytes. The generator checks
the source document and emits a deterministic seed block; no function duplicates its
economic values. The seed's effective start is the actual migration time,
not a fabricated past launch date.

`app_private.economy_policy_versions`, `economy_policy_receipts` and
`economy_policy_publications` are append-only, forced-RLS server data. There
are no browser grants, public policy table, additional SECURITY DEFINER
function, alternative wallet writer or catalog approval. The existing START
no-funding withdrawal ceiling, zero START fee, money-source capture, immutable
journal, reconciliation and member lock contracts remain unchanged.

## Single canonical write command

```text
public.manage_economy_policy_version(
  p_operation text,
  p_policy_version text,
  p_manifest_text text,
  p_expected_revision uuid,
  p_expected_digest text,
  p_effective_from timestamptz,
  p_actor uuid,
  p_admin_session_id uuid,
  p_auth_session_id text,
  p_verified_aal text,
  p_step_up_token text,
  p_reason text,
  p_idempotency_key text
) returns jsonb
```

Only service_role can execute this fixed-path SECURITY INVOKER command.
`CREATE`, `PREVIEW`, `APPROVE` and `PUBLISH` share this one signature. There
are no overloads or mutation aliases. The separate read RPC below never writes
policy or money and does not duplicate this administration command.
The command inserts a versioned `ECONOMY_POLICY` audit intent. Its private
BEFORE INSERT trigger verifies authority and performs the policy transition,
immutable audit receipt, idempotency completion and
`ECONOMY_POLICY_VERSION_CHANGED.v1` outbox insertion atomically. Direct policy
table INSERTs fail outside that trigger; UPDATE and DELETE always fail.

The server caller must obtain fresh `requireAdminCommand(HIGH_IMPACT_ROLES)`
authorization from verified Auth claims and `getUser`, enforce same-origin
request authorization, and issue the existing single-use `ECONOMY_POLICY`
step-up grant after recent TOTP verification. `p_verified_aal` is a trusted
server result, never a browser claim. SQL requires `aal2`, the current
registered admin session's matching Auth session, its unexpired idle and
absolute limits, and the latest unrevoked role to be ADMIN or SUPER_ADMIN.
Equal-time conflicting latest roles fail closed. No authority is taken from
user_metadata. This foundation adds neither an Auth schema permission nor an
unverified assumption about managed Auth table columns.

Every write requires a nonblank reason and matching one-use step-up grant.
The raw token is removed from the audit before storage; only the consumed
grant ID is retained. SQL rechecks session expiry after serialization using
the database clock. A completed same-key replay revalidates current authority
and its original consumed proof, returns the original receipt, and never
reapplies state. Changed logical input fails. A failed audit/outbox write also
rolls back token consumption and the idempotency reservation.

## Canonical administrator read

```text
public.read_economy_policy_version_state(
  p_actor uuid,
  p_admin_session_id uuid,
  p_auth_session_id text,
  p_verified_aal text,
  p_policy_version text default null
) returns jsonb
```

This service-only, fixed-path INVOKER query uses the same latest role, server
AAL2 and current bound administrator session checks as the write command.
A shared policy advisory lock makes original documents, current revisions
and the published timeline one consistent read against serialized writes.
Reading does not consume a step-up token or create an audit mutation. The
server still applies fresh `requireAdminCommand(HIGH_IMPACT_ROLES)` identity
checks and strips raw manifest/config/approval text from browser DTOs.

The exact camelCase envelope is:

```text
{
  schemaVersion: 1,
  serverNow: timestamp,
  actorRole: ADMIN | SUPER_ADMIN,
  selectedVersion: versionDocument,
  referencePolicy: versionDocument,
  versions: [versionSummary],
  publishedTimeline: [publicationMetadata],
  latestPublication: publicationMetadata | null
}
```

`versionDocument` has `policyId`, `policyVersion`, `configuration`,
`configText`, `manifestText`, `configDigest`, `manifestDigest`,
`approvalEvidence`, `approvalEvidenceDigest`, `createdAt`, `latestRevision`
and `history`. Each revision has `revisionId`, `revision`, `state`,
`effectiveFrom`, `predecessorPublicationId` and `publishedAt`; history also
has `createdAt`, `actorUserId` and `approvalKind`.

The newest 100 `versionSummary` rows contain `policyId`, `policyVersion`,
`configDigest`, `manifestDigest`, `approvalEvidence`, `approvalEvidenceDigest`,
`state`, `revisionId`, `revision`, `createdAt`, `effectiveFrom`,
`predecessorPublicationId` and `publishedAt`. Exact name selection can read
older versions outside this bounded summary. Without a name, selection is
the policy currently effective at the database clock, rather than a future
publication or draft. `publicationMetadata` contains `policyId`,
`policyVersion`, `publicationId`, `revisionId`, `state`, `publishedAt`,
`effectiveFrom`, `effectiveUntil`, `configDigest`, `manifestDigest`,
`approvalEvidence` and `approvalEvidenceDigest`. `latestPublication` is the
forward schedule's final publication point, which may still be in the future.

Do not call `.schema('app_private')` through Supabase/PostgREST or expose that
schema. This administrator reader is not a worker/engine policy authority.
An unattended engine reader needs its own separately contracted backend
authority and pinned effective-time receipt; it must not fake administrator
sessions. Neither reader nor publication creates source-completeness proof.

## Immutable lifecycle and future schedule

- CREATE requires raw manifest text, no expected revision/digest/start, and a
  new policyVersion. It stores one immutable config and DRAFT receipt.
- PREVIEW requires the current DRAFT receipt ID and exact config digest. It
  records the future `effective_from`, current publication predecessor and a
  digest-bound preview. It does not grant or compute member money.
- APPROVE requires that PREVIEWED receipt, exact digest and the same future
  start. It appends an APPROVED receipt without changing the config.
- PUBLISH requires that APPROVED receipt, exact digest and the same start.
  The start must still be in the future and strictly after the latest
  published start. The previewed publication predecessor must still match.
  It appends one PUBLISHED receipt and one publication point.

A global policy advisory transaction lock serializes initial creation and
every transition. Expected revision prevents stale approval. The publication
timeline is append-only with unique, strictly increasing finite starts.
`app_private.economy_policy_published` derives each effective interval as
`[effective_from, next effective_from)`; the final interval is open-ended.
This construction permits no overlapping published version, no retroactive
insertion and no editable end boundary. A future successor may shorten only
the still-future portion of the prior derived interval. Consumers pin the
policy ID/digest and the interval containing each economic event's effective
time; they never rewrite a historical calculation using the latest policy.

The migration bootstrap alone records the owner document as its approval
kind and appends all four lifecycle receipts plus audit/outbox evidence.
It creates no fake administrator or MFA session. After the guard triggers
are installed, service writes require actual administrator proof; they
cannot create a bootstrap approval.

## Validation and consumers

The initial JSON is the exact owner-approved initial configuration. Its zero
fees and rates, thresholds, retention values, multiplier ranges, campaign
ceilings and slot counts are initial values, not permanent ceilings. The
owner explicitly authorized administrators to change these values through
a new DRAFT → PREVIEWED → APPROVED → PUBLISHED policy version. Supported
numeric changes need no new migration. A published version remains immutable.

The fixed accounting contract retains schema/identity, the 1,000,000 micro-KRW
unit and carry preservation, separate withdrawal sources, same-source fees,
manual TRC20-to-KRW semantics and one global cycle capacity. Economic amounts
and fees are nonnegative whole KRW within ledger bigint storage. Thresholds
are positive; fourteen named tier intervals remain ordered, contiguous and
end with an unbounded final tier. Rate and slot fields are whole integers
within exact JSON integer transport bounds; slots and multipliers are
positive. Defaults stay within their configured multiplier range, and
campaign default ≤ single maximum ≤ combined maximum. Allocation stays
within one basis-point unit (100%) and per-product maximum ≤ total maximum.
These syntax, accounting and range relationships do not freeze an economic
percentage at its initial value. Engine arithmetic uses the selected version,
checks ledger/timestamp overflow and preserves existing cycle anchors/carry.
Numeric publication cannot retroactively edit a settled result or grant
principal/source coverage. A structural accounting change still requires a
separately approved contract; changing a supported number does not.

The private published projection exposes `policy_version`, `config`,
`config_text`, `config_digest`, `manifest_text`, `manifest_digest`,
`approval_evidence`, `approval_evidence_digest`, `revision_id`, `published_at`, `effective_from` and
`effective_until`. Data-source coverage and engine completeness are separate
adapter evidence; publication alone must never produce `sourceComplete=true`.
This private data and formulas must not ship in member browser bundles.

No existing mining or withdrawal function is connected in this migration.
The new outbox event is a durable policy change record, held as PENDING with
`available_at=infinity` and `POLICY_CONSUMER_NOT_ENABLED` until a contracted
consumer is explicitly enabled. Existing workers therefore cannot claim an
unsupported policy event; existing ready-event tests and handlers stay intact.
Administrator reading and the four-stage policy workflow can run while the
consumer is held. Publication does not activate financial settlement. This
work adds meaningful pgTAP checks, but local and
remote Supabase execution remain frozen; unexecuted SQL tests are not runtime
acceptance evidence.

## Next audit-replay consumer contract (proposal, not enabled)

The existing `workers/runner.mjs` registry supports only
`SAFE_MODE_CHANGED.v1`. The current `public.complete_outbox_event(uuid,text)`
already verifies the original safe-mode audit and commits one deduplicated
`event_consumer_deliveries` receipt. A later explicit batch can extend this
existing completion command for `ECONOMY_POLICY_VERSION_CHANGED.v1` rather
than invent a second completion RPC or replay the policy write command.

The worker preflight checks the exact versioned envelope, aggregate, audit
ID, revision ID and digests. Under the existing owned, unexpired lease, DB
completion resolves the immutable policy/receipt/audit/outbox chain and
consumed proof, including the documented OWNER_DOCUMENT bootstrap exception.
It then commits one `operator_economy_policy_audit.v1` SUCCEEDED delivery
using the existing unique `(event_id, consumer_name)` boundary and marks the
original event complete in the same transaction. A replay validates the same
receipt and returns without changing current policy state. It does not
recheck a past actor's currently expired session as historical authorization.

This consumer acknowledges durable audit delivery only. It creates no wallet
entry, entitlement, new approval, engine activation, notification claim or
sourceComplete flag. Missing or conflicting receipts fail and use existing
retry/lease recovery; failure rolls back both completion and delivery record.
Duplicate delivery, changed digest, stale lease and injected-write failure
need real database tests. Enabling the handler and releasing only validated
held events requires a separately approved batch and audit of that release.
Keep infinity holding until DB completion, registry and tests are all ready;
do not mark held events processed to bypass consumer evidence. Financial
application and the real Admin Economy Control Center have separate runtime
acceptance from this audit-replay proposal.
