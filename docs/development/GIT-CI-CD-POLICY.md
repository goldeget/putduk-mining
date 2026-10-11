# PUTDUK Git, CI and CD Policy

Status: **CANONICAL / INTEGRITY VERIFIED**

## 1. Target lock

The only authorized remote is:

```text
https://github.com/goldeget/putduk-mining.git
```

Before every GitHub operation, verify `git remote get-url origin` exactly. A missing, inaccessible or different remote is a hard stop. Never search another account, organization or repository as a workaround.

## 2. Repository integrity gate

Before commit, push, merge, tag or release:

```text
git status --short
git remote -v
git fsck --full
git rev-list --objects --all --missing=print
```

The repository must have no missing reachable objects. A shallow clone may be repaired only by retrieving the exact authorized history. Do not hide corruption with a graft, replacement ref, fake shallow boundary, rewritten branch or force push.

### Production coupling guard

Before any push, PR update, merge, tag, workflow dispatch, remote database apply or deployment, determine whether that exact action can trigger an automatic production release or live mutation. Inspect this repository's workflow triggers, deployment scripts, webhooks, connected apps, branch/tag release policies, environments and deployment history. Record only sanitized names, states and hostnames; never secret values, webhook payloads or signed URLs.

Classify the action as proven isolated, production-coupled or unknown. **UNKNOWN is not safe.** Missing tracked deployment code, empty deployment history, a green CI run or denied metadata access does not prove an external integration is absent. A denied check remains an evidence blocker; do not search another account or project to work around it.

Production-coupled actions require explicit human approval for the exact target, candidate SHA, operation and live effects, with a reviewed rollback plan. If coupling remains unknown, leave a reviewable local candidate and request the precise owner evidence or explicit approval for the described live-impact operation. Existing development or Git authorization does not grant production-release authorization. Do not disable or change integrations to manufacture a safe classification without separate authorization.

Local edits, local builds and project-scoped local tests may continue within their existing authorization after verifying local targets and excluding live credentials. Remote Supabase and Cloudflare freezes remain in force. CI acceptance and production approval are separate evidence states.

## 3. Branch and change policy

- Default agent branch names use `codex/<scope>` unless the user specifies another name.
- Keep migrations, deployment, production configuration and application changes separately reviewable when practical.
- Never use `--no-verify` or force push.
- Never erase user work to create a clean tree.
- Generated assets are reviewed through their manifest and source/version record.
- Commits are atomic enough to revert without mixing unrelated state.
- Batch a complete feature flow into each PR: input, authorization, domain/DB,
  worker, UI and recovery changes that belong together. Keep reversible commits
  locally and run focused checks before publishing a stable candidate. Do not
  trigger the full workflow for every small intermediate edit. Verify the final
  PR candidate and its develop merge independently; a changed failing candidate
  still needs a new complete run.

## 4. CI gates

Required application gate:

```text
pnpm assets:verify
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Schema changes additionally require a project-scoped isolated Supabase reset/tests/lint/advisors gate on the developer host or at the exact target SHA in CI. An unavailable local runtime is reported as an environment limitation and never converted into a pass; exact-head CI may provide independent execution evidence. Docker commands remain deterministically scoped to this repository; no global inventory or prune is permitted.

The existing database job also runs four actual two-session probes after a fresh disposable reset: KRW deposit approval, USDT deposit approval, safe-mode command and withdrawal member-lock ordering. The existing worker job runs the local full-API admin-auth admission probe after reset and guarded CLI env capture, before worker runtime tests. The probe inventory and fixture boundaries are defined in `docs/quality/WS-05-EXECUTION-CONTRACT.md`. These checks retain the same required jobs and whole-workflow budget; their new runtime evidence must come from the current candidate, not a previous green run.

Critical UI changes add browser E2E, accessibility, visual and performance evidence. A green sub-job is not release acceptance unless the workflow ran the exact target SHA and all required jobs/artifacts are present.

### CI wall-clock contract (PR / push to `main` or `develop`)

PUTDUK MINING requires the **entire CI attempt to finish within 20 minutes** on `ubuntu-24.04`. This is a hard acceptance ceiling, not an approximate target. For an initial run, measure `created_at` to final workflow completion, including runner queue time, the shared build, dependent jobs and evidence uploads. A full rerun uses that attempt's `run_started_at`; jobs from earlier attempts cannot fill missing evidence. Neither the longest individual job nor the sum of parallel jobs measures the whole workflow.

`CI completeness and 20-minute budget` starts alongside the quality jobs. It verifies the exact repository, run, attempt and candidate, then requires all 17 quality jobs to complete successfully. Only `Exact diff integrity` may be skipped on a push. Missing, duplicate, unexpected, cancelled, failed or timed-out jobs cannot pass. The controller requests cancellation at **18m30s** if work remains, reserving 90 seconds for shutdown. If ordinary cancellation leaves quality jobs running, it uses force cancellation. A cancelled run is a failure candidate, never evidence of quality. API errors fail closed.

The controller's `actions: write` permission is confined to that job, with no persisted checkout credential; all other jobs keep read-only permissions. It can address only this repository and this run's cancellation endpoints. Hosted-runner queues or API outages cannot be promised away: an over-20-minute result must be recorded as failed acceptance and must not be merged, even if GitHub later reports green. Verify the final run metadata separately before PR merge and after the develop push.

All four Playwright CI lanes use `--fail-on-flaky-tests`. Existing retries remain available for diagnosis, but a test that fails and then passes on retry makes the job fail. Fix the cause rather than accepting a coincidental retry success.

**Required hybrid pattern** (see `.github/workflows/ci.yml` and `.cursor/rules/putduk-ci-wall-clock.mdc`):

1. Job **`e2e-app-build`** runs **`pnpm build` once** per workflow and uploads artifact **`e2e-next-production`** (`.next` and `apps/admin/.next` at repo-relative paths).
2. **`authenticated`** matrix jobs (eight shards) **`need`** `e2e-app-build` and `webserver-lifecycle`, download the artifact, set **`E2E_NEXT_START=1`**, and run Playwright with **production `next start`** — not `next dev`. Each shard still runs isolated local Supabase reset for data isolation.
3. **`typography-protected`** **`needs`** `e2e-app-build`, downloads the same artifact, and sets **`E2E_PREBUILT_APPS=1`** so protected typography servers skip duplicate builds.

The authenticated scheduler collects the current Playwright inventory, keeps each file/project together and assigns every collected test exactly once across eight lanes. Timing hints affect placement only; they never change assertions, deadlines or acceptance. `playwright-report/ci-shard-evidence/{plan,coverage,execution}.json` records the actual checkout SHA, parent SHAs, candidate/run/attempt identity in CI and whether the source tree is clean. This ignored path stays outside Playwright's cleared `test-results` output directory. Local dirty-tree evidence is identified as local validation, not exact committed-candidate evidence. A PR's synthetic merge checkout must include the candidate head as a direct parent; record both SHAs instead of claiming a head-only build.

Worker Vitest writes `test-results/worker/vitest.json`. The evidence check requires a report started during the current worker step, consistent nonzero test counts and no failed, skipped or todo tests. It writes a sanitized `test-results/worker/report.json` containing counts, file identities, hashed test names, statuses, durations and source/run identity. CI must upload that actual report as `worker-runtime` with missing files treated as failure. Raw failure messages, console payloads and credentials are not uploaded in this artifact. All eight authenticated artifacts, the shared build, both typography reports and this worker report must be present for evidence completeness.

After all jobs finish, independently verify the exact candidate, base/merge checkout, workflow/run/attempt, all required results, artifact identifiers/digests and final whole-workflow duration. Evidence from the earlier PR #71 candidate does not validate a later local patch, new commit or develop push. Only one complete attempt can establish a candidate's CI acceptance.

**Forbidden regressions:** authenticated CI using `next dev`; removing the eight-shard matrix without a documented replacement; adding a serial full authenticated suite job; per-shard full app builds without the shared artifact; weakening assertions, removing specs, skipping tests or treating timeout/cancellation as a pass. Test-level timeouts, real TOTP waits and retries remain intact. Workflow/job deadlines bound a failed run; they do not make a partial suite acceptable.

**Baseline evidence:** PR #39 green runs with eight authenticated shards at **~16 minutes** wall clock (`docs/development/E2E-AGENT-WORKFLOW.md`, run `36975512027` / `9cfc2ef`). Agents must read the E2E CI section and the wall-clock rule before changing the workflow. Every new candidate needs all checks and measured full-workflow time within 20 minutes; a plan to improve it later does not waive the ceiling.

## 5. CD stages

```text
reviewed commit
→ immutable CI artifact
→ preview environment
→ migration preflight (when applicable)
→ production deploy with version ID
→ smoke/readiness
→ bounded functional verification
→ release evidence and monitoring
```

Deployment is not authorized merely because code is merged. GitHub push, Cloudflare provisioning/deploy and Supabase remote changes are distinct mutation boundaries.

## 6. Database deployment

- Verify Supabase project ref `osrmyjgmpdspdcwqjwuv` immediately before any remote action.
- Prefer expand/contract migrations and backward-compatible application order.
- Never edit an already-applied migration.
- Economic rule values are not seeded without explicit product approval.
- Record migration versions, transaction behavior, expected locks and recovery steps.
- A backup is not a substitute for a reversible migration plan.

## 7. Application rollback

- Retain the prior known-good application artifact/version.
- Configuration/feature flags have reviewed defaults and audit trails.
- Roll back application code before destructive database reversal when the schema remains backward-compatible.
- Database rollback is a reviewed recovery operation, not an automatic down migration.
- After rollback, run readiness, critical smoke and reconciliation checks.

## 8. Release evidence

Record:

- local and remote SHA;
- branch/tag and remote URL;
- CI workflow/run/job/artifact identifiers and artifact digest;
- application deployment/version ID;
- Supabase project ref and migration set;
- Cloudflare account ID and Worker/version only after authorized provisioning;
- QA environment, browser matrix and raw failures;
- rollback decision/owner and monitoring window.

## 9. Temporary public visibility

On 2026-09-29 the owner changed `goldeget/putduk-mining` from private to public so GitHub Actions could run. Private Actions jobs were not starting because recent account payments failed or the spending limit had to be increased.

This visibility is temporary. It is not a launch, and it does not authorize Supabase remote mutation, Cloudflare provisioning, DNS changes, or a wider target scope.

When platform work is finished and the product is ready to launch, the owner switches this repository back to private before production traffic. Agents do not change repository visibility unless the user explicitly asks for that change.

## 10. Current integrity state (2026-09-27)

The exact authorized origin is reachable under the verified `goldeget` GitHub identity. The original missing parent object (`c27b7c542ccb8808a2656a62c9d0536dffd87f06`) and its reachable graph were restored from that origin with `git fetch --refetch origin develop`; no graft, replacement ref, fake shallow boundary, history rewrite or force push was used.

`git fsck --full` now completes without missing or broken objects. WS-03 PR [#2](https://github.com/goldeget/putduk-mining/pull/2) passed all three CI workflow jobs in GitHub Actions run `36284465615` at exact head `a28bad387af21e9c7aaf6ffc185a4e594b42c122`; its isolated database job rebuilt PostgreSQL from zero, passed 222 pgTAP assertions, schema lint and security advisors. The PR merged only to `develop` as `eaaf7616be9b8f627a44d59510909068b023ed0c`, and the remote feature branch was deleted. `main` remained unchanged at `fbea85eebf1084bfc02bf1c452392b20f2f497ce`. This integration evidence does not establish deploy-artifact provenance and does not authorize deployment, Supabase remote mutation or Cloudflare provisioning.
