# PR #38 — Destination replacement P1 repair

Date: 2026-10-01. Integration parent: `e52b806345a87c2b13114148f5ebf0f97a593769`.
Repository: `goldeget/putduk-mining`. No main/develop merge is part of this task.

## Finding and scope

The destination registration route previously minted a random UUID as a
step-up token. The DB accepted a sufficiently long string, so replacing a
sensitive withdrawal destination did not prove fresh password authentication.

The repair adds actual server-side password/MFA verification, owner/current
session/method/fingerprint binding, a five-minute single-use proof, immutable
attempt accounting, security audit and safe protected-destination recovery.
The frozen WS-04 public function signatures and prior logical idempotency
repair are preserved. No ledger, reward formula or funding prerequisite changes.

See `docs/security/WITHDRAWAL-DESTINATION-REAUTHENTICATION.md` for the trust
boundary, privacy, deployment ordering and safe failure policy.

## Acceptance status

| Gate | Current evidence |
| --- | --- |
| Foundation | Code, additive migration, restricted grants and regression tests implemented |
| Functional | Pending exact-head DB/Auth/browser CI execution |
| Product | Pending masked rendered screenshot review and scoped acceptance |
| Whole-product launch gate | Not passed; this repair cannot close unrelated product/security/release gaps |

Local web unit tests: 375 passed. Admin unit tests: 40 passed. Typechecks passed.
Complete local application verification/build result and exact-head CI IDs
will be recorded after execution; earlier PR CI is not acceptance of this delta.

Local fresh Supabase startup was rejected by the execution environment policy.
No workaround, historical container reuse, global inventory or remote DB call
was attempted. The temporary fresh namespace/port configuration was restored.
Per Git-CI-CD policy, exact-head isolated CI must independently prove DB reset,
pgTAP, lint/advisors, Auth provider behavior and browser flows.

New browser matrix: 16 tests (8 cases × desktop/mobile), with KRW/USDT,
Light/Dark, incorrect password, successful replacement, protected state,
lost-response recovery, cross-session/owner/method/fingerprint denial,
concurrent one-use consumption, rate limit and actual TOTP verification.
Existing welcome and idempotency tests remain in the full suite.

## Boundaries and carried findings

- Remote Supabase `osrmyjgmpdspdcwqjwuv`: no apply/mutation.
- Cloudflare/DNS/deployment: no provisioning or mutation.
- Main/develop: no merge or direct update.
- Root worktree's pre-existing uncommitted files: not changed by this repair.
- Existing P2/P3 findings, broad product completion and launch-readiness gaps
  are carried forward unless separately proven. Destination error mapping now
  uses own-property lookup; this does not close every error-mapping finding.
- No old project, remembered implementation or old Docker resource is evidence.
