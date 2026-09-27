-- bootstrap_user is SECURITY INVOKER and executable only by service_role.
-- It must be able to ensure profile/settings/preferences rows for new members.

grant select, insert, update on table public.user_profiles to service_role;
grant select, insert, update on table public.user_settings to service_role;
grant select, insert, update on table public.notification_preferences to service_role;
