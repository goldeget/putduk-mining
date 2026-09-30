begin;

-- 대사 예외 확인과 성공 감사는 한 트랜잭션이다.
-- 감사 삽입이 실패하면 상태 변경도 함께 롤백된다.
-- SECURITY INVOKER: 기존 서버 명령과 같이 service_role 권한만 사용한다.
-- 브라우저 역할에는 execute 를 주지 않는다. 원장·지갑·투영은 건드리지 않는다.

create function public.acknowledge_reconciliation_mismatch(
  p_mismatch_id uuid,
  p_actor uuid,
  p_result text,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_row public.reconciliation_mismatches%rowtype;
  v_role public.app_role;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_result text := upper(btrim(coalesce(p_result, '')));
  v_terminal boolean;
begin
  if p_mismatch_id is null
    or p_actor is null
    or p_request_id is null
    or v_result not in ('INVESTIGATING', 'RESOLVED', 'ACCEPTED')
    or char_length(v_reason) < 10
    or char_length(v_reason) > 500
  then
    raise exception using errcode = '22023', message = 'INVALID_RECONCILIATION_ACK';
  end if;

  -- 서버가 넘긴 역할 문자열은 믿지 않고, 활성 고위험 역할만 감사에 남긴다.
  select role.role into v_role
  from public.user_roles as role
  where role.user_id = p_actor
    and role.role in ('SUPER_ADMIN', 'ADMIN')
    and role.revoked_at is null
  order by case role.role when 'SUPER_ADMIN' then 0 else 1 end
  limit 1;

  if v_role is null then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  select mismatch.* into v_row
  from public.reconciliation_mismatches as mismatch
  where mismatch.id = p_mismatch_id
  for update;

  if v_row.id is null then
    raise exception using errcode = '55000', message = 'MISMATCH_NOT_FOUND';
  end if;

  -- 같은 요청의 재시도는 이미 커밋된 처분을 덮어쓰지 않는다.
  if exists (
    select 1
    from public.audit_logs as audit
    where audit.request_id = p_request_id
      and audit.action = 'RECONCILIATION_EXCEPTION_ACK'
      and audit.target_type = 'RECONCILIATION_MISMATCH'
      and audit.target_id = p_mismatch_id::text
  ) then
    return jsonb_build_object(
      'ok', true,
      'code', 'ACKNOWLEDGED_REPLAY',
      'status', v_row.status,
      'mismatch_id', v_row.id,
      'request_id', p_request_id
    );
  end if;

  -- 잠금을 얻은 뒤에만 전이를 판단한다.
  -- 종료 상태(RESOLVED, ACCEPTED)는 항상 STALE_OR_CLOSED 이며 행을 바꾸지 않는다.
  -- 조사 중(INVESTIGATING)은 먼저 잠근 요청이 사유를 유지한다.
  -- 이미 조사 중일 때 다시 조사 중을 요청하면 ALREADY_INVESTIGATING 으로 거절한다.
  -- 조사 중에서 종료 전이(RESOLVED, ACCEPTED)만 허용한다.
  -- 두 종료 확인은 행 잠금으로 직렬화된다. 먼저 커밋한 쪽만 성공하고
  -- 나중 요청은 종료 상태를 보고 STALE_OR_CLOSED 로 실패한다.
  if v_row.status in ('RESOLVED', 'ACCEPTED')
    or v_row.status not in ('OPEN', 'INVESTIGATING')
  then
    raise exception using errcode = '55000', message = 'STALE_OR_CLOSED';
  end if;

  if v_row.status = 'INVESTIGATING' and v_result = 'INVESTIGATING' then
    raise exception using errcode = '55000', message = 'ALREADY_INVESTIGATING';
  end if;

  if v_row.status = 'INVESTIGATING' and v_result not in ('RESOLVED', 'ACCEPTED') then
    raise exception using errcode = '22023', message = 'INVALID_RECONCILIATION_ACK';
  end if;

  v_terminal := v_result in ('RESOLVED', 'ACCEPTED');

  update public.reconciliation_mismatches
  set
    status = v_result,
    resolution_reason = v_reason,
    resolved_by = case when v_terminal then p_actor else null end,
    resolved_at = case when v_terminal then statement_timestamp() else null end
  where id = p_mismatch_id;

  -- 감사 삽입 실패는 함수 밖으로 나간다. 호출 트랜잭션이 상태 변경까지 롤백한다.
  begin
    insert into public.audit_logs (
      actor_user_id,
      actor_role,
      action,
      target_type,
      target_id,
      reason,
      request_id,
      before_state,
      after_state,
      metadata
    ) values (
      p_actor,
      v_role,
      'RECONCILIATION_EXCEPTION_ACK',
      'RECONCILIATION_MISMATCH',
      p_mismatch_id::text,
      v_reason,
      p_request_id,
      jsonb_build_object('status', v_row.status),
      jsonb_build_object('status', v_result),
      jsonb_build_object(
        'result', v_result,
        'auto_repair', false,
        'expected_value', v_row.expected_value,
        'actual_value', v_row.actual_value
      )
    );
  exception
    when others then
      raise exception using errcode = 'P0001', message = 'AUDIT_WRITE_FAILED';
  end;

  return jsonb_build_object(
    'ok', true,
    'code', 'ACKNOWLEDGED',
    'status', v_result,
    'mismatch_id', p_mismatch_id,
    'request_id', p_request_id
  );
end;
$$;

comment on function public.acknowledge_reconciliation_mismatch(
  uuid, uuid, text, text, uuid
) is
  '대사 예외 확인과 성공 감사를 한 트랜잭션에서 처리한다. 행 잠금 후 OPEN 에서만 조사 중을 시작하고, 이미 조사 중이면 종료 전이만 허용한다. 종료 상태는 덮어쓰지 않는다. 감사 삽입 실패 시 상태 변경은 롤백된다. 원장과 지갑은 수정하지 않는다.';

revoke all on function public.acknowledge_reconciliation_mismatch(
  uuid, uuid, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.acknowledge_reconciliation_mismatch(
  uuid, uuid, text, text, uuid
) to service_role;

commit;
