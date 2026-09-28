-- WITHDRAWAL_OPERATOR step-up은 현재 운영 세션과 발급 세션이 같을 때만 소비한다.
--
-- 기존 4-인자 public.consume_admin_step_up / app_private.consume_admin_step_up_token 은
-- 세션 id를 받지 않아 service_role이 다른 세션의 grant를 소비할 수 있었다.
-- 이 마이그레이션은 그 시그니처를 제거한다. 권한만 회수하면 함수 소유자는
-- 세션 검사 없는 본문을 계속 실행할 수 있다.
--
-- 새 public 래퍼는 SECURITY INVOKER다. SECURITY DEFINER allowlist를 늘리지 않는다.
-- 그래서 5-인자 private helper는 service_role EXECUTE가 필요하다.
-- private 함수도 현재 admin_session_id가 grant와 같을 때만 소비한다.
--
-- 잠금: 함수 DROP/CREATE의 ACCESS EXCLUSIVE.
-- 트랜잭션: 마이그레이션 트랜잭션 안에서 적용된다.
-- 복구: 4-인자 시그니처를 되돌리지 않는다. 이전 앱은 함수 부재로 실패한다.

create function app_private.consume_admin_step_up_token(
  p_user_id uuid,
  p_token text,
  p_command_family text,
  p_request_id uuid,
  p_admin_session_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_hash text;
  v_grant public.admin_step_up_grants%rowtype;
begin
  if p_admin_session_id is null
    or char_length(btrim(coalesce(p_token, ''))) < 16
  then
    raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select grant_row.* into v_grant
  from public.admin_step_up_grants as grant_row
  where grant_row.token_hash = v_hash
    and grant_row.user_id = p_user_id
    and grant_row.command_family = p_command_family
    and grant_row.admin_session_id = p_admin_session_id
  for update;

  if v_grant.id is null
    or v_grant.consumed_at is not null
    or v_grant.expires_at <= statement_timestamp()
  then
    raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.admin_sessions as session
    where session.id = v_grant.admin_session_id
      and session.id = p_admin_session_id
      and session.user_id = p_user_id
      and session.revoked_at is null
      and session.idle_expires_at > statement_timestamp()
      and session.absolute_expires_at > statement_timestamp()
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_SESSION_EXPIRED';
  end if;

  update public.admin_step_up_grants
  set consumed_at = statement_timestamp(), consume_request_id = p_request_id
  where id = v_grant.id
    and consumed_at is null
    and user_id = p_user_id
    and command_family = p_command_family
    and admin_session_id = p_admin_session_id;

  if not found then
    raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
  end if;

  return v_grant.id;
end;
$$;

revoke all on function app_private.consume_admin_step_up_token(
  uuid, text, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function app_private.consume_admin_step_up_token(
  uuid, text, text, uuid, uuid
) to service_role;

comment on function app_private.consume_admin_step_up_token(
  uuid, text, text, uuid, uuid
) is
  'Consumes one admin step-up grant only when user, family, and current admin session all match.';

create function public.consume_admin_step_up(
  p_user_id uuid,
  p_token text,
  p_command_family text,
  p_request_id uuid,
  p_admin_session_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  return app_private.consume_admin_step_up_token(
    p_user_id,
    p_token,
    p_command_family,
    p_request_id,
    p_admin_session_id
  );
end;
$$;

revoke all on function public.consume_admin_step_up(uuid, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_admin_step_up(uuid, text, text, uuid, uuid)
  to service_role;

comment on function public.consume_admin_step_up(uuid, text, text, uuid, uuid) is
  'Service-role wrapper. Consumes a step-up grant only for the current admin session.';

drop function public.consume_admin_step_up(uuid, text, text, uuid);
drop function app_private.consume_admin_step_up_token(uuid, text, text, uuid);
