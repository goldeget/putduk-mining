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

## 3. Branch and change policy

- Default agent branch names use `codex/<scope>` unless the user specifies another name.
- Keep migrations, deployment, production configuration and application changes separately reviewable when practical.
- Never use `--no-verify` or force push.
- Never erase user work to create a clean tree.
- Generated assets are reviewed through their manifest and source/version record.
- Commits are atomic enough to revert without mixing unrelated state.

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

Critical UI changes add browser E2E, accessibility, visual and performance evidence. A green sub-job is not release acceptance unless the workflow ran the exact target SHA and all required jobs/artifacts are present.

### CI wall-clock contract (PR / push to `main` or `develop`)

PUTDUK MINING keeps GitHub Actions on `ubuntu-24.04` within a **~20 minute workflow wall clock** until platform launch. The measured critical path is the **longest single job**, not the sum of parallel jobs.

**Required hybrid pattern** (see `.github/workflows/ci.yml` and `.cursor/rules/putduk-ci-wall-clock.mdc`):

1. Job **`e2e-app-build`** runs **`pnpm build` once** per workflow and uploads artifact **`e2e-next-production`** (`.next` and `apps/admin/.next` at repo-relative paths).
2. **`authenticated`** matrix jobs (eight shards) **`need`** `e2e-app-build` and `webserver-lifecycle`, download the artifact, set **`E2E_NEXT_START=1`**, and run Playwright with **production `next start`** — not `next dev`. Each shard still runs isolated local Supabase reset for data isolation.
3. **`typography-protected`** **`needs`** `e2e-app-build`, downloads the same artifact, and sets **`E2E_PREBUILT_APPS=1`** so protected typography servers skip duplicate builds.

**Forbidden regressions:** authenticated CI using `next dev`; removing the eight-shard matrix without a documented replacement; adding a serial full authenticated suite job; per-shard full app builds without the shared artifact; weakening assertions or step timeouts only to shorten wall clock.

**Baseline evidence:** PR #39 green runs with eight authenticated shards at **~16 minutes** wall clock (`docs/development/E2E-AGENT-WORKFLOW.md`, run `36975512027` / `9cfc2ef`). Agents must read the E2E CI section and the wall-clock rule before changing the workflow and must not merge changes that increase critical path without documented mitigation and measurement.

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
