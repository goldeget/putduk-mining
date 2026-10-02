begin;

-- Lifecycle only: no destination material, cipher envelope or independent money.
create table public.withdrawal_logical_requests (
  idempotency_key text primary key default gen_random_uuid()::text,
  schema_version integer not null default 2 check (schema_version = 2),
  user_id uuid not null references auth.users(id) on delete restrict,
  method text not null check (method in ('KRW_BANK', 'USDT_ADDRESS')),
  amount_krw bigint not null check (amount_krw > 0),
  policy_id uuid not null references public.withdrawal_policies(id),
  policy_version integer not null check (policy_version > 0),
  destination_fingerprint text not null check (destination_fingerprint ~ '^[a-f0-9]{64}$'),
  destination_id uuid references public.withdrawal_destinations(id),
  withdrawal_id uuid unique references public.withdrawal_requests(id),
  state text not null default 'PREPARED' check (state in (
    'PREPARED', 'DESTINATION_REGISTERED', 'OUTCOME_UNCERTAIN',
    'CONFIRMED', 'DEFINITIVELY_REJECTED', 'CANCELLED'
  )),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp() + interval '24 hours',
  check (expires_at > created_at),
  check (state not in ('OUTCOME_UNCERTAIN', 'CONFIRMED') or withdrawal_id is not null)
);

create unique index withdrawal_logical_requests_one_pending_owner
  on public.withdrawal_logical_requests(user_id)
  where state in ('PREPARED', 'DESTINATION_REGISTERED', 'OUTCOME_UNCERTAIN');
alter table public.withdrawal_logical_requests enable row level security;
alter table public.withdrawal_logical_requests force row level security;
revoke all on public.withdrawal_logical_requests from public, anon, authenticated;
grant select, insert, update on public.withdrawal_logical_requests to service_role;

create function app_private.withdrawal_logical_record(
  p_record public.withdrawal_logical_requests
)
returns jsonb language sql stable security invoker set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'v', p_record.schema_version, 'ownerId', p_record.user_id,
    'key', p_record.idempotency_key, 'method', p_record.method,
    'amountKrw', p_record.amount_krw::text, 'policyId', p_record.policy_id,
    'policyVersion', p_record.policy_version,
    'destinationIdentity', p_record.destination_fingerprint,
    'destinationId', p_record.destination_id, 'withdrawalId', p_record.withdrawal_id,
    'state', p_record.state, 'createdAt', p_record.created_at,
    'updatedAt', p_record.updated_at, 'expiresAt', p_record.expires_at
  );
$$;

-- One unresolved owner intent: missing browser state and racing tabs cannot mint
-- independent money keys. Conflicting input must be explicitly reconciled first.
create function public.prepare_withdrawal_logical_request(
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

-- Registration and safe mapping commit together; replay never repeats registration,
-- replacement, history, rate-limit consumption or the protection start timestamp.
create function public.bind_withdrawal_logical_destination(
  p_user_id uuid, p_idempotency_key text, p_method text,
  p_value_fingerprint text, p_encrypted_value bytea, p_display_hint text,
  p_step_up_token text, p_request_id uuid,
  p_network text default null, p_address text default null
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_record public.withdrawal_logical_requests%rowtype;
  v_destination uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:' || p_user_id::text, 0));
  select * into v_record from public.withdrawal_logical_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key for update;
  if v_record.idempotency_key is null or v_record.method is distinct from p_method
    or v_record.destination_fingerprint is distinct from p_value_fingerprint then
    raise exception using errcode = '42501', message = 'WITHDRAWAL_LOGICAL_MISMATCH';
  end if;
  if v_record.destination_id is not null then
    return app_private.withdrawal_logical_record(v_record);
  end if;
  if v_record.state <> 'PREPARED' or v_record.expires_at <= statement_timestamp() then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_LOGICAL_RECONCILIATION_REQUIRED';
  end if;
  if p_method = 'KRW_BANK' then
    v_destination := public.register_krw_bank_destination(
      p_user_id, p_encrypted_value, p_value_fingerprint, p_display_hint,
      p_step_up_token, p_request_id, 24
    );
  else
    v_destination := public.register_usdt_withdrawal_destination(
      p_user_id, p_network, p_address, p_encrypted_value, p_value_fingerprint,
      p_display_hint, p_step_up_token, p_request_id, 24
    );
  end if;
  update public.withdrawal_logical_requests set
    destination_id = v_destination, state = 'DESTINATION_REGISTERED', updated_at = statement_timestamp()
  where idempotency_key = p_idempotency_key returning * into v_record;
  return app_private.withdrawal_logical_record(v_record);
end;
$$;

-- The frozen WS-04 commands still own all money. Hold + durable outcome are atomic.
create function public.hold_withdrawal_logical_request(
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
  perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:' || p_user_id::text, 0));
  select * into v_record from public.withdrawal_logical_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key for update;
  if v_record.idempotency_key is null or v_record.method is distinct from p_method
    or v_record.destination_id is distinct from p_destination_id
    or v_record.amount_krw is distinct from p_amount_krw then
    raise exception using errcode = '42501', message = 'WITHDRAWAL_LOGICAL_MISMATCH';
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

-- RECOVER returns the single pending record. Terminal transitions serialize
-- against hold, so a racing committed request cannot be discarded as rejection.
create function public.resolve_withdrawal_logical_request(
  p_user_id uuid, p_action text default 'RECOVER',
  p_idempotency_key text default null, p_withdrawal_id uuid default null
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_record public.withdrawal_logical_requests%rowtype;
  v_request uuid;
begin
  if p_user_id is null or p_action not in ('RECOVER', 'CONFIRM', 'CANCEL', 'REJECT') then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_LOGICAL_RESOLUTION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:' || p_user_id::text, 0));
  select * into v_record from public.withdrawal_logical_requests
  where user_id = p_user_id and (
    (p_idempotency_key is not null and idempotency_key = p_idempotency_key)
    or (p_idempotency_key is null and state in ('PREPARED', 'DESTINATION_REGISTERED', 'OUTCOME_UNCERTAIN'))
  ) for update;
  if v_record.idempotency_key is null then
    if p_action <> 'RECOVER' then
      raise exception using errcode = '42501', message = 'WITHDRAWAL_LOGICAL_NOT_FOUND';
    end if;
    return null;
  end if;
  select id into v_request from public.withdrawal_requests
  where user_id = p_user_id and idempotency_key = v_record.idempotency_key;

  if p_action = 'CONFIRM' then
    if v_request is null or v_request is distinct from p_withdrawal_id then
      raise exception using errcode = '42501', message = 'WITHDRAWAL_LOGICAL_CONFIRMATION_REQUIRED';
    end if;
    update public.withdrawal_logical_requests set
      state = 'CONFIRMED', withdrawal_id = v_request, updated_at = statement_timestamp()
    where idempotency_key = v_record.idempotency_key returning * into v_record;
  elsif p_action in ('CANCEL', 'REJECT') then
    if v_request is not null then
      -- Return the committed result for recovery, NEVER a false cancellation.
      if v_record.state <> 'CONFIRMED' then
        update public.withdrawal_logical_requests set
          state = 'OUTCOME_UNCERTAIN', withdrawal_id = v_request, updated_at = statement_timestamp()
        where idempotency_key = v_record.idempotency_key returning * into v_record;
      end if;
    elsif v_record.state in ('PREPARED', 'DESTINATION_REGISTERED') then
      update public.withdrawal_logical_requests set
        state = case p_action when 'CANCEL' then 'CANCELLED' else 'DEFINITIVELY_REJECTED' end,
        updated_at = statement_timestamp()
      where idempotency_key = v_record.idempotency_key returning * into v_record;
    end if;
  elsif v_request is not null and v_record.state <> 'CONFIRMED' then
    update public.withdrawal_logical_requests set
      state = 'OUTCOME_UNCERTAIN', withdrawal_id = v_request, updated_at = statement_timestamp()
    where idempotency_key = v_record.idempotency_key returning * into v_record;
  end if;
  return app_private.withdrawal_logical_record(v_record);
end;
$$;

revoke all on function app_private.withdrawal_logical_record(public.withdrawal_logical_requests) from public, anon, authenticated;
revoke all on function public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid) from public, anon, authenticated;
revoke all on function public.bind_withdrawal_logical_destination(uuid,text,text,text,bytea,text,text,uuid,text,text) from public, anon, authenticated;
revoke all on function public.hold_withdrawal_logical_request(uuid,text,text,uuid,bigint) from public, anon, authenticated;
revoke all on function public.resolve_withdrawal_logical_request(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function app_private.withdrawal_logical_record(public.withdrawal_logical_requests) to service_role;
grant execute on function public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid) to service_role;
grant execute on function public.bind_withdrawal_logical_destination(uuid,text,text,text,bytea,text,text,uuid,text,text) to service_role;
grant execute on function public.hold_withdrawal_logical_request(uuid,text,text,uuid,bigint) to service_role;
grant execute on function public.resolve_withdrawal_logical_request(uuid,text,text,uuid) to service_role;

comment on table public.withdrawal_logical_requests is
  'Service-only owner-scoped logical recovery. No raw destination material. Not ledger truth.';

commit;
