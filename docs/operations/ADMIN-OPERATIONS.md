# Admin & Operations

## Roles
- SUPER_ADMIN
- ADMIN
- CONTENT_ADMIN
- SUPPORT_ADMIN
- VIEWER

## Main sections
- Dashboard
- Users
- Trial
- Mining
- Economy
- Assets
- Funding
- Withdrawals
- Events
- Notices
- Notifications
- AI
- Trust
- Analytics
- Audit
- System

## Core KPIs
- new users today
- active users
- active trials
- trial completions
- trial → funding conversion
- active mining farms
- settlements today
- pending deposits
- pending withdrawals
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
- privilege changes

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
