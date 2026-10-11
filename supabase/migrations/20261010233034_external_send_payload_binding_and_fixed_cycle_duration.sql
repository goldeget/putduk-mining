begin;
-- Preserve historical migrations, existing invoker permissions and financial posting.
-- Replay binds normalized transfer facts, including the actual sent timestamp.
-- A currently authorized admin may confirm another admin's identical recorded facts;
-- the original operator/audit/event are retained and no second transfer is recorded.
-- RPC callers must resubmit the original sent_at on lost-response recovery.

create table app_private.withdrawal_external_send_keys (
  idempotency_key text primary key,
  send_id uuid not null references public.withdrawal_external_sends(id),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint withdrawal_external_send_key_length
    check (char_length(btrim(idempotency_key)) between 8 and 200)
);
create index withdrawal_external_send_keys_send_idx
  on app_private.withdrawal_external_send_keys(send_id);
alter table app_private.withdrawal_external_send_keys enable row level security;
alter table app_private.withdrawal_external_send_keys force row level security;
revoke all on app_private.withdrawal_external_send_keys from public, anon, authenticated, service_role;
grant select, insert on app_private.withdrawal_external_send_keys to service_role;
create policy withdrawal_external_send_keys_service on app_private.withdrawal_external_send_keys
  for all to service_role using (true) with check (true);
create trigger withdrawal_external_send_keys_immutable
  before update or delete on app_private.withdrawal_external_send_keys
  for each row execute function app_private.prevent_row_mutation();
-- Existing canonical keys retain their immutable original send binding on upgrade.
insert into app_private.withdrawal_external_send_keys(idempotency_key, send_id)
select idempotency_key, id from public.withdrawal_external_sends;

create or replace function public.record_krw_external_send(
  p_withdrawal_id uuid,
  p_bank_reference text,
  p_actual_krw_amount bigint,
  p_actor uuid,
  p_sent_at timestamptz,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_request public.withdrawal_requests%rowtype;
  v_existing public.withdrawal_external_sends%rowtype;
  v_send_id uuid;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_withdrawal_id is null
    or char_length(btrim(coalesce(p_bank_reference, ''))) < 4
    or p_actual_krw_amount is null
    or p_actual_krw_amount <= 0
    or p_actor is null
    or p_sent_at is null
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_KRW_EXTERNAL_SEND';
  end if;

  if not exists (
    select 1 from public.user_roles as role
    where role.user_id = p_actor
      and role.role in ('SUPER_ADMIN', 'ADMIN')
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  -- Serialize the same command key across both payout methods. A waiter
  -- reads the first committed receipt before considering another withdrawal.
  perform pg_advisory_xact_lock(hashtextextended(
    'putduk-withdrawal-external-send:' || p_idempotency_key, 0));

  select send.* into v_existing
  from app_private.withdrawal_external_send_keys as replay_key
  join public.withdrawal_external_sends as send on send.id = replay_key.send_id
  where replay_key.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.withdrawal_id is distinct from p_withdrawal_id
      or v_existing.method is distinct from 'KRW_BANK'
      or v_existing.sent_at is distinct from p_sent_at
      or v_existing.bank_reference is distinct from btrim(p_bank_reference)
      or v_existing.actual_krw_amount is distinct from p_actual_krw_amount then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_existing.id;
  end if;

  select request.* into v_request
  from public.withdrawal_requests as request
  where request.id = p_withdrawal_id
  for update;

  if v_request.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FOUND';
  end if;

  if v_request.destination_type <> 'KRW_BANK' then
    raise exception using errcode = '22023', message = 'WITHDRAWAL_METHOD_MISMATCH';
  end if;

  select send.* into v_existing
  from public.withdrawal_external_sends as send
  where send.withdrawal_id = p_withdrawal_id;
  if v_existing.id is not null then
    if v_existing.withdrawal_id is distinct from p_withdrawal_id
      or v_existing.method is distinct from 'KRW_BANK'
      or v_existing.sent_at is distinct from p_sent_at
      or v_existing.bank_reference is distinct from btrim(p_bank_reference)
      or v_existing.actual_krw_amount is distinct from p_actual_krw_amount then
      raise exception using errcode = '22023', message = 'EXTERNAL_SEND_PAYLOAD_MISMATCH';
    end if;
    -- Bind every successful retry key to the same immutable send receipt.
    insert into app_private.withdrawal_external_send_keys(idempotency_key, send_id)
    values (p_idempotency_key, v_existing.id);
    return v_existing.id;
  end if;

  if v_request.status not in ('HELD', 'ADMIN_PROCESSING', 'REQUESTED') then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_SENDABLE';
  end if;

  if v_request.status = 'HELD' or v_request.status = 'REQUESTED' then
    update public.withdrawal_requests
    set status = 'ADMIN_PROCESSING', processing_started_at = statement_timestamp()
    where id = p_withdrawal_id;
  end if;

  insert into public.withdrawal_external_sends (
    withdrawal_id, method, bank_reference, actual_krw_amount,
    operator_user_id, sent_at, idempotency_key
  ) values (
    p_withdrawal_id, 'KRW_BANK', btrim(p_bank_reference), p_actual_krw_amount,
    p_actor, p_sent_at, p_idempotency_key
  ) returning id into v_send_id;

  insert into app_private.withdrawal_external_send_keys(idempotency_key, send_id)
  values (p_idempotency_key, v_send_id);

  update public.withdrawal_requests
  set status = 'EXTERNAL_SENT_RECORDED'
  where id = p_withdrawal_id;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_EXTERNAL_SENT.v1',
    1,
    'withdrawal_request',
    p_withdrawal_id,
    p_actor,
    jsonb_build_object(
      'method', 'KRW_BANK',
      'bank_reference', btrim(p_bank_reference),
      'actual_krw_amount', p_actual_krw_amount::text
    ),
    gen_random_uuid(),
    gen_random_uuid(),
    p_idempotency_key || ':event'
  );

  perform app_private.record_money_command_link(
    'record_krw_external_send',
    v_send_id,
    p_actor,
    'record_krw_external_send',
    'withdrawal_external_send',
    v_send_id,
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'destination_id', v_request.withdrawal_destination_id,
      'currency', 'KRW',
      'amount_atomic', p_actual_krw_amount::text,
      'withdrawal_amount_atomic', v_request.amount_atomic::text,
      'withdrawal_fee_atomic', v_request.fee_atomic::text,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_send_id;
end;
$$;

create or replace function public.record_usdt_external_send(
  p_withdrawal_id uuid,
  p_network text,
  p_tx_hash text,
  p_actual_usdt_amount numeric,
  p_conversion_evidence jsonb,
  p_actor uuid,
  p_sent_at timestamptz,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_request public.withdrawal_requests%rowtype;
  v_network text := upper(btrim(coalesce(p_network, '')));
  v_tx text := lower(btrim(coalesce(p_tx_hash, '')));
  v_existing public.withdrawal_external_sends%rowtype;
  v_send_id uuid;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_withdrawal_id is null
    or v_network not in ('TRC20', 'ERC20', 'BEP20')
    or char_length(v_tx) not between 8 and 128
    or p_actual_usdt_amount is null
    or p_actual_usdt_amount::text in ('NaN', 'Infinity', '-Infinity')
    or p_actual_usdt_amount <= 0
    or scale(p_actual_usdt_amount) > 6
    or (p_conversion_evidence is not null and jsonb_typeof(p_conversion_evidence) <> 'object')
    or p_actor is null
    or p_sent_at is null
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_USDT_EXTERNAL_SEND';
  end if;

  if not exists (
    select 1 from public.user_roles as role
    where role.user_id = p_actor
      and role.role in ('SUPER_ADMIN', 'ADMIN')
      and role.revoked_at is null
  ) then
    raise exception using errcode = '42501', message = 'ADMIN_ROLE_REQUIRED';
  end if;

  -- Serialize the same command key across both payout methods. A waiter
  -- reads the first committed receipt before considering another withdrawal.
  perform pg_advisory_xact_lock(hashtextextended(
    'putduk-withdrawal-external-send:' || p_idempotency_key, 0));

  select send.* into v_existing
  from app_private.withdrawal_external_send_keys as replay_key
  join public.withdrawal_external_sends as send on send.id = replay_key.send_id
  where replay_key.idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.withdrawal_id is distinct from p_withdrawal_id
      or v_existing.method is distinct from 'USDT_ADDRESS'
      or v_existing.sent_at is distinct from p_sent_at
      or v_existing.network is distinct from v_network
      or v_existing.tx_hash is distinct from v_tx
      or v_existing.actual_usdt_amount is distinct from p_actual_usdt_amount
      or v_existing.conversion_evidence is distinct from p_conversion_evidence then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
    return v_existing.id;
  end if;

  select request.* into v_request
  from public.withdrawal_requests as request
  where request.id = p_withdrawal_id
  for update;

  if v_request.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FOUND';
  end if;

  if v_request.destination_type <> 'USDT_ADDRESS' then
    raise exception using errcode = '22023', message = 'WITHDRAWAL_METHOD_MISMATCH';
  end if;

  select send.* into v_existing
  from public.withdrawal_external_sends as send
  where send.withdrawal_id = p_withdrawal_id;
  if v_existing.id is not null then
    if v_existing.withdrawal_id is distinct from p_withdrawal_id
      or v_existing.method is distinct from 'USDT_ADDRESS'
      or v_existing.sent_at is distinct from p_sent_at
      or v_existing.network is distinct from v_network
      or v_existing.tx_hash is distinct from v_tx
      or v_existing.actual_usdt_amount is distinct from p_actual_usdt_amount
      or v_existing.conversion_evidence is distinct from p_conversion_evidence then
      raise exception using errcode = '22023', message = 'EXTERNAL_SEND_PAYLOAD_MISMATCH';
    end if;
    -- Bind every successful retry key to the same immutable send receipt.
    insert into app_private.withdrawal_external_send_keys(idempotency_key, send_id)
    values (p_idempotency_key, v_existing.id);
    return v_existing.id;
  end if;

  if v_request.status not in ('HELD', 'ADMIN_PROCESSING', 'REQUESTED') then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_SENDABLE';
  end if;

  if v_request.status in ('HELD', 'REQUESTED') then
    update public.withdrawal_requests
    set status = 'ADMIN_PROCESSING', processing_started_at = statement_timestamp()
    where id = p_withdrawal_id;
  end if;

  insert into public.withdrawal_external_sends (
    withdrawal_id, method, network, tx_hash, actual_usdt_amount,
    conversion_evidence, operator_user_id, sent_at, idempotency_key
  ) values (
    p_withdrawal_id, 'USDT_ADDRESS', v_network, v_tx, p_actual_usdt_amount,
    p_conversion_evidence, p_actor, p_sent_at, p_idempotency_key
  ) returning id into v_send_id;

  insert into app_private.withdrawal_external_send_keys(idempotency_key, send_id)
  values (p_idempotency_key, v_send_id);

  update public.withdrawal_requests
  set status = 'EXTERNAL_SENT_RECORDED'
  where id = p_withdrawal_id;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_EXTERNAL_SENT.v1',
    1,
    'withdrawal_request',
    p_withdrawal_id,
    p_actor,
    jsonb_build_object(
      'method', 'USDT_ADDRESS',
      'network', v_network,
      'tx_hash', v_tx,
      'actual_usdt_amount', p_actual_usdt_amount::text,
      'conversion_evidence_present', p_conversion_evidence is not null
    ),
    gen_random_uuid(),
    gen_random_uuid(),
    p_idempotency_key || ':event'
  );

  perform app_private.record_money_command_link(
    'record_usdt_external_send',
    v_send_id,
    p_actor,
    'record_usdt_external_send',
    'withdrawal_external_send',
    v_send_id,
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'destination_id', v_request.withdrawal_destination_id,
      'withdrawal_currency', 'KRW',
      'withdrawal_amount_atomic', v_request.amount_atomic::text,
      'withdrawal_fee_atomic', v_request.fee_atomic::text,
      'external_currency', 'USDT',
      'external_amount', p_actual_usdt_amount::text,
      'idempotency_key', p_idempotency_key
    )
  );

  return v_send_id;
end;
$$;

create or replace function app_private.open_next_funding_cycle(p_earned uuid) returns uuid
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare e app_private.funding_earned_receipts%rowtype;old app_private.funding_engine_state_receipts%rowtype;
 previous_cycle app_private.funding_cycle_windows%rowtype;next_cycle app_private.funding_cycle_windows%rowtype;
 condition app_private.funding_condition_originals%rowtype;r app_private.funding_cycle_rollovers%rowtype;
 base numeric[];retention numeric[];
begin
 if current_user<>'service_role' or auth.role() is distinct from 'service_role' then
  raise exception using errcode='42501',message='FUNDING_ENGINE_SERVICE_ROLE_REQUIRED';end if;
 select * into e from app_private.funding_earned_receipts where id=p_earned;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||e.user_id::text,0));
 select * into r from app_private.funding_cycle_rollovers where earned_receipt_id=e.id;
 if r.id is not null then
  perform app_private.assert_funding_engine_seal(r.id,'FUNDING_CYCLE_ROLLED',r.user_id,r.input_digest,r.audit_id,r.source_event_id,
   app_private.funding_cycle_rollover_snapshot(r));return r.next_state_id;end if;
 select * into old from app_private.funding_engine_state_receipts where id=e.next_state_id;
 select * into previous_cycle from app_private.funding_cycle_windows where id=old.cycle_id;
 select * into condition from app_private.funding_condition_originals where id=old.condition_id;
 if e.id is null or not old.cycle_closed or old.id is distinct from(select id from app_private.funding_engine_state where user_id=e.user_id)
  or e.settled_to is distinct from previous_cycle.cycle_end or e.settled_to>clock_timestamp()
  or not(e.calculation ? 'retentionComponentOriginal') then
  raise exception using errcode='55000',message='FUNDING_ROLLOVER_TERMINAL_REQUIRED';end if;
 perform app_private.verify_neutral_funding_job_earned(e);
 select * into next_cycle from app_private.funding_cycle_windows where user_id=e.user_id and cycle_ordinal=previous_cycle.cycle_ordinal+1;
 if next_cycle.id is null then
  insert into app_private.funding_cycle_windows(user_id,cycle_ordinal,cycle_days,cycle_started_at,cycle_end)
  values(e.user_id,previous_cycle.cycle_ordinal+1,30,previous_cycle.cycle_end,previous_cycle.cycle_end+30 * interval '24 hours') returning * into next_cycle;
 end if;
 if next_cycle.cycle_started_at is distinct from previous_cycle.cycle_end or next_cycle.cycle_days<>30 then
  raise exception using errcode='55000',message='FUNDING_CYCLE_BOUNDARY_MISMATCH';end if;
 base:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'base_bps')::numeric,10000);
 retention:=app_private.funding_exact_ratio((condition.inputs->>'principal_atomic')::numeric*(condition.inputs->>'retention_bps')::numeric,10000);
 r.id:=gen_random_uuid();r.user_id:=e.user_id;r.activation_id:=e.activation_id;r.earned_receipt_id:=e.id;
 r.closed_state_id:=old.id;r.next_state_id:=gen_random_uuid();r.previous_cycle_id:=old.cycle_id;r.next_cycle_id:=next_cycle.id;
 r.condition_id:=old.condition_id;r.base_capacity_num:=base[1];r.base_capacity_den:=base[2];
 r.retention_capacity_num:=retention[1];r.retention_capacity_den:=retention[2];r.carry_num:=old.carry_num;r.carry_den:=old.carry_den;
 r.audit_id:=gen_random_uuid();r.source_event_id:=gen_random_uuid();r.recorded_at:=clock_timestamp();
 r.input_digest:=app_private.funding_engine_digest(app_private.funding_cycle_rollover_snapshot(r));
 insert into app_private.funding_cycle_rollovers select r.*;
 insert into app_private.funding_engine_state_receipts(id,user_id,activation_id,cycle_id,revision,previous_state_id,
 cursor_at,base_used_num,base_used_den,retention_used_num,retention_used_den,carry_num,carry_den,cycle_closed,condition_id,rollover_id)
 values(r.next_state_id,e.user_id,e.activation_id,next_cycle.id,old.revision+1,old.id,next_cycle.cycle_started_at,
  0,1,0,1,old.carry_num,old.carry_den,false,old.condition_id,r.id);
 perform app_private.write_funding_engine_seal(r.id,'FUNDING_CYCLE_ROLLED',r.user_id,r.input_digest,r.audit_id,r.source_event_id,
  app_private.funding_cycle_rollover_snapshot(r));
 return r.next_state_id;
end;
$$;

commit;
