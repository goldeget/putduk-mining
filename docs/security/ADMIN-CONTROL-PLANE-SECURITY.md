# PUTDUK MINING Admin Control-Plane Security

Status: historical WS-03 foundation record with the local security changes in
section 10; not a production launch approval

Application hostname: `admin.mining.putduk.com`

Public hostname: `mining.putduk.com`

## 1. Physical boundary

The operator experience is a separate Next.js 16 application under `apps/admin`.
It has its own build, route graph, security headers, authentication entry point,
session cookie storage key, UI, and command handlers. The public application no
longer contains an admin page, admin component, or admin command handler.

On the public application, `/admin`, `/administrator`, `/manage`, `/backoffice`,
and `/api/v1/admin/*` are unregistered paths. They receive the same ordinary 404
as any other nonexistent route. The public navigation, proxy matcher, login
return-path allowlist, robots policy, browser environment, and analytics origin
allowlist contain no admin entry point.

The hostname is not a secret and is not treated as an authorization control.
Future Cloudflare Access or Zero Trust is an additional edge gate only. It is
not provisioned in WS-03 and cannot replace application and database controls.

## 2. Request trust chain

```text
Internet
  -> future Cloudflare edge access gate (not provisioned)
  -> dedicated admin Next.js application
  -> dedicated Supabase Auth cookie (`putduk-admin-auth`, host-only)
  -> live Auth user verification and trusted JWT subject match
  -> current, unrevoked `public.user_roles` row under RLS
  -> mandatory AAL2/TOTP
  -> route-specific role capability
  -> recent TOTP step-up for high-impact commands
  -> server-only command / service credential
  -> database function, RLS/domain invariant, immutable audit
```

Every protected page executes the data-access authorization check. Proxy only
refreshes the session and performs an optimistic unauthenticated redirect; it is
never the sole authorization layer. Every command repeats authorization at the
handler immediately before the mutation.

## 3. Identity and authorization

- Authority comes only from active rows in `public.user_roles`.
- `user_metadata` and `app_metadata` are not authorization sources.
- The server verifies both `auth.getClaims()` and the live `auth.getUser()`
  result and requires their subjects to match. This rejects revoked or invalid
  users before role evaluation.
- Role precedence is deterministic: `SUPER_ADMIN`, `ADMIN`, `CONTENT_ADMIN`,
  `SUPPORT_ADMIN`, then `VIEWER`.
- A normal authenticated member with no active operator role is signed out of
  the admin cookie and receives the same generic login failure language.
- Login responses do not distinguish unknown account, wrong password, revoked
  role, or non-operator account.
- Admin signup, impersonation, password viewing, and user-editable role changes
  do not exist in the application.

## 4. MFA and step-up

AAL2 is mandatory for every protected operator page. An operator with only AAL1
is routed to TOTP enrollment or challenge. The control plane accepts a verified
TOTP factor before continuing.

High-impact commands additionally require the access token's latest TOTP AMR
timestamp to be no older than ten minutes. The deposit-approval handler also
requires:

- exact same-origin `Origin` matching `ADMIN_APP_URL`;
- `SUPER_ADMIN` or `ADMIN` from `user_roles`;
- a valid idempotency key;
- explicit `APPROVE_DEPOSIT` confirmation;
- a human reason of at least ten characters;
- the existing deterministic database approval function.

Direct calls to the handler receive 401 or 403 before business logic when any
identity, role, AAL2, origin, capability, or recent-step-up check fails.

The current step-up implementation is a truthful access-token AMR freshness
gate. It is not yet an app-owned, single-use database grant. See the remaining
P0 controls below.

## 5. Session boundary and revocation

The admin application uses the storage key `putduk-admin-auth`; the public app
uses a different Supabase browser session namespace. Cookies are host-only,
`SameSite=Lax`, and `Secure` in production. No parent-domain cookie is set, so a
session established on one hostname is not silently reused on the other.

Operators can end the current admin session or request Supabase global sign-out
for all refresh-token sessions. Page and command checks call the live Auth API,
so a revoked session is rejected rather than trusted only from a locally parsed
cookie.

## 6. Security and audit records

The admin login path writes `security_events` for rejected login, accepted
operator login, and successful MFA. No supplied email, password, OTP, IP, or
secret is stored. Until a verified edge IP chain exists, `trusted_client_ip` is
`NULL` and `ip_source` is `NONE`; the application never trusts an arbitrary
forwarded header.

If an accepted login or MFA event cannot be recorded, entry is denied. The
existing deposit command writes its balanced ledger result and immutable audit
inside the deterministic database function.

Member 360 shows a minimal operator summary. It never reads password material,
KYC document paths, encrypted withdrawal destinations, or private AI prompt
content. KYC status/risk summary is limited to `SUPER_ADMIN` and `ADMIN`; its
immutable audit insert must succeed before the read occurs. There is no
impersonation feature.

## 7. Operator UX

The canonical surfaces are implemented as deep reference screens:

- **오늘의 퍼뜩**: exception-first KYC, deposit, withdrawal, settlement, and
  notification queues; automated success does not create manual work.
- **Member 360**: audited, masked name/login-ID/phone search and exact-UUID lookup, identity/account status, lifecycle,
  START/mining/wallet/funding/event/notification/AI/security counts, audited KYC
  summary, and activity timeline.

The UI is responsive and supports system light/dark preference and reduced
motion. Query failures display “확인 필요” or an explicit unavailable state;
they are never converted to a false zero or healthy status.

## 8. Verification contract

Automated tests must continue to prove:

- public admin aliases and the former public admin command are ordinary 404s;
- the public bundle has no admin navigation or public admin URL;
- an authenticated member without `user_roles` is denied;
- AAL1 is denied and AAL2 is mandatory;
- command roles and recent TOTP step-up are checked server-side;
- the admin cookie namespace differs from the public session namespace;
- both public and admin production builds complete independently.

Actual production acceptance additionally requires authenticated browser tests
against an isolated local Supabase stack with operator and normal-member
fixtures. WS-03 does not mutate remote Supabase.

## 9. Historical WS-03 remaining P0 before production operation

This list records the WS-03 assessment. Later schema/auth work must be assessed
against its own code and verification evidence; this historical list is not a
claim about the present implementation. Remote rollout requires separate
authorization:

1. App-owned admin session records with a short idle timeout and bounded
   absolute lifetime independent from refreshed JWT issuance.
2. An admin-specific session revocation registry and “revoke one / revoke all”
   operator evidence, without unintentionally coupling public product sessions.
3. Single-use, server-recorded step-up grants bound to operator, session,
   command family, issue time, expiry, and consumption audit.
4. Rate limiting and automated lock/alert policy for admin authentication and
   MFA attempts.
5. Verified Cloudflare Access/Zero Trust identity binding, IP provenance, WAF,
   and hostname routing in the new PUTDUK MINING account.
6. Authenticated browser E2E for normal user denial, role revocation, MFA
   enrollment/challenge/recovery, session expiry, direct command denial, and
   immutable security/audit evidence.

Until those gates are implemented, locally verified, reviewed, and separately
rolled out, the admin control plane is **FOUNDATION COMPLETE only**, not
production-operational or launch ready.

## 10. Local security changes, 2026-10-06

`register_admin_session` now treats confirmation for one Auth session as an
idempotent operation. Repeated confirmation returns the same live app session
without changing either expiry. A revoked, idle-expired, absolute-expired, or
fingerprint-mismatched session is rejected; a fresh password login establishes a
new Auth session. The existing registration request ceiling also counts
idempotent retries. The login page checks the app registry before redirecting an
existing AAL2 identity, so an expired identity can reach the login form.

Password and TOTP handlers reserve the existing five-failure allowance per
hashed subject and scope in a 15-minute window before contacting Auth. The
service-only, `SECURITY INVOKER` admission function locks the bucket and counts
both failures and unfinished attempts. Success releases its reservation;
failure appends one failure atomically. Finishing the same result again is
idempotent, and a contradictory result is denied. An interrupted request stays
charged until the existing window expires. Immutable events contain a hashed
bucket and scope, without credentials or supplied identity/IP fields.

Admin server components validate the Supabase URL and public key before
constructing client props. An opaque secret key, a legacy service-role JWT, or
an authenticated-role JWT cannot cross that boundary. Client validation remains
an additional check. Member AI chat, feedback, and analytics read JSON through
a byte-bounded stream reader, which cancels oversized bodies while reading and
preserves the existing caps and response codes.

The regression contract includes:

- `apps/admin/tests/admin-auth-atomic-admission.test.ts`: concurrent live
  password/TOTP handler calls honor the atomic RPC receipt and fail closed when
  admission or completion storage is unavailable.
- `apps/admin/tests/admin-public-config-serialization.test.ts` and
  `tests/unit/bounded-api-body.test.ts`: validation precedes client props and
  chunked body accumulation stops at the cap.
- `supabase/tests/database/admin_security_auth_replay.sql`: session replay,
  expiry/revocation, idempotent auth outcomes, privilege boundaries, and pending
  attempt accounting.
- `scripts/assert-admin-auth-admission-concurrency.mjs`: 20 actual concurrent
  local RPCs starting with four failures must admit one attempt and deny 19.
  This probe refuses non-loopback targets and checks the local checkout's
  project and API port before constructing a credentialed client.

These changes are local implementation evidence. Unit/type/lint checks do not
substitute for executing the migrations, database regressions, concurrency
probe, and authenticated browser scenarios. They do not establish remote
deployment status or production readiness.

## 11. User-authorized member search, 2026-10-06

Member 360 now searches legal names and display names by literal substring,
login IDs by literal prefix, exact UUIDs, and complete phone numbers normalized
through the existing signup E.164 rules. Formatted Korean numbers and their
international form find the same profile. Numeric queries retain the login-ID
path; recognizing a phone does not replace it. Phone suffix search is not
enabled because there is no approved policy for that additional match scope.

The POST-only search endpoint repeats the existing active-role, live identity,
AAL2, origin and app-session checks. It preserves Member 360's existing
`ADMIN_ROLES` capability and returns masked names/login IDs/phone numbers with
links to the separately authorized member detail. It does not grant SUPPORT,
CONTENT or VIEWER access to KYC. Audit insertion must succeed before any search
read; the audit contains query kind and allowed output fields, never query
text, phone numbers or returned personal values.

Each text source reads at most 21 rows; combined results contain at most 20
distinct members and explicitly indicate additional matches. Exact phone and
login-ID matches come first. Current profile rows are searched without an
active/banned status filter so operators can find restricted accounts. Deleted
accounts cascade out of the existing profile tables. Passwords, recovery email,
birth dates, KYC records and money data are not search fields or results.
Raw queries stay out of URLs and durable browser storage; API responses are
`private, no-store`. No migration or privilege grant is introduced.
