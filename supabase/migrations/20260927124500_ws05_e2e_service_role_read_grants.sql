-- Authenticated e2e uses the service role to prepare trial and KYC fixtures.
-- Claim-table grants already exist. These are the remaining read/write
-- surfaces those fixtures and SECURITY INVOKER commands touch.

grant select on table public.asset_worlds to service_role;

grant select, insert, update on table public.trial_programs to service_role;
grant select, insert on table public.trial_reward_curves to service_role;
grant select, insert on table public.trial_reward_curve_points to service_role;
grant select, insert, update on table public.trial_accounts to service_role;
grant select, insert, update on table public.trial_sessions to service_role;
grant select, insert on table public.trial_completions to service_role;
grant select, insert on table public.trial_ledger to service_role;

grant select, insert, update on table public.kyc_cases to service_role;
grant select, insert on table public.kyc_status_history to service_role;
grant select, insert on table public.kyc_submissions to service_role;

grant select on table public.deposit_requests to service_role;
grant select on table public.wallet_balance_snapshots to service_role;
