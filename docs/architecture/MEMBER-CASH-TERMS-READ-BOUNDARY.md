# Member cash terms read boundary

The 2026-10-11 migration makes the existing reviewed publication boundary
explicit so the public view satisfies the security advisor's invoker-view
requirement. Inspection found an intentional narrow owner projection; it did
not establish an attacker path leaking private financial or member records.
This change is boundary hardening, not evidence of an exploited vulnerability.

`public.member_cash_event_terms` retains its name, authenticated-only SELECT,
and exactly these fields and types: `event_id uuid`, `content_revision_id uuid`,
`terms_version integer`, `terms_ko text`, `cash_terms_digest text`,
`reward_krw text`, `starts_at timestamptz`, and `ends_at timestamptz`.
The public view uses `security_invoker` and `security_barrier` and reads only
`app_private.read_member_cash_event_terms()`.

The private reader is the 74th reviewed definer, owned by postgres with fixed
`search_path=pg_catalog`. It accepts no caller-supplied SQL, identity, amount or
filter. Both direct execution and view reads require the actual authenticated
role, authenticated JWT role, and a non-null UID. Otherwise it returns zero
rows. PUBLIC, anon and service_role have no EXECUTE privilege; authenticated
has EXECUTE solely to support the view. No public RPC alias is introduced.
The existing private-schema USAGE revoke is retained. The rollback-only test
temporarily grants schema USAGE after proving the ordinary member view read,
solely to reach and verify the direct-call checks; installation adds no such
grant.

It returns only EVENT policies whose sealed policy window is currently open,
whose event is SCHEDULED, LIVE or ENDED and already published, and whose exact
local configuration is enabled. Missing or disabled configuration returns zero
rows. Members share these public terms under the existing MEMBERS/ALL_MEMBERS
publication contract; this read does not expose participants or consents.
Private policy snapshots, budgets, approval originals, risk data and source
maps remain behind FORCE RLS and the existing revoked raw privileges.

Installation creates no configuration, funded policy or activation. Existing
four-argument NONE participation and five-argument explicit cash consent retain
their command names and validation. LOCAL_QA verification grants no production
activation, treasury or deployment authority.

`supabase/tests/database/local_cash_event_terms_boundary.sql` covers the actual
authenticated view read and direct reader, exact output columns and types,
disabled and absent configuration, role/UID failures, revoked role and raw
private access, future publication, cancellation, and explicit consent using
the digest obtained from the member view. The rollback-only synthetic fixture
uses canonical reviewed publication and approval originals. Test execution is
required before claiming compatibility or advisor verification.
