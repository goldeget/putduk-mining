begin;

-- Fresh principal CREDIT revisions describe eligible principal after the credit,
-- excluding unreleased original reservations as of that exact effective instant.
-- Preserve all immutable historical revisions and existing canonical commands.
-- No after-credit member lock is added; canonical early lock integration belongs
-- to the separately reviewed future engine boundary, avoiding wallet/member reversal.

create or replace function app_private.guard_funding_principal_revision()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_lot public.funding_principal_lots%rowtype;
  v_eligible bigint;
  v_hold_posted_at timestamptz;
  v_matched boolean;
begin
  if new.direction = 'DECREASE' then
    select exists (
      select 1
      from public.funding_principal_recovery_allocations as allocation
      where allocation.user_id = new.user_id
        and allocation.lot_id = new.lot_id
        and allocation.hold_ledger_transaction_id = new.hold_ledger_transaction_id
        and allocation.allocation_micro_krw = new.delta_micro_krw
        and allocation.policy_code in ('NEWEST_FIRST', 'ORIGINAL_LOT_TARGETED')
        and allocation.effective_at = new.effective_at
    ) into v_matched;
    if not v_matched then
      raise exception using errcode = '55000', message = 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED';
    end if;
    select transaction.posted_at
      into v_hold_posted_at
    from public.ledger_transactions as transaction
    where transaction.id = new.hold_ledger_transaction_id;
    if new.hold_ledger_transaction_id is null
      or new.money_source_movement_id is not null
      or new.ledger_transaction_id is distinct from new.hold_ledger_transaction_id
      or v_hold_posted_at is null
      or new.effective_at is distinct from v_hold_posted_at
      or new.eligible_principal_micro_krw_after is distinct from
        app_private.funding_principal_mining_eligible_micro(new.user_id, new.effective_at)
    then
      raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_ALLOCATION_MISMATCH';
    end if;
    return new;
  end if;
  if new.direction is distinct from 'INCREASE' then
    raise exception using errcode = '55000', message = 'FUNDING_PRINCIPAL_ORIGIN_REJECTED';
  end if;
  select lot.* into v_lot
  from public.funding_principal_lots as lot
  where lot.id = new.lot_id;
  v_eligible := app_private.funding_principal_mining_eligible_micro(
    new.user_id, new.effective_at);
  if v_lot.id is null
    or v_lot.user_id is distinct from new.user_id
    or v_lot.money_source_movement_id is distinct from new.money_source_movement_id
    or v_lot.ledger_transaction_id is distinct from new.ledger_transaction_id
    or v_lot.source_event_id is distinct from new.source_event_id
    or v_lot.effective_at is distinct from new.effective_at
    or v_lot.amount_micro_krw is distinct from new.delta_micro_krw
    or v_eligible is distinct from new.eligible_principal_micro_krw_after
    or new.hold_ledger_transaction_id is not null
  then
    raise exception using errcode = '55000', message = 'FUNDING_PRINCIPAL_LOT_MISMATCH';
  end if;
  return new;
end;
$$;

create or replace function app_private.capture_funding_principal_lot()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_micro bigint;
  v_lot_id uuid;
  v_eligible bigint;
begin
  if new.source_bucket is distinct from 'PRINCIPAL' or new.movement_kind is distinct from 'CREDIT' then
    return new;
  end if;
  if new.origin_code not in ('KRW_DEPOSIT', 'USDT_KRW_DEPOSIT', 'PRINCIPAL_CORRECTION') then
    raise exception using errcode = '55000', message = 'FUNDING_PRINCIPAL_ORIGIN_REJECTED';
  end if;
  -- micro bigint에 담기지 않으면 lot을 만들지 않는다. 기존 입금 확정은 롤백하지 않는다.
  if new.amount_atomic > 9223372036854 then
    return new;
  end if;
  v_micro := app_private.funding_principal_micro_krw(new.amount_atomic);
  insert into public.funding_principal_lots (
    user_id, money_source_movement_id, ledger_transaction_id, source_event_id,
    origin_code, amount_atomic, amount_micro_krw, effective_at
  ) values (
    new.user_id, new.id, new.ledger_transaction_id, new.source_event_id,
    new.origin_code, new.amount_atomic, v_micro, new.effective_at
  ) returning id into v_lot_id;
  v_eligible := app_private.funding_principal_mining_eligible_micro(
    new.user_id, new.effective_at);
  insert into public.funding_principal_revisions (
    user_id, lot_id, money_source_movement_id, ledger_transaction_id, source_event_id,
    direction, delta_micro_krw, eligible_principal_micro_krw_after, effective_at
  ) values (
    new.user_id, v_lot_id, new.id, new.ledger_transaction_id, new.source_event_id,
    'INCREASE', v_micro, v_eligible, new.effective_at
  );
  return new;
end;
$$;

commit;
