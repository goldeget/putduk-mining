# Event Factory and Reward Architecture

Status: **P0 REWARD SAFETY / P1 EVENT EXPERIENCE**

## Separation of authority

```text
AI Event Factory (draft only)
→ deterministic validation
→ operator approval or explicit pre-authorized template policy
→ deterministic publisher
→ deterministic mission/reward evaluator
→ risk and budget guards
→ balanced ledger payout
→ outbox fanout, analytics and postmortem
```

AI never writes wallet or ledger data, bypasses a budget, changes eligibility,
publishes without authority or claims an event ran when it did not.

## Draft bundle

A draft may contain Korean name/copy, mission definition, eligibility, proposed
reward table, schedule, segments, responsive visual brief/assets, banner/card,
push/popup/notice/FAQ copy, analytics plan, anti-abuse notes and post-event
report template. Raster images contain no production copy.

## Deterministic primitives

V1 supports reusable first-mining, consecutive activity, world exploration,
settlement milestone, rank celebration, weekend/seasonal and referral campaign
templates. Definitions are data, not new application code.

Reward types:

```text
CASH_REWARD
WELCOME_REWARD (only where the welcome policy permits)
EVENT_POINT
BADGE
RANK_XP
VISUAL_EFFECT
PROFILE_TITLE
WORLD_UNLOCK
SPECIAL_ACCESS
```

Cash rewards use unique `(event_id, user_id, reward_rule_id)` claims, a balanced
journal transaction, budget exposure and an immutable qualification snapshot.
High-value cash paths require approved funding/activity/age/settlement/rank/risk
conditions; repetitive unfunded farming is not allowed.

Mission and achievement progress consumes canonical versioned domain events,
not client-side counters.

## Publication fanout

Publishing/scheduling an event or notice automatically creates audience,
in-app, push-when-permitted, banner/popup, analytics and history work through
the outbox. A second manual send is not required. Preference, quiet-hours and
fatigue rules still apply unless an approved critical-service policy overrides
them.
