-- bootstrap_user must stay SECURITY DEFINER. Replacing the body for a
-- KRW-only wallet dropped that attribute and failed the reviewed allowlist.
-- consume_admin_step_up stays INVOKER. service_role may execute the private
-- token function, which already has the session and grant table privileges.

alter function public.bootstrap_user(uuid) security definer;
alter function public.bootstrap_user(uuid) set search_path = pg_catalog;

create or replace function public.consume_admin_step_up(
  p_user_id uuid,
  p_token text,
  p_command_family text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  return app_private.consume_admin_step_up_token(
    p_user_id, p_token, p_command_family, p_request_id
  );
end;
$$;

revoke all on function public.consume_admin_step_up(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_admin_step_up(uuid, text, text, uuid)
  to service_role;

revoke all on function app_private.consume_admin_step_up_token(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function app_private.consume_admin_step_up_token(uuid, text, text, uuid)
  to service_role;
