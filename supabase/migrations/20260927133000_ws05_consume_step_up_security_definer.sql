-- public.consume_admin_step_up is the service-role entrypoint for consuming
-- opaque step-up grants. It must be SECURITY DEFINER so it can call
-- app_private.consume_admin_step_up_token without exposing that private
-- function to service_role callers.

create or replace function public.consume_admin_step_up(
  p_user_id uuid,
  p_token text,
  p_command_family text,
  p_request_id uuid
)
returns uuid
language plpgsql
security definer
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

comment on function public.consume_admin_step_up(uuid, text, text, uuid) is
  'Service-role wrapper that consumes a single-use admin step-up grant via app_private.';
