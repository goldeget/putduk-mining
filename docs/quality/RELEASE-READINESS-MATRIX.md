# PUTDUK MINING Release-Readiness Matrix

Status date: `2026-09-27 KST`

This matrix separates architecture presence, working domain flow and production experience. Only a `PRODUCT COMPLETE = PASS` row may contribute to launch readiness. `PARTIAL`, `SPEC_ONLY`, `ABSENT`, `BLOCKED` and `NOT_SAFE_TO_INFER` never count as pass.

| Priority | Capability | FOUNDATION COMPLETE | FUNCTIONALLY COMPLETE | PRODUCT COMPLETE | Current evidence / next gate |
| --- | --- | --- | --- | --- | --- |
| P0 | Repository integrity and CI integration | PASS | PASS | PASS | PR [#2](https://github.com/goldeget/putduk-mining/pull/2) passed all three CI workflow jobs at exact head `a28bad387af21e9c7aaf6ffc185a4e594b42c122` in run `36284465615` and merged to `develop` as `eaaf7616be9b8f627a44d59510909068b023ed0c`; `main` remained unchanged and the remote feature branch was deleted. |
| P0 | Immutable release artifact and deployment provenance | PASS | BLOCKED | BLOCKED | The release policy defines the required evidence, but CI did not publish an immutable deploy artifact/version/digest and no production deployment was authorized. |
| P0 | Database 0→latest, pgTAP, RLS, lint and advisors | PASS | PASS | BLOCKED | Exact-head isolated GitHub CI run `36284465615` rebuilt PostgreSQL from zero through the latest migration and passed all 222 pgTAP assertions, schema lint and security advisors. `BLOCKED_LOCAL_DB_RUNTIME` remains only a local-environment limitation; the production Supabase target is unverified and was not mutated by WS-03. |
| P0 | Login, signup, identity, consent and recovery | PASS | PARTIAL | BLOCKED | ID/email login, required profile fields, consent history, safe return, recovery and local/global logout exist. Connected auth E2E, abuse/rate controls, legal approval and production mail/template/redirect evidence remain. |
| P0 | Responsive Korean shell, themes, states and accessibility | PASS | PARTIAL | PARTIAL | System/Light/Dark, reduced-motion and responsive public references exist; tablet, protected states, keyboard/screen-reader and full error/offline evidence remain. |
| P0 | PUTDUK START, conversion and first welcome withdrawal | PASS | PARTIAL | BLOCKED | Trial/real accounting separation and deterministic capped conversion exist. Real KYC qualification, destination registration/verification and completed no-funding first-withdrawal E2E remain. |
| P0 | Mining, settlement and effective-time economy rules | PASS | PARTIAL | BLOCKED | Server-derived session/settlement foundations exist; approved production rules, worker execution, segment/concurrency tests and operator pause evidence remain. |
| P0 | Balanced ledger, wallet projections and reconciliation | PASS | PARTIAL | BLOCKED | Balanced journal and append-only projection invariants pass in isolated exact-head CI; treasury reconciliation runner, mismatch queue, production-target verification and authenticated receipt evidence remain. |
| P0 | Transactional outbox, jobs, leases, DLQ and replay | PASS | PARTIAL | BLOCKED | Versioned outbox/job schemas and bounded lease/fail commands exist. No continuously running worker, heartbeat, backpressure proof, operator DLQ or idempotent replay evidence exists. |
| P0 | KRW deposit request and operator approval | PASS | PARTIAL | BLOCKED | User request and deterministic approval command exist; isolated admin action UI plus user/operator completed E2E and audit linkage remain. |
| P0 | KRW withdrawal, destinations and operator review | PASS | PARTIAL | BLOCKED | Request commands and a safe destination-status projection exist. Destination onboarding, verification, KYC, operator review/completion and receipt E2E remain. |
| P0 | Referral and funding-promotion automation | PASS | PARTIAL | BLOCKED | Versioned qualification/cap/budget rules exist; consumers, recheck/payout automation, exception queue and end-to-end accounting evidence remain. |
| P0 | Approved mining-product catalog and configuration | PASS | PARTIAL | BLOCKED | Versioned sourced proposal/approval foundations exist; reviewed operator approval, non-empty production values and runtime activation evidence remain. |
| P0 | KYC, risk, client-IP provenance and immutable security evidence | PASS | PARTIAL | BLOCKED | KYC/security data foundations, an adapter that rejects arbitrary forwarded IP headers and a permissioned Member 360 summary exist; verified edge provenance, real lifecycle commands, reviewed rules, denial tests and target audit evidence remain. |
| P0 | Safe mode and emergency stop | PASS | PARTIAL | BLOCKED | Configuration/data seams exist; operator controls, command enforcement across every real-value mutation, recovery and immutable incident evidence remain. |
| P0 | Admin physical isolation and operator authentication | PASS | PARTIAL | BLOCKED | Separate build/host/cookie, server-owned role, mandatory AAL2 and recent-TOTP checks exist. App-owned sessions, idle/absolute limits, per-session revoke, single-use step-up, rate limits and authenticated browser evidence remain. |
| P0 | One-person operator queues and user lookup | PASS | PARTIAL | BLOCKED | 오늘의 퍼뜩 request-time snapshot and exact-UUID Member 360 reference exist. Deposit/withdrawal/settlement resolution, health/job signals and authenticated operator journeys remain. |
| P0 | Request/trace/job/audit correlation | PASS | PARTIAL | BLOCKED | Audit and idempotency foundations exist; an end-to-end user failure → command → job → ledger → audit trace with redaction and operator ownership is unproven. |
| P0 | Health, readiness, monitoring and alerts | PASS | PARTIAL | BLOCKED | Non-secret health/readiness routes and some failure surfaces exist; dependency truth, synthetic checks, alert routing, SLOs and owned runbooks are not active. |
| P0 | Backup, PITR, restore and rollback | SPEC_ONLY | BLOCKED | BLOCKED | Contracts exist only. Exact-project entitlement, isolated restore rehearsal, data validation, RPO/RTO and app/config/database rollback evidence are absent. |
| P0 | Privacy-safe activation/lifecycle/failure analytics | PASS | PARTIAL | BLOCKED | Allowlisted event foundations exist; delivery reliability, consent/retention, welcome-withdrawal cohorts, 7/30-day activity and operator funnel evidence remain. |
| P0 | Supabase production target | BLOCKED | BLOCKED | BLOCKED | Remote apply, security verification and deployment are explicitly frozen in WS-03; local source is not production-target evidence. |
| P0 | Cloudflare edge/domain production target | SPEC_ONLY | BLOCKED | BLOCKED | Account ID is unknown and all account-scoped calls, Access provisioning, Workers deployment and DNS changes are explicitly frozen in WS-03. |
| P1 | Canonical visual benchmark | PASS | PASS | PARTIAL | 42 hashed canonical captures plus route/responsive/motion/state specifications are durable; complete state-by-state production regression remains. |
| P1 | Public landing | PASS | PASS | PARTIAL | Product copy and real brand assets render in all four desktop/mobile theme corners; cinematic depth, tablet/state evidence and production Web Vitals remain. |
| P1 | Guided START quest | PASS | PARTIAL | PARTIAL | Accessible spotlight coach marks support replay/skip and key off the server trial stage. Per-step durable resume, domain-event progression, analytics and authenticated completion evidence do not exist. |
| P1 | Authenticated home and mining presentation | PASS | PARTIAL | PARTIAL | Authoritative summaries and server-derived world presence exist; connected state matrix, settlement reveal, performance tiers and authenticated benchmark evidence remain. |
| P1 | Events, notices and notifications | PASS | PARTIAL | PARTIAL | Progress, outbox and notification-center foundations exist; detail/preferences/publication fanout, fatigue controls and completed E2E remain. |
| P1 | PUTDUK AI | PASS | PARTIAL | BLOCKED | Policy router, least-privilege tools, safe context, fail-closed money answers and a 28-case Korean corpus exist. Durable first-party conversation continuity, provider-quality and authenticated tool E2E remain required because the feature is user-visible. |
| P1 | PWA, offline and push | PASS | PARTIAL | BLOCKED | Manifest, service worker, offline route and preferences exist; install/upgrade, push delivery, deep-link and offline journey evidence remain. |
| P1 | Member 360 extended experience | PASS | PARTIAL | BLOCKED | Exact-UUID aggregation and permissioned/audited KYC summary exist; full support/security/device/AI evidence, operator actions and authenticated visual acceptance remain. |
| P1 | Visual regression and performance acceptance | PASS | PARTIAL | BLOCKED | Reviewed screenshots and bounded loopback measurements exist; full canonical states, representative device/network percentiles, real INP, memory/FPS and future WebGL lifecycle remain. |

## Current gate result

`NOT LAUNCH READY`. No launch-critical exception is allowed: every P0 row must have `PRODUCT COMPLETE = PASS`, current evidence and an owner before production traffic or real-value flows.

### WS-03 Git/CI closure evidence

- PR: [#2](https://github.com/goldeget/putduk-mining/pull/2)
- Exact PR head: `a28bad387af21e9c7aaf6ffc185a4e594b42c122`
- GitHub Actions run: [`36284465615`](https://github.com/goldeget/putduk-mining/actions/runs/36284465615)
- CI workflow jobs: `Application gates`, `Browser foundation`, `Database security gates` — all `success`
- `develop` merge: `eaaf7616be9b8f627a44d59510909068b023ed0c`
- `main`: unchanged at `fbea85eebf1084bfc02bf1c452392b20f2f497ce`
- Remote feature branch: deleted after merge
- Boundary: no deploy artifact/version/digest, Supabase remote mutation or Cloudflare provisioning was produced by this evidence

## Current P0 blockers

1. Complete KYC/qualification and KRW destination registration/verification, then prove START conversion through a completed first withdrawal without prior funding.
2. Deploy and verify the settlement/outbox/job workers, bounded retries, DLQ/replay, reconciliation and mismatch operator queues.
3. Complete deposit, withdrawal and settlement operator actions plus safe-mode/emergency enforcement; prove request/trace/job/ledger/audit linkage end to end.
4. Complete the admin-owned session registry, idle/absolute lifetime, per-session revocation, single-use action-bound step-up grants, authentication rate limits and authenticated role/MFA/revocation browser suite.
5. Approve and activate versioned production economic/catalog values, monitoring/alerts/runbooks and privacy-safe lifecycle analytics.
6. Verify exact-project backup/PITR, isolated restore and app/config/database rollback with recorded RPO/RTO.
7. Complete connected authentication/recovery delivery, abuse controls and authenticated P0 browser fixtures without real member/KYC data.
8. Produce reproducible deploy-artifact provenance, then perform separately authorized Supabase and Cloudflare production phases. Remote mutation remains forbidden in WS-03.

## Current P1 gaps

- Increase Landing cinematic depth or record an explicit design acceptance decision; reconcile Login backdrop composition and Signup progressive staging with the canonical benchmark.
- Add durable PUTDUK AI conversation ownership/recovery and authenticated provider/tool evaluation; the visible feature cannot be accepted from static or unit evidence.
- Expand reviewed loading, empty, error, success, disabled, offline/reconnect and reduced-motion captures across protected routes and tablet widths.
- Finish the extended Member 360, event/notice fanout, PWA/push and premium mining experience acceptance suites.
- Capture production-like Web Vitals, interaction latency, long tasks, FPS/memory and any future WebGL lifecycle on representative devices and networks.
