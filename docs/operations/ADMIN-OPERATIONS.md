# Admin & Operations

The complete one-person operating model, exception queues, safe-mode controls,
AI boundaries, reconciliation and restore requirements are defined in
`docs/operations/AUTONOMOUS-ONE-PERSON-OPERATIONS.md`. This file records the
implemented foundation and high-risk command constraints.

## Roles
- SUPER_ADMIN
- ADMIN
- CONTENT_ADMIN
- SUPPORT_ADMIN
- VIEWER

## Main sections
- Dashboard
- Users
- Member 360 / KYC / Security
- Trial
- Welcome conversion
- Mining
- Economy
- Assets
- Funding
- Promotions
- Withdrawals
- Referrals
- Events
- Notices
- Notifications
- AI
- Trust
- Analytics
- Audit
- Jobs / Outbox / Dead letter
- Reconciliation
- System

## Core KPIs
- new users today
- active users
- active trials
- trial completions
- trial → funding conversion
- trial → welcome reward qualification/conversion
- welcome withdrawal completed without funding
- no-funding withdrawal → first funding
- active mining farms
- settlements today
- pending deposits
- pending withdrawals
- referral/promotion/event reward exposure and exception counts
- outbox backlog age, dead letters and reconciliation mismatches
- notification delivery
- AI usage
- system errors

## High-risk operations
Require confirmation and audit:
- economy/rate changes
- wallet adjustments
- deposit approval
- withdrawal approval
- USDT approval
- bulk rewards
- promotion/event budgets and special campaign caps
- referral reversal
- KYC override or security block
- subsystem safe-mode changes
- privilege changes

Normal referral qualification, campaign calculation, event evaluation,
notification fanout, retries and reconciliation run automatically under approved
versions. Operators set policy, approve high-impact campaigns, pause/resume
subsystems and handle true exceptions; they do not manually execute routine
payouts.

## Member 360

Authorized views connect profile, account state, KYC, trial/welcome conversion,
catalog/mining, balanced ledger and receipts, deposits/withdrawals, referrals,
events, notifications, security/session context, support, AI activity and audit
through a factual timeline. Sensitive KYC documents and withdrawal destinations
are redacted by default; access is separately audited.

## Emergency controls

Signup, trial, new mining, settlement, deposit approval, withdrawal, referral
payout, event payout, notifications and AI can be paused independently. Each
control requires actor, reason, start, optional expiry/review time and audit.
Paused work is preserved and visible; it is never deleted or reported as active.

## First `SUPER_ADMIN`

The first role is created only through `public.bootstrap_first_super_admin` and
the guarded `pnpm admin:bootstrap` operator script. The command:

- is locked to the approved Supabase ref `osrmyjgmpdspdcwqjwuv`;
- accepts an exact existing `auth.users` UUID, never an email search result;
- requires a 10–500 character reason and the literal confirmation
  `BOOTSTRAP_FIRST_SUPER_ADMIN`;
- atomically creates the role and append-only audit record;
- permanently refuses to run after any role row exists;
- performs a read-back verification before reporting success.

It is a remote mutation and must not be run without explicit approval for the
exact target and user.

## Deposit approval

Only `SUPER_ADMIN` and `ADMIN` may approve a pending deposit. The operator must
confirm the actual received atomic amount, provide an audit reason, and type the
literal confirmation `APPROVE_DEPOSIT`. One database transaction creates the
immutable ledger credit, updates the request and appends the audit record. A
successful HTTP response alone is not sufficient evidence; verify the ledger,
request state and audit record together.

## Economy changes
```text
Draft rule
→ Test world
→ Simulation
→ Compare
→ Approve
→ effective_at
→ Production
→ Audit
→ Changelog if user-impacting
```
