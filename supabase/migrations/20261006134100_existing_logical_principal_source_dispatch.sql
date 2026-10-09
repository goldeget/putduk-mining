begin;

-- Exact existing signatures. Historical v2 body retained except explicit v3
-- pending refusal and consistent member-before-logical hold serialization.

create or replace function public.prepare_withdrawal_logical_request(
  p_user_id uuid, p_method text, p_amount_krw bigint,
  p_policy_id uuid, p_policy_version integer, p_destination_fingerprint text,
  p_destination_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_record public.withdrawal_logical_requests%rowtype;
  v_fingerprint text := p_destination_fingerprint;
  v_policy public.withdrawal_policies%rowtype;
begin
  if p_user_id is null or p_method not in ('KRW_BANK', 'USDT_ADDRESS')
    or p_amount_krw is null or p_amount_krw <= 0 then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_LOGICAL_REQUEST';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:' || p_user_id::text, 0));

  if p_destination_id is not null then
    select destination.value_fingerprint into v_fingerprint
    from public.withdrawal_destinations as destination
    where destination.id = p_destination_id and destination.user_id = p_user_id
      and destination.destination_type = p_method;
  end if;
  if v_fingerprint is null or v_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_LOGICAL_DESTINATION';
  end if;

  select * into v_record from public.withdrawal_logical_requests
  where user_id = p_user_id
    and state in ('PREPARED', 'DESTINATION_REGISTERED', 'OUTCOME_UNCERTAIN') for update;
  if v_record.idempotency_key is not null then
    if v_record.schema_version <> 2 then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_LOGICAL_PENDING';
    end if;
    if v_record.method is distinct from p_method
      or v_record.amount_krw is distinct from p_amount_krw
      or v_record.policy_id is distinct from p_policy_id
      or v_record.policy_version is distinct from p_policy_version
      or v_record.destination_fingerprint is distinct from v_fingerprint then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_LOGICAL_PENDING';
    end if;
    -- Preserve the exact original key, including after TTL, policy or destination
    -- changes. Only resolution may retire an expired uncommitted record.
    return app_private.withdrawal_logical_record(v_record);
  end if;

  select * into v_policy from public.withdrawal_policies
  where currency = 'KRW' and destination_type = p_method and is_enabled
    and effective_at <= statement_timestamp()
    and (expires_at is null or expires_at > statement_timestamp())
  order by version desc limit 1;
  if v_policy.id is null or v_policy.id is distinct from p_policy_id
    or v_policy.version is distinct from p_policy_version then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_LOGICAL_POLICY_CHANGED';
  end if;
  perform app_private.touch_command_rate_limit('PREPARE_WITHDRAWAL_LOGICAL_REQUEST', p_user_id::text, 60, 3600, 3600);

  insert into public.withdrawal_logical_requests(
    user_id, method, amount_krw, policy_id, policy_version,
    destination_fingerprint, destination_id, state
  ) values (
    p_user_id, p_method, p_amount_krw, p_policy_id, p_policy_version,
    v_fingerprint, p_destination_id,
    case when p_destination_id is null then 'PREPARED' else 'DESTINATION_REGISTERED' end
  ) returning * into v_record;
  return app_private.withdrawal_logical_record(v_record);
end;
$$;

create or replace function public.hold_withdrawal_logical_request(
  p_user_id uuid, p_idempotency_key text, p_method text,
  p_destination_id uuid, p_amount_krw bigint
)
returns uuid language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_record public.withdrawal_logical_requests%rowtype;
  v_request uuid;
  v_policy uuid;
begin
  -- All native/member confirmation paths take member before logical serialization.
  perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:' || p_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:' || p_user_id::text, 0));
  select * into v_record from public.withdrawal_logical_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key for update;
  if v_record.idempotency_key is null or v_record.method is distinct from p_method
    or v_record.destination_id is distinct from p_destination_id
    or v_record.amount_krw is distinct from p_amount_krw then
    raise exception using errcode = '42501', message = 'WITHDRAWAL_LOGICAL_MISMATCH';
  end if;
  if v_record.schema_version = 3 then
    v_request := app_private.request_member_confirmed_principal_hold(p_idempotency_key);
    if v_record.withdrawal_id is null then
      update public.withdrawal_logical_requests set withdrawal_id = v_request,
        state = 'OUTCOME_UNCERTAIN', updated_at = (
          select r.hold_posted_at from public.withdrawal_requests r where r.id = v_request)
      where idempotency_key = v_record.idempotency_key;
    end if;
    return v_request;
  end if;
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);
  select id into v_request from public.withdrawal_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if v_request is not null then
    return v_request;
  end if;
  if v_record.state <> 'DESTINATION_REGISTERED' or v_record.expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_LOGICAL_RECONCILIATION_REQUIRED';
  end if;
  select id into v_policy from public.withdrawal_policies
  where currency = 'KRW' and destination_type = p_method and is_enabled
    and effective_at <= statement_timestamp()
    and (expires_at is null or expires_at > statement_timestamp())
  order by version desc limit 1;
  if v_policy is distinct from v_record.policy_id then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_LOGICAL_POLICY_CHANGED';
  end if;

  if p_method = 'KRW_BANK' then
    v_request := public.request_krw_withdrawal(p_user_id, p_destination_id, p_amount_krw, p_idempotency_key);
  else
    v_request := public.request_usdt_withdrawal(p_user_id, p_destination_id, p_amount_krw, p_idempotency_key);
  end if;
  update public.withdrawal_logical_requests set
    withdrawal_id = v_request, state = 'OUTCOME_UNCERTAIN', updated_at = statement_timestamp()
  where idempotency_key = p_idempotency_key;
  return v_request;
end;
$$;

commit;
