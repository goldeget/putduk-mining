# Versioned Domain Events and Transactional Outbox

Status: **CANONICAL P0 RELIABILITY CONTRACT**

## Rule

Any database mutation followed by notifications, analytics, qualification,
rewards or other asynchronous work writes an outbox record in the same database
transaction. Unsafe database-plus-provider dual writes are forbidden.

## Envelope

Every event contains:

- immutable event UUID;
- canonical type ending in `.vN`;
- schema version;
- aggregate type and ID;
- actor/member ID where applicable;
- occurrence time in UTC;
- JSON object payload;
- correlation, causation and request IDs;
- deterministic idempotency/deduplication key;
- processing state, availability time and attempt metadata.

Canonical launch events include:

```text
MINING_STARTED.v1
MINING_SETTLEMENT_COMPLETED.v1
TRIAL_COMPLETED.v1
TRIAL_REWARD_CONVERTED.v1
DEPOSIT_CONFIRMED.v1
WITHDRAWAL_COMPLETED.v1
REFERRAL_REWARD_PAID.v1
FUNDING_PROMO_REWARD_PAID.v1
NOTICE_PUBLISHED.v1
EVENT_STARTED.v1
EVENT_REWARD_GRANTED.v1
```

## Compatibility

- Existing event versions are immutable.
- Additive optional fields may remain in the same version only when every
  consumer tolerates their absence.
- Renames, semantic changes, required fields or unit changes require `.vN+1`.
- Producers may dual-publish only under a documented migration window.
- Consumers reject unknown incompatible versions into a recoverable exception
  state; they do not guess.

## Delivery and jobs

Consumers claim due records with bounded leases, process at least once and
deduplicate by `(consumer_name, event_id)`. Retry uses capped exponential
backoff with jitter. Permanent failures enter a dead-letter/recovery state with
the original payload digest and correlation IDs. Replay preserves the original
business idempotency key.

The browser is never required for mining progression, settlement eligibility,
referral checks, event schedules, notice publication or push fanout.

## Acceptance

- domain mutation and event commit together;
- rolled-back mutation leaves no event;
- duplicate delivery produces one consumer effect;
- a failed notification never duplicates money;
- leases recover after worker loss;
- replay is auditable and idempotent;
- backlog age, retry count and terminal failures are observable.
