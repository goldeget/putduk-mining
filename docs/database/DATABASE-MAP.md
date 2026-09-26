# Database Map

## Identity
```text
user_profiles
user_roles
user_settings
```

## Trial
```text
trial_programs
trial_accounts
trial_sessions
trial_ledger
trial_reward_curves
trial_completions
```

## World / Economy
```text
asset_worlds
world_instruments
world_rules
world_rule_versions
```

## Mining
```text
mining_farms
mining_sessions
mining_equipment
mining_status_history
mining_settlements
```

## Wallet / Funding
```text
wallet_accounts
wallet_ledger
deposit_requests
bank_deposits
asset_reference_rates
crypto_deposits
crypto_transactions
withdrawal_requests
crypto_withdrawals
```

## LiveOps
```text
events
event_rules
event_rewards
event_participants
notices
notifications
notification_deliveries
push_subscriptions
notification_preferences
```

## AI
```text
ai_requests
ai_usage
ai_cache
ai_reports
ai_knowledge
```

## Trust / System
```text
trust_facts
trust_documents
trust_versions
trust_sources
audit_logs
system_jobs
system_status
```

This is a planning map. The actual executable schema is owned by versioned Supabase migrations.
