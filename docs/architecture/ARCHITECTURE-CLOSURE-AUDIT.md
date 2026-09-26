# PUTDUK MINING Architecture Closure Audit

Audit date: **2026-09-27 KST**

Scope: **authorized local repository only**

Remote Supabase/Cloudflare validation: **not performed; mutation freeze preserved**

Overall state: **FOUNDATION PARTIAL / NOT RELEASE READY**

## 1. Evidence rules

This audit distinguishes specification from implementation. Repository prose is not proof that a production capability exists. Local source is not proof that a remote database, deployment or operator workflow exists.

Status vocabulary:

- `IMPLEMENTED_UNVERIFIED` — coherent local implementation exists but target-environment proof is missing.
- `PARTIAL` — only a bounded portion exists.
- `SPEC_ONLY` — this closure pass defines the contract; production implementation is absent.
- `ABSENT` — no adequate contract or implementation existed at audit time.
- `BLOCKED` — verification/action requires a named external condition.

## 1.1 WS-02 implementation delta and evidence

This pass added local production foundations rather than treating architecture prose as implementation:

| Foundation | Local implementation | Current proof | Remaining proof |
| --- | --- | --- | --- |
| PUTDUK START real conversion | KYC/risk-gated, idempotent RPC; KRW 5,000 hard cap; `funding_required = false` | TypeScript rule tests pass | pgTAP blocked because the local Docker daemon is unavailable |
| First welcome withdrawal | verified destination, cooldown, zero-fee welcome policy, receipt and outbox; no deposit query | unit policy test passes | local DB RPC and authenticated browser journey pending |
| Authoritative money journal | account/header/line model, deferred debit=credit and currency constraints, wallet projection link | unit balance tests pass | migration reset, pgTAP, lint and advisors pending |
| Event propagation | version-matched transactional outbox, consumer dedupe table, leased claim/complete/fail commands | unit version/dedupe tests pass | worker integration and operator backlog UI pending |
| Durable jobs | priority, bounded attempts, leases, attempt history and dead-letter commands | schema/pgTAP test authored | local database execution and worker heartbeat pending |
| Referral and promotions | versioned qualification/claim/campaign data plus 5,000+5,000 cap and first-funding cap rules | unit rule tests pass | event consumer and operator workflow pending |
| Catalog governance | sourced dated DRAFT proposal, 11 neutral products, approval state machine and immutable post-approval children | source review complete | operator approval command/UI and database execution pending |
| Member/security operations | KYC, security/risk/block, lifecycle/timeline, destination and receipt foundations | schema authored | Member 360 UI and full denial/E2E pending |
| Access return | protected-route allowlist and safe post-login return preservation | unit routing tests pass | authenticated browser matrix pending |

Current application evidence from this pass: the full `pnpm verify` gate passed, including 84 asset checks, formatting, ESLint, TypeScript, 82/82 unit tests and the Next.js production build. Playwright passed 14/14 desktop/mobile tests, `git diff --check` passed, and the production browser bundle contains no `.map` files or lossless master assets. This is not release acceptance. The database gate could not start because the Docker Desktop Linux engine pipe was unavailable; no unrelated Docker inventory or historical resource was inspected.

Dimension codes:

- `Y` — present in local source/specification;
- `P` — partial or narrow;
- `N` — absent;
- `—` — not applicable at this layer.

Columns:

- `Spec`: explicit product/technical contract.
- `Impl`: local application/schema implementation.
- `UX`: mobile/tablet/desktop plus loading/empty/error/recovery treatment.
- `Theme`: Light/Dark/System compatibility.
- `Admin`: operator controls/queue.
- `Data`: schema, source-of-truth and versioning.
- `Sec`: authentication, authorization, RLS and sensitive boundary.
- `Obs`: audit, analytics, request/trace evidence.
- `Res`: idempotency, retry, offline/recovery/rollback.
- `QA`: automated and manual acceptance evidence.
- `I18n`: Korean production readiness and Japan seam.

## 2. Forty-area closure matrix

| # | Area | Pri | Status | Spec | Impl | UX | Theme | Admin | Data | Sec | Obs | Res | QA | I18n |
| ---: | --- | :---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 01 | Product definition and information architecture | P0 | PARTIAL | Y | P | P | P | P | Y | P | P | P | P | P |
| 02 | Brand, visual references and asset pipeline | P1 | IMPLEMENTED_UNVERIFIED | Y | Y | P | Y | — | P | Y | P | Y | P | Y |
| 03 | Theme system and design tokens | P1 | PARTIAL | Y | P | P | P | — | — | — | — | P | N | P |
| 04 | Responsive web, PWA and native boundary | P0 | PARTIAL | Y | P | P | P | P | P | P | P | P | P | P |
| 05 | Identity, account lifecycle and consent | P0 | PARTIAL | P | P | P | P | P | Y | P | P | P | P | P |
| 06 | Guided onboarding quest | P1 | SPEC_ONLY | P | N | N | N | N | N | N | N | N | N | P |
| 07 | PUTDUK START trial | P0 | PARTIAL | Y | P | P | P | P | Y | Y | P | Y | P | P |
| 08 | Mining engine and authoritative session state | P0 | PARTIAL | Y | P | P | P | P | Y | Y | P | P | P | P |
| 09 | Premium mining experience / selective 3D | P1 | PARTIAL | Y | P | P | P | — | P | P | P | P | N | P |
| 10 | Living World and emotion presentation | P2 | SPEC_ONLY | P | N | N | N | P | N | N | N | N | N | P |
| 11 | Worlds, equipment and six-rank system | P1 | PARTIAL | P | P | P | P | P | Y | P | P | P | P | P |
| 12 | Economy rules and effective-time versioning | P0 | PARTIAL | Y | P | P | P | P | Y | Y | P | P | P | P |
| 13 | Settlement, offline accrual and reconciliation | P0 | PARTIAL | Y | P | P | P | P | Y | Y | P | P | P | P |
| 14 | Wallet and append-only ledger | P0 | PARTIAL | Y | P | P | P | P | Y | Y | P | Y | P | P |
| 15 | Funding and withdrawals | P0 | PARTIAL | Y | P | P | P | P | Y | Y | P | P | P | P |
| 16 | Events and LiveOps | P1 | PARTIAL | P | P | P | P | N | Y | P | P | P | N | P |
| 17 | Notices, banners, popups and toasts | P1 | PARTIAL | P | P | P | P | N | P | P | P | P | N | P |
| 18 | Push, notification preferences and deep links | P1 | PARTIAL | Y | P | P | P | P | Y | Y | P | P | N | P |
| 19 | User AI, Operations AI and Growth AI | P1/P2 | PARTIAL | Y | P | P | P | N | P | P | P | P | P | P |
| 20 | One-person admin cockpit | P0 | PARTIAL | Y | P | P | P | P | Y | P | P | P | N | P |
| 21 | Emergency stop and safe mode | P0 | PARTIAL | Y | P | N | N | P | Y | P | P | P | N | P |
| 22 | Support, user search and case evidence | P1 | PARTIAL | Y | P | N | N | P | P | P | P | P | N | P |
| 23 | Growth, attribution and ads boundary | P2 | SPEC_ONLY | P | N | N | N | N | N | P | N | N | N | P |
| 24 | Product analytics and experiment evidence | P1 | PARTIAL | Y | P | P | P | P | Y | P | P | P | P | P |
| 25 | Trust center, SEO and AI discovery | P0 | PARTIAL | Y | P | P | P | P | P | P | P | P | P | P |
| 26 | UTC storage, KST display and localization | P0/P2 | PARTIAL | P | P | P | P | P | P | P | P | P | P | P |
| 27 | Accessibility and Korean production writing | P1 | PARTIAL | Y | P | P | P | — | — | P | P | P | N | P |
| 28 | Performance, media delivery and 3D budgets | P1 | PARTIAL | Y | P | P | P | — | P | P | P | P | N | Y |
| 29 | Security, RLS and privilege boundary | P0 | PARTIAL | Y | P | — | — | P | Y | P | P | P | P | — |
| 30 | Jobs, retry, leases and dead-letter handling | P0 | PARTIAL | Y | P | P | — | P | Y | P | P | Y | P | — |
| 31 | Observability, audit and correlation IDs | P0 | PARTIAL | P | P | P | — | P | Y | P | P | P | P | P |
| 32 | Feature flags and configuration control | P0 | PARTIAL | Y | P | N | P | P | Y | P | P | P | N | P |
| 33 | Backup, PITR and restore rehearsal | P0 | SPEC_ONLY | Y | N | — | — | P | P | P | P | P | N | — |
| 34 | Git integrity, CI and artifact provenance | P0 | PARTIAL | Y | P | — | — | — | — | P | P | Y | P | — |
| 35 | Cross-browser E2E and visual regression | P0/P1 | PARTIAL | Y | P | P | P | P | P | P | P | P | P | P |
| 36 | End-to-end user journey acceptance | P0 | PARTIAL | Y | P | P | P | P | P | P | P | P | P | P |
| 37 | Admin journey acceptance | P0 | ABSENT | Y | N | N | N | P | P | P | P | N | N | P |
| 38 | PWA/install/offline/push acceptance | P0/P1 | PARTIAL | Y | P | P | P | P | P | P | P | P | N | P |
| 39 | Animation, WebGL, FPS and memory acceptance | P1 | SPEC_ONLY | Y | N | P | P | — | — | P | P | P | N | — |
| 40 | Production deploy, rollback and disaster recovery | P0 | SPEC_ONLY | Y | N | — | — | P | P | P | P | P | N | — |

## 3. Findings and closure conditions

### 01 — Product definition and information architecture

The five-world loop and domain map are documented; routes cover public, login, trial/mining/wallet/events/menu and a narrow admin. There is no proven production navigation/state map for every role and terminal state. **Close when:** signed-off route/state inventory, role visibility, responsive navigation and critical-journey E2E are current.

### 02 — Brand, visual references and asset pipeline

Canonical references, hashes, custom SVGs, mascot/world/rank masters, AVIF/WebP/PNG variants and a manifest/verifier now exist. App-wide replacement and browser/performance review remain incomplete. **Close when:** every production surface uses manifest assets and passes dark/light/system, crop, byte and accessibility review.

### 03 — Theme system and design tokens

The semantic contract is now defined, while current application styling was originally dark/mint and has no persisted user selector. **Close when:** all components consume the black/gold semantic tokens, System/Light/Dark selection is pre-paint safe and the full state matrix passes.

### 04 — Responsive web, PWA and native boundary

Manifest, service worker, offline route and responsive CSS foundations exist. Install, upgrade, offline mutation, mobile keyboard and standalone lifecycle are unproven; native is intentionally deferred. **Close when:** PWA acceptance matrix passes and native-only claims are absent.

### 05 — Identity, account lifecycle and consent

Email/password UI, Supabase SSR session helpers, callback/confirm routes and profile foundations exist. Username/name/DOB policy, confirmation, full terms-version capture, duplicate resolution, account deletion/export, MFA and recovery completion are incomplete. **Close when:** lifecycle schema/UI/admin/E2E and abuse controls pass with exact-project RLS evidence.

### 06 — Guided onboarding quest

The desired first-value journey is described only at loop level. No resumable quest state, step analytics or operator view exists. **Close when:** a versioned, skippable, resumable Korean quest leads from account completion to a real first trial result without fabricating progress.

### 07 — PUTDUK START trial

Trial tables/functions/routes now include a separate trial ledger plus a one-time KYC/risk-gated real KRW conversion capped at 5,000, a balanced journal, wallet projection and outbox event in one transaction. It never queries funding eligibility. Full authenticated browser proof, database execution, operator visibility and terminal-state UX are missing. **Close when:** local/target pgTAP plus concurrency, refresh/offline, duplicate, abuse and expiration tests pass.

### 08 — Mining engine and authoritative session state

Core schema/functions and server-time principles exist, but production economic configuration is intentionally unseeded and no live engine runner is proven. **Close when:** versioned approved rules, segment settlement, maintenance states, concurrency, operator pause and reconciliation are verified.

### 09 — Premium mining experience / selective 3D

A basic 2.5D core and canonical raster fallback assets exist. There is no capability-gated premium 3D runtime or FPS/memory evidence. **Close when:** the truthful state machine, LOD/fallback, reduced motion and device budgets pass without blocking core actions.

### 10 — Living World and emotion presentation

This is a P2 presentation domain, not an economic source. **Close when:** data inputs, non-manipulative emotion states, admin preview, expiry and fallback are specified before implementation.

### 11 — Worlds, equipment and six-rank system

World/equipment/rank schema foundations and six neutral rank asset families exist. Approved rank names, thresholds, benefits, localization and end-to-end UI/admin behavior are not final. **Close when:** versioned data binds neutral IDs to reviewed copy/rules and no art implies unapproved value.

### 12 — Economy rules and effective-time versioning

Version tables and time-bound rule concepts exist. Operator lifecycle, overlap prevention, approval, preview, safe activation, rollback and production-value ownership are incomplete. **Close when:** immutable/effective-time constraints and segmented settlement are proven under concurrent rule change.

### 13 — Settlement, offline accrual and reconciliation

Trial and wallet settlement paths are present locally. Leased durable job/outbox claim, bounded retry, attempt history, dead-letter data and reconciliation schemas now exist, but no continuously running worker, backfill tool, reconciliation cockpit or production load evidence is proven. **Close when:** at-least-once execution produces exactly-once business effects and every terminal failure is operable.

### 14 — Wallet and append-only ledger

An authoritative balanced account/header/line journal now sits behind the wallet projection. Deferred constraints reject empty, mixed-currency and debit/credit-imbalanced postings; the welcome conversion posts both sides atomically. Local unit tests pass, while pgTAP execution is Docker-blocked. Production reconciliation, pagination/load, reversal workflow and admin evidence remain incomplete. **Close when:** database gates and concurrent mutation/reversal/reconciliation scenarios pass.

### 15 — Funding and withdrawals

Request schema/routes and deposit approval foundations exist; crypto is structural only. A welcome-reward-specific command now supports the first verified KRW withdrawal without prior deposit/funding, with destination cooldown, zero-fee policy, receipt, idempotency and outbox. General withdrawal operator flow, holds, SLA queues and reconciliation remain incomplete. **Close when:** approved V1 rails pass database, authenticated user/admin E2E and reconciliation.

### 16 — Events and LiveOps

Schema/read UI foundations exist, but no operator lifecycle or approved non-empty seed content is proven. **Close when:** draft/preview/schedule/publish/pause/expire/rollback, targeting, timezone, deep link, audit and analytics work with disabled-by-default V1 templates.

### 17 — Notices, banners, popups and toasts

Notice data and UI toast primitives exist. Placement precedence, frequency caps, acknowledgement, admin preview and complete state handling do not. **Close when:** a content contract prevents conflicting or stale messages and critical notices remain accessible.

### 18 — Push, notification preferences and deep links

Subscription/preferences routes, manifest/service worker and safe relative click routing exist. Provider/VAPID deployment, permission education, delivery outcomes, token cleanup and installed-PWA cross-platform tests are missing. **Close when:** opt-in/out and each notification class are end-to-end verified.

### 19 — User AI, Operations AI and Growth AI

The user AI route has guard/context/tool/usage/streaming code and non-mutation rules. Authenticated E2E, durable conversation recovery and provider evidence are not complete; operations/growth AI are P2 advisory specs only. **Close when:** genuine deltas, ownership isolation, cancel/retry/refresh and factual citations pass, with all mutations denied.

### 20 — One-person admin cockpit

Role schema, protected layout, dashboard and deposit approval exist. MFA, withdrawal/settlement/job/support queues, global search, safe mode, flags and SLA/reconciliation views are missing. **Close when:** the daily loop can be completed without direct SQL and every high-impact action is confirmed/audited.

### 21 — Emergency stop and safe mode

Global/domain safe-mode and typed feature-flag schemas now exist, but evaluation adapters, operator UI and game-day evidence do not. **Close when:** switches default safely, propagate predictably, preserve due work/evidence, expose public/operator state and are exercised in a game day.

### 22 — Support, user search and case evidence

Member lifecycle state, immutable timeline, KYC/security/risk/block, destination and receipt foundations now exist. A complete case-management and Member 360 operator surface does not. **Close when:** authorized lookup produces the evidence timeline without exposing secrets, records case notes/actions and separates explanation from financial mutation.

### 23 — Growth, attribution and ads boundary

No production attribution system exists. **Close when:** first-party campaign parameters, consent, retention, anti-PII rules and fact-only reporting are approved; ad-platform mutation stays outside V1 unless separately authorized.

### 24 — Product analytics and experiment evidence

An allowlisted analytics endpoint/client and schema exist. Coverage, identity/consent model, delivery reliability, admin funnels and experiment assignment are incomplete. **Close when:** event dictionary, validation, privacy/retention, deduplication and funnel QA pass.

### 25 — Trust center, SEO and AI discovery

Canonical public-content code/routes, structured data, sitemap, robots and `llms.txt` exist. Editorial admin, production copy/legal review, status/change automation and contradiction checks are incomplete. **Close when:** one approved fact source drives web, AI and search with freshness ownership.

### 26 — UTC storage, KST display and localization

Timestamps largely use timezone-aware database types and selected UI paths use Asia/Seoul. No unified formatter, locale catalog or Japan implementation exists. **Close when:** UTC storage/KST business-boundary tests pass DST-independent logic and all copy/date/number/currency uses a locale seam.

### 27 — Accessibility and Korean production writing

ARIA/reduced-motion foundations exist, but no complete audit or production copy sign-off. **Close when:** keyboard, screen reader, contrast, target size, zoom, forced colors, Korean line breaking and error language pass every P0/P1 journey.

### 28 — Performance, media delivery and 3D budgets

Responsive AVIF/WebP assets and manifest integrity exist. Route budgets, field/lab monitoring, critical preload decisions, cache policy and 3D measurements do not. **Close when:** budgets are recorded and enforced without lowering visual quality.

### 29 — Security, RLS and privilege boundary

RLS/policies/functions and server-only admin helpers exist locally. Exact production-project advisors, penetration/abuse review, MFA and secret-rotation evidence are unavailable. **Close when:** migration tests, Supabase advisors and authenticated cross-user/admin denial tests pass on the exact authorized target.

### 30 — Jobs, retry, leases and dead-letter handling

Job/outbox attempt schemas and service-only `SKIP LOCKED` lease claim, complete and fail commands now exist with bounded attempts and dead-letter exhaustion. No worker process, heartbeat extension, operator DLQ or replay UI is proven. **Close when:** migration tests plus concurrent claim, lease expiry, backoff, terminal quarantine, replay and idempotency tests pass.

### 31 — Observability, audit and correlation IDs

Audit and request/idempotency foundations exist but are not end-to-end. **Close when:** request→domain command→job→ledger→audit can be followed by IDs, sensitive fields are redacted and alert/runbook ownership is active.

### 32 — Feature flags and configuration control

Typed/versioned flag and experiment-assignment data foundations plus safe-mode controls now exist. Evaluation adapters, expiry automation, operator UI and audit-integrated mutation commands do not. **Close when:** server evaluation, owner/scope/default/expiry, safe rollout and UI are proven; flags never replace authorization.

### 33 — Backup, PITR and restore rehearsal

Supabase Pro is stated, but entitlement/retention and restore evidence were not queried under the freeze. **Close when:** exact-project backup/PITR state is verified and a clean authorized restore drill validates schema, RLS, ledger and app compatibility.

### 34 — Git integrity, CI and artifact provenance

The exact authorized origin is reachable. A normal fetch initially left reachable parent `c27b7c542ccb8808a2656a62c9d0536dffd87f06` missing because local negotiation advertised its descendants; `git fetch --refetch origin develop` recovered the original object graph without rewriting history. `git fsck --full` now exits successfully with no missing/broken objects. The preflight archive is `.ws02-recovery/20260927-041213/workspace-preflight.zip` (SHA-256 `C53EC07CF64A73037D6116559B5A5D91665762E4408AA8536E36046A6B4D605E`, locally excluded). **Close when:** feature commits are on the exact remote, CI succeeds for that SHA and PR integration completes.

### 35 — Cross-browser E2E and visual regression

Playwright foundation smoke coverage exists. Authenticated journeys, browser/device matrix, screenshot baselines, accessibility and performance automation are incomplete. **Close when:** the matrix in `BROWSER-QA-MATRIX.md` passes for the release SHA.

### 36 — End-to-end user journey acceptance

Local pages/APIs cover portions of the loop but not a proven complete user outcome. **Close when:** account→trial→settlement→wallet→funding/withdrawal→notification/trust journeys run with real server state and recovery cases.

### 37 — Admin journey acceptance

No full operator E2E exists. **Close when:** MFA/role denial, queues, confirm/reason/audit, replay/safe mode and reconciliation pass with least-privilege accounts.

### 38 — PWA/install/offline/push acceptance

Technical shell files exist. Cross-platform install, icon/mask, service-worker upgrade, cached/offline truth, permission and deep-link results are unproven. **Close when:** iOS, Android and desktop installed-PWA scenarios pass.

### 39 — Animation, WebGL, FPS and memory acceptance

Motion principles and reduced-motion CSS exist; no WebGL performance harness or device evidence. **Close when:** cinematic and fallback paths meet the defined interaction, FPS, long-task, memory and reduced-motion gates.

### 40 — Production deploy, rollback and disaster recovery

Cloudflare and Git/CD decisions are documented only. Cloudflare account ID and hostname delegation are unresolved; no production pipeline exists. **Close when:** exact account/topology are authorized, adapter compatibility passes, immutable deploy/rollback works and a recovery exercise produces current evidence.

## 4. Priority summary

The V1 critical path is not “build every row.” It is:

```text
preserve verified Git integrity
→ finish P0 identity/security/economic correctness
→ provide operator safety and recovery
→ prove critical browser/database flows
→ integrate P1 brand/mining/PWA quality
→ provision only the minimal approved runtime
```

P2/P3 domains remain explicit seams, not launch blockers and not a reason to provision speculative infrastructure.

## 5. Current hard blockers

1. **Cloudflare:** account ID remains `UNKNOWN`; account-scoped calls/provisioning are forbidden.
2. **Production database truth:** remote Supabase mutation/verification is intentionally frozen for this architecture closure pass.
3. **Local database verification:** Docker Desktop Linux engine is not running, so migration reset, pgTAP, lint and advisors are currently unverified.
4. **Product values:** economic/rank/event values remain unapproved and must not be inferred from visual mockups.
