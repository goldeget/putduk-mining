# Cloudflare V1 Infrastructure Decision

Status: **DOCUMENTED / NOT PROVISIONED**

This document is the mandatory decision record that must be approved before any Cloudflare resource is created for PUTDUK MINING.

## 1. Verified current state

- The authorized target is a brand-new Cloudflare account created only for PUTDUK MINING.
- The exact account ID is not yet verified in this repository.
- No Worker, Queue, KV namespace, R2 bucket, D1 database, zone, route, Zero Trust application, or deployment is assumed to exist.
- `putduk.com` remains in a different Cloudflare account and is out of scope.
- Production hostnames are planned as `mining.putduk.com` and `admin.mining.putduk.com`.
- No account-scoped Cloudflare API operation may run until the new account ID is uniquely verified and recorded in `AGENTS.md`.

## 2. V1 responsibility boundary

### Tooling inspection (2026-09-27)

- The Cloudflare architecture/documentation skill and current official documentation are available for read-only design work.
- This repository does not currently include Wrangler, a Cloudflare adapter, account bindings, Worker configuration or an authenticated account-scoped deployment integration.
- No exact account ID has been verified. Therefore no account listing, API call, compatibility migration, Worker preview tied to the account or resource provisioning was executed.
- The first executable Cloudflare step remains a separately authorized identity/account preflight, followed by a local non-destructive runtime compatibility check.

| Capability | System of record | Cloudflare V1 decision |
| --- | --- | --- |
| PostgreSQL data and transactions | Supabase PostgreSQL | Do not create D1 |
| Identity and sessions | Supabase Auth | Do not duplicate in Access or KV |
| User files and product objects | Supabase Storage | Do not create R2 without a separate approved requirement |
| Realtime user updates | Supabase Realtime | Do not create Durable Objects |
| Scheduled database work | Supabase-owned job path | Do not create Queues merely for scheduling |
| Mining and settlement authority | Server domain + PostgreSQL ledger | Never calculate authoritative rewards at the edge |
| Web application runtime | Candidate: Cloudflare Workers | Validate framework compatibility before adoption |
| Static assets and edge delivery | Candidate: Workers Static Assets | Provision with the web runtime only |
| Request protection and observability | Candidate: Workers controls and logs | Enable after account and hostname topology are verified |
| DNS for `putduk.com` | Existing external account | No access or changes from this project |

## 3. Proposed minimal resources

No resource below is approved for provisioning yet.

### A. User web runtime

- Proposed name: `putduk-mining-web`
- Product: Cloudflare Workers with static assets
- Purpose: run the public/user Next.js application and its server routes
- Data flow: browser → Worker → Supabase APIs
- Security boundary: no Supabase service-role key in browser bundles; privileged calls remain server-only
- Cost surface: Worker requests, CPU time, logs, and asset delivery
- Removal plan: remove the Worker after traffic is detached and a verified deployment replacement exists

### B. Admin web runtime

- Proposed name: `putduk-mining-admin`
- Product: Cloudflare Workers with static assets, or an isolated entrypoint from the same reviewed source
- Purpose: serve the admin interface independently from the public hostname
- Data flow: authorized operator → admin Worker → server-side authorization → Supabase
- Security boundary: every operation requires server-side role checks; hostname separation is not authorization
- Cost surface: Worker requests, CPU time, logs, and asset delivery
- Removal plan: remove only after admin traffic and operational access are safely migrated

The final choice between two Workers and one Worker with strict hostname routing is deferred until the admin authentication flow and framework adapter pass integration tests. Separate Workers are preferred when they materially reduce blast radius without duplicating application logic.

## 4. Explicitly rejected for V1

- **D1:** PostgreSQL is already the transactional source of truth.
- **KV:** no independent globally replicated key-value requirement exists.
- **R2:** Supabase Storage owns V1 object storage.
- **Queues:** no approved workload currently requires Cloudflare-native queue semantics; database jobs must not be duplicated.
- **Durable Objects:** no V1 real-time coordination domain requires them.
- **Vectorize / Workers AI / AI Gateway:** PUTDUK AI provider and retrieval design are not approved yet.
- **Zero Trust:** not assumed or provisioned. Admin authorization remains an application and database responsibility.

Adding one of these products requires a new architecture decision covering ownership, consistency, failure recovery, security, cost, observability, and deletion.

## 5. Framework gate

Current Cloudflare documentation (checked 2026-09-27) recommends `vinext` as the default Next.js-on-Workers path while also describing it as beta. PUTDUK must not adopt a beta runtime path solely to make deployment convenient.

Before adding Wrangler or a Cloudflare adapter:

1. run the current compatibility check against this repository;
2. verify Next.js route handlers, server components, cookies, PWA assets, and Supabase SSR behavior;
3. pass the same unit, database, build, and browser test gates used by the standard Next.js runtime;
4. document any compatibility exception;
5. pin the adapter and Wrangler versions;
6. verify preview and rollback behavior without production traffic.

Official references:

- [Next.js on Cloudflare Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)
- [Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare DNS setup options](https://developers.cloudflare.com/dns/zone-setups/)

## 6. Hostname blocker

Workers Custom Domains require an active zone owned by the account attaching the domain. The new PUTDUK MINING account does not currently own the `putduk.com` zone, and that zone must not be moved or inspected.

Production hostname activation therefore remains blocked until the domain owner chooses and performs a supported handoff, such as an eligible delegated subdomain setup. The exact option depends on the Cloudflare plans and ownership topology and must be verified before execution.

The project may later provide the required target or nameserver values, but it must not modify the existing `putduk.com` account. `workers.dev` may be used only for isolated technical validation, not as the final production hostname.

## 7. Provisioning gate

Provisioning is allowed only after all of the following are known:

- exact new Cloudflare account ID;
- account plan and product eligibility;
- approved runtime adapter and pinned versions;
- user/admin deployment topology;
- hostname delegation method;
- secrets and environment-variable inventory;
- log retention and alert ownership;
- rollback owner and procedure;
- explicit user authorization to provision.

Until then, Cloudflare state is intentionally unchanged.

## 8. WS-02 confirmation

Transactional outbox, consumer deduplication, leased durable jobs, retry history and dead-letter state are owned by PostgreSQL/Supabase in V1. This removes any speculative reason to create Cloudflare Queues, KV, D1, R2 or Durable Objects. A future measured throughput or isolation requirement must produce a new approved decision record before that boundary changes.

