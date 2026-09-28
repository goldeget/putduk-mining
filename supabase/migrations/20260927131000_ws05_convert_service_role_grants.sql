-- convert_trial_welcome_reward is SECURITY INVOKER.
-- The member API calls it through the service-role admin client, so that role
-- needs the table privileges the command body touches. Without these grants
-- PostgREST returns 42501 (permission denied for table risk_flags) and the
-- welcome conversion path cannot complete.

grant select on table public.risk_flags to service_role;

grant select, insert, update on table public.trial_reward_conversions to service_role;

grant select, insert on table public.trial_qualification_snapshots to service_role;
