# PUTDUK MINING

Premium virtual mining platform built around a simple user experience, server-authoritative mining, ledger-based assets, operator-controlled economics, PWA notifications, PUTDUK AI, and public trust/discovery.

> Product principle: V1 ships fast, but it must never look or feel like a cheap MVP.

## Current implementation state

This repository is the new PUTDUK MINING foundation, built from a blank
application state. It currently includes:

- a responsive premium Korean user application and protected admin control
  plane;
- Supabase migrations with forced RLS, server-only mutation commands,
  a true balanced journal, wallet projections, versioned economics and atomic
  trial settlement;
- PUTDUK START qualification and one-time real KRW conversion capped at 5,000,
  with a verified first withdrawal that does not require prior funding;
- a transactional versioned outbox, consumer deduplication, leased durable jobs,
  bounded retries, attempt history, dead-letter and reconciliation foundations;
- referral, funding-promotion, event-reward, KYC/security, Member 360 lifecycle,
  feature-flag and sourced product-catalog foundations;
- KRW/USDT request boundaries, policy-bound encrypted withdrawal destinations
  and audited deposit approval;
- PWA manifest, offline shell, opt-in push subscription controls and notification
  preferences;
- canonical public trust pages, structured data, sitemap, robots, `llms.txt` and
  a machine-readable facts endpoint;
- PUTDUK AI with static-first routing, version cache, optional low/high model
  selection, authenticated real provider streaming, cancellation, idempotency,
  database rate limits and redacted audit records;
- local database, unit, build and browser verification gates.

No remote database migration, first-admin mutation, Cloudflare resource,
production deployment or domain switch is implied by this code. Those are
separate, explicit operational approvals.

## Product
- Korean brand: **퍼뜩 채굴**
- English brand: **PUTDUK MINING**
- User domain: `mining.putduk.com`
- Admin domain: `admin.mining.putduk.com`
- Primary display currency: **KRW**
- Secondary funding/withdrawal method: **USDT**
- Trial: **PUTDUK START — max 24 hours / quota-based / separate trial ledger**

## UX quality bar
PUTDUK is not an emoji-driven UI. Production UI uses:
- custom SVG iconography
- a unified design-token system
- high-quality motion and micro-interactions
- 2D/2.5D for general product UI
- selective Three.js / React Three Fiber for mining scenes
- responsive mobile, tablet and desktop layouts
- polished loading, empty, error and accessibility states

## Core architecture
```text
Identity / User
Trial
World / Mining / Equipment / Economy / Settlement / Reward
Wallet / Ledger / Funding / Withdrawal / Crypto
Event / Notice / Notification / PWA
PutdukAI
Trust / Discovery
Admin / Audit / Analytics / System
```

## Non-negotiable engineering rules
1. Client UI never determines balances or mining rewards.
2. Mining and settlement use server time.
3. Do not write mining progress to the database every second.
4. Asset mutations are ledger-first and idempotent.
5. Trial assets and real assets are separate.
6. Economic rules are versioned and never retroactively applied.
7. AI explains and analyzes; it never directly changes balances, approvals, or mining calculations.
8. Admin actions that affect assets/economics are audited.
9. Public product facts have one canonical truth source.
10. Search/AI discovery is part of V1, not a post-launch SEO patch.

## Documentation
- [Master architecture](docs/architecture/PUTDUK-MINING-MASTER-ARCHITECTURE.md)
- [Architecture closure audit](docs/architecture/ARCHITECTURE-CLOSURE-AUDIT.md)
- [Balanced ledger and reconciliation](docs/architecture/LEDGER-RECONCILIATION.md)
- [Domain events and outbox](docs/architecture/DOMAIN-EVENTS-OUTBOX.md)
- [Notification and PWA architecture](docs/architecture/NOTIFICATION-PWA.md)
- [24-hour trial system](docs/product/PUTDUK-START.md)
- [Welcome conversion and first withdrawal](docs/product/TRIAL-WELCOME-WITHDRAWAL.md)
- [Referral auto payout](docs/product/REFERRAL-AUTO-PAYOUT.md)
- [Funding promotions](docs/product/FUNDING-PROMOTIONS.md)
- [Event reward architecture](docs/product/EVENT-REWARD-ARCHITECTURE.md)
- [Product catalog](docs/product/PRODUCT-CATALOG.md)
- [Design system](docs/design/PUTDUK-DESIGN-SYSTEM.md)
- [Development conventions](docs/development/CONVENTIONS.md)
- [Admin & operations](docs/operations/ADMIN-OPERATIONS.md)
- [PUTDUK AI V1](docs/ai/PUTDUK-AI.md)
- [Cloudflare infrastructure decision](docs/operations/CLOUDFLARE-INFRASTRUCTURE.md)
- [Backup and restore drill](docs/operations/BACKUP-RESTORE-DRILL.md)
- [Trust & discovery](docs/trust/TRUST-DISCOVERY.md)
- [Trust, search and AI discovery policy](docs/trust/TRUST-SEARCH-AI-DISCOVERY.md)
- [Technology protection](docs/security/TECHNOLOGY-PROTECTION.md)
- [Definition of Done](docs/quality/DEFINITION-OF-DONE.md)
- [SLI, SLO and load testing](docs/quality/SLI-SLO-LOAD-TESTING.md)

## Local development

Required versions are pinned in `package.json`, `.node-version` and `.nvmrc`.

```powershell
pnpm install --frozen-lockfile
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
pnpm db:start
pnpm db:reset
pnpm dev
```

For local browser requests, set both public app URLs in `.env.local` to the
actual local origin (for example `http://127.0.0.1:3000`). Keep production URLs
in the deployment environment only.

The local Supabase configuration uses project-specific ports in the `58421`–
`58429` range. Use only the repository-scoped `pnpm db:*` commands; do not inspect
or reuse unrelated Docker resources.

## Verification

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:test
pnpm db:lint
pnpm db:advisors
pnpm test:e2e
```

`pnpm verify` runs formatting, lint, type checking, unit tests and the production
build. `pnpm db:verify` rebuilds the local schema and runs pgTAP, schema lint and
security-advisor gates. Browser tests remain explicit because they start their
own local web server.

## Repository structure
```text
app/
components/
features/
domain/
lib/
workers/
supabase/
public/
tests/
docs/
scripts/
.cursor/
.github/
```

## Branches
- `main` — production-ready
- `develop` — integration
- `feature/*`
- `fix/*`
- `hotfix/*`
- `refactor/*`
- `chore/*`

## License
Private proprietary project. No open-source license is granted.
