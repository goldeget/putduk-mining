# Analytics

## Primary funnel
```text
landing_view
→ signup_complete
→ trial_start
→ trial_first_reward
→ trial_50_percent
→ trial_complete
→ welcome_reward_qualified
→ welcome_reward_converted
→ welcome_withdrawal_complete
→ withdrawal_complete_no_funding
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
welcome_reward_qualified
welcome_reward_auto_hold
welcome_reward_converted
welcome_withdrawal_start
welcome_withdrawal_complete
withdrawal_complete_no_funding
first_funding
first_real_mining
active_7d
active_30d
long_term_active
referral_stage_qualified
referral_reward_paid
funding_promotion_reward_paid
event_reward_granted
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
- completion → welcome reward qualification
- qualification → real-wallet conversion
- conversion → first welcome withdrawal
- welcome withdrawal → completed with no funding
- no-funding withdrawal → first funding (non-spam re-engagement cohort)
- funding screen → deposit request
- deposit request → deposit completion
- deposit completion → real mining
- first real mining → return visit

Server-confirmed money/lifecycle events originate from committed domain/outbox
facts, never browser self-report. Attribution follows campaign/creative/landing
through signup, trial, welcome withdrawal, first funding, first real mining and
7/30-day activity without storing sensitive query parameters.

## Observability signals

- `landing_view` is the first funnel event and is sent for `/` only.
- `web_vital` carries `vital_name`, `vital_value`, `vital_rating`, `vital_unit`, and optional `navigation_type`.
- `client_error` carries `error_name` and an optional `error_digest`. Error messages are not stored.
- `app_release` is an optional release token. It is omitted when unset or unsafe.
- Property names are the allowlist in `domain/analytics/events.ts`. Email, phone, address, token, balance, and query strings are rejected.
- Browser ingestion runs only in production and skips automated browsers and loopback hosts.
- Session evidence is a random session id plus a structural path. DOM, input, network bodies, and money values are not replayed.
- The production funnel definition is `domain/analytics/funnel.ts`. A hosted product-analytics project is not configured from this repository.
