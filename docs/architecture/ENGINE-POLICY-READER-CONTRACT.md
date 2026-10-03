# Effective economy policy reader contract

Contract version: `engine-policy-reader-2026.10.03-v1`.

This is the separate unattended server read authority anticipated by WS-04
section 7. Its canonical name is fixed here before implementation:

```text
public.read_effective_economy_policy(p_effective_at_microseconds bigint)
  returns jsonb
```

The migration is `20261003160000_effective_economy_policy_reader.sql`. It
depends on `20261003140000_economy_policy_v1.sql`. It does not replace an
existing command or create an alternate money writer. The administrator
lifecycle commands retain their existing signatures and proof requirements.
This reader and its exact-time core are integrated in the same reviewed
candidate; their canonical name is also registered in WS-04.

## Authority and time

Only the actual PostgreSQL `service_role` has EXECUTE. The function also
checks `current_user`; a JWT claim or an administrator role is insufficient.
It uses SECURITY INVOKER and `search_path = pg_catalog`. It accepts no user,
administrator, session, AAL or step-up arguments. Existing administrator
lifecycle commands continue to require their real administrator proof.

The input is a nonnegative integer count of microseconds since Unix epoch.
PostgREST transport uses a canonical decimal string, never a JSON Number or
JavaScript Date. PostgreSQL bigint limits still apply. Null, negative,
overflow and fractional input fail. The database samples its finite current
clock after obtaining the lock and rejects an event later than that clock.
Timestamps are constructed from integer whole UTC days and integer remainder
microseconds smaller than one day, preserving the exact input without a
floating epoch cast or a daylight-saving offset. The server must derive this
time from an authoritative persisted domain event. Accepting a past timestamp
does not prove that an event occurred then; no client-supplied time may choose
a more favorable historical economic policy.

The function requires READ COMMITTED. It acquires the same transaction-scoped
shared advisory lock keyed by `putduk-mining.economy-policy` as the existing
policy administrator reader. Publication uses the exclusive counterpart.
After any publisher completes, the reader obtains a fresh statement snapshot
and reads the half-open interval `[effective_from, effective_until)` containing
the exact event. A missing interval or an inconsistent receipt fails closed.
The last publication has a null upper bound; an already published future
successor closes its predecessor at the exact successor boundary.

Historical reads preserve publication-time authority. The reader validates
all four original lifecycle receipts against the existing audit, outbox,
configuration and consumed step-up proofs. It does not require a historical
administrator to retain a current session or role. It does not issue, consume
or fabricate an administrator session. Future append-only publications cannot
rewrite a past event's chosen policy. Read results are snapshots, not locks
held across later network calls or permission to settle money.

## Exact JSON envelope

```text
{
  schemaVersion: 1,
  reader: "EFFECTIVE_ECONOMY_POLICY",
  effectiveAtMicroseconds: string,
  readAtMicroseconds: string,
  policyReceiptComplete: true,
  policy: {
    policyId: UUID,
    publicationId: UUID,
    revisionId: UUID,
    policyVersion: string,
    state: "PUBLISHED",
    publishedAtMicroseconds: string,
    effectiveFromMicroseconds: string,
    effectiveUntilMicroseconds: string | null,
    configuration: object,
    configText: string,
    configDigest: lowercase SHA256,
    manifestText: string,
    manifestDigest: lowercase SHA256,
    approvalEvidence: repository document identifier,
    approvalEvidenceDigest: lowercase SHA256,
    approvalProof: [
      {
        revisionId: UUID,
        revision: 1 | 2 | 3 | 4,
        state: "DRAFT" | "PREVIEWED" | "APPROVED" | "PUBLISHED",
        previousRevisionId: UUID | null,
        auditId: UUID,
        outboxId: UUID,
        approvalKind: "OWNER_DOCUMENT" | "ADMIN_STEP_UP",
        actorUserId: UUID | null,
        adminSessionId: UUID | null,
        stepUpGrantId: UUID | null,
        createdAtMicroseconds: string
      }
    ]
  }
}
```

All time strings are canonical nonnegative bigint decimals. Proof entries are
ordered by revision, contain exactly the four lifecycle states, and end at
the returned publication receipt. Configuration text is the actual PostgreSQL
`jsonb::text` source of `configDigest`. The original UTF-8 approval manifest
has its distinct digest; the approval document has a third digest. No hash
uses a JavaScript reserialization in place of the stored original text.
The approval document itself is not stored or returned by this RPC. A trusted
server caller must supply the corresponding document bytes for the pure
validator to verify. Raw configuration, proof and document content are private
server inputs and must not be serialized into client components or public HTTP
responses.

`policyReceiptComplete` describes policy provenance only. It says nothing
about funding lots, principal attribution, held/recoverable amounts, verified
mining rewards, balances, risk eligibility or source reconciliation. Those
inputs retain their separate fail-closed completeness checks. Published policy
is not engine activation or earned-money evidence.

## Server adapter and exact core time

`domain/mining/published-policy-reader.ts` uses the configured server secret
and the existing `getSupabaseBrowserAuthConfig` server helper before creating
its client. That helper permits only the authorized remote hostname
`osrmyjgmpdspdcwqjwuv.supabase.co`, or a development/test loopback URL whose
project identity and API port match this checkout's `supabase/config.toml`.
Production loopback and a different local port are rejected. No client
supplied project identity, secret or administrator session is accepted. Its
raw read validates the exact requested time, finite DB clock, half-open window,
identities and complete proof shape. RPC failures are fail-closed; it never
falls back to a seed, cached version, another project or administrator query.
The adapter reads only
`docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md` under the actual repository
root, rejects a different reported approval path or redirected real path,
and verifies its raw UTF-8 hash. An unavailable original document fails closed.
The bridge requires an explicit trusted `policySourceComplete` input; this
flag is policy-source coverage only and never funding/ledger completeness.

This next candidate consumes the root-owned `validateEconomyPolicy` exact
microsecond identity contract. Publication time, lower bound, finite upper bound
and event remain bigint microseconds throughout. There is no division,
truncation, rounding or requirement that a value align to a millisecond. The
initial seed's actual `clock_timestamp()` precision remains valid.
For a historical event, the validator's `serverNowMicroseconds` evaluation
instant is the DB-authorized exact event, while the actual database read clock
remains separately preserved. This permits an expired policy to be validated
for an event within its original interval. Microsecond time units and micro-KRW
money units are separate protocols; this adapter performs no money calculation.
The exact-time core and reader are one integration boundary. Neither core nor
reader source alone establishes live database, economic engine or product
completion.

## Validation and integration gates

The new pgTAP source covers grants and actual role checks, spoofed JWT claims,
null/negative/future/overflow/fractional time, exact seed boundary and one
microsecond neighbors, exact content hashes and four original proofs, shared
publication lock and stale isolation rejection, historical stability after a
future canonical publication, no money writes and no outbox activation.
Unit tests cover exact transport above JavaScript's safe-integer range, malformed
envelopes and proof chains, DB failure recovery, all interval edges, private
content hashes, historical evaluation and nonaligned exact microsecond cases.
The stale-isolation guard is currently a source assertion; its real transaction
replay and the two-session lock sequence below remain separate DB gates.
pgTAP execution remains unverified until separately authorized CI/local DB
evidence exists. Source checks and unit fixtures do not prove live DB behavior.

A future transaction-level settlement adapter must obtain authoritative
funding/entitlement/source receipts under its own user and money locks, pin
publication identity at the exact event boundary, enforce receipt/idempotency
and reconcile before invoking an existing canonical writer. No such adapter,
earned-money write, worker handler, policy outbox release or remote apply is
part of this reader. Existing policy events remain held at infinity.

Before activating a consumer or writer, test real two-session contention:
hold the exclusive policy lock while a shared read waits, publish and commit,
then verify the read sees the committed successor interval; reverse the lock
order to prove publication waits until the read completes. Repeat with a
publisher rollback. No elapsed-time claim or source inspection substitutes
for this concurrency evidence.
