# PUTDUK Definition of Done

Status: **REQUIRED RELEASE GATE**

“Implemented” means source exists. “Done” means the feature is specified, secure, observable, operable, recoverable and proven in the target environment.

## Three-state completion gate

- `FOUNDATION COMPLETE` proves the approved architecture and implementation seams exist.
- `FUNCTIONALLY COMPLETE` proves the authorized real backend/domain flow works end to end.
- `PRODUCT COMPLETE` proves the functional flow is a finished production experience.

Only `PRODUCT COMPLETE` counts toward launch readiness. Route, API, schema, component, screenshot or isolated test existence cannot be relabelled as completion.

In addition to the gates below, `PRODUCT COMPLETE` requires all applicable premium PUTDUK UI/UX, Korean production copy, mobile/tablet/desktop, System/Light/Dark, loading/skeleton, empty, validation/error/recovery, success, disabled/unauthorized, hover/press/focus, offline/reconnect, accessibility, reduced motion, browser E2E, actual rendered screenshot review, canonical Visual Lab comparison, visual regression and performance acceptance.

Reject as final output: generic dashboards, default SaaS templates, unmodified shadcn appearance, placeholder cards, bare forms, raw CRUD tables, generic gradients, generic ChatGPT clones, desktop merely stacked on mobile, fake/unconnected UI, `coming soon` in place of required V1 UX and engineering/foundation copy exposed to end users.

## Feature-level gate

Every feature must satisfy all applicable items:

### Product and experience

- owner, user outcome, P0/P1/P2/P3 priority and out-of-scope behavior are explicit;
- Korean copy is reviewed and generated-image text is not used;
- mobile (320 px+), tablet and desktop layouts are complete;
- loading, empty, success, warning, error, disabled, offline and reconnect states are deliberate;
- Light, Dark and System behavior is verified;
- keyboard, focus, screen reader, contrast, 200% text zoom and reduced motion are verified;
- analytics events describe facts, not inferred success.

### Data and authorization

- owning domain and source-of-truth table/function are identified;
- every user row has an explicit ownership/RLS decision;
- privileged routes repeat authorization server-side;
- service-role access is server-only and narrowly used;
- monetary/mining mutations are ledger-first, idempotent and server-time based;
- every monetary journal transaction balances debit and credit before commit;
- wallet/display balances are reconciled projections, never mutable truth;
- any asynchronous follow-up is represented by an outbox event in the same transaction;
- rule/config changes are versioned with effective timestamps where historical truth depends on them;
- sensitive data, retention and deletion behavior are documented.

### Reliability and operations

- request/trace/job/audit IDs connect user-visible failure to operator evidence;
- retries are bounded and safe; terminal failures enter an owned exception/dead-letter state;
- consumer duplicate delivery cannot duplicate money, rewards or notifications;
- duplicate submit, refresh, cancellation, timeout and reconnect behavior is tested;
- an operator can view, pause, resume or resolve the flow without direct database editing;
- high-impact action requires reason, explicit confirmation and audit evidence;
- rollback and recovery path is described and rehearsable.

### Engineering evidence

- formatting, lint, typecheck, unit tests and production build pass;
- database migration lint, security advisors and pgTAP pass for schema work;
- explicit grants, RLS, FORCE RLS where intended, ownership indexes and
  security-invoker views are reviewed for each exposed object;
- browser E2E passes for changed critical flows;
- visual regression, accessibility and performance checks pass where UI changed;
- asset manifest verification passes where visual assets changed;
- secrets and production identifiers are absent from client bundles/logs;
- raw evidence includes exact commit SHA, build/run identifiers and environment.

## Release-level gate

Production release is allowed only when:

1. `git fsck --full` succeeds and the exact authorized remote is reachable;
2. the release commit is present on the intended remote branch and CI checks that exact SHA;
3. required migrations are reviewed, backward-safe and paired with a recovery plan;
4. Supabase target ref is exactly `osrmyjgmpdspdcwqjwuv` before any remote database operation;
5. Cloudflare account ID is recorded and uniquely verified before any account-scoped operation;
6. critical P0 journeys pass authenticated browser tests in the production-like environment;
7. backup/PITR status is verified and the restore procedure has current evidence;
8. app/config/database rollback owners and steps are recorded;
9. monitoring, alerts and operator queues are active and assigned;
10. public status, support and change communication match actual capability.
11. PUTDUK START conversion proves the KRW 5,000 hard ceiling, exactly-once
    payout and withdrawal without funding.
12. referral, promotion and event reward paths prove qualification snapshots,
    budget/risk guards and exactly-once balanced posting.
13. outbox backlog, failed jobs, reconciliation mismatches and notification
    delivery have owned operator queues and replay/runbook evidence.
14. public/protected route inventory proves safe deep-link return and that
    account, wallet, KYC and admin content is non-indexable.
15. no public source map, secret, authoritative formula or lossless master asset
    is present in the production artifact.
16. the public and admin applications build as separate artifacts; the public
    route graph, navigation and bundle contain no privileged admin surface;
17. operator access proves dedicated authentication, current server-owned role,
    AAL2 MFA, bounded session policy and step-up for high-impact commands as
    defined in `docs/security/ADMIN-CONTROL-PLANE-SECURITY.md`;
18. `/admin`, `/administrator`, `/manage`, `/backoffice` and former public admin
    command paths behave like ordinary nonexistent routes on the public app.

## Evidence labels

- `PASS` — requirement and target are proven with current raw evidence.
- `PARTIAL` — a bounded portion is proven; remaining scope is named.
- `SPEC_ONLY` — approved design exists but no implementation proof.
- `ABSENT` — no adequate specification or implementation.
- `BLOCKED` — the exact blocker and required authority/external change are named.
- `NOT_SAFE_TO_INFER` — evidence is insufficient and no claim is made.

An HTTP 200, local green unit test, screenshot or successful child job alone is not formal release acceptance.
