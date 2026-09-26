# Analytics

## Primary funnel
```text
landing_view
→ signup_complete
→ trial_start
→ trial_first_reward
→ trial_50_percent
→ trial_complete
→ deposit_start
→ deposit_complete
→ real_mining_start
→ first_real_settlement
→ return_visit
```

## Core event names
```text
screen_view
signup_complete
trial_start
trial_first_reward
trial_progress
trial_complete
mining_world_view
mining_start
mining_stop
mining_settlement_view
deposit_start
deposit_complete
withdrawal_start
withdrawal_complete
event_view
event_join
notice_view
rank_up_view
ai_open
ai_question
push_open
```

Properties use snake_case.

## Ingestion boundary

- The browser sends allowlisted events to `/api/v1/analytics` only in production.
- The endpoint accepts only the official app/admin origins and an 8 KiB bounded payload.
- Event and property names are allowlisted; property values are primitive and bounded.
- Authenticated activity is stored against the verified user. Anonymous activity receives
  a first-party HttpOnly identifier.
- `request_id` is unique so browser retries do not create duplicate events.
- Client roles cannot insert analytics rows directly; the server performs the insert.
- Analytics failure never blocks the product flow.

## Core conversion metrics
- signup → trial start
- trial start → first result
- first result → 50% quota
- 50% quota → completion
- completion → funding screen
- funding screen → deposit request
- deposit request → deposit completion
- deposit completion → real mining
- first real mining → return visit
