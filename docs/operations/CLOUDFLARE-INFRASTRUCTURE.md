# Cloudflare V1 Infrastructure Decision

Status: **AUTHORIZED TARGET VERIFIED / NEW PLATFORM STAGING NOT PROVISIONED / RELEASE GATES REMAIN**

This record separates the authorized account and preservation scope from current observations, proposed platform resources, and exact provisioning/activation gates. Account selection is settled; it does not approve an arbitrary resource, a paid contract, or public production traffic.

## 1. Authorized target and observed current state

The direct owner decision on 2026-10-13, recorded in `AGENTS.md`, supersedes the earlier new-account and existing-zone prohibitions for this exact project.

- Authorized account: `putduk-landing`, ID `9dc502d4ef06b3b5374591de6e6933ca`.
- Existing active zone: `putduk.com`, ID `c9e6c93451c3c2e107a1eca511bedaba`, in that same account. Preserve the zone, email routing/mail authentication, certificates, access controls and security settings. Do not transfer the zone or create a replacement account.
- Exact source remains `https://github.com/goldeget/putduk-mining.git`. Planned platform hosts are `mining.putduk.com` and `admin.mining.putduk.com` with separate member/admin deployment boundaries.
- Read-only observation on 2026-10-14 UTC found the retained `putduk-web` production Worker serving `putduk.com` and `www.putduk.com`. Deployment `625b4462-bba8-491b-be6c-aa45e8bf587d` used version `b6604afa-d6c3-43f4-acde-8b99a61b317c` at 100%. This is an observed retained version, not proof it contains the current platform or that rollback has been tested. Keep it until an exact reviewed transition and rollback are accepted.
- At that observation, the planned mining/admin DNS records and custom-domain bindings were absent. No protected staging or current-candidate deployment is established by these receipts. Existing `ops.putduk.com` and `api.putduk.com` mappings are retained; unrelated source, secrets and data were not inspected.

The external QA run `release-integration-20261015-02a`, under `git-recovery/release-coupling/`, preserves `connector-observations.json`, `additional-metadata-and-bindings.json`, `README.md`, `COUPLING_FOLLOWUP_CHECKPOINT.json` and the exact Supabase integration UI receipt. These are point-in-time observations. Verify the exact account/zone before each scoped operation and recheck affected settings immediately before any accepted effect. Do not infer current safety from an old receipt or a display name.

## 2. V1 responsibility boundary

### Tooling and integration state (2026-10-15 review)

- The current repository declares Next.js `16.3.6` but no Cloudflare adapter or Wrangler dependency/configuration has been selected and pinned for the current application. No adapter compatibility build or actual Workers-runtime member/admin Auth evidence has passed.
- The exact account and zone have been verified for bounded read-only inspection. The earlier account-identity blocker is superseded; it is not a reason to request another account.
- Repository App installation and exact-project Supabase integration were inspected read-only. Codex, Cursor and Supabase Apps were present. The specified Supabase project's automatic production deploy and automatic branching switches were off at the observation; the repository link and installed App still exist. Other App/event/action effects remain unverified, so push/PR/release coupling is not classified safe.
- Local fresh PostgreSQL `17.6` replay and the official native201 test input suite are local evidence only. Remote Supabase project `osrmyjgmpdspdcwqjwuv` remains frozen for schema/application changes until its explicit accepted phase. Cloudflare work does not authorize a remote DB apply.
- Next steps are a reviewed current-candidate compatibility plan and local checks, followed by protected staging only under the resource/effect gates below. No CLI migration or provisioning was run by this document review.

| Capability | System of record | Cloudflare V1 decision |
| --- | --- | --- |
| PostgreSQL data and transactions | Supabase PostgreSQL | Do not create D1 |
| Identity and sessions | Supabase Auth | Keep Supabase canonical; a future Access gate may add outer defense in depth, never session or role authority |
| User files and product objects | Supabase Storage | Do not create R2 without a separate approved requirement |
| Realtime user updates | Supabase Realtime | Do not create Durable Objects |
| Scheduled database work | Supabase-owned job path | Do not create Queues merely for scheduling |
| Mining and settlement authority | Server domain + PostgreSQL ledger | Never calculate authoritative rewards at the edge |
| Web application runtime | Candidate: Cloudflare Workers | Validate framework compatibility before adoption |
| Static assets and edge delivery | Candidate: Workers Static Assets | Provision with the web runtime only |
| Request protection and observability | Candidate: Workers controls and logs | Enable after account and hostname topology are verified |
| DNS for `putduk.com` | Existing zone in the authorized `putduk-landing` account | Preserve email/security and retained services; only exact reviewed platform host records may change during gated activation |

## 3. Proposed minimal resources

The entries below remain proposals, not existing resource IDs or blanket provisioning permission. Before creation, review each exact name, owner, purpose, data flow, security, cost and removal/rollback plan in the authorized account. Protected staging may precede product completion to produce its evidence; it does not authorize public production traffic.

### A. User web runtime

- Proposed name: `putduk-mining-web`
- Product: Cloudflare Workers with static assets
- Purpose: run the current member Next.js application and its permitted public/server routes under an explicit host contract; preserve the existing root landing Worker until a separately reviewed transition
- Data flow: browser → Worker → Supabase APIs
- Security boundary: no Supabase service-role key in browser bundles; privileged calls remain server-only
- Cost surface: Worker requests, CPU time, logs, and asset delivery
- Removal plan: remove the Worker after traffic is detached and a verified deployment replacement exists

### B. Admin web runtime

- Proposed name: `putduk-mining-admin`
- Product: a separate Cloudflare Worker with static assets, built from the isolated `apps/admin` application
- Purpose: serve the admin interface independently from the public hostname
- Data flow: authorized operator → admin Worker → server-side authorization → Supabase
- Security boundary: every operation requires server-side role checks; hostname separation is not authorization
- Cost surface: Worker requests, CPU time, logs, and asset delivery
- Removal plan: remove only after admin traffic and operational access are safely migrated

The public and admin builds must remain separate Workers/deployments. A one-Worker hostname switch or public-path rewrite would weaken the required bundle and blast-radius boundary.

### C. Admin edge access gate

- Proposed name: `putduk-mining-admin-access`
- Product: Cloudflare Access self-hosted application for `admin.mining.putduk.com`
- Purpose: reject operators who do not satisfy the approved organization/identity/device policy before traffic reaches the admin runtime
- Data flow: operator → Access policy/identity provider → dedicated admin Worker → dedicated Supabase authentication/MFA → server role/capability checks → domain command
- Security boundary: Access is defense in depth only; it never grants an application role, replaces Supabase AAL2, step-up, DB permissions or immutable audit
- Cost surface: Zero Trust seats/features, identity-provider integration, Access logs and optional device posture
- Removal plan: detach the Access application only under an approved replacement gate while retaining application authentication and authorization

This resource is documented but not provisioned. The account is settled; exact plan/cost eligibility, identity provider, operator allowlist, session duration, device policy, emergency access and log retention still need concrete review. Creating paid contracts or enrolling identities is not implied by this proposal.

## 4. Explicitly rejected for V1

- **D1:** PostgreSQL is already the transactional source of truth.
- **KV:** no independent globally replicated key-value requirement exists.
- **R2:** Supabase Storage owns V1 object storage.
- **Queues:** no approved workload currently requires Cloudflare-native queue semantics; database jobs must not be duplicated.
- **Durable Objects:** no V1 real-time coordination domain requires them.
- **Vectorize / Workers AI / AI Gateway:** the current PUTDUK AI architecture has no approved Cloudflare-specific storage, retrieval, inference or gateway requirement.
- **Access as authorization:** rejected. A future Access application may be an outer admin traffic gate, but application MFA, role/capability authorization and database/domain checks remain mandatory.

Adding one of these products requires a new architecture decision covering ownership, consistency, failure recovery, security, cost, observability, and deletion.

## 5. Framework compatibility gate

Official documentation checked on 2026-10-15 describes vinext as Cloudflare's recommended Next.js path and also identifies it as beta. It describes OpenNext as an existing-application adapter path. Neither is selected by this record, and generic version support is not proof that this application works.

OpenNext's current overview lists Next.js 16 minor/patch support but says Node.js Middleware is not supported and full Windows support is not guaranteed. This repository has both `proxy.ts` and `apps/admin/proxy.ts`, with Supabase session handling and protected route matchers. Their Next.js 16 Node Proxy behavior in a selected adapter is an **unverified compatibility risk**. Do not rename, remove or weaken proxy/Auth/origin/role checks merely to pass an adapter build.

Before adding an adapter or Wrangler:

1. review an exact current candidate and adapter/tool versions without `latest` or lockfile regeneration shortcuts;
2. inspect the package scripts, output paths, hooks, bindings and cache/resource effects before any command;
3. verify the actual Workers runtime for member/admin route handlers, RSC, server actions, cookie refresh, Auth redirects, AAL2/step-up, origin/security headers, streaming, PWA/static assets and Supabase SSR boundaries;
4. pass applicable unchanged unit, DB, standard build and browser gates, plus adapter build/preview evidence; a normal `next dev` result does not prove `workerd` compatibility;
5. review any compatibility exception, private credential/source-map handling, protected staging and tested rollback before remote activation.

OpenNext command names do not establish safe effects. Its `build` invokes the application's package build script; `preview` populates local cache. `deploy` populates remote cache and immediately serves the deployment; `upload` also populates remote cache despite not serving the new version immediately. `migrate` edits source/config/dependencies and can create an R2 cache bucket when R2 is enabled. Do not run migration, remote cache population/upload/deploy, auto-provisioning or Access changes as a compatibility-check shortcut. R2 and the other rejected V1 products still require a concrete separately approved requirement.

Official references:

- [Cloudflare Next.js path and beta status](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Cloudflare OpenNext adapter guidance](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)
- [OpenNext version, runtime and Windows compatibility](https://opennext.js.org/cloudflare)
- [OpenNext CLI command effects](https://opennext.js.org/cloudflare/cli)
- [Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

## 6. Hostname and retained-service gate

The active `putduk.com` zone is already in the authorized account. A new account, zone transfer or speculative subdomain delegation is not required by the current target decision.

Before activating the planned member/admin hosts, preserve the exact DNS/custom-domain/security/email snapshot, map the reviewed current repository commit/artifact to each separate application, and record TLS, Auth, route ownership and rollback. An observed old Worker version is only a rollback starting point; test actual restoration and dependencies in protected staging.

Keep the retained root landing, `ops`/`api` mappings, mail and security services intact. Disconnect/remove only exact unrelated deployment integrations whose ownership, dependencies, production effects and restoration are established under the direct owner's cleanup scope. Unknown ownership or effect blocks that resource's removal. Any `workers.dev` or preview use must have a reviewed isolated/protected technical-validation plan and is not final production-host acceptance.

## 7. Provisioning and activation gates

The account/zone are settled. Every proposed resource still needs exact target, plan/cost eligibility, owner, purpose, data flow, security, secret inventory, retention/alerts and removal/rollback evidence. Do not ask the user to reselect a known target or infer permission from a key.

Follow the existing ordered gate in `AGENTS.md` and `docs/development/GIT-CI-CD-POLICY.md`: verify identity and bounded current integrations; preserve affected configuration and rollback; prepare only reviewed protected staging and run applicable real member/admin/backend/engine tests; establish product-completion and exact-candidate CI; then decide exact integration/host/DNS activation and perform TLS/Auth/security/readiness checks. Remove confirmed obsolete remnants only after retained services are safe.

Repository App/event effects remain partly unknown. The observed branch protection still required eight Auth shard names while the candidate workflow emitted twelve; reconcile the exact reviewed checks without deleting quality gates or accepting a failed candidate. A read-only integration snapshot, local unit/native test pass or account selection does not authorize push/merge, remote Supabase changes, production activation, real payout or paid AI.

Keep remote Supabase frozen until its separate explicit phase. Keep all current raw failures, unverified compatibility, protected-staging/restore gaps and product evidence visible. No current platform staging/activation or restore success is declared here.

## 8. WS-02 confirmation

Transactional outbox, consumer deduplication, leased durable jobs, retry history and dead-letter state are owned by PostgreSQL/Supabase in V1. This removes any speculative reason to create Cloudflare Queues, KV, D1, R2 or Durable Objects. A future measured throughput or isolation requirement must produce a new approved decision record before that boundary changes.
