# Database Map

## Identity
```text
user_profiles
user_roles
user_settings
member_lifecycle_states
kyc_cases
kyc_submissions
kyc_status_history
```

## Trial
```text
trial_programs
trial_accounts
trial_sessions
trial_ledger
trial_reward_curves
trial_completions
trial_reward_conversions
trial_qualification_snapshots
```

## World / Economy
```text
asset_worlds
world_instruments
world_rules
world_rule_versions
product_catalog_versions
mining_products
product_rule_versions
product_visuals
product_availability
```

## Mining
```text
mining_farms
mining_sessions
mining_equipment
mining_status_history
mining_settlements
```

## Balanced Ledger / Wallet / Funding
```text
ledger_accounts
ledger_transactions
ledger_entries
wallet_accounts
wallet_ledger
reconciliation_runs
reconciliation_mismatches
deposit_requests
bank_deposits
asset_reference_rates
crypto_deposits
crypto_transactions
withdrawal_requests
crypto_withdrawals
withdrawal_destinations
transaction_receipts
```

`ledger_transactions` + `ledger_entries` are authoritative. `wallet_ledger` and
wallet balances are append-only projections/read models.

## Referrals / Promotions
```text
referral_attributions
referral_program_versions
referral_qualifications
referral_decision_snapshots
referral_reward_claims
promotion_campaigns
promotion_rule_versions
promotion_budget_accounts
promotion_reward_claims
```

## LiveOps
```text
events
event_rules
event_rewards
event_participants
missions
mission_progress
achievement_definitions
user_achievements
notices
notifications
notification_deliveries
push_subscriptions
notification_preferences
```

## Events / Jobs / Automation
```text
outbox_events
event_consumer_deliveries
system_jobs
system_job_attempts
safe_mode_controls
feature_flags
experiment_definitions
experiment_assignments
```

## Security / Member 360
```text
security_events
user_sessions
login_attempts
ip_observations
risk_flags
block_rules
block_history
member_timeline_events
support_cases
support_diagnostic_bundles
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

All exposed tables require explicit grants plus RLS; service-only tables remain
denied to `anon` and `authenticated`. Authoritative formulas, risk thresholds
and privileged commands remain server-side.
