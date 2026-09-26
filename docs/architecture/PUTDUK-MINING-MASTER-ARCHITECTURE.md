# PUTDUK MINING — Master Architecture

Status: **FINAL / Single Source of Truth**

## 1. Product definition
PUTDUK MINING is PUTDUK's internal virtual mining economy platform. Users operate virtual mining farms across several worlds, while all mining, settlement, reward and wallet calculations remain server-authoritative.

V1 worlds:
- KOREA
- USA
- GOLD
- SILVER
- CRYPTO

The worlds do not depend on external securities, exchange or live market-data APIs. Their economics are defined by PUTDUK's internal rules.

## 2. Product loop
```text
Acquisition
→ Sign up
→ PUTDUK START trial
→ First mining result
→ 24h auto-mining experience
→ Trial completion
→ Funding
→ Real mining
→ Auto settlement
→ Growth / Events / AI
→ Return
```

## 3. System domains
```text
Identity
User

Trial

World
Mining
Equipment
Economy
Settlement
Reward

Wallet
Ledger
Funding
Withdrawal
Crypto

Event
Notice
Notification
PWA

PutdukAI

Trust
Discovery

Admin
Audit
Analytics
System
```

## 4. Technology
Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS
- Motion
- SVG
- Three.js / React Three Fiber
- PWA

Backend/Data:
- Supabase PostgreSQL
- Supabase Auth
- Supabase Realtime
- Supabase Storage
- Supabase Edge Functions when appropriate

Infrastructure:
- Cloudflare DNS / CDN / WAF
- Cloudflare Workers / Queues for background processing where appropriate

## 5. Mining engine
Core settlement formula is conceptually:
```text
elapsed_time
× base_mining_rate
× equipment_efficiency
× world_multiplier
× event_multiplier
× status_multiplier
= settlement_amount
```

Rules:
- server time only
- no per-second database writes
- `last_settled_at` is the settlement anchor
- every economic change has a rule version and effective time
- if a rule changes mid-session, settlement is split into time segments
- settlements must be idempotent

Mining statuses:
- NORMAL
- REDUCED
- MAINTENANCE
- PARTIAL_STOP
- STOPPED

## 6. Trial architecture
PUTDUK START:
- all eligible new users
- maximum 24 hours
- quota-based usage
- ends at 100% quota OR 24 hours, whichever occurs first
- separate trial account and trial ledger
- configurable target experience range: KRW 3,000–10,000 equivalent
- default first world: KOREA
- trial continues via server-time settlement while the app is closed

Trial and real wallet assets never mix.

## 7. Wallet and ledger
Core tables:
```text
wallet_accounts
wallet_ledger
```

Ledger event types:
```text
DEPOSIT
WITHDRAWAL
MINING_REWARD
EVENT_REWARD
UPGRADE_COST
REFUND
REVERSAL
ADMIN_ADJUSTMENT
```

Rules:
- no direct arbitrary balance overwrite
- every mutation produces an auditable ledger entry
- financial-like operations require idempotency
- admin adjustments require reason + audit event

## 8. Funding
Primary UI denomination: KRW.

KRW funding:
```text
Create deposit request
→ Show bank-transfer instructions
→ Operator verifies
→ DEPOSIT ledger entry
→ Balance reflects ledger
```

USDT:
- secondary option only
- not shown as a permanent main-wallet asset tile
- user sees it only when selecting USDT funding/withdrawal
- V1 can use operator verification
- architecture leaves room for a future self-hosted node/RPC deposit watcher
- no external exchange API is assumed
- reference conversion values are versioned and operator-controlled

## 9. PWA / notifications
Required:
- manifest
- service worker
- home-screen install
- web push
- notification click routing
- notification preferences
- offline application shell where useful

Do not request push permission immediately on first page load. Ask after the user understands the product value.

## 10. PUTDUK AI
AI may:
- explain
- summarize
- analyze
- retrieve authorized user/product context
- recommend next actions

AI may not directly:
- mutate balances
- approve deposits or withdrawals
- create ledger entries
- decide mining results
- change economic rules
- change admin privileges

## 11. Admin
Roles:
- SUPER_ADMIN
- ADMIN
- CONTENT_ADMIN
- SUPPORT_ADMIN
- VIEWER

Admin controls:
- users
- trial configuration
- worlds
- mining/economic rules
- settlement visibility
- wallet/ledger inspection
- funding/withdrawals
- USDT operations
- events
- notices
- push notifications
- AI knowledge
- trust content
- status/changelog
- analytics
- audit logs

High-impact operations must require explicit confirmation and audit logging.

## 12. Trust & discovery
Public routes include:
```text
/about
/how-it-works
/putduk-facts
/verification
/mining-rules
/trial
/economy
/deposit
/withdrawal
/faq
/status
/changelog
/ai
```

PUTDUK maintains one canonical public truth layer so:
- official pages
- FAQ
- PUTDUK AI
- structured data
- external search/AI discovery

do not contradict each other.

## 13. Design quality bar
Production UI is not emoji-driven.

Use:
- custom SVG icons
- consistent typography
- design tokens
- premium motion
- structured spacing
- high-quality empty/error/loading states
- selective 3D only where it adds value
- accessibility and reduced-motion support
- mobile-first responsive behavior

The product should combine fintech-level clarity, premium game immersion and SaaS-level information architecture without copying any one category visually.

## 14. V1 scope
Required:
- auth
- 24h PUTDUK START
- five mining worlds
- mining engine
- auto-mining settlement
- wallet + ledger
- KRW funding
- USDT funding path
- KRW withdrawal
- USDT withdrawal structure
- events / notices
- notifications / web push / PWA
- rank system
- premium mining scene
- PUTDUK AI
- admin center
- economic rule configuration
- audit + analytics
- trust center / FAQ / status / changelog
- SEO / structured data / sitemap / AI discovery

Deferred:
- user marketplace
- guilds
- social graph
- massive live leaderboard
- large equipment catalog
- multiplayer 3D
- autonomous AI agents

## 15. Architecture decision gate
Before adding any feature, answer:
1. Which domain owns it?
2. Does it mutate a ledger?
3. Does it require rule versioning?
4. Is it auditable?
5. Must an operator control it?
6. Which analytics events are needed?
7. Does it increase user-facing complexity?
8. Could it contradict the public truth/AI layer?

If those questions are unanswered, implementation is not ready.
