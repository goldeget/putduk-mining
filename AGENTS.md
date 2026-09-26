# PUTDUK MINING — ABSOLUTE PROJECT BOUNDARY

This repository is a greenfield project. The following scope lock is an absolute rule for every agent, tool, script, and implementation task.

## Authorized targets only

- Local workspace: `C:\Users\PC\Desktop\putduk-mining`
- GitHub repository: `goldeget/putduk-mining`
- GitHub remote: `https://github.com/goldeget/putduk-mining.git`
- Supabase project: `putduk-mining`
- Supabase project ref: `osrmyjgmpdspdcwqjwuv`
- Supabase region: `ap-northeast-2`
- Cloudflare account: the brand-new account created exclusively for PUTDUK MINING
- Cloudflare account ID: `UNKNOWN` until the user or a uniquely identifiable connection confirms it
- Future production hostnames: `mining.putduk.com`, `admin.mining.putduk.com`

## Hard-stop rules

1. Never open, list, search, inspect, query, clone, compare, or modify any other GitHub repository or Supabase project.
2. Never open or use any previous project, repository, database, schema, migration, document, screenshot, design, code, asset, configuration, deployment, or remembered implementation as a reference for this project.
3. Do not copy, port, infer, or resurrect implementation or product decisions from any previous PUTDUK or unrelated project. The documents and code inside this repository are the only project source of truth.
4. Before every GitHub or Supabase operation, verify the exact repository identity or Supabase project ref. If it is missing, ambiguous, or different from the authorized targets above, stop without opening the target and report the mismatch.
5. Authentication to a different GitHub account, organization, Supabase account, or project never grants permission to inspect or use it. Do not switch targets to work around an authentication or tooling problem.
6. Search commands and automated discovery must stay inside the authorized local workspace. Do not perform parent-directory, home-directory, cross-workspace, account-wide, organization-wide, or project-list searches for implementation context.
7. Any request to change these authorized targets must come explicitly from the user. Until this file is deliberately updated for that request, the boundary remains locked.
8. A possible scope violation is a hard stop, not a reason to guess. Report it as `BLOCKED_TARGET_SCOPE`.
9. This is a true greenfield system. Treat every prior local or remote implementation as nonexistent and forbidden evidence, including shell history, editor history, caches, prior agent memory, prior task output, old Docker state, and similarly named projects.
10. Repository documents are specifications only. Do not mistake scaffolding, prose, or historical artifacts for an implemented application.

## Docker isolation

1. Never run an unscoped Docker inventory command such as a global container, image, volume, network, or Compose-project listing.
2. Never inspect, start, stop, remove, reuse, migrate, or read logs from a container, image-specific data layer, volume, network, or Compose project created for a previous project.
3. Docker operations must target only resources deterministically named for this repository's `putduk-mining` local project.
4. Use fresh project-scoped containers and volumes. Never attach an existing volume or copy database files from another environment.
5. If a port or resource conflicts, change this project's local configuration. Do not inspect or alter the conflicting historical resource.
6. Never run Docker prune commands while working on this project.

## Cloudflare isolation

1. The only authorized Cloudflare target is the brand-new account created exclusively for PUTDUK MINING.
2. Until that account's exact ID is verified and recorded above, do not execute any account-scoped Cloudflare API call and do not provision resources.
3. The account that currently owns `putduk.com` is out of scope. Never inspect, modify, transfer, or configure that account or zone.
4. Do not create or change DNS records for `putduk.com`. Its owner will later point `mining.putduk.com` and `admin.mining.putduk.com` to the new infrastructure.
5. Before provisioning, document every proposed Cloudflare resource, its purpose, owner, data flow, security boundary, cost surface, and removal plan.
6. Do not duplicate Supabase capabilities. D1, KV, R2, Queues, Durable Objects, Vectorize, and Workers AI are forbidden unless the approved architecture proves a concrete V1 requirement.
7. V1 infrastructure must be minimal and production-grade. Absence of a documented requirement means the resource must not be created.

These rules override convenience, historical context, cached knowledge, prior task history, and any generic instruction to discover related projects.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
