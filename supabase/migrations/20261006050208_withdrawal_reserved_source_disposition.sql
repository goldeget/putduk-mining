begin;

-- 이미 예약된 출금이 확정되거나, 외부 송금 전에 취소되면 출처 행을 한 번만 남긴다.
-- 원장 차감은 기존 finalize_withdrawal_ledger / release_withdrawal_hold 가 끝낸 것만 쓴다.
-- 예약 순서는 effective_at DESC, recorded_at DESC, id DESC 그대로다.
-- 원금 전액과 채굴 수익 전액은 한 출금에 섞지 않는다. 수수료가 0이 아닌 hold는 열지 않는다.
-- BONUS는 일반 출금 출처가 아니다. record_mining_settlement 는 호출하지 않는다.
-- 읽기 함수는 원장을 쓰지 않는다. 같은 hold에 FINALIZE와 RELEASE를 같이 남기지 않는다.

create function app_private.mining_reward_hold_released(
  p_hold_ledger_transaction_id uuid
) returns boolean
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select p_hold_ledger_transaction_id is not null
    and exists (
      select 1
      from public.withdrawal_requests as request
      join public.money_source_movements as movement
        on movement.ledger_transaction_id = request.release_ledger_transaction_id
       and movement.user_id = request.user_id
       and movement.source_bucket = 'MINING_REWARD'
       and movement.movement_kind = 'RELEASE'
       and movement.origin_code = 'MINING_REWARD_WITHDRAWAL_RELEASE'
      where request.hold_ledger_transaction_id = p_hold_ledger_transaction_id
        and request.release_ledger_transaction_id is not null
    )
    and not exists (
      select 1
      from public.withdrawal_requests as request
      join public.money_source_movements as movement
        on movement.ledger_transaction_id = request.finalize_ledger_transaction_id
       and movement.user_id = request.user_id
       and movement.movement_kind = 'FINALIZE'
      where request.hold_ledger_transaction_id = p_hold_ledger_transaction_id
        and request.finalize_ledger_transaction_id is not null
    );
$$;

create or replace function app_private.verified_mining_reward_remaining_atomic(
  p_user_id uuid
) returns bigint
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_credit bigint;
  v_reserved bigint;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_REQUEST';
  end if;
  select coalesce(sum(movement.amount_atomic), 0)::bigint
    into v_credit
  from public.money_source_movements as movement
  where movement.user_id = p_user_id
    and movement.source_bucket = 'MINING_REWARD'
    and movement.movement_kind = 'CREDIT'
    and app_private.money_source_credit_verified(movement);
  select coalesce(sum(reservation.amount_atomic), 0)::bigint
    into v_reserved
  from public.mining_reward_withdrawal_reservations as reservation
  join public.money_source_movements as movement
    on movement.id = reservation.credit_movement_id
  where reservation.user_id = p_user_id
    and movement.user_id = p_user_id
    and movement.source_bucket = 'MINING_REWARD'
    and movement.movement_kind = 'CREDIT'
    and app_private.money_source_credit_verified(movement)
    and not app_private.mining_reward_hold_released(
      reservation.hold_ledger_transaction_id);
  if v_credit is null or v_reserved is null or v_credit < 0 or v_reserved < 0
    or v_reserved > v_credit then
    raise exception using errcode = '22003', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  return v_credit - v_reserved;
end;
$$;

create or replace function app_private.guard_mining_reward_withdrawal_reservation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_move public.money_source_movements%rowtype;
  v_used bigint;
begin
  select movement.*
    into v_move
  from public.money_source_movements as movement
  where movement.id = new.credit_movement_id;
  select coalesce(sum(reservation.amount_atomic), 0)::bigint
    into v_used
  from public.mining_reward_withdrawal_reservations as reservation
  where reservation.credit_movement_id = new.credit_movement_id
    and not app_private.mining_reward_hold_released(
      reservation.hold_ledger_transaction_id);
  if v_move.id is null
    or v_move.user_id is distinct from new.user_id
    or v_move.source_bucket is distinct from 'MINING_REWARD'
    or v_move.movement_kind is distinct from 'CREDIT'
    or not app_private.money_source_credit_verified(v_move)
    or v_used is null
    or v_used < 0
    or new.amount_atomic > v_move.amount_atomic - v_used
    or not exists (
      select 1
      from public.withdrawal_requests as request
      join public.ledger_transactions as transaction
        on transaction.id = request.hold_ledger_transaction_id
      where request.user_id = new.user_id
        and request.hold_ledger_transaction_id = new.hold_ledger_transaction_id
        and request.status = 'HELD'
        and request.currency = 'KRW'
        and request.fee_atomic = 0
        and request.welcome_reward_conversion_id is null
        and transaction.category = 'WITHDRAWAL'
        and transaction.member_user_id = new.user_id
        and transaction.metadata->>'phase' = 'HOLD'
    )
  then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  return new;
end;
$$;

-- 배분 순서는 그대로다. 송금 전 취소로 풀린 hold만 남은 수량에서 뺀다.
create or replace function app_private.reserve_verified_mining_reward_newest_first(
  p_user_id uuid,
  p_hold_ledger_transaction_id uuid
) returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_amount bigint;
  v_fee bigint;
  v_posted timestamptz;
  v_existing integer;
  v_left bigint;
  v_take bigint;
  v_ordinal integer := 0;
  v_credit record;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'WITHDRAWAL_SOURCE_SERVICE_ROLE_REQUIRED';
  end if;
  if p_user_id is null or p_hold_ledger_transaction_id is null then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_REQUEST';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('putduk-funding-recovery:' || p_user_id::text, 0));
  select count(*)::integer
    into v_existing
  from public.mining_reward_withdrawal_reservations as reservation
  where reservation.hold_ledger_transaction_id = p_hold_ledger_transaction_id
    and reservation.user_id = p_user_id;
  if v_existing > 0 then
    return;
  end if;

  select request.amount_atomic, request.fee_atomic, transaction.posted_at
    into v_amount, v_fee, v_posted
  from public.withdrawal_requests as request
  join public.ledger_transactions as transaction
    on transaction.id = request.hold_ledger_transaction_id
  where request.user_id = p_user_id
    and request.hold_ledger_transaction_id = p_hold_ledger_transaction_id
    and request.status = 'HELD'
    and request.currency = 'KRW'
    and request.welcome_reward_conversion_id is null
    and transaction.category = 'WITHDRAWAL'
    and transaction.member_user_id = p_user_id
    and transaction.metadata->>'phase' = 'HOLD'
  for update of request;

  if v_amount is null or v_amount <= 0 or v_fee is null or v_fee <> 0
    or v_posted is null or not isfinite(v_posted) then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;

  v_left := v_amount;
  for v_credit in
    select
      movement.id,
      (
        movement.amount_atomic - coalesce((
          select sum(reservation.amount_atomic)::bigint
          from public.mining_reward_withdrawal_reservations as reservation
          where reservation.credit_movement_id = movement.id
            and not app_private.mining_reward_hold_released(
              reservation.hold_ledger_transaction_id)
        ), 0)
      )::bigint as open_atomic
    from public.money_source_movements as movement
    where movement.user_id = p_user_id
      and movement.source_bucket = 'MINING_REWARD'
      and movement.movement_kind = 'CREDIT'
      and movement.effective_at <= v_posted
      and app_private.money_source_credit_verified(movement)
    order by movement.effective_at desc, movement.recorded_at desc, movement.id desc
  loop
    if v_credit.open_atomic is null or v_credit.open_atomic < 0 then
      raise exception using errcode = '22003', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
    end if;
    if v_credit.open_atomic = 0 then
      continue;
    end if;
    v_take := least(v_credit.open_atomic, v_left);
    insert into public.mining_reward_withdrawal_reservations (
      user_id, credit_movement_id, hold_ledger_transaction_id,
      amount_atomic, ordinal, effective_at
    ) values (
      p_user_id, v_credit.id, p_hold_ledger_transaction_id,
      v_take, v_ordinal, v_posted
    );
    v_left := v_left - v_take;
    v_ordinal := v_ordinal + 1;
    exit when v_left = 0;
  end loop;
  if v_left <> 0 then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
end;
$$;

create function app_private.assert_mining_reward_withdrawal_disposition(
  p_move public.money_source_movements
) returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_journal public.ledger_transactions%rowtype;
  v_event public.outbox_events%rowtype;
  v_request public.withdrawal_requests%rowtype;
  v_reserved bigint;
begin
  if p_move.source_bucket is distinct from 'MINING_REWARD'
    or p_move.amount_atomic is null
    or p_move.amount_atomic <= 0
    or p_move.movement_kind not in ('FINALIZE', 'RELEASE')
    or (
      p_move.movement_kind = 'FINALIZE'
      and (
        p_move.origin_code is distinct from 'MINING_REWARD_WITHDRAWAL_FINALIZE'
        or p_move.wallet_ledger_id is null
      )
    )
    or (
      p_move.movement_kind = 'RELEASE'
      and (
        p_move.origin_code is distinct from 'MINING_REWARD_WITHDRAWAL_RELEASE'
        or p_move.wallet_ledger_id is not null
      )
    )
  then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;

  select transaction.*
    into v_journal
  from public.ledger_transactions as transaction
  where transaction.id = p_move.ledger_transaction_id;
  select event.*
    into v_event
  from public.outbox_events as event
  where event.id = p_move.source_event_id;
  if v_journal.id is null or v_event.id is null
    or v_journal.member_user_id is distinct from p_move.user_id
    or v_journal.currency::text is distinct from 'KRW'
    or p_move.effective_at is distinct from v_journal.posted_at
    or v_event.aggregate_id is distinct from v_journal.id
    or v_event.aggregate_type is distinct from 'ledger_transaction'
    or v_event.actor_user_id is distinct from p_move.user_id
    or v_event.schema_version is distinct from 1
  then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;

  select request.*
    into v_request
  from public.withdrawal_requests as request
  where request.user_id = p_move.user_id
    and request.currency = 'KRW'
    and request.fee_atomic = 0
    and request.welcome_reward_conversion_id is null
    and request.amount_atomic = p_move.amount_atomic
    and (
      (
        p_move.movement_kind = 'FINALIZE'
        and request.finalize_ledger_transaction_id = v_journal.id
        and request.status = 'COMPLETED'
      )
      or (
        p_move.movement_kind = 'RELEASE'
        and request.release_ledger_transaction_id = v_journal.id
        and request.status in ('CANCELLED', 'REJECTED')
      )
    );
  if v_request.id is null or v_request.hold_ledger_transaction_id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;

  if p_move.movement_kind = 'FINALIZE' then
    if v_journal.category::text is distinct from 'WITHDRAWAL'
      or v_journal.metadata->>'phase' is distinct from 'FINALIZE'
      or v_event.event_type is distinct from 'MINING_REWARD_WITHDRAWAL_FINALIZED.v1'
      or not exists (
        select 1
        from public.withdrawal_external_sends as send
        where send.withdrawal_id = v_request.id
      )
      or not exists (
        select 1
        from public.wallet_ledger as ledger
        where ledger.id = p_move.wallet_ledger_id
          and ledger.user_id = p_move.user_id
          and ledger.direction = 'DEBIT'
          and ledger.entry_type::text = 'WITHDRAWAL'
          and ledger.amount_atomic = p_move.amount_atomic
          and ledger.reference_type = 'withdrawal_request'
          and ledger.reference_id = v_request.id
      )
    then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
    end if;
  elsif v_journal.category::text is distinct from 'REVERSAL'
    or v_journal.metadata->>'phase' is distinct from 'RELEASE'
    or v_journal.reversal_of_transaction_id is distinct from v_request.hold_ledger_transaction_id
    or v_event.event_type is distinct from 'MINING_REWARD_WITHDRAWAL_RELEASED.v1'
    or exists (
      select 1
      from public.withdrawal_external_sends as send
      where send.withdrawal_id = v_request.id
    )
  then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;

  if exists (
    select 1
    from public.funding_principal_recovery_allocations as allocation
    where allocation.hold_ledger_transaction_id = v_request.hold_ledger_transaction_id
      and allocation.user_id = v_request.user_id
  ) or exists (
    select 1
    from public.money_source_movements as other
    where other.user_id = v_request.user_id
      and other.movement_kind = case
        when p_move.movement_kind = 'FINALIZE' then 'RELEASE'
        else 'FINALIZE'
      end
      and other.ledger_transaction_id = case
        when p_move.movement_kind = 'FINALIZE' then v_request.release_ledger_transaction_id
        else v_request.finalize_ledger_transaction_id
      end
  ) then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_DISPOSITION_CONFLICT';
  end if;

  select coalesce(sum(reservation.amount_atomic), 0)::bigint
    into v_reserved
  from public.mining_reward_withdrawal_reservations as reservation
  where reservation.hold_ledger_transaction_id = v_request.hold_ledger_transaction_id
    and reservation.user_id = v_request.user_id;
  if v_reserved is distinct from p_move.amount_atomic
    or exists (
      select 1
      from public.mining_reward_withdrawal_reservations as reservation
      join public.money_source_movements as credit
        on credit.id = reservation.credit_movement_id
      where reservation.hold_ledger_transaction_id = v_request.hold_ledger_transaction_id
        and reservation.user_id = v_request.user_id
        and (
          credit.user_id is distinct from v_request.user_id
          or credit.source_bucket is distinct from 'MINING_REWARD'
          or credit.movement_kind is distinct from 'CREDIT'
          or not app_private.money_source_credit_verified(credit)
        )
    )
  then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
end;
$$;

create or replace function app_private.assert_principal_recovery_movement(
  p_move public.money_source_movements
) returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_journal public.ledger_transactions%rowtype;
  v_event public.outbox_events%rowtype;
  v_allocated bigint;
begin
  if p_move.source_bucket is distinct from 'OTHER_NON_PRINCIPAL'
    or p_move.amount_atomic is null
    or p_move.amount_atomic <= 0
    or p_move.movement_kind not in ('RESERVE', 'RELEASE', 'FINALIZE')
    or (
      p_move.movement_kind in ('RESERVE', 'RELEASE')
      and p_move.wallet_ledger_id is not null
    )
    or (
      p_move.movement_kind = 'FINALIZE'
      and p_move.wallet_ledger_id is null
    )
  then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_MOVEMENT_REJECTED';
  end if;
  select transaction.* into v_journal
  from public.ledger_transactions as transaction
  where transaction.id = p_move.ledger_transaction_id;
  select event.* into v_event
  from public.outbox_events as event
  where event.id = p_move.source_event_id;
  if v_journal.id is null or v_event.id is null
    or v_journal.member_user_id is distinct from p_move.user_id
    or v_journal.currency::text is distinct from 'KRW'
    or p_move.effective_at is distinct from v_journal.posted_at
    or v_event.aggregate_id is distinct from v_journal.id
    or v_event.actor_user_id is distinct from p_move.user_id
  then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_MOVEMENT_REJECTED';
  end if;
  if p_move.movement_kind = 'RESERVE' then
    select coalesce(sum(allocation.allocation_micro_krw), 0)::bigint
      into v_allocated
    from public.funding_principal_recovery_allocations as allocation
    where allocation.hold_ledger_transaction_id = v_journal.id
      and allocation.user_id = p_move.user_id;
    if p_move.origin_code is distinct from 'PRINCIPAL_RECOVERY_HOLD'
      or v_journal.category::text is distinct from 'WITHDRAWAL'
      or v_journal.metadata->>'phase' is distinct from 'HOLD'
      or v_event.event_type is distinct from 'PRINCIPAL_RECOVERY_HELD.v1'
      or v_allocated is distinct from p_move.amount_atomic * 1000000
    then
      raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_MOVEMENT_REJECTED';
    end if;
  elsif p_move.movement_kind = 'RELEASE' then
    if p_move.origin_code is distinct from 'PRINCIPAL_RECOVERY_RELEASE'
      or v_journal.category::text is distinct from 'REVERSAL'
      or v_journal.metadata->>'phase' is distinct from 'RELEASE'
      or v_event.event_type is distinct from 'PRINCIPAL_RECOVERY_RELEASED.v1'
      or not exists (
        select 1
        from public.funding_principal_recovery_releases as recovery_release
        where recovery_release.release_ledger_transaction_id = v_journal.id
          and recovery_release.user_id = p_move.user_id
          and recovery_release.effective_at = v_journal.posted_at
      )
    then
      raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_MOVEMENT_REJECTED';
    end if;
  elsif p_move.movement_kind = 'FINALIZE' then
    if p_move.origin_code is distinct from 'PRINCIPAL_RECOVERY_FINALIZE'
      or v_journal.category::text is distinct from 'WITHDRAWAL'
      or v_journal.metadata->>'phase' is distinct from 'FINALIZE'
      or v_event.event_type is distinct from 'PRINCIPAL_RECOVERY_FINALIZED.v1'
      or not exists (
        select 1
        from public.withdrawal_requests as request
        where request.user_id = p_move.user_id
          and request.finalize_ledger_transaction_id = v_journal.id
          and request.hold_ledger_transaction_id is not null
          and request.status = 'COMPLETED'
          and request.currency = 'KRW'
          and request.fee_atomic = 0
          and request.welcome_reward_conversion_id is null
          and request.amount_atomic = p_move.amount_atomic
          and exists (
            select 1
            from public.withdrawal_external_sends as send
            where send.withdrawal_id = request.id
          )
          and exists (
            select 1
            from public.money_source_movements as reserve_move
            where reserve_move.ledger_transaction_id = request.hold_ledger_transaction_id
              and reserve_move.user_id = request.user_id
              and reserve_move.source_bucket = 'OTHER_NON_PRINCIPAL'
              and reserve_move.movement_kind = 'RESERVE'
              and reserve_move.origin_code = 'PRINCIPAL_RECOVERY_HOLD'
              and reserve_move.amount_atomic = p_move.amount_atomic
          )
          and (
            select coalesce(sum(allocation.allocation_micro_krw), 0)::bigint
            from public.funding_principal_recovery_allocations as allocation
            where allocation.hold_ledger_transaction_id = request.hold_ledger_transaction_id
              and allocation.user_id = request.user_id
          ) = app_private.funding_principal_micro_krw(p_move.amount_atomic)
          and not exists (
            select 1
            from public.funding_principal_recovery_releases as recovery_release
            where recovery_release.hold_ledger_transaction_id = request.hold_ledger_transaction_id
              and recovery_release.user_id = request.user_id
          )
          and not exists (
            select 1
            from public.money_source_movements as release_move
            where release_move.user_id = request.user_id
              and release_move.ledger_transaction_id = request.release_ledger_transaction_id
              and release_move.movement_kind = 'RELEASE'
          )
      )
      or not exists (
        select 1
        from public.wallet_ledger as ledger
        join public.withdrawal_requests as request
          on request.id = ledger.reference_id
        where ledger.id = p_move.wallet_ledger_id
          and ledger.user_id = p_move.user_id
          and ledger.direction = 'DEBIT'
          and ledger.entry_type::text = 'WITHDRAWAL'
          and ledger.amount_atomic = p_move.amount_atomic
          and ledger.reference_type = 'withdrawal_request'
          and request.user_id = p_move.user_id
          and request.finalize_ledger_transaction_id = v_journal.id
      )
    then
      raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_MOVEMENT_REJECTED';
    end if;
  else
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_MOVEMENT_REJECTED';
  end if;
end;
$$;

create or replace function app_private.guard_money_source_movement()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.movement_kind = 'CREDIT' then
    perform app_private.assert_money_source_credit(new);
  elsif (new.movement_kind = 'RESERVE' and new.origin_code = 'PRINCIPAL_RECOVERY_HOLD')
    or (new.movement_kind = 'RELEASE' and new.origin_code = 'PRINCIPAL_RECOVERY_RELEASE')
    or (new.movement_kind = 'FINALIZE' and new.origin_code = 'PRINCIPAL_RECOVERY_FINALIZE')
  then
    perform app_private.assert_principal_recovery_movement(new);
  elsif new.source_bucket = 'MINING_REWARD'
    and (
      (new.movement_kind = 'FINALIZE' and new.origin_code = 'MINING_REWARD_WITHDRAWAL_FINALIZE')
      or (new.movement_kind = 'RELEASE' and new.origin_code = 'MINING_REWARD_WITHDRAWAL_RELEASE')
    )
  then
    perform app_private.assert_mining_reward_withdrawal_disposition(new);
  else
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_COMMAND_NOT_CONNECTED';
  end if;
  return new;
end;
$$;

create or replace function app_private.money_source_credit_verified(
  p_move public.money_source_movements
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if p_move.movement_kind = 'CREDIT' then
    perform app_private.assert_money_source_credit_complete(p_move);
  elsif (p_move.movement_kind = 'RESERVE' and p_move.origin_code = 'PRINCIPAL_RECOVERY_HOLD')
    or (p_move.movement_kind = 'RELEASE' and p_move.origin_code = 'PRINCIPAL_RECOVERY_RELEASE')
    or (p_move.movement_kind = 'FINALIZE' and p_move.origin_code = 'PRINCIPAL_RECOVERY_FINALIZE')
  then
    perform app_private.assert_principal_recovery_movement(p_move);
  elsif p_move.source_bucket = 'MINING_REWARD'
    and (
      (p_move.movement_kind = 'FINALIZE' and p_move.origin_code = 'MINING_REWARD_WITHDRAWAL_FINALIZE')
      or (p_move.movement_kind = 'RELEASE' and p_move.origin_code = 'MINING_REWARD_WITHDRAWAL_RELEASE')
    )
  then
    perform app_private.assert_mining_reward_withdrawal_disposition(p_move);
  else
    return false;
  end if;
  return true;
exception when sqlstate '55000' then
  return false;
end;
$$;

-- 기존 확정·취소 함수가 요청 행을 갱신한 뒤에만 출처 행을 붙인다.
-- 그 함수는 security invoker이고 호출자는 service_role이다.
-- 이 트리거도 invoker로 두어 current_user를 service_role로 유지한다.
-- record_principal_recovery_release의 역할 검사를 그대로 통과한다.
-- 세션 역할은 바꾸지 않는다. 원장 분개와 지갑 행은 추가하지 않는다.
create function app_private.record_reserved_withdrawal_source_disposition()
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

create trigger withdrawal_requests_reserved_source_disposition
after update of finalize_ledger_transaction_id, release_ledger_transaction_id
on public.withdrawal_requests
for each row
when (
  (old.finalize_ledger_transaction_id is null and new.finalize_ledger_transaction_id is not null)
  or (old.release_ledger_transaction_id is null and new.release_ledger_transaction_id is not null)
)
execute function app_private.record_reserved_withdrawal_source_disposition();

revoke all on function app_private.mining_reward_hold_released(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.mining_reward_hold_released(uuid)
  to service_role;
revoke all on function app_private.assert_mining_reward_withdrawal_disposition(public.money_source_movements)
  from public, anon, authenticated, service_role;
grant execute on function app_private.assert_mining_reward_withdrawal_disposition(public.money_source_movements)
  to service_role;
revoke all on function app_private.record_reserved_withdrawal_source_disposition()
  from public, anon, authenticated, service_role;
grant execute on function app_private.record_reserved_withdrawal_source_disposition()
  to service_role;

comment on function app_private.mining_reward_hold_released(uuid) is
  '송금 전 취소로 RELEASE 출처 행이 있고 FINALIZE가 없는 채굴 수익 hold만 예약에서 뺀다.';
comment on function app_private.verified_mining_reward_remaining_atomic(uuid) is
  '검증된 채굴 수익 CREDIT에서, 아직 취소되지 않은 예약만 뺀다. 원장은 쓰지 않는다.';
comment on function app_private.reserve_verified_mining_reward_newest_first(uuid, uuid) is
  '검증된 MINING_REWARD CREDIT만 최신순으로 예약한다. 취소된 hold는 다시 남긴다. 원금과 BONUS는 쓰지 않는다.';
comment on function app_private.record_reserved_withdrawal_source_disposition() is
  '기존 확정 또는 송금 전 취소가 성공하면 예약 금액과 같은 출처 행을 한 번만 남긴다. 원장을 다시 차감하지 않는다.';
comment on table public.mining_reward_withdrawal_reservations is
  '수수료 0 출금 hold에 묶인 검증된 채굴 수익 예약. 확정은 FINALIZE, 송금 전 취소는 RELEASE 출처 행으로 한 번만 남긴다.';

commit;
