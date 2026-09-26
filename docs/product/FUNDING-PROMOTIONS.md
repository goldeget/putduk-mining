# Funding Promotion Engine

Status: **CANONICAL P0 RULE CONTRACT / P1 OPERATOR UX**

## Supported campaign families

```text
FUNDING_ONLY
ACTIVITY_ONLY
FUNDING_ACTIVITY_HYBRID
PROGRESSION
REFERRAL
```

Funding-only campaigns are first-class and must not be forced through an
activity condition.

## Reward models

- fixed atomic amount;
- percentage in integer basis points;
- tiered amount/percentage;
- progressive brackets;
- minimum qualifying funding;
- per-user and per-event maximums;
- total campaign budget and first-N guard;
- eligible segment/world/product;
- priority, stacking and mutually exclusive campaign group;
- scheduled start/end in UTC with KST presentation.

The default first-funding promotion has a maximum additional reward of
`KRW 10,000`. A separately identified `SPECIAL_OPERATOR_CAMPAIGN` may exceed
that limit only when an authorized operator explicitly sets and approves its
budget, cap and schedule. This exception never changes the default policy.

## Resolution order

```text
DEPOSIT_CONFIRMED.v1
→ select active approved versions
→ deterministic eligibility
→ deterministic calculation and rounding
→ stacking/exclusive resolution
→ per-user cap
→ campaign exposure/budget guard
→ anti-abuse
→ balanced FUNDING_PROMO_REWARD journal
→ outbox notification/analytics
```

Budget tracks configured, committed, paid, reversed, remaining and estimated
exposure. Reservation/posting occurs in one serialized transaction so
concurrent events cannot overspend.

AI may draft copy, targeting and a proposed rule. Only deterministic approved
rules calculate or post money.

## Acceptance

Percentage, fixed, tiered, progressive, boundary time, caps, budget exhaustion,
stacking, duplicate deposit event, idempotent payout and the explicit special
campaign exception are mandatory tests.
