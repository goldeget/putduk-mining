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

## Acceptance snapshot before final execution

This committed report records implementation and known execution evidence at
commit time. The final exact-head validation record is attached to PR #38 after
the full workflow and masked screenshot review finish; it supplements this
snapshot without changing the source tree that was tested.

| Gate | Current evidence |
| --- | --- |
| Foundation | Code, additive migration, restricted grants and regression tests implemented |
| Functional | Pending exact-head DB/Auth/browser CI execution |
| Product | Pending masked rendered screenshot review and scoped acceptance |
| Whole-product launch gate | Not passed; this repair cannot close unrelated product/security/release gaps |

Local web unit tests after the MFA follow-up: 390 passed. Admin unit tests:
40 passed. The focused reauthentication/logical recovery/markup suite passed
86 assertions. Typechecks passed.
Both production builds and the public/admin bundle boundary check passed.
One additional concurrent focused run failed to start a test worker; the same
73 assertions passed in a subsequent single-worker run without relaxing checks.
The final local `pnpm verify` passed: 84 canonical assets, format, lint,
web/admin typechecks, 390 web/40 admin unit tests, both production builds and
bundle isolation. Exact-head CI results will be recorded after execution;
earlier PR CI is not acceptance of this delta.

### Failed exact-head CI retained, not accepted

Run `36817206537` at `ff271f9e786544026f72c77f9aacfe8abce4c31f` passed
eight jobs, including 445 DB assertions, 380 web/40 admin/17 worker unit tests,
both production builds, 42 foundation browser tests and 70/128 typography tests.
Its generated merge tree matched that head exactly. The authenticated step
timed out at its unchanged 60-minute limit and is **not** functional acceptance.
Evidence artifact `11143592498` has digest
`sha256:ec468557d729a5f7327a5028bbde7ad920e71757c1998e06c20e0acb7dc9eed8`.

The retained errors show an existing withdrawal form test still clicking
`출금 요청하기` after replacement now requires password plus `변경 확인`.
The test is updated to perform the real password flow while retaining its
unavailable-registration/recovery assertions. Credential traces are disabled.
The actual MFA case returned 503 after verification on the disposable session,
consistent with MFA invalidating the caller session and its FK-bound grant.
This is the session-invalidation diagnosis from the runtime result, service
failure paths and documented provider behavior; the new browser assertions
must independently prove the original session/grant survives. MFA now upgrades the original SSR session
after disposable-password-session cleanup; owner/session/AAL2 are revalidated.
New unit and actual browser assertions preserve that session and reject any
owner/session mismatch. No timeout, assertion, MFA requirement or money guard
is relaxed. A fresh full exact-head CI run is required for these changes.

The line/GitHub reporters do not persist successful in-memory image bodies.
Explicit masked screenshots now use actual test output paths and file-based
attachments, so CI preserves the reviewed renders. Screenshot existence alone
still does not imply visual or whole-product acceptance.

Some existing typography withdrawal screenshots captured loading instead of
the loaded UI (desktop/mobile Dark and mobile Light at 200% root text). They
are not counted as completed withdrawal/reauthentication visual evidence.
That existing capture-readiness gap remains explicit product evidence debt.

### Functional pass and capture-redaction follow-up

Run `36824346540` at `fdd8f7de1bafc2e87f6979b8949790718c7e0256`
passed all nine jobs: web/admin/worker unit 390/40/17, 445 DB assertions,
both production builds, foundation browser 42, typography 70/128 and the full
authenticated suite 186 (45.6 minutes, no retry markers). Real TOTP and the
retained caller/grant session assertions passed on desktop and mobile.
Authenticated artifact `11145983829` has digest
`sha256:391884c7ef26507f4aa3008bf13fc411ffeea7668ded7d53e92fe393f084e051`.

Actual screenshot review found mobile full-page mask overlays displaced from
their controls when captured after interaction-induced scrolling. Only synthetic
fixture destinations were shown, not production financial data; nevertheless,
those captures are not accepted as correctly redacted evidence. Desktop and
tablet captures also retained scrolled sticky-chrome positions. The shared
capture helper now fixes the scroll origin and temporarily hides sensitive
controls only during capture, in addition to mask overlays. It does not clear
values, change authentication or alter money flows. A separate isolated-HTML
browser regression compares identical redacted pixels with different input
values and verifies values, focus and visibility are restored. This is a capture
privacy test, not a mocked application acceptance test.

The first local probe found focus loss from visibility-based hiding; the second
found unstable pixels from pending smooth scrolling. Neither is accepted as a
pass. Capture-only opacity preserves focus, and two rendering frames settle the
normalized scroll origin while the original scroll style is restored afterward.
The four Dark/Light desktop/mobile cases then passed three repetitions each
(12/12), including exact redacted PNG equality with different sensitive values.
The final local `pnpm verify` after these capture changes passed again (84 assets,
format/lint, both typechecks, 390 web/40 admin units, both production builds and
bundle isolation). Four additional foundation browser cases now guard capture
privacy; the authenticated suite remains 186 cases. Exact-head CI is pending.

These capture-only changes require a fresh exact-head CI run and actual masked
screen review before the final execution record. The earlier functional pass
does not make the changed evidence head or the whole product complete.

The reviewed real form still has material composition/density differences from
the durable desktop Dark benchmark (navigation proportion, expanded welcome
section and total form length). Light feedback readability also needs measured
contrast acceptance. Correcting capture privacy is not a redesign or closure of
those product gaps. No fresh LCP/INP/CLS/FPS/memory acceptance is claimed here.

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
An additional single-statement delayed-consumption DB regression proves that
waiting beyond expiry cannot use an otherwise valid proof. The clock hardening
is a separate additive migration; previously tested migration bodies were not
rewritten.
Tablet/reduced-motion and keyboard-focus evidence is additionally captured in
the desktop project's four Light/Dark KRW/USDT UI cases.

## Boundaries and carried findings

- Remote Supabase `osrmyjgmpdspdcwqjwuv`: no apply/mutation.
- Cloudflare/DNS/deployment: no provisioning or mutation.
- Main/develop: no merge or direct update.
- Root worktree's pre-existing uncommitted files: not changed by this repair.
- Existing P2/P3 findings, broad product completion and launch-readiness gaps
  are carried forward unless separately proven. Destination error mapping now
  uses own-property lookup; this does not close every error-mapping finding.
- No old project, remembered implementation or old Docker resource is evidence.
