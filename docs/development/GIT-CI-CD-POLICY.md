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

Schema changes additionally require project-scoped local Supabase reset/tests/lint/advisors. Docker commands remain deterministically scoped to this repository; no global inventory or prune is permitted.

Critical UI changes add browser E2E, accessibility, visual and performance evidence. A green sub-job is not release acceptance unless the workflow ran the exact target SHA and all required jobs/artifacts are present.

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

## 9. Current integrity state (2026-09-27)

The exact authorized origin is reachable under the verified `goldeget` GitHub identity. The original missing parent object (`c27b7c542ccb8808a2656a62c9d0536dffd87f06`) and its reachable graph were restored from that origin with `git fetch --refetch origin develop`; no graft, replacement ref, fake shallow boundary, history rewrite or force push was used.

`git fsck --full` now completes without missing or broken objects. WS-03 work uses the bounded `codex/ws-03-productization` branch; any push, pull request and merge remains subject to exact-origin/baseline preflight and all required CI checks. This integrity result does not authorize deployment, Supabase remote mutation or Cloudflare provisioning.
