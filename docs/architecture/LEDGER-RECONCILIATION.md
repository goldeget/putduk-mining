# Balanced Ledger and Reconciliation

Status: **CANONICAL P0 ACCOUNTING CONTRACT**

## Source of truth

`ledger_transactions` and `ledger_entries` form the authoritative balanced
journal. `wallet_accounts`, `wallet_ledger` and user-facing balances are
projections/read models and must never be treated as independently mutable
truth.

Each transaction has one currency and at least two positive entries. Total
debits must equal total credits before commit. Amounts are integer atomic units
stored without floating point. TypeScript boundaries use decimal strings or
`bigint`, never JavaScript `number` for money.

## Required transaction categories

```text
DEPOSIT
WITHDRAWAL
MINING_REWARD
TRIAL_REWARD_CONVERSION
WELCOME_REWARD
EVENT_REWARD
FUNDING_PROMO_REWARD
REFERRAL_REWARD
UPGRADE_COST
REFUND
REVERSAL
ADMIN_ADJUSTMENT
```

## Account model

Accounts have an immutable code, currency, account class, normal side and
optional member owner. Launch account families include controlled cash/assets,
member-wallet liabilities, reward/promotion expenses, mining expense/revenue,
fees and clearing/suspense. Platform accounts are created only from reviewed
deterministic configuration. Member liability accounts are created
idempotently.

## Posting rules

- Stable business idempotency key per command.
- One journal transaction per business effect.
- No update/delete of posted entries.
- Reversal references the original transaction and posts opposite entries.
- Admin adjustment requires role, bounded reason, confirmation and audit.
- Domain state, journal, projection and outbox are committed together.
- Ledger posting functions are service-only and run with the caller's
  privileges; no browser-callable security-definer shortcut is allowed.

## Reconciliation

Automated checks compare:

```text
wallet projection ↔ balanced journal
settlement result ↔ MINING_REWARD journal
approved deposit ↔ DEPOSIT journal
completed withdrawal ↔ WITHDRAWAL journal
trial/referral/event/promotion decision ↔ its journal transaction
system-controlled assets/funding records ↔ platform liabilities
outbox event ↔ committed domain/journal result
```

Every run records scope, cursor, counts, totals, mismatch details and status.
Mismatches enter an operator-owned exception queue; silent balance repair is
forbidden. A repair is a separate idempotent, reviewed command.

## Precision and scaling

- KRW: zero decimal display scale; one atomic unit equals one won.
- USDT readiness: six decimal display scale.
- Database journal amount: positive `numeric(38,0)` atomic units.
- API serialization: integer string.
- Percentage calculations: integer basis points with an explicit rounding
  direction and cap order.

## Acceptance

Balanced-deferred constraints, duplicate posting, rollback, reversal,
projection parity, cross-user denial, extremely large integer serialization and
concurrent posting must be tested before any remote migration.
