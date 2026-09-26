# PUTDUK START, Welcome Reward, and First Withdrawal

Status: **CANONICAL P0 PRODUCT CONTRACT**

This document supersedes any older wording that implies PUTDUK START is only a
non-withdrawable simulation or that funding is required before the first
welcome-reward withdrawal.

## Invariants

- PUTDUK START lasts at most 24 hours and completes at quota `100%` or the time
  limit, whichever occurs first.
- Trial accounting and real wallet accounting remain separate.
- An eligible completed trial may convert once to a real KRW welcome reward.
- The real cash-convertible amount is capped at `KRW 5,000` per eligible user.
- The launch hard ceiling is `KRW 5,000`; configuration may lower it, never
  raise it without a new approved product version and migration.
- Funding is never an eligibility condition for conversion or withdrawal of
  this reward.
- KYC, identity integrity, one-person eligibility and anti-abuse checks are
  required. A shared IP alone is evidence, not an automatic rejection.
- Server time, server commands and immutable rule snapshots are authoritative.

For KRW, one atomic unit is one won. The launch hard ceiling is therefore
`5000` KRW atomic units. USDT uses six decimal atomic units and is not part of
this welcome conversion.

## State machine

```text
trial READY → ACTIVE → COMPLETED|EXPIRED
                         │
                         ▼
conversion PENDING_QUALIFICATION
  → QUALIFIED
  → AUTO_HOLD → QUALIFIED|REJECTED
  → APPROVED
  → CONVERTED
  → REVERSED (a new compensating transaction; never delete history)
```

`REJECTED` requires a reason and rule/risk version. `AUTO_HOLD` is retryable and
must have a next review time. One `trial_account_id` can own only one conversion
record and one successful ledger transaction.

## Atomic conversion transaction

```text
lock trial account + conversion identity
→ verify terminal trial and unused conversion
→ verify KYC/eligibility/risk snapshot
→ amount = min(earned trial result, configured cap, KRW 5,000)
→ create balanced TRIAL_REWARD_CONVERSION ledger transaction
→ debit PUTDUK welcome-reward expense
→ credit the member KRW liability account
→ append the wallet projection entry
→ mark conversion CONVERTED
→ append TRIAL_REWARD_CONVERTED.v1 outbox event
→ commit
```

Retries reuse the same business idempotency key and return the original result.
AI can explain or flag a case but cannot qualify, approve or post the reward.

## First withdrawal trust path

```text
welcome reward visible in real KRW wallet
→ register and verify KRW withdrawal destination
→ request withdrawal
→ identity/risk/destination checks
→ reserve available balance
→ operator/system policy review
→ complete transfer
→ receipt + notification + timeline + reconciliation
```

No step may query for a prior deposit as a prerequisite. A withdrawal policy
may enforce identity, destination, minimum/fee, cooldown and risk controls, but
must expose a dedicated welcome-reward-compatible policy where the configured
minimum would otherwise prevent the promised withdrawal.

## Lifecycle analytics

The canonical member lifecycle is:

```text
visitor → signup → trial_started → first_mining → trial_completed
→ welcome_withdrawal_requested → welcome_withdrawal_completed
→ withdrawal_completed_no_funding → first_funding → first_real_mining
→ active_7d → active_30d → long_term_active
```

Re-engagement for `withdrawal_completed_no_funding` is preference-aware,
frequency-capped and never conditions already-earned money on future funding.

## Required proof

- cap cannot exceed `5000` KRW atomic;
- duplicate/replayed conversion cannot pay twice;
- conversion and ledger/outbox effects commit or roll back together;
- withdrawal succeeds without any funding record;
- two-user RLS isolation and anonymous denial pass;
- rejection/hold decisions retain evidence and version identifiers.
