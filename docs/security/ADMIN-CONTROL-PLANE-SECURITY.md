# PUTDUK MINING Admin Control-Plane Security

Status: WS-03 implemented foundation, not a production launch approval

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
- **Member 360**: exact-UUID lookup, identity/account status, lifecycle,
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

## 9. Remaining P0 before production operation

These controls are intentionally not claimed as complete because they require a
reviewed local schema/auth configuration phase and then separately authorized
remote rollout:

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
