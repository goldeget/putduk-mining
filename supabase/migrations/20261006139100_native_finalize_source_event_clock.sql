begin;

--139 OUTSIDE source candidate: immutable native FINALIZE originals only.
create or replace function app_private.record_reserved_withdrawal_source_disposition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_mining bigint;
  v_principal_micro bigint;
  v_journal public.ledger_transactions%rowtype;
  v_wallet uuid;
  v_wallet_count integer;
  v_event uuid;
  v_kind text;
  v_bucket text;
  v_origin text;
  v_event_type text;
  v_existing_amount bigint;
begin
  if new.user_id is null or new.hold_ledger_transaction_id is null then
    return new;
  end if;
  if not (
    (old.finalize_ledger_transaction_id is null and new.finalize_ledger_transaction_id is not null)
    or (old.release_ledger_transaction_id is null and new.release_ledger_transaction_id is not null)
  ) then
    return new;
  end if;
  if old.finalize_ledger_transaction_id is null
    and new.finalize_ledger_transaction_id is not null
    and old.release_ledger_transaction_id is null
    and new.release_ledger_transaction_id is not null
  then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_DISPOSITION_CONFLICT';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('putduk-funding-recovery:' || new.user_id::text, 0));

  select coalesce(sum(reservation.amount_atomic), 0)::bigint
    into v_mining
  from public.mining_reward_withdrawal_reservations as reservation
  where reservation.hold_ledger_transaction_id = new.hold_ledger_transaction_id
    and reservation.user_id = new.user_id;
  select coalesce(sum(allocation.allocation_micro_krw), 0)::bigint
    into v_principal_micro
  from public.funding_principal_recovery_allocations as allocation
  where allocation.hold_ledger_transaction_id = new.hold_ledger_transaction_id
    and allocation.user_id = new.user_id;

  if coalesce(v_mining, 0) = 0 and coalesce(v_principal_micro, 0) = 0 then
    return new;
  end if;
  if coalesce(v_mining, 0) > 0 and coalesce(v_principal_micro, 0) > 0 then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  if new.fee_atomic is distinct from 0
    or new.welcome_reward_conversion_id is not null
    or new.currency is distinct from 'KRW'
    or new.amount_atomic is null
    or new.amount_atomic <= 0
  then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  if v_mining > 0 and v_mining is distinct from new.amount_atomic then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  if v_principal_micro > 0
    and v_principal_micro is distinct from app_private.funding_principal_micro_krw(new.amount_atomic)
  then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;

  if old.finalize_ledger_transaction_id is null
    and new.finalize_ledger_transaction_id is not null
  then
    if new.status is distinct from 'COMPLETED' then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FINALIZABLE';
    end if;
    if not exists (
      select 1
      from public.withdrawal_external_sends as send
      where send.withdrawal_id = new.id
    ) then
      raise exception using errcode = '55000', message = 'EXTERNAL_SEND_REQUIRED';
    end if;
    if app_private.mining_reward_hold_released(new.hold_ledger_transaction_id)
      or exists (
        select 1
        from public.funding_principal_recovery_releases as recovery_release
        where recovery_release.hold_ledger_transaction_id = new.hold_ledger_transaction_id
          and recovery_release.user_id = new.user_id
      )
      or exists (
        select 1
        from public.money_source_movements as movement
        where movement.user_id = new.user_id
          and movement.ledger_transaction_id = new.release_ledger_transaction_id
          and movement.movement_kind = 'RELEASE'
      )
    then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_DISPOSITION_CONFLICT';
    end if;

    select transaction.*
      into v_journal
    from public.ledger_transactions as transaction
    where transaction.id = new.finalize_ledger_transaction_id;
    if v_journal.id is null
      or v_journal.member_user_id is distinct from new.user_id
      or v_journal.currency::text is distinct from 'KRW'
      or v_journal.category::text is distinct from 'WITHDRAWAL'
      or v_journal.metadata->>'phase' is distinct from 'FINALIZE'
      or v_journal.reference_id is distinct from new.id
      or v_journal.request_id is null
      or v_journal.correlation_id is null
      or not isfinite(v_journal.posted_at)
    then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
    end if;

    select count(*)::integer
      into v_wallet_count
    from public.wallet_ledger as ledger
    where ledger.user_id = new.user_id
      and ledger.reference_type = 'withdrawal_request'
      and ledger.reference_id = new.id
      and ledger.direction = 'DEBIT'
      and ledger.entry_type::text = 'WITHDRAWAL'
      and ledger.amount_atomic = new.amount_atomic;
    select ledger.id
      into v_wallet
    from public.wallet_ledger as ledger
    where ledger.user_id = new.user_id
      and ledger.reference_type = 'withdrawal_request'
      and ledger.reference_id = new.id
      and ledger.direction = 'DEBIT'
      and ledger.entry_type::text = 'WITHDRAWAL'
      and ledger.amount_atomic = new.amount_atomic
    limit 1;
    if v_wallet_count is distinct from 1 or v_wallet is null then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
    end if;

    if v_mining > 0 then
      v_bucket := 'MINING_REWARD';
      v_origin := 'MINING_REWARD_WITHDRAWAL_FINALIZE';
      v_event_type := 'MINING_REWARD_WITHDRAWAL_FINALIZED.v1';
    else
      v_bucket := 'OTHER_NON_PRINCIPAL';
      v_origin := 'PRINCIPAL_RECOVERY_FINALIZE';
      v_event_type := 'PRINCIPAL_RECOVERY_FINALIZED.v1';
      if not exists (
        select 1
        from public.money_source_movements as reserve_move
        where reserve_move.ledger_transaction_id = new.hold_ledger_transaction_id
          and reserve_move.user_id = new.user_id
          and reserve_move.source_bucket = 'OTHER_NON_PRINCIPAL'
          and reserve_move.movement_kind = 'RESERVE'
          and reserve_move.origin_code = 'PRINCIPAL_RECOVERY_HOLD'
          and reserve_move.amount_atomic = new.amount_atomic
      ) then
        raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
      end if;
    end if;
    v_kind := 'FINALIZE';
  else
    if new.status not in ('CANCELLED', 'REJECTED') then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_RELEASABLE';
    end if;
    if exists (
      select 1
      from public.withdrawal_external_sends as send
      where send.withdrawal_id = new.id
    ) then
      raise exception using errcode = '55000',
        message = 'WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND';
    end if;
    if new.finalize_ledger_transaction_id is not null then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_DISPOSITION_CONFLICT';
    end if;
    if v_principal_micro > 0 then
      perform app_private.record_principal_recovery_release(
        new.user_id, new.release_ledger_transaction_id);
      return new;
    end if;

    select transaction.*
      into v_journal
    from public.ledger_transactions as transaction
    where transaction.id = new.release_ledger_transaction_id;
    if v_journal.id is null
      or v_journal.member_user_id is distinct from new.user_id
      or v_journal.currency::text is distinct from 'KRW'
      or v_journal.category::text is distinct from 'REVERSAL'
      or v_journal.metadata->>'phase' is distinct from 'RELEASE'
      or v_journal.reference_id is distinct from new.id
      or v_journal.reversal_of_transaction_id is distinct from new.hold_ledger_transaction_id
      or v_journal.request_id is null
      or v_journal.correlation_id is null
      or not isfinite(v_journal.posted_at)
    then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
    end if;
    v_wallet := null;
    v_bucket := 'MINING_REWARD';
    v_kind := 'RELEASE';
    v_origin := 'MINING_REWARD_WITHDRAWAL_RELEASE';
    v_event_type := 'MINING_REWARD_WITHDRAWAL_RELEASED.v1';
  end if;

  select movement.amount_atomic
    into v_existing_amount
  from public.money_source_movements as movement
  where movement.ledger_transaction_id = v_journal.id
    and movement.user_id = new.user_id
    and movement.source_bucket = v_bucket
    and movement.movement_kind = v_kind
    and movement.origin_code = v_origin;
  if v_existing_amount is not null then
    if v_existing_amount is distinct from new.amount_atomic then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_DISPOSITION_CONFLICT';
    end if;
    return new;
  end if;

  if v_origin='PRINCIPAL_RECOVERY_FINALIZE' and v_journal.metadata->>'portion_clock_contract'='HOLD_CANCEL_FINALIZE_V1' then
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key, available_at, last_error_code, occurred_at, created_at
  ) values (
    v_event_type,
    1,
    'ledger_transaction',
    v_journal.id,
    new.user_id,
    jsonb_build_object(
      'user_id', new.user_id,
      'hold_ledger_transaction_id', new.hold_ledger_transaction_id,
      'amount_atomic', new.amount_atomic::text,
      'movement_kind', v_kind
    ),
    v_journal.correlation_id,
    v_journal.request_id,
    v_journal.id::text || ':' || lower(v_kind) || ':withdrawal-source',
    'infinity'::timestamptz,
    'WITHDRAWAL_SOURCE_DISPOSITION_CONSUMER_NOT_ENABLED', v_journal.posted_at, v_journal.posted_at
  )
  on conflict (idempotency_key) do nothing
  returning id into v_event;
  else
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key, available_at, last_error_code
  ) values (
    v_event_type,
    1,
    'ledger_transaction',
    v_journal.id,
    new.user_id,
    jsonb_build_object(
      'user_id', new.user_id,
      'hold_ledger_transaction_id', new.hold_ledger_transaction_id,
      'amount_atomic', new.amount_atomic::text,
      'movement_kind', v_kind
    ),
    v_journal.correlation_id,
    v_journal.request_id,
    v_journal.id::text || ':' || lower(v_kind) || ':withdrawal-source',
    'infinity'::timestamptz,
    'WITHDRAWAL_SOURCE_DISPOSITION_CONSUMER_NOT_ENABLED'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_event;
  end if;

  if v_event is null then
    select event.id
      into v_event
    from public.outbox_events as event
    where event.idempotency_key =
      v_journal.id::text || ':' || lower(v_kind) || ':withdrawal-source';
  end if;
  if v_event is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;

  insert into public.money_source_movements (
    user_id, source_bucket, movement_kind, origin_code, amount_atomic,
    ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at
  ) values (
    new.user_id, v_bucket, v_kind, v_origin, new.amount_atomic,
    v_journal.id, v_wallet, v_event, v_journal.posted_at
  );
  return new;
end;
$$;


commit;
