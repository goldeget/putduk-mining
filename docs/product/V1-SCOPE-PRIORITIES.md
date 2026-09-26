# PUTDUK MINING V1 Scope and Priorities

Status: **CANONICAL SCOPE CONTROL**

V1 means limited scope at production quality. It does not mean placeholder security, demo accounting, incomplete states or generic visual design.

## Priority definitions

- **P0 — launch integrity:** must be implemented, verified and operable before production traffic or real-value flows.
- **P1 — V1 product quality:** required for the intended V1 experience; may launch behind a disabled feature flag only when its absence does not compromise P0 truth or safety.
- **P2 — deliberate next:** architecture seam and ownership are documented; implementation is not a V1 launch dependency.
- **P3 — deferred:** no V1 implementation and no speculative infrastructure.

## P0 — launch integrity

### Platform and identity

- repository integrity, protected CI and reproducible release artifacts;
- responsive Korean-first web/PWA shell for mobile, tablet and desktop;
- email/password account creation, sign-in/out, verification and recovery;
- terms/privacy consent version capture and account-state enforcement;
- RLS-backed ownership, server authorization and admin role checks;
- light/dark/system token compatibility, accessibility and reduced motion;
- truthful loading, empty, error, offline and reconnect states.

### Economic core

- PUTDUK START eligibility, start, server-time progress, settlement and terminal states;
- one-time qualified PUTDUK START conversion to real KRW, hard-capped at KRW 5,000;
- first welcome-reward withdrawal with no funding prerequisite;
- server-authoritative mining session and settlement engine;
- versioned economic rules with effective timestamps and segment settlement;
- separate trial and real ledgers;
- true balanced journal, append-only/idempotent wallet projections and treasury reconciliation;
- transactional outbox and versioned domain events for every post-commit effect;
- durable retry/lease/dead-letter/replay foundation with backpressure;
- KRW deposit-request and operator approval path;
- KRW withdrawal-request and operator review path;
- secure withdrawal destinations, receipts and history;
- automatic two-stage referral qualification/risk/recheck/payout foundation;
- funding-promotion rules, budget guards and automatic payout foundation;
- versioned AI-proposed/operator-approved mining product catalog with no runtime market API;
- KYC lifecycle, security evidence and Member 360 source model;
- trusted client-IP adapter that rejects arbitrary forwarded headers;
- public-versus-protected routing and safe deep-link return;
- server-only proprietary formulas/risk rules and private production source maps;
- explicit safe mode and emergency stop that halt new risk while preserving evidence;
- immutable audit records for every privileged/economic mutation.

### Operations and release

- minimum one-person admin queues for deposit, withdrawal, settlement exception and user lookup;
- request, trace, job and audit correlation IDs;
- retry/dead-letter policy with idempotent replay;
- production backup/PITR entitlement verification and a restore rehearsal;
- health/readiness checks that reflect dependencies without leaking secrets;
- rollback procedure for app, configuration and database changes;
- critical-path browser E2E in supported browsers and viewports;
- privacy-safe analytics for activation, settlement and failures.
- lifecycle analytics through welcome withdrawal, no-funding cohort, funding and 7/30-day activity;
- Supabase RLS/grant/advisor gates for every schema delta.

## P1 — V1 product quality

- original PUTDUK black/gold visual system and canonical asset pipeline;
- guided onboarding quest from account completion to first trial result;
- premium 2.5D mining scene with selective capability-gated 3D;
- five V1 mining worlds, equipment and six-rank presentation backed by versioned data;
- events, notices, banners and notification preferences;
- AI event-draft factory plus deterministic mission/achievement/reward engines;
- automatic notice/event fanout and notification fatigue controls;
- installable PWA, web push and validated deep-link routing;
- explanatory PUTDUK AI with authenticated ownership and non-mutating tools;
- canonical Trust Center, FAQ, status and changelog;
- operator-authored non-empty V1 notice/event templates, disabled until dates/content are approved;
- admin controls for content, rules, feature flags and user support evidence;
- visual-regression, accessibility and performance budgets;
- Korean production writing pass and timezone-safe KST presentation.
- Trust/Search/AI discovery pages and structured data from canonical facts;
- Member 360, referral, campaign, reward and dead-letter operator experiences;
- provider-neutral first-party growth attribution;
- production-oriented k6 scenarios, synthetic checks and SLO dashboards.

## P2 — deliberate next

- USDT deposit/withdrawal operations beyond the V1 structural seam;
- richer equipment catalog and advanced rank benefit system;
- Living World events and emotion-based presentation that never changes economic truth;
- operations AI summaries and growth AI recommendations, both read-only/advisory;
- Japan launch, `ja-JP` localization and Japan-specific compliance/content review;
- native iOS/Android shells after PWA retention and capability evidence;
- attribution and campaign optimization beyond privacy-safe first-party parameters;
- advanced support search and case management.
- advanced funding/benefit tiers and richer noncash progression;
- brand/search question-gap monitoring and advisory growth AI;
- staged experimentation UI beyond the P0 assignment/economy separation;
- retention partition/archive automation beyond the documented launch policy.

## P3 — deferred

- marketplace, guilds, social graph and massive live leaderboard;
- multiplayer 3D worlds;
- autonomous agents with mutation authority;
- speculative external-market coupling;
- Cloudflare D1, KV, R2, Queues, Durable Objects, Vectorize or Workers AI without a newly approved requirement;
- transfer or administration of the existing `putduk.com` zone.
- autonomous monetary AI, live-market-priced rewards or runtime securities-price APIs;
- fabricated reviews, users, testimonials, media coverage or reputation content.

## Release scope rule

A P1 feature that misses its acceptance gate may be disabled only if:

1. the feature flag defaults off in production;
2. no P0 flow, public claim or navigation promises it;
3. data migrations remain backward-safe;
4. admin and support know the disabled state;
5. release evidence records the deferral owner and follow-up.

No P0 safety, ledger, authorization, recovery or evidence requirement can be waived by calling the release an MVP.
