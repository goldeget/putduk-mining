# PUTDUK MINING — Master Architecture

Status: **CANONICAL TARGET ARCHITECTURE / IMPLEMENTATION PARTIAL**

Architecture version: `2026.09.27-WS-03`

Product state: **greenfield 0→1; not production ready**

This document is the architectural source of truth. It defines the intended system; it is not evidence that every capability is implemented. Current closure state is recorded in `ARCHITECTURE-CLOSURE-AUDIT.md`.

## 1. Absolute project boundary

PUTDUK MINING is built only from this repository and its explicitly authorized services:

- workspace: `C:\Users\PC\Desktop\putduk-mining`;
- GitHub: `goldeget/putduk-mining`;
- Supabase: `putduk-mining`, ref `osrmyjgmpdspdcwqjwuv`, `ap-northeast-2`;
- Cloudflare: the new PUTDUK MINING account, whose account ID remains unknown;
- future hosts: `mining.putduk.com`, `admin.mining.putduk.com`.

No previous implementation, schema, asset, Docker resource, repository or similarly named project is valid evidence. The current `putduk.com` account/zone is outside scope and must not be inspected or changed.

## 2. Product definition

PUTDUK MINING is a Korean-first virtual mining platform. Users enter a guided trial, operate mining worlds, receive server-authoritative settlement and inspect a ledger-backed wallet. The product combines fintech clarity, premium game-world immersion and operational transparency without coupling its economy to external securities or exchange-market prices.

V1 worlds:

- KOREA;
- USA;
- GOLD;
- SILVER;
- CRYPTO.

World names are internal product concepts. Their calculations come only from PUTDUK's approved, versioned rules.

## 3. V1 outcome and scope

The target loop is:

```text
trusted discovery
→ account creation and consent
→ guided PUTDUK START
→ first authoritative mining result
→ trial completion
→ eligible welcome-reward conversion (maximum KRW 5,000)
→ first withdrawal without a funding prerequisite
→ optional funding decision
→ real mining and settlement
→ ledger/wallet evidence
→ event, notification and explanatory AI
→ return
```

P0/P1/P2/P3 ownership is defined in `docs/product/V1-SCOPE-PRIORITIES.md`. Scope may be narrow; security, truth, recovery, accessibility and visual quality may not be reduced.

## 4. System principles

1. **Server authority:** clients render state; they do not determine time, eligibility, rewards, balances or approval.
2. **Ledger first:** every asset mutation produces an immutable business record before a derived balance is trusted.
3. **Effective-time rules:** economic behavior is versioned and applied by timestamp; new rules do not rewrite history.
4. **Idempotent commands:** retries, duplicate taps and at-least-once jobs produce one business effect.
5. **Separation:** trial and real assets never mix; user/admin/public surfaces have explicit authorization boundaries.
6. **Operability:** every critical flow has an operator queue, reasoned action, audit and recovery path.
7. **Truthful experience:** UI and motion never fabricate progress or completion.
8. **Minimal infrastructure:** one capability has one owner; no duplicate database, queue or object store without proof.
9. **Privacy and least privilege:** client exposure, RLS, service-role use, retention and logs are intentionally bounded.
10. **Evidence before readiness:** source code or a green sub-job alone is not production acceptance.
11. **Transactional propagation:** a domain mutation and its versioned outbox event commit together; provider dual writes are forbidden.
12. **Operator control, system automation:** normal qualification, payout, retry, fanout and reconciliation are automated under versioned operator policy; only genuine exceptions require manual work.

## 5. Domain ownership

### Permanent completion model

Every user/admin capability is tracked independently as:

- `FOUNDATION COMPLETE`: architecture, schema, route, component and test seams exist;
- `FUNCTIONALLY COMPLETE`: the authorized real domain flow works end to end, including validation and recovery;
- `PRODUCT COMPLETE`: the functional flow meets the canonical visual benchmark and all applicable production UX, browser, accessibility, state, motion and performance gates.

Only `PRODUCT COMPLETE` contributes to launch readiness. A route, API, schema, component, attractive static screen or green unit test cannot substitute for the final state. Product completeness requires actual browser-rendered review across mobile/tablet/desktop and System/Light/Dark, state coverage, Korean production copy, reduced motion, accessibility, benchmark comparison and visual regression where appropriate.

Generic dashboards, default SaaS templates, unmodified component-library styling, placeholder cards, bare forms, raw CRUD tables, random gradients, generic chat clones, stacked-desktop mobile, fake/unconnected data, `coming soon` in place of V1 flow and engineering copy in consumer UI are architectural acceptance failures.

```text
Identity ─ account, profile, consent, session, roles
Trial ─ eligibility, quota, trial session, trial ledger and welcome conversion
Catalog ─ versioned mining-product registry, availability and visuals
World ─ world catalog and presentation configuration
Equipment ─ inventory, capability and upgrade rules
Rank ─ neutral rank IDs, thresholds and presentation
Economy ─ rule versions and effective-time configuration
Mining ─ authoritative sessions and status
Settlement ─ segmentation, due work, command results, reconciliation
Wallet ─ accounts, projections and statements
Ledger ─ balanced journal, append-only projections, reversals and reconciliation
Funding ─ deposit/withdrawal requests, destinations and promotion rules
Referral ─ attribution, versioned qualification, risk hold and automatic payout
LiveOps ─ event factory, deterministic rewards, notices, missions and targeting
Notification ─ preferences, subscriptions, delivery and deep links
AI ─ read-only/explanatory user AI and future advisory ops/growth AI
Trust ─ canonical facts, FAQ, status and changelog
Analytics ─ validated fact events, funnels and experiments
Admin ─ queues and role-bounded commands; not a second business layer
Audit ─ immutable actor/action/target/change evidence
Security/KYC ─ identity evidence, trusted client context, risk and controls
Outbox/Jobs ─ versioned events, leases, retry, dead letter and replay
System ─ flags, experiments, safe mode, health and observability
```

A domain owns its invariants and commands. UI route or admin page location does not transfer ownership.

## 6. Runtime topology

```text
Public browser / installed PWA             Operator browser
  │ HTTPS                                   │ HTTPS
  ▼                                         ▼
Root Next.js public application             apps/admin Next.js application
  mining.putduk.com                           admin.mining.putduk.com
  ├─ public/user UI                           ├─ dedicated operator login + MFA
  ├─ user route handlers/actions              ├─ role/capability/step-up boundary
  └─ static/PWA assets                        └─ admin-only commands and UI
  │                                         │
  └──────────────────┬──────────────────────┘
                     ▼
  Supabase Auth + PostgreSQL (RLS + domain RPC + immutable audit)
  ├─ Realtime only where a proven UX needs it
  ├─ Storage for approved product objects
  └─ approved external AI/push provider through server boundary
```

Candidate edge runtime is Cloudflare Workers plus static assets, subject to a compatibility gate. Cloudflare is not the economic source of truth. PostgreSQL remains authoritative.

The two applications are separate builds and deployments. The public application does not register `/admin`, `/administrator`, `/manage`, `/backoffice` or an admin command API and does not import privileged admin UI. Those paths are ordinary public-app 404s. Shared code may contain neutral primitives and domain contracts only; it cannot collapse the authentication, cookie, runtime or bundle boundary.

## 7. Frontend architecture

- Next.js App Router, React and TypeScript;
- server components by default; client components only for interaction/browser APIs;
- Route Handlers/Server Actions call validated domain functions;
- semantic design tokens and custom SVG icon system;
- 2D/2.5D for ordinary UI and selective capability-gated 3D for mining;
- installable PWA with an explicit offline/mutation contract;
- Korean-first copy with an i18n seam for future `ja-JP`;
- mobile, tablet and desktop parity for all critical actions.

The Next.js version in this repository is authoritative. Agents must read its installed documentation before changing framework conventions.

## 8. Canonical visual architecture

The two files in `docs/design/visual-references/` are the canonical art-direction masters. The durable specification in `docs/design/visual-lab/` (`visual-lab-2026.09.27-v1`) is the canonical product visual/UX benchmark. Its private Site source commit is `a8206957b1cb540291ad4e840e7f8835487e0380` and deployment ID is `appgdep_6ab84fdd747c81919198ed1968163109`; neither the Site nor its prototype state is a production runtime or backend dependency. Together these sources establish:

- cinematic black/gold identity;
- Earth/space atmosphere and warm gold lighting;
- premium metallic material language;
- the sprout-miner PUTDUK mascot;
- planetary rank-emblem direction;
- premium app/PWA production quality.
- canonical screen composition, responsive priority and interaction intent.

They do not establish final copy or economics. The only exact Korean brand spelling is `퍼뜩`. All production copy is real application typography or reviewed SVG content; text baked into generated images is forbidden.

Runtime rules, versions and responsive formats are defined in:

- `docs/design/PUTDUK-VISUAL-DIRECTION.md`;
- `docs/design/PUTDUK-BRAND-ASSET-SYSTEM.md`;
- `docs/design/PUTDUK-THEME-SYSTEM.md`;
- `docs/design/PUTDUK-MOTION-EXPERIENCE.md`.

## 9. Theme, accessibility and state model

`System` is the default theme preference with complete Light and Dark modes. Business state never varies by theme.

Every critical screen defines:

- loading and skeleton;
- empty;
- success;
- warning;
- validation and server error;
- disabled/unauthorized;
- offline and reconnect;
- stale/revalidation state where applicable.

Accessibility includes keyboard/focus, screen readers, contrast, target size, 200% text zoom, forced colors, Korean readability and reduced motion. No critical state is represented by color, animation or imagery alone.

## 10. Identity and account lifecycle

V1 identity uses Supabase Auth with application-owned profile/consent state.

Required lifecycle:

```text
sign up
→ validate email/password confirmation and required fields
→ record terms/privacy document versions and consent timestamps
→ verify identity channel
→ create owned application profile atomically/idempotently
→ active session
→ recovery / sign-out-all / account-state enforcement
→ export/deletion process per approved policy
```

Server routes validate current user identity; RLS enforces row ownership. Admin status changes require role authorization, reason, audit and appropriate user communication. MFA is mandatory for production operators.

## 11. Guided onboarding quest

P1 onboarding is a versioned, resumable sequence that leads to a real first result:

```text
complete profile/consent
→ understand trial separation
→ choose/start eligible KOREA trial
→ observe authoritative status
→ settle first result
→ read trial ledger evidence
→ understand next safe action
```

Quest progress records completed domain facts, not arbitrary frontend steps. It is skippable where legally/product-safe, supports return/recovery and emits privacy-safe analytics.

## 12. PUTDUK START trial and real welcome reward

- maximum duration: 24 hours;
- completion: quota reaches 100% or time expires, whichever occurs first;
- default world: KOREA;
- server-time accrual while app is closed;
- separate trial account and trial ledger;
- one active eligible trial per user under approved policy;
- trial presentation target and real conversion cap are separate configuration;
- settlement is idempotent and preserves applied rule versions.

An eligible completed trial converts at most once through an explicit
`TRIAL_REWARD_CONVERSION`/`WELCOME_REWARD` command into the real KRW wallet. The
launch hard ceiling is KRW 5,000. KYC, identity and anti-abuse qualification are
required; funding is never required for this conversion or its eligible first
withdrawal. The command posts a balanced journal transaction, projection and
outbox event atomically. A trial balance is never relabeled as real money.

Canonical contract: `docs/product/TRIAL-WELCOME-WITHDRAWAL.md`.

## 13. Mining and settlement engine

Conceptual formula:

```text
elapsed interval
× base mining rate
× equipment efficiency
× world multiplier
× event multiplier
× status multiplier
= segment result
```

Authoritative calculation uses fixed/decimal database-safe arithmetic and server timestamps. No per-second database write is required. `last_settled_at` or an equivalent cursor anchors settled time.

If any effective rule changes inside an interval, the engine splits the interval at each boundary and records the exact rule/config versions. The command locks or otherwise serializes the subject, validates expected state, writes settlement and ledger/audit effects in one transactional boundary, then advances the cursor.

Mining status:

- `NORMAL`;
- `REDUCED`;
- `MAINTENANCE`;
- `PARTIAL_STOP`;
- `STOPPED`.

Each status has explicit start/end behavior, user copy, admin authority and settlement semantics.

## 14. Economy and configuration

Economic configuration is immutable/versioned after activation:

```text
draft → validated preview → approved → scheduled → active → superseded
```

Constraints prevent overlapping effective windows for the same rule scope. Preview uses the same calculation library/function as execution. Activation, cancellation and emergency override require actor, reason, diff and audit. No economic values are inferred from visual references or seeded without product-owner approval.

## 15. Wallet, balanced ledger and reconciliation

Core model:

```text
domain command
→ balanced ledger transaction
→ debit/credit ledger entries
→ append-only wallet projection
→ derived/reconciled balance and receipt
```

Minimum ledger event families:

- `DEPOSIT`;
- `WITHDRAWAL`;
- `MINING_REWARD`;
- `TRIAL_REWARD_CONVERSION`;
- `WELCOME_REWARD`;
- `EVENT_REWARD`;
- `FUNDING_PROMO_REWARD`;
- `REFERRAL_REWARD`;
- `UPGRADE_COST`;
- `REFUND`;
- `REVERSAL`;
- `ADMIN_ADJUSTMENT`.

Each posted transaction has one currency, at least two positive integer-atomic
entries and equal debit/credit totals. No arbitrary balance overwrite. Reversal
references the original transaction; adjustment requires a bounded approved
command, reason and immutable audit. All monetary commands require a stable
idempotency key and ownership/authorization check. Canonical model:
`docs/architecture/LEDGER-RECONCILIATION.md`.

## 16. Funding and withdrawal

Primary V1 denomination is KRW.

```text
deposit request
→ bank-transfer instruction
→ operator evidence/review
→ idempotent approval
→ DEPOSIT ledger entry
→ notification and reconciliation
```

```text
withdrawal request
→ validation and balance hold/reservation
→ operator review
→ approved transfer or rejection/release
→ WITHDRAWAL/release ledger effect
→ notification and reconciliation
```

The welcome-reward withdrawal path must not check for a prior deposit. The
funding promotion engine supports funding-only, activity-only, hybrid,
progression and referral campaigns. The normal first-funding promotion is
capped at KRW 10,000; an explicitly approved special operator campaign may use
a higher configured cap and budget. See `docs/product/FUNDING-PROMOTIONS.md`.

USDT remains a secondary P2 operational seam unless specifically approved for V1. No exchange API or external-price dependency is assumed. Destination data is sensitive and receives encryption/redaction/retention controls, history, cooldown and step-up authentication.

## 17. Transactional outbox, jobs and reconciliation

Every domain transaction that requires asynchronous effects writes a versioned
outbox event in the same commit. Due/background work uses a PostgreSQL-owned job
model unless scale evidence proves another system necessary. Canonical event
and compatibility rules are in `docs/architecture/DOMAIN-EVENTS-OUTBOX.md`.

Required fields/behavior:

- job ID, command type and payload/version digest;
- business idempotency key;
- state, priority, availability time and attempt count;
- lease owner/expiry and heartbeat for long work;
- bounded exponential backoff with jitter;
- classified retryable/permanent failure;
- terminal exception/dead-letter state;
- request/trace/audit linkage;
- operator replay using the same idempotency key.

Consumers record `(consumer, event_id)` delivery, use bounded exponential
backoff/jitter, recover expired leases, apply backpressure and preserve terminal
dead-letter evidence. A user browser is never the job runner.

Reconciliation compares domain commands, ledger effects, projections and external/manual decisions. Mismatches enter an operator queue; they are never silently patched.

## 18. Events, referrals, promotions and live operations

Content lifecycle:

```text
draft → preview → scheduled → published → paused/expired → archived
```

Every item has owner, Korean copy, targeting, start/end timestamps, timezone interpretation, priority, placement, deep link, accessibility text, analytics and audit history. V1 includes reviewed, non-empty notice/event templates that remain disabled until copy, dates and economic implications are approved.

AI may create a complete draft bundle, but deterministic approved rules own
publication, qualification, budget/risk guards and payout. Events, referrals
and promotions post money only through balanced journal commands. Normal
referral qualification and stage payouts are automatic; ambiguous cases enter
the operator queue. See `docs/product/EVENT-REWARD-ARCHITECTURE.md` and
`docs/product/REFERRAL-AUTO-PAYOUT.md`.

## 19. PWA, push and deep links

Required:

- standards-compliant manifest with 192/512/maskable assets;
- service worker with versioned shell and safe upgrade;
- an honest offline shell and no queued financial mutation without explicit protocol;
- education before push permission request;
- subscription ownership, rotation/cleanup and preference categories;
- server-side send policy and delivery evidence;
- allowlisted same-origin deep links;
- iOS, Android and desktop installed-mode QA.

Push is a convenience channel, never the sole record of an economic or security event.

Published notices/events fan out automatically from outbox events. Preference,
quiet-hours, cooldown, daily-cap, digest and critical-service override rules
prevent notification fatigue. Canonical flow:
`docs/architecture/NOTIFICATION-PWA.md`.

## 20. PUTDUK AI

### User AI (P1)

May explain, summarize, retrieve authorized context and recommend next actions. It uses genuine provider streaming and durable user-owned conversation state when enabled.

### Operations AI and Growth AI (P2)

May summarize queues/failures or propose experiments from authorized facts. Their output is advisory.

No AI may mutate a balance/ledger, approve funding/withdrawal, decide a reward, change a rule/flag/role, publish content or claim unavailable evidence. Tools enforce these denials on the server. Provider failures are visible and recoverable; fake timer progress and chain-of-thought exposure are forbidden.

## 21. Admin and one-person operations

Roles:

- `SUPER_ADMIN`;
- `ADMIN`;
- `CONTENT_ADMIN`;
- `SUPPORT_ADMIN`;
- `VIEWER`.

The admin hostname is a routing/blast-radius boundary, not authorization. The separately built `apps/admin` control plane uses its own authentication cookie and requires live user verification, an active server-owned `user_roles` record and AAL2 TOTP MFA. High-impact commands additionally require recent TOTP step-up, exact origin, capability, idempotency, explicit confirmation and reason. `user_metadata` never grants authority. The cockpit owns deposit, withdrawal, settlement/job exception, support, content, security and audit queues with SLA/age/severity.

High-impact commands require:

1. current role revalidation;
2. target/current-state readback;
3. explicit confirmation and reason;
4. idempotent domain command;
5. immutable audit diff and correlated result;
6. notification/reconciliation where applicable.

Full operating model: `docs/operations/AUTONOMOUS-ONE-PERSON-OPERATIONS.md`. Implemented and remaining security truth: `docs/security/ADMIN-CONTROL-PLANE-SECURITY.md`.

## 22. Safe mode, feature flags and experiments

P0 safe mode can pause signup, trial, new mining, settlement execution, funding
approvals, withdrawals, referral/event payouts, notifications and AI
independently while preserving pending work and evidence.

Feature flags are typed configuration with owner, scope, default, expiry and audit. Server-side evaluation is required for behavior with security/economic impact. A flag is not authorization and cannot bypass schema invariants.

Experiment assignment is stored separately from economic rule versions. UI
experiments may change presentation; they never silently randomize monetary
truth.

## 23. Trust, discovery and public truth

Public routes include About, How It Works, PUTDUK Facts, Verification, Mining Rules, Trial, Economy, Deposit, Withdrawal, FAQ, Status, Changelog and AI explanations.

One canonical fact layer feeds pages, structured data, sitemap, PUTDUK AI and machine-readable discovery. Claims include effective date and owner. Status and changelog report actual availability and changes without exposing sensitive incident details. Reviews, member counts, testimonials and media coverage are never fabricated. Canonical rules: `docs/trust/TRUST-SEARCH-AI-DISCOVERY.md`.

## 24. Analytics and growth evidence

Analytics accepts only versioned allowlisted events. Events identify factual transitions—request created, settlement accepted, notification opened—not inferred intent or success. Server-confirmed conversions are emitted server-side where appropriate and deduplicated.

Attribution is first-party, consent-aware and strips sensitive parameters. Experiments record assignment version and guardrails. Growth automation may recommend but not publish or mutate without a distinct approved workflow.

## 25. Time and internationalization

- persist instants as UTC-aware timestamps;
- calculate business boundaries explicitly in the approved timezone;
- present Korean V1 dates in `Asia/Seoul`;
- centralize date, number and currency formatting;
- keep copy in a message/catalog seam even before translation;
- do not concatenate Korean grammatical fragments from generated pieces;
- Japan/`ja-JP` is P2 and requires separate product, legal and content approval.

## 26. Security

- deny-by-default RLS on exposed application tables;
- explicit grants and security-definer search paths;
- server-side authorization on privileged routes;
- service role never enters client code;
- rate/abuse controls on auth, AI, funding, settlement and analytics;
- secrets in managed secret storage, never committed/logged;
- sensitive data encrypted/redacted and retained only by policy;
- session/cookie security, CSRF/origin review and safe redirects;
- operator MFA and role-change audit;
- dependency, migration and database-advisor gates.

KYC, session/IP/device telemetry, destination changes and Member 360 views are
least-privilege and audited. A shared IP alone never causes a permanent block.
Client IP is accepted only through a configured trusted-proxy adapter; arbitrary
`X-Forwarded-For` is ignored. Authoritative formulas, risk weights and fraud
logic remain server-only, and production source maps are not public. Canonical
protection rules: `docs/security/TECHNOLOGY-PROTECTION.md`.

## 27. Observability

Every request receives or propagates a request/trace ID. Domain command, job, ledger and audit records retain correlation without placing secrets/PII in logs.

Minimum signals:

- availability/readiness and dependency latency;
- route/domain error rate;
- settlement due age/failure/retry;
- ledger reconciliation mismatch;
- deposit/withdrawal queue age;
- job lease/dead-letter state;
- push and AI provider failure;
- safe-mode/flag changes;
- admin security events.

Alerts name a severity, owner and runbook. Readiness does not return green when a required dependency or migration state is unsafe.

SLIs/SLOs cover auth availability, core latency, settlement success, outbox/job
backlog, notification delivery and reconciliation health. k6 or an equivalent
stack exercises signup bursts, 10k trial-return concurrency, settlement/fanout/
referral batches, Member 360 queries and AI bursts. Scale is claimed only from
measured evidence.

## 28. Backup, restore and disaster recovery

Supabase Pro backup/PITR capability must be verified on the exact project; it is not assumed from plan name alone. Storage objects, third-party configuration and secrets require separate inventory/recovery.

A restore rehearsal uses only an explicitly authorized isolated recovery target and validates schema, RLS/grants, constraints, representative ledger chains, row counts, migrations and application compatibility. RPO/RTO are evidence-based. Recovery never inspects a historical project.

## 29. Mining product catalog

Mining products are versioned virtual themes across Korean stocks, U.S. stocks,
Gold, Silver and top-tier crypto. There is no runtime market API and no market
price enters the economy. AI produces a sourced dated `DRAFT` proposal;
operators approve/schedule; deterministic code publishes. React never hardcodes
the list. See `docs/product/PRODUCT-CATALOG.md`.

## 30. Cloudflare decision

Cloudflare remains **documented, not provisioned** until the new account ID, plan, runtime compatibility and hostname delegation are verified.

V1 candidates only:

- user web Worker/static assets;
- isolated admin Worker or reviewed hostname-separated entrypoint;
- Workers request protection/logging tied to those runtimes.

Explicitly rejected without a new requirement: D1, KV, R2, Queues, Durable Objects, Vectorize and Workers AI. Supabase owns database/auth/realtime/storage/jobs unless evidence changes the decision.

Current Cloudflare guidance recommends `vinext` for Next.js on Workers but identifies it as beta and calls for a compatibility check. Adoption is therefore gated; it is not assumed. The existing `putduk.com` account/zone stays untouched. See `docs/operations/CLOUDFLARE-INFRASTRUCTURE.md`.

## 31. Git, CI/CD and release

Release sequence:

```text
healthy authorized Git graph
→ reviewed commit
→ exact-SHA CI and immutable artifact
→ preview/integration evidence
→ backward-safe migration preflight
→ authorized deployment
→ readiness and bounded functional verification
→ monitoring/reconciliation
→ formal release record
```

Git push, Supabase remote changes and Cloudflare provisioning/deploy are separate authorization boundaries. No force push, `--no-verify`, acceptance weakening or target switching. Detailed policy: `docs/development/GIT-CI-CD-POLICY.md`.

## 32. Definition of done and QA

The mandatory gate is `docs/quality/DEFINITION-OF-DONE.md`; browser/device/state coverage is `docs/quality/BROWSER-QA-MATRIX.md`.

Release evidence must include exact SHA, workflow/run/artifact IDs and digests, migration set, deployed version, target identifiers, browser/device versions, raw failures, recovery/rollback state and operator ownership.

## 33. Architecture decision gate

Before implementation, answer:

1. Which domain owns the invariant and data?
2. What is the source of truth?
3. Does it mutate an asset or privilege?
4. What is the idempotency/concurrency boundary?
5. Does historical truth require effective-time versioning?
6. What authentication, authorization and RLS apply?
7. What audit, analytics and correlation evidence is required?
8. What loading/error/offline/retry/recovery states exist?
9. What can the operator inspect, pause, replay or roll back?
10. How do mobile/tablet/desktop, Light/Dark/System, accessibility and reduced motion behave?
11. What is the Korean source copy and future localization seam?
12. What tests and target-environment evidence close the work?
13. Does it duplicate an existing platform capability or increase cost/blast radius?
14. Could it contradict the public truth layer or imply an unapproved value?

Unanswered gates mean the feature is not ready to build or provision.

## 34. Current truth

This repository contains meaningful application, schema, test, isolated-admin and visual-benchmark foundations, but most domains are partial and no production deployment is established. Access to the exact authorized GitHub origin is verified, the previously missing reachable object was restored from that origin without rewriting history, and `git fsck --full` passes without missing or broken objects. Every WS-03 integration remains subject to exact-baseline verification, pull-request CI and merge evidence under repository policy. Remote Supabase and Cloudflare remain untouched, and the Cloudflare account ID is unknown. No production-readiness claim is valid until every P0 row in the release-readiness matrix and the release definition of done passes.
