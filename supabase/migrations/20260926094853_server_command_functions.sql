begin;

grant usage on schema app_private to service_role;
grant select, insert, update on table app_private.idempotency_keys to service_role;

create function app_private.require_operator_role(
  p_user_id uuid,
  p_allowed_roles public.app_role[]
)
returns public.app_role
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_role public.app_role;
begin
  select role_record.role
  into v_role
  from public.user_roles as role_record
  where role_record.user_id = p_user_id
    and role_record.revoked_at is null
    and role_record.role = any (p_allowed_roles)
  order by role_record.granted_at desc
  limit 1;

  if v_role is null then
    raise exception using
      errcode = '42501',
      message = 'OPERATOR_ROLE_REQUIRED';
  end if;

  return v_role;
end;
$$;

revoke all on function app_private.require_operator_role(uuid, public.app_role[])
  from public, anon, authenticated;
grant execute on function app_private.require_operator_role(uuid, public.app_role[])
  to service_role;

create function public.bootstrap_user(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'AUTH_USER_NOT_FOUND';
  end if;

  insert into public.user_profiles (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.user_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.notification_preferences (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.wallet_accounts (user_id, currency)
  values
    (p_user_id, 'KRW'::public.currency_code),
    (p_user_id, 'USDT'::public.currency_code)
  on conflict (user_id, currency) do nothing;
end;
$$;

revoke all on function public.bootstrap_user(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_user(uuid) to service_role;

create function public.start_trial(
  p_user_id uuid,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_account public.trial_accounts%rowtype;
  v_program public.trial_programs%rowtype;
  v_session_id uuid;
  v_now timestamptz := statement_timestamp();
begin
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then
    raise exception using
      errcode = '22023',
      message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  perform public.bootstrap_user(p_user_id);

  select account.*
  into v_account
  from public.trial_accounts as account
  where account.user_id = p_user_id
  for update;

  if v_account.id is null then
    select program.*
    into v_program
    from public.trial_programs as program
    where program.is_enabled
      and program.effective_at <= v_now
      and (program.retired_at is null or program.retired_at > v_now)
    order by program.effective_at desc, program.version desc
    limit 1;

    if v_program.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'TRIAL_PROGRAM_UNAVAILABLE';
    end if;

    insert into public.trial_accounts (
      user_id,
      trial_program_id,
      trial_program_version,
      world_id,
      target_reward_krw
    ) values (
      p_user_id,
      v_program.id,
      v_program.version,
      v_program.first_world_id,
      v_program.target_reward_krw
    )
    returning * into v_account;
  else
    select program.*
    into v_program
    from public.trial_programs as program
    where program.id = v_account.trial_program_id;
  end if;

  if v_account.status = 'ACTIVE' then
    select session.id
    into v_session_id
    from public.trial_sessions as session
    where session.trial_account_id = v_account.id
      and session.ended_at is null
    order by session.started_at desc
    limit 1;

    if v_session_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'ACTIVE_TRIAL_SESSION_MISSING';
    end if;

    return v_session_id;
  end if;

  if v_account.status <> 'READY' then
    raise exception using
      errcode = '55000',
      message = 'TRIAL_ALREADY_FINISHED';
  end if;

  update public.trial_accounts
  set
    status = 'ACTIVE',
    started_at = v_now,
    expires_at = v_now + make_interval(secs => v_program.duration_seconds),
    last_settled_at = v_now
  where id = v_account.id;

  insert into public.trial_sessions (
    trial_account_id,
    user_id,
    started_at,
    last_settled_at,
    idempotency_key
  ) values (
    v_account.id,
    p_user_id,
    v_now,
    v_now,
    p_idempotency_key
  )
  returning id into v_session_id;

  return v_session_id;
end;
$$;

revoke all on function public.start_trial(uuid, text) from public, anon, authenticated;
grant execute on function public.start_trial(uuid, text) to service_role;

create function public.create_deposit_request(
  p_user_id uuid,
  p_currency public.currency_code,
  p_amount_atomic bigint,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_request_id uuid;
begin
  if p_amount_atomic <= 0 then
    raise exception using errcode = '22023', message = 'AMOUNT_MUST_BE_POSITIVE';
  end if;
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select request.id
  into v_request_id
  from public.deposit_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = p_idempotency_key;

  if v_request_id is not null then
    return v_request_id;
  end if;

  perform public.bootstrap_user(p_user_id);

  insert into public.deposit_requests (
    user_id,
    currency,
    amount_atomic,
    status,
    idempotency_key
  ) values (
    p_user_id,
    p_currency,
    p_amount_atomic,
    case
      when p_currency = 'KRW'::public.currency_code
        then 'AWAITING_TRANSFER'::public.deposit_status
      else 'REQUESTED'::public.deposit_status
    end,
    p_idempotency_key
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.create_deposit_request(uuid, public.currency_code, bigint, text)
  from public, anon, authenticated;
grant execute on function public.create_deposit_request(uuid, public.currency_code, bigint, text)
  to service_role;

create function public.create_withdrawal_request(
  p_user_id uuid,
  p_wallet_account_id uuid,
  p_amount_atomic bigint,
  p_fee_atomic bigint,
  p_destination_type text,
  p_destination_snapshot jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_balance bigint;
  v_currency public.currency_code;
  v_held bigint;
  v_request_id uuid;
begin
  if p_amount_atomic <= 0 or p_fee_atomic < 0 then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_AMOUNT';
  end if;
  if char_length(btrim(coalesce(p_destination_type, ''))) not between 1 and 80
    or jsonb_typeof(p_destination_snapshot) <> 'object'
  then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_DESTINATION';
  end if;
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select request.id
  into v_request_id
  from public.withdrawal_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = p_idempotency_key;

  if v_request_id is not null then
    return v_request_id;
  end if;

  select account.currency
  into v_currency
  from public.wallet_accounts as account
  where account.id = p_wallet_account_id
    and account.user_id = p_user_id
    and account.closed_at is null
  for update;

  if v_currency is null then
    raise exception using errcode = '22023', message = 'WALLET_ACCOUNT_NOT_FOUND';
  end if;

  select coalesce(sum(
    case
      when ledger.direction = 'CREDIT' then ledger.amount_atomic
      else -ledger.amount_atomic
    end
  ), 0)::bigint
  into v_balance
  from public.wallet_ledger as ledger
  where ledger.wallet_account_id = p_wallet_account_id;

  select coalesce(sum(request.amount_atomic + request.fee_atomic), 0)::bigint
  into v_held
  from public.withdrawal_requests as request
  where request.wallet_account_id = p_wallet_account_id
    and request.status in ('REQUESTED', 'REVIEWING', 'APPROVED', 'PROCESSING');

  if v_balance - v_held < p_amount_atomic + p_fee_atomic then
    raise exception using errcode = '22003', message = 'INSUFFICIENT_AVAILABLE_BALANCE';
  end if;

  insert into public.withdrawal_requests (
    wallet_account_id,
    user_id,
    currency,
    amount_atomic,
    fee_atomic,
    destination_type,
    destination_snapshot,
    idempotency_key
  ) values (
    p_wallet_account_id,
    p_user_id,
    v_currency,
    p_amount_atomic,
    p_fee_atomic,
    p_destination_type,
    p_destination_snapshot,
    p_idempotency_key
  )
  returning id into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function public.create_withdrawal_request(
  uuid,
  uuid,
  bigint,
  bigint,
  text,
  jsonb,
  text
) from public, anon, authenticated;
grant execute on function public.create_withdrawal_request(
  uuid,
  uuid,
  bigint,
  bigint,
  text,
  jsonb,
  text
) to service_role;

create function public.approve_deposit_request(
  p_deposit_request_id uuid,
  p_operator_id uuid,
  p_received_amount_atomic bigint,
  p_ledger_idempotency_key text,
  p_reason text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_after public.deposit_requests%rowtype;
  v_before public.deposit_requests%rowtype;
  v_ledger_id uuid;
  v_operator_role public.app_role;
  v_wallet_id uuid;
begin
  if p_received_amount_atomic <= 0 then
    raise exception using errcode = '22023', message = 'AMOUNT_MUST_BE_POSITIVE';
  end if;
  if char_length(btrim(coalesce(p_ledger_idempotency_key, ''))) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception using errcode = '22023', message = 'AUDIT_REASON_REQUIRED';
  end if;

  v_operator_role := app_private.require_operator_role(
    p_operator_id,
    array['SUPER_ADMIN', 'ADMIN']::public.app_role[]
  );

  select request.*
  into v_before
  from public.deposit_requests as request
  where request.id = p_deposit_request_id
  for update;

  if v_before.id is null then
    raise exception using errcode = '22023', message = 'DEPOSIT_REQUEST_NOT_FOUND';
  end if;

  if v_before.status = 'APPROVED' then
    select ledger.id
    into v_ledger_id
    from public.wallet_ledger as ledger
    where ledger.reference_type = 'deposit_request'
      and ledger.reference_id = v_before.id
    order by ledger.created_at
    limit 1;
    return v_ledger_id;
  end if;

  if v_before.status not in ('REQUESTED', 'AWAITING_TRANSFER', 'REVIEWING') then
    raise exception using errcode = '55000', message = 'DEPOSIT_REQUEST_NOT_APPROVABLE';
  end if;

  insert into public.wallet_accounts (user_id, currency)
  values (v_before.user_id, v_before.currency)
  on conflict (user_id, currency) do nothing;

  select account.id
  into v_wallet_id
  from public.wallet_accounts as account
  where account.user_id = v_before.user_id
    and account.currency = v_before.currency
    and account.closed_at is null
  for update;

  insert into public.wallet_ledger (
    wallet_account_id,
    user_id,
    direction,
    entry_type,
    amount_atomic,
    idempotency_key,
    reference_type,
    reference_id,
    reason,
    created_by
  ) values (
    v_wallet_id,
    v_before.user_id,
    'CREDIT',
    'DEPOSIT',
    p_received_amount_atomic,
    p_ledger_idempotency_key,
    'deposit_request',
    v_before.id,
    p_reason,
    p_operator_id
  )
  returning id into v_ledger_id;

  update public.deposit_requests
  set
    status = 'APPROVED',
    reviewed_by = p_operator_id,
    reviewed_at = statement_timestamp(),
    rejection_reason = null
  where id = v_before.id
  returning * into v_after;

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
    p_operator_id,
    v_operator_role,
    'deposit.approve',
    'deposit_request',
    v_before.id::text,
    p_reason,
    p_request_id,
    to_jsonb(v_before),
    to_jsonb(v_after),
    jsonb_build_object('wallet_ledger_id', v_ledger_id)
  );

  return v_ledger_id;
end;
$$;

revoke all on function public.approve_deposit_request(
  uuid,
  uuid,
  bigint,
  text,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.approve_deposit_request(
  uuid,
  uuid,
  bigint,
  text,
  text,
  uuid
) to service_role;

create function public.record_mining_settlement(
  p_user_id uuid,
  p_mining_session_id uuid,
  p_settled_from timestamptz,
  p_settled_to timestamptz,
  p_amount_atomic bigint,
  p_currency public.currency_code,
  p_segments jsonb,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_cursor timestamptz;
  v_existing_id uuid;
  v_farm_world_id uuid;
  v_ledger_key text;
  v_segment jsonb;
  v_segment_amount bigint;
  v_segment_end timestamptz;
  v_segment_start timestamptz;
  v_sequence integer := 0;
  v_settlement_id uuid;
  v_sum bigint := 0;
  v_wallet_id uuid;
begin
  if p_settled_to <= p_settled_from or p_settled_to > statement_timestamp() then
    raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_INTERVAL';
  end if;
  if p_amount_atomic < 0 then
    raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_AMOUNT';
  end if;
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 180 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if jsonb_typeof(p_segments) <> 'array' or jsonb_array_length(p_segments) = 0 then
    raise exception using errcode = '22023', message = 'SETTLEMENT_SEGMENTS_REQUIRED';
  end if;

  select settlement.id
  into v_existing_id
  from public.mining_settlements as settlement
  where settlement.mining_session_id = p_mining_session_id
    and settlement.idempotency_key = p_idempotency_key;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select farm.world_id
  into v_farm_world_id
  from public.mining_sessions as session
  join public.mining_farms as farm on farm.id = session.mining_farm_id
  where session.id = p_mining_session_id
    and session.user_id = p_user_id
    and session.ended_at is null
    and session.last_settled_at = p_settled_from
  for update of session;

  if v_farm_world_id is null then
    raise exception using errcode = '55000', message = 'SETTLEMENT_ANCHOR_MISMATCH';
  end if;

  v_cursor := p_settled_from;

  for v_segment in
    select value
    from jsonb_array_elements(p_segments)
  loop
    begin
      v_segment_start := (v_segment ->> 'settled_from')::timestamptz;
      v_segment_end := (v_segment ->> 'settled_to')::timestamptz;
      v_segment_amount := (v_segment ->> 'amount_atomic')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_SEGMENT';
    end;

    if v_segment_start <> v_cursor
      or v_segment_end <= v_segment_start
      or v_segment_end > p_settled_to
      or v_segment_amount < 0
      or (v_segment ->> 'equipment_efficiency_bps')::integer not between 0 and 100000
      or (v_segment ->> 'world_multiplier_bps')::integer not between 0 and 100000
      or (v_segment ->> 'event_multiplier_bps')::integer not between 0 and 100000
      or (v_segment ->> 'status_multiplier_bps')::integer not between 0 and 100000
    then
      raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_SEGMENT';
    end if;

    if not exists (
      select 1
      from public.world_rule_versions as version
      join public.world_rules as rule on rule.id = version.world_rule_id
      where version.id = (v_segment ->> 'rule_version_id')::uuid
        and rule.world_id = v_farm_world_id
        and version.effective_at <= v_segment_start
    ) then
      raise exception using errcode = '22023', message = 'INVALID_SETTLEMENT_RULE_VERSION';
    end if;

    v_sum := v_sum + v_segment_amount;
    v_cursor := v_segment_end;
    v_sequence := v_sequence + 1;
  end loop;

  if v_cursor <> p_settled_to or v_sum <> p_amount_atomic then
    raise exception using errcode = '22023', message = 'SETTLEMENT_TOTAL_MISMATCH';
  end if;

  insert into public.mining_settlements (
    mining_session_id,
    user_id,
    settled_from,
    settled_to,
    amount_atomic,
    currency,
    segment_count,
    idempotency_key
  ) values (
    p_mining_session_id,
    p_user_id,
    p_settled_from,
    p_settled_to,
    p_amount_atomic,
    p_currency,
    v_sequence,
    p_idempotency_key
  )
  returning id into v_settlement_id;

  v_sequence := 0;
  for v_segment in
    select value
    from jsonb_array_elements(p_segments)
  loop
    insert into public.mining_settlement_segments (
      mining_settlement_id,
      user_id,
      sequence,
      settled_from,
      settled_to,
      amount_atomic,
      rule_version_id,
      equipment_efficiency_bps,
      world_multiplier_bps,
      event_multiplier_bps,
      status_multiplier_bps
    ) values (
      v_settlement_id,
      p_user_id,
      v_sequence,
      (v_segment ->> 'settled_from')::timestamptz,
      (v_segment ->> 'settled_to')::timestamptz,
      (v_segment ->> 'amount_atomic')::bigint,
      (v_segment ->> 'rule_version_id')::uuid,
      (v_segment ->> 'equipment_efficiency_bps')::integer,
      (v_segment ->> 'world_multiplier_bps')::integer,
      (v_segment ->> 'event_multiplier_bps')::integer,
      (v_segment ->> 'status_multiplier_bps')::integer
    );
    v_sequence := v_sequence + 1;
  end loop;

  update public.mining_sessions
  set last_settled_at = p_settled_to
  where id = p_mining_session_id
    and last_settled_at = p_settled_from;

  if not found then
    raise exception using errcode = '40001', message = 'SETTLEMENT_CONCURRENT_UPDATE';
  end if;

  if p_amount_atomic > 0 then
    insert into public.wallet_accounts (user_id, currency)
    values (p_user_id, p_currency)
    on conflict (user_id, currency) do nothing;

    select account.id
    into v_wallet_id
    from public.wallet_accounts as account
    where account.user_id = p_user_id
      and account.currency = p_currency
      and account.closed_at is null
    for update;

    v_ledger_key := p_idempotency_key || ':ledger';

    insert into public.wallet_ledger (
      wallet_account_id,
      user_id,
      direction,
      entry_type,
      amount_atomic,
      idempotency_key,
      reference_type,
      reference_id
    ) values (
      v_wallet_id,
      p_user_id,
      'CREDIT',
      'MINING_REWARD',
      p_amount_atomic,
      v_ledger_key,
      'mining_settlement',
      v_settlement_id
    );
  end if;

  return v_settlement_id;
end;
$$;

revoke all on function public.record_mining_settlement(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  bigint,
  public.currency_code,
  jsonb,
  text
) from public, anon, authenticated;
grant execute on function public.record_mining_settlement(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  bigint,
  public.currency_code,
  jsonb,
  text
) to service_role;

comment on function public.bootstrap_user(uuid) is
  'Service-only idempotent creation of non-economic user foundation rows.';
comment on function public.start_trial(uuid, text) is
  'Service-only server-time transition from READY to ACTIVE. Requires an operator-published trial program.';
comment on function public.record_mining_settlement(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  bigint,
  public.currency_code,
  jsonb,
  text
) is
  'Service-only atomic settlement header, effective-time segments, anchor update, and ledger credit.';

commit;
