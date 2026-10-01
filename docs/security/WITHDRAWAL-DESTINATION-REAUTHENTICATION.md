# Withdrawal destination reauthentication

Date: 2026-10-01. Scope: PR #38 P1 sensitive destination replacement only.

The frozen WS-04 command names/signatures remain unchanged. This repair does
not redesign withdrawal holds, welcome conversion, ledger posting or operator
step-up. First registration remains immediately eligible; no funding is needed
for the eligible first welcome withdrawal.

## Trust boundary

1. A same-origin JSON request authenticates the current user with verified
   claims and Auth `getUser`. The owner/email/session come from the server,
   never the request body or editable metadata.
2. The service records a `PENDING` attempt before contacting Auth. Five attempts
   per owner in 15 minutes are permitted, including incorrect passwords,
   unavailable verification and unfinished attempts. Immutable security events
   retain admission history even after logout deletes a grant.
3. A detached non-persistent Auth client verifies the actual password. It must
   return the same owner and a real session. Factor lookup failure denies access.
   If a verified MFA factor exists, a trusted TOTP challenge and actual AAL2 are
   required. Unsupported factors fail closed. The disposable password session
   is signed out **before** challenging MFA on the original caller's SSR client.
   MFA can invalidate other low-assurance sessions; verifying it on a disposable
   session invalidates the caller-bound proof. The caller's existing session is
   therefore upgraded, never replaced or signed out by this helper. Auth user
   and signed claims must retain the same owner/session before and after MFA,
   with actual AAL2 afterward. The SSR client's MFA event persists upgraded
   cookies. Cleanup, identity or assurance failure cannot issue a proof.
4. A 256-bit opaque proof is bound to owner, originating Auth session, method
   and the existing canonical destination fingerprint. Only its SHA-256 hash
   is stored. The DB fixes its five-minute lifetime and verification timestamp.
   Verification/consumption uses the actual DB clock, not the start time of a
   statement that may have waited on a lock.
5. Registration validates the proof against the current verified session before
   invoking the frozen service-only command. The private DB helper serializes
   on the existing owner withdrawal lock and atomically consumes a verified,
   unexpired owner/method/fingerprint/token match in the replacement transaction.
   It is not a public RPC. No arbitrary token string is authority.

The frozen registration signature has no session parameter: the server route
checks current-session equality; the DB session foreign key invalidates a proof
when the bound Auth session is removed. Direct command callers are restricted
to the trusted server role. Ordinary authenticated/anonymous callers cannot
read, issue, verify, consume or delete grants or invoke these commands.

## Accounting and recovery

- First registration creates no additional password step-up or protection delay.
- A replacement retains the existing 24-hour protection period, history,
  encryption, safe-mode check and command rate limit.
- Proof consumption and replacement commit together. Failed validation or a
  failed downstream transaction cannot leave a consumed grant without a change.
- A committed logical binding replay returns its original destination before
  attempting a new registration. Replaying a spent proof is not another change.
- Protected replacement closes only the uncommitted logical intent. It never
  issues a money hold while protection is active.
- A lost registration response is recovered from the authoritative owner-bound
  intent plus protected destination. Serialized cancellation rechecks actual
  monetary effects; a competing committed hold is preserved as uncertain or
  confirmed, never discarded. No new password or registration is needed.
- Display protection metadata is outside the version-2 logical record. DB
  commands still determine eligibility and money; browser time does not.

## Privacy and operations

Passwords and OTPs are transient inputs, cleared immediately on submit, and
never stored in React state, logical records, local storage, audit metadata or
analytics. Opaque proof plaintext exists only in the no-store response and one
registration header. New browser evidence disables credential-bearing traces
and masks all credential/destination inputs in explicit screenshots.

Security events record admission/verification/denial/consumption using owner,
method, grant ID and request ID. They contain neither credentials nor raw
destinations. Expired proofs cannot be used or extended by the application;
session deletion removes them, while the canonical security-event retention
policy governs audit history. Long-lived expired-row cleanup is an operations
retention task, not a grant-renewal or limit-reset mechanism.

Deploy the additive migration before its matching server/UI artifact, in a later
explicitly authorized phase. Do not roll back to random-token registration.
On an incident, fail closed or use the existing withdrawal safe mode; retain
security evidence. No remote migration or deployment is authorized by this PR.

## Evidence gate

Unit tests cover real provider calls, MFA failure/AAL2, cleanup, strict bodies,
origin controls, transient credentials and lost-response monetary safety.
pgTAP covers forced RLS/grants, first registration, missing/arbitrary/expired/
foreign/mismatched/spent proofs, atomic consumption, audit and durable limits.
Authenticated browser tests use actual local Supabase Auth, including MFA,
multiple sessions, concurrent requests and Dark/Light desktop/mobile UI.

Passing source/unit checks alone is not runtime acceptance. Current execution
results live in `docs/quality/PR38-DESTINATION-REAUTH-REPAIR.md`.

Vendor behavior checked against the installed client and official references:
[password verification](https://supabase.com/docs/reference/javascript/auth-signinwithpassword),
[TOTP challenge and AAL](https://supabase.com/docs/guides/auth/auth-mfa/totp),
[factor verification/session behavior](https://supabase.com/docs/reference/javascript/auth-mfa-enroll),
[local-only signout](https://supabase.com/docs/reference/javascript/auth-signout).
