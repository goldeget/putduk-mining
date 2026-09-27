-- Worker claim commands are SECURITY INVOKER. The service role must be
-- able to touch the rows those commands read and write. This does not
-- authorize the browser or a user session.

grant select, insert, update on table public.outbox_events to service_role;
grant select, insert, update on table public.system_jobs to service_role;
grant select, insert, update on table public.system_job_attempts to service_role;
grant select, insert, update on table public.reconciliation_runs to service_role;
grant select, insert, update on table public.reconciliation_mismatches to service_role;
grant select, insert, update on table public.ledger_transactions to service_role;
grant select, insert on table public.ledger_entries to service_role;
grant select, insert, update on table public.ledger_accounts to service_role;
grant select, insert, update on table public.wallet_accounts to service_role;
grant select, insert on table public.wallet_ledger to service_role;
grant select on table public.trial_reward_conversions to service_role;
grant select, insert, update on table public.withdrawal_policies to service_role;
grant select, insert, update on table public.withdrawal_requests to service_role;
grant select, insert, update on table public.withdrawal_destinations to service_role;
grant select, insert on table public.withdrawal_destination_history to service_role;
grant select, insert on table public.withdrawal_external_sends to service_role;
grant select, insert, update on table public.user_roles to service_role;
grant select, insert, update on table public.transaction_receipts to service_role;
grant select, insert, update on table public.safe_mode_controls to service_role;
grant select, insert on table public.security_events to service_role;
grant select, insert on table public.member_timeline_events to service_role;
grant select, insert, update on table public.member_lifecycle_states to service_role;

grant execute on function app_private.assert_not_safe_mode(text[]) to service_role;
grant execute on function app_private.touch_command_rate_limit(text, text, integer, integer, integer) to service_role;
grant execute on function app_private.ensure_withdrawal_hold_accounts(uuid) to service_role;
grant execute on function app_private.available_krw_balance(uuid) to service_role;
grant execute on function app_private.post_withdrawal_hold(uuid, uuid, bigint, text, uuid) to service_role;
grant execute on function app_private.request_withdrawal_with_hold(uuid, uuid, bigint, text, text, uuid) to service_role;
