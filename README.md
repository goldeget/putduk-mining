# PUTDUK MINING

Premium virtual mining platform built around a simple user experience, server-authoritative mining, ledger-based assets, operator-controlled economics, PWA notifications, PUTDUK AI, and public trust/discovery.

> Product principle: V1 ships fast, but it must never look or feel like a cheap MVP.

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
- [24-hour trial system](docs/product/PUTDUK-START.md)
- [Design system](docs/design/PUTDUK-DESIGN-SYSTEM.md)
- [Development conventions](docs/development/CONVENTIONS.md)
- [Admin & operations](docs/operations/ADMIN-OPERATIONS.md)
- [Trust & discovery](docs/trust/TRUST-DISCOVERY.md)

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
