begin;

-- 일반 원금 회수는 NEWEST_FIRST다.
-- 정렬은 effective_at DESC, recorded_at DESC, lot id DESC다.
-- funding_principal_lots에 created_at은 없고 recorded_at이 생성 시각이다.
-- 돈의 원장 쓰기는 기존 post_withdrawal_hold / release_withdrawal_hold만 쓴다.
-- 이 migration은 그 hold가 성립한 뒤에 lot 배분과 감소 revision만 남긴다.
-- hold가 성공하기 전에는 채굴 기준 원금을 줄이지 않는다.
-- release는 release effective_at부터 그 예약만 복구한다. 대기 구간 채굴은 만들지 않는다.
-- 일반 회수는 VERIFIED 채굴 보상을 되돌리지 않는다.
-- BONUS와 MINING_REWARD는 principal lot이 아니다. 기존 lot 가드를 유지한다.
-- FIFO, 비례 배분, LIFO라는 별도 정책 함수는 만들지 않는다.
-- segment, capacity, speed는 여기서 계산하지 않는다.
-- 유지기간 clock과 미확정 retention의 세부 복원, 이미 회수에 묶인 원본 lot의
-- 복합 상계는 정하지 않는다. 원본 lot 잔액이 부족하면 다른 lot으로 넘기지 않고 거절한다.

create table public.funding_principal_recovery_allocations (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  user_id uuid not null references auth.users (id) on delete restrict,
  lot_id uuid not null references public.funding_principal_lots (id) on delete restrict,
  hold_ledger_transaction_id uuid not null
    references public.ledger_transactions (id) on delete restrict,
  allocation_micro_krw bigint not null check (allocation_micro_krw > 0),
  policy_code text not null check (policy_code in (
    'NEWEST_FIRST', 'ORIGINAL_LOT_TARGETED'
  )),
  ordinal integer not null check (ordinal >= 0),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  unique (hold_ledger_transaction_id, lot_id),
  unique (hold_ledger_transaction_id, ordinal),
  check (isfinite(effective_at))
);

create index funding_principal_recovery_allocations_owner_effective
  on public.funding_principal_recovery_allocations (user_id, effective_at, id);

alter table public.funding_principal_recovery_allocations enable row level security;
alter table public.funding_principal_recovery_allocations force row level security;
revoke all on public.funding_principal_recovery_allocations
  from public, anon, authenticated, service_role;
grant select, insert on public.funding_principal_recovery_allocations to service_role;

create trigger funding_principal_recovery_allocations_append_only
before update or delete on public.funding_principal_recovery_allocations
for each row execute function app_private.prevent_row_mutation();

create table public.funding_principal_recovery_releases (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  user_id uuid not null references auth.users (id) on delete restrict,
  hold_ledger_transaction_id uuid not null unique
    references public.ledger_transactions (id) on delete restrict,
  release_ledger_transaction_id uuid not null unique
    references public.ledger_transactions (id) on delete restrict,
  effective_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  check (isfinite(effective_at))
);

create index funding_principal_recovery_releases_owner_effective
  on public.funding_principal_recovery_releases (user_id, effective_at, id);

alter table public.funding_principal_recovery_releases enable row level security;
alter table public.funding_principal_recovery_releases force row level security;
revoke all on public.funding_principal_recovery_releases
  from public, anon, authenticated, service_role;
grant select, insert on public.funding_principal_recovery_releases to service_role;

create trigger funding_principal_recovery_releases_append_only
before update or delete on public.funding_principal_recovery_releases
for each row execute function app_private.prevent_row_mutation();

-- 그 시각까지 생긴 lot에서, 아직 release되지 않은 hold 배분을 뺀다.
create function app_private.funding_principal_mining_eligible_micro(
  p_user_id uuid,
  p_at timestamptz
) returns bigint
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_gross bigint;
  v_reserved bigint;
begin
  if p_user_id is null or p_at is null or not isfinite(p_at) then
    raise exception using errcode = '22023', message = 'PRINCIPAL_RECOVERY_TIME_INVALID';
  end if;
  select coalesce(sum(lot.amount_micro_krw), 0)::bigint
    into v_gross
  from public.funding_principal_lots as lot
  where lot.user_id = p_user_id
    and lot.effective_at <= p_at;
  select coalesce(sum(allocation.allocation_micro_krw), 0)::bigint
    into v_reserved
  from public.funding_principal_recovery_allocations as allocation
  where allocation.user_id = p_user_id
    and allocation.effective_at <= p_at
    and not exists (
      select 1
      from public.funding_principal_recovery_releases as recovery_release
      where recovery_release.hold_ledger_transaction_id = allocation.hold_ledger_transaction_id
        and recovery_release.effective_at <= p_at
    );
  if v_gross is null or v_reserved is null
    or v_gross < 0 or v_reserved < 0 or v_reserved > v_gross then
    raise exception using errcode = '22003', message = 'PRINCIPAL_RECOVERY_MICRO_INVALID';
  end if;
  return v_gross - v_reserved;
end;
$$;

alter table public.funding_principal_revisions
  add column hold_ledger_transaction_id uuid
    references public.ledger_transactions (id) on delete restrict;

alter table public.funding_principal_revisions
  alter column money_source_movement_id drop not null;

do $$
declare
  v_name text;
begin
  select constraint_row.conname
    into v_name
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.funding_principal_revisions'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) like '%eligible_principal_micro_krw_after%'
    and pg_get_constraintdef(constraint_row.oid) like '%delta_micro_krw%';
  if v_name is null then
    raise exception using errcode = '55000', message = 'PRINCIPAL_REVISION_CHECK_MISSING';
  end if;
  execute format(
    'alter table public.funding_principal_revisions drop constraint %I',
    v_name
  );
end;
$$;

alter table public.funding_principal_revisions
  add constraint funding_principal_revisions_direction_shape check (
    (
      direction = 'INCREASE'
      and money_source_movement_id is not null
      and hold_ledger_transaction_id is null
    )
    or (
      direction = 'DECREASE'
      and money_source_movement_id is null
      and hold_ledger_transaction_id is not null
    )
  );

alter table public.funding_principal_revisions
  add constraint funding_principal_revisions_eligible_after_direction check (
    (
      direction = 'INCREASE'
      and eligible_principal_micro_krw_after >= delta_micro_krw
    )
    or (
      direction = 'DECREASE'
      and eligible_principal_micro_krw_after >= 0
    )
  );

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
  select coalesce(sum(lot.amount_micro_krw), 0) into v_eligible
  from public.funding_principal_lots as lot
  where lot.user_id = new.user_id;
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

create function app_private.plan_principal_recovery_newest_first(
  p_user_id uuid,
  p_amount_micro bigint,
  p_at timestamptz
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_lot record;
  v_open bigint;
  v_take bigint;
  v_left bigint;
  v_ordinal integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_before bigint;
begin
  if p_user_id is null or p_at is null or not isfinite(p_at)
    or p_amount_micro is null or p_amount_micro <= 0 then
    raise exception using errcode = '22023', message = 'PRINCIPAL_RECOVERY_AMOUNT_INVALID';
  end if;
  v_before := app_private.funding_principal_mining_eligible_micro(p_user_id, p_at);
  v_left := p_amount_micro;
  for v_lot in
    select
      lot.id,
      (
        lot.amount_micro_krw - coalesce((
          select sum(allocation.allocation_micro_krw)::bigint
          from public.funding_principal_recovery_allocations as allocation
          where allocation.lot_id = lot.id
            and allocation.effective_at <= p_at
            and not exists (
              select 1
              from public.funding_principal_recovery_releases as recovery_release
              where recovery_release.hold_ledger_transaction_id
                = allocation.hold_ledger_transaction_id
                and recovery_release.effective_at <= p_at
            )
        ), 0)
      )::bigint as open_micro
    from public.funding_principal_lots as lot
    where lot.user_id = p_user_id
      and lot.effective_at <= p_at
    order by lot.effective_at desc, lot.recorded_at desc, lot.id desc
  loop
    v_open := v_lot.open_micro;
    if v_open is null or v_open < 0 then
      raise exception using errcode = '22003', message = 'PRINCIPAL_RECOVERY_MICRO_INVALID';
    end if;
    if v_open = 0 then
      continue;
    end if;
    v_take := least(v_open, v_left);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'lot_id', v_lot.id,
      'allocation_micro_krw', v_take::text,
      'ordinal', v_ordinal
    ));
    v_left := v_left - v_take;
    v_ordinal := v_ordinal + 1;
    exit when v_left = 0;
  end loop;
  if v_left <> 0 then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_EXCEEDS_ELIGIBLE';
  end if;
  return jsonb_build_object(
    'policy_code', 'NEWEST_FIRST',
    'amount_micro_krw', p_amount_micro::text,
    'eligible_before_micro_krw', v_before::text,
    'eligible_after_micro_krw', (v_before - p_amount_micro)::text,
    'allocations', v_items
  );
end;
$$;

create function app_private.preview_principal_recovery_newest_first(
  p_user_id uuid,
  p_amount_micro bigint
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'PRINCIPAL_RECOVERY_SERVICE_ROLE_REQUIRED';
  end if;
  return app_private.plan_principal_recovery_newest_first(
    p_user_id, p_amount_micro, statement_timestamp());
end;
$$;

create function app_private.lock_principal_recovery_hold(
  p_user_id uuid,
  p_hold_ledger_transaction_id uuid
) returns table (
  hold_id uuid,
  amount_atomic bigint,
  amount_micro bigint,
  posted_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_tx public.ledger_transactions%rowtype;
  v_request public.withdrawal_requests%rowtype;
  v_amount bigint;
begin
  if p_user_id is null or p_hold_ledger_transaction_id is null then
    raise exception using errcode = '22023', message = 'PRINCIPAL_RECOVERY_HOLD_REQUIRED';
  end if;
  select transaction.*
    into v_tx
  from public.ledger_transactions as transaction
  where transaction.id = p_hold_ledger_transaction_id
  for update;
  if v_tx.id is null then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_HOLD_REQUIRED';
  end if;
  select request.*
    into v_request
  from public.withdrawal_requests as request
  where request.id = v_tx.reference_id
    and request.user_id = p_user_id
    and request.hold_ledger_transaction_id = v_tx.id
    and request.status = 'HELD'
    and request.currency = 'KRW'
    and request.fee_atomic = 0
  for update;
  if v_tx.metadata->>'amount_atomic' !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_HOLD_MISMATCH';
  end if;
  v_amount := (v_tx.metadata->>'amount_atomic')::bigint;
  if v_request.id is null
    or v_tx.category::text is distinct from 'WITHDRAWAL'
    or v_tx.currency::text is distinct from 'KRW'
    or v_tx.member_user_id is distinct from p_user_id
    or v_tx.reference_type is distinct from 'withdrawal_request'
    or v_tx.metadata->>'phase' is distinct from 'HOLD'
    or right(v_tx.idempotency_key, 5) is distinct from ':hold'
    or v_amount is distinct from v_request.amount_atomic
    or not isfinite(v_tx.posted_at)
    or not exists (
      select 1
      from public.ledger_entries as entry
      join public.ledger_accounts as account on account.id = entry.account_id
      where entry.transaction_id = v_tx.id
        and entry.sequence = 0
        and entry.side = 'DEBIT'
        and entry.amount_atomic = v_amount
        and account.code = 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY'
    )
    or not exists (
      select 1
      from public.ledger_entries as entry
      join public.ledger_accounts as account on account.id = entry.account_id
      where entry.transaction_id = v_tx.id
        and entry.sequence = 1
        and entry.side = 'CREDIT'
        and entry.amount_atomic = v_amount
        and account.code = 'PUTDUK:WITHDRAWAL_HOLD:KRW'
    )
  then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_HOLD_MISMATCH';
  end if;
  hold_id := v_tx.id;
  amount_atomic := v_amount;
  amount_micro := app_private.funding_principal_micro_krw(v_amount);
  posted_at := v_tx.posted_at;
  return next;
end;
$$;

create function app_private.finish_principal_recovery_hold(
  p_user_id uuid,
  p_hold_id uuid,
  p_posted_at timestamptz,
  p_amount_micro bigint,
  p_policy_code text,
  p_request_id uuid
) returns bigint
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_after bigint;
  v_event uuid;
  v_item record;
begin
  v_after := app_private.funding_principal_mining_eligible_micro(p_user_id, p_posted_at);
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key, available_at, last_error_code
  ) values (
    'PRINCIPAL_RECOVERY_HELD.v1',
    1,
    'ledger_transaction',
    p_hold_id,
    p_user_id,
    jsonb_build_object(
      'policy_code', p_policy_code,
      'hold_ledger_transaction_id', p_hold_id,
      'amount_micro_krw', p_amount_micro::text,
      'eligible_after_micro_krw', v_after::text
    ),
    gen_random_uuid(),
    p_request_id,
    p_hold_id::text || ':principal-recovery-held',
    'infinity'::timestamptz,
    'PRINCIPAL_RECOVERY_CONSUMER_NOT_ENABLED'
  ) returning id into v_event;

  insert into public.money_source_movements (
    user_id, source_bucket, movement_kind, origin_code, amount_atomic,
    ledger_transaction_id, source_event_id, effective_at
  ) values (
    p_user_id, 'OTHER_NON_PRINCIPAL', 'RESERVE', 'PRINCIPAL_RECOVERY_HOLD',
    p_amount_micro / 1000000, p_hold_id, v_event, p_posted_at
  );

  for v_item in
    select
      allocation.lot_id,
      allocation.allocation_micro_krw,
      allocation.effective_at
    from public.funding_principal_recovery_allocations as allocation
    where allocation.hold_ledger_transaction_id = p_hold_id
      and allocation.user_id = p_user_id
      and allocation.policy_code = p_policy_code
    order by allocation.ordinal
  loop
    insert into public.funding_principal_revisions (
      user_id, lot_id, money_source_movement_id, ledger_transaction_id, source_event_id,
      direction, delta_micro_krw, eligible_principal_micro_krw_after, effective_at,
      hold_ledger_transaction_id
    ) values (
      p_user_id,
      v_item.lot_id,
      null,
      p_hold_id,
      v_event,
      'DECREASE',
      v_item.allocation_micro_krw,
      v_after,
      v_item.effective_at,
      p_hold_id
    );
  end loop;
  return v_after;
end;
$$;

create function app_private.apply_principal_recovery_newest_first(
  p_user_id uuid,
  p_hold_ledger_transaction_id uuid
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_hold record;
  v_plan jsonb;
  v_item record;
  v_after bigint;
  v_existing integer;
  v_request_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'PRINCIPAL_RECOVERY_SERVICE_ROLE_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('putduk-funding-recovery:' || p_user_id::text, 0));
  select count(*)::integer
    into v_existing
  from public.funding_principal_recovery_allocations as allocation
  where allocation.hold_ledger_transaction_id = p_hold_ledger_transaction_id
    and allocation.user_id = p_user_id;
  if v_existing > 0 then
    if exists (
      select 1
      from public.funding_principal_recovery_allocations as allocation
      where allocation.hold_ledger_transaction_id = p_hold_ledger_transaction_id
        and allocation.policy_code is distinct from 'NEWEST_FIRST'
    ) then
      raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_POLICY_MIXED';
    end if;
    return jsonb_build_object(
      'policy_code', 'NEWEST_FIRST',
      'replayed', true,
      'allocation_count', v_existing,
      'eligible_micro_krw', app_private.funding_principal_mining_eligible_micro(
        p_user_id, statement_timestamp())::text
    );
  end if;

  select locked.hold_id, locked.amount_atomic, locked.amount_micro, locked.posted_at
    into v_hold
  from app_private.lock_principal_recovery_hold(
    p_user_id, p_hold_ledger_transaction_id) as locked;
  select transaction.request_id
    into v_request_id
  from public.ledger_transactions as transaction
  where transaction.id = v_hold.hold_id;

  v_plan := app_private.plan_principal_recovery_newest_first(
    p_user_id, v_hold.amount_micro, v_hold.posted_at);

  for v_item in
    select *
    from jsonb_to_recordset(v_plan->'allocations')
      as allocation_item(
        lot_id uuid,
        allocation_micro_krw text,
        ordinal integer
      )
  loop
    insert into public.funding_principal_recovery_allocations (
      user_id, lot_id, hold_ledger_transaction_id, allocation_micro_krw,
      policy_code, ordinal, effective_at
    ) values (
      p_user_id,
      v_item.lot_id,
      v_hold.hold_id,
      v_item.allocation_micro_krw::bigint,
      'NEWEST_FIRST',
      v_item.ordinal,
      v_hold.posted_at
    );
  end loop;

  v_after := app_private.finish_principal_recovery_hold(
    p_user_id, v_hold.hold_id, v_hold.posted_at, v_hold.amount_micro,
    'NEWEST_FIRST', v_request_id);
  if v_after::text is distinct from v_plan->>'eligible_after_micro_krw' then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_ALLOCATION_MISMATCH';
  end if;
  return jsonb_build_object(
    'policy_code', 'NEWEST_FIRST',
    'replayed', false,
    'allocation_count', jsonb_array_length(v_plan->'allocations'),
    'eligible_micro_krw', v_after::text
  );
end;
$$;

create function app_private.apply_principal_recovery_original_lot(
  p_user_id uuid,
  p_hold_ledger_transaction_id uuid,
  p_lot_id uuid
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_hold record;
  v_lot public.funding_principal_lots%rowtype;
  v_open bigint;
  v_after bigint;
  v_existing integer;
  v_request_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'PRINCIPAL_RECOVERY_SERVICE_ROLE_REQUIRED';
  end if;
  if p_lot_id is null then
    raise exception using errcode = '22023', message = 'PRINCIPAL_RECOVERY_ORIGINAL_LOT_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('putduk-funding-recovery:' || p_user_id::text, 0));
  select count(*)::integer
    into v_existing
  from public.funding_principal_recovery_allocations as allocation
  where allocation.hold_ledger_transaction_id = p_hold_ledger_transaction_id
    and allocation.user_id = p_user_id;
  if v_existing > 0 then
    if exists (
      select 1
      from public.funding_principal_recovery_allocations as allocation
      where allocation.hold_ledger_transaction_id = p_hold_ledger_transaction_id
        and (
          allocation.policy_code is distinct from 'ORIGINAL_LOT_TARGETED'
          or allocation.lot_id is distinct from p_lot_id
        )
    ) then
      raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_POLICY_MIXED';
    end if;
    return jsonb_build_object(
      'policy_code', 'ORIGINAL_LOT_TARGETED',
      'replayed', true,
      'allocation_count', v_existing,
      'eligible_micro_krw', app_private.funding_principal_mining_eligible_micro(
        p_user_id, statement_timestamp())::text
    );
  end if;

  select locked.hold_id, locked.amount_atomic, locked.amount_micro, locked.posted_at
    into v_hold
  from app_private.lock_principal_recovery_hold(
    p_user_id, p_hold_ledger_transaction_id) as locked;
  select transaction.request_id
    into v_request_id
  from public.ledger_transactions as transaction
  where transaction.id = v_hold.hold_id;

  select lot.*
    into v_lot
  from public.funding_principal_lots as lot
  where lot.id = p_lot_id;
  if v_lot.id is null
    or v_lot.user_id is distinct from p_user_id
    or v_lot.effective_at > v_hold.posted_at
    or v_lot.origin_code not in ('KRW_DEPOSIT', 'USDT_KRW_DEPOSIT', 'PRINCIPAL_CORRECTION')
  then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_ORIGINAL_LOT_MISMATCH';
  end if;
  select (
    v_lot.amount_micro_krw - coalesce((
      select sum(allocation.allocation_micro_krw)::bigint
      from public.funding_principal_recovery_allocations as allocation
      where allocation.lot_id = v_lot.id
        and allocation.effective_at <= v_hold.posted_at
        and not exists (
          select 1
          from public.funding_principal_recovery_releases as recovery_release
          where recovery_release.hold_ledger_transaction_id
            = allocation.hold_ledger_transaction_id
            and recovery_release.effective_at <= v_hold.posted_at
        )
    ), 0)
  )::bigint into v_open;
  if v_open is null or v_open < v_hold.amount_micro then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_ORIGINAL_LOT_SHORT';
  end if;

  insert into public.funding_principal_recovery_allocations (
    user_id, lot_id, hold_ledger_transaction_id, allocation_micro_krw,
    policy_code, ordinal, effective_at
  ) values (
    p_user_id, v_lot.id, v_hold.hold_id, v_hold.amount_micro,
    'ORIGINAL_LOT_TARGETED', 0, v_hold.posted_at
  );
  v_after := app_private.finish_principal_recovery_hold(
    p_user_id, v_hold.hold_id, v_hold.posted_at, v_hold.amount_micro,
    'ORIGINAL_LOT_TARGETED', v_request_id);
  return jsonb_build_object(
    'policy_code', 'ORIGINAL_LOT_TARGETED',
    'replayed', false,
    'allocation_count', 1,
    'eligible_micro_krw', v_after::text
  );
end;
$$;

create function app_private.record_principal_recovery_release(
  p_user_id uuid,
  p_release_ledger_transaction_id uuid
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_tx public.ledger_transactions%rowtype;
  v_request public.withdrawal_requests%rowtype;
  v_amount bigint;
  v_existing uuid;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'PRINCIPAL_RECOVERY_SERVICE_ROLE_REQUIRED';
  end if;
  if p_user_id is null or p_release_ledger_transaction_id is null then
    raise exception using errcode = '22023', message = 'PRINCIPAL_RECOVERY_RELEASE_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('putduk-funding-recovery:' || p_user_id::text, 0));

  select transaction.*
    into v_tx
  from public.ledger_transactions as transaction
  where transaction.id = p_release_ledger_transaction_id
  for update;
  if v_tx.id is null then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_RELEASE_REQUIRED';
  end if;
  select recovery_release.id
    into v_existing
  from public.funding_principal_recovery_releases as recovery_release
  where recovery_release.release_ledger_transaction_id = v_tx.id
    and recovery_release.user_id = p_user_id;
  if v_existing is not null then
    return jsonb_build_object('replayed', true, 'release_id', v_existing);
  end if;

  select request.*
    into v_request
  from public.withdrawal_requests as request
  where request.user_id = p_user_id
    and request.release_ledger_transaction_id = v_tx.id
    and request.hold_ledger_transaction_id = v_tx.reversal_of_transaction_id
    and request.status in ('CANCELLED', 'REJECTED')
    and request.fee_atomic = 0
    and request.currency = 'KRW'
  for update;
  v_amount := v_request.amount_atomic;
  if v_request.id is null
    or v_tx.category::text is distinct from 'REVERSAL'
    or v_tx.currency::text is distinct from 'KRW'
    or v_tx.member_user_id is distinct from p_user_id
    or v_tx.metadata->>'phase' is distinct from 'RELEASE'
    or right(v_tx.idempotency_key, 8) is distinct from ':release'
    or not isfinite(v_tx.posted_at)
    or not exists (
      select 1
      from public.funding_principal_recovery_allocations as allocation
      where allocation.hold_ledger_transaction_id = v_request.hold_ledger_transaction_id
        and allocation.user_id = p_user_id
        and allocation.policy_code in ('NEWEST_FIRST', 'ORIGINAL_LOT_TARGETED')
    )
    or not exists (
      select 1
      from public.ledger_entries as entry
      join public.ledger_accounts as account on account.id = entry.account_id
      where entry.transaction_id = v_tx.id
        and entry.sequence = 0
        and entry.side = 'DEBIT'
        and entry.amount_atomic = v_amount
        and account.code = 'PUTDUK:WITHDRAWAL_HOLD:KRW'
    )
    or not exists (
      select 1
      from public.ledger_entries as entry
      join public.ledger_accounts as account on account.id = entry.account_id
      where entry.transaction_id = v_tx.id
        and entry.sequence = 1
        and entry.side = 'CREDIT'
        and entry.amount_atomic = v_amount
        and account.code = 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY'
    )
  then
    raise exception using errcode = '55000', message = 'PRINCIPAL_RECOVERY_RELEASE_MISMATCH';
  end if;

  insert into public.funding_principal_recovery_releases (
    user_id, hold_ledger_transaction_id, release_ledger_transaction_id, effective_at
  ) values (
    p_user_id, v_request.hold_ledger_transaction_id, v_tx.id, v_tx.posted_at
  );

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key, available_at, last_error_code
  ) values (
    'PRINCIPAL_RECOVERY_RELEASED.v1',
    1,
    'ledger_transaction',
    v_tx.id,
    p_user_id,
    jsonb_build_object(
      'hold_ledger_transaction_id', v_request.hold_ledger_transaction_id,
      'release_ledger_transaction_id', v_tx.id
    ),
    gen_random_uuid(),
    v_tx.request_id,
    v_tx.id::text || ':principal-recovery-released',
    'infinity'::timestamptz,
    'PRINCIPAL_RECOVERY_CONSUMER_NOT_ENABLED'
  ) returning id into v_existing;

  insert into public.money_source_movements (
    user_id, source_bucket, movement_kind, origin_code, amount_atomic,
    ledger_transaction_id, source_event_id, effective_at
  ) values (
    p_user_id, 'OTHER_NON_PRINCIPAL', 'RELEASE', 'PRINCIPAL_RECOVERY_RELEASE',
    v_amount, v_tx.id, v_existing, v_tx.posted_at
  );

  return jsonb_build_object('replayed', false, 'release_id', (
    select recovery_release.id
    from public.funding_principal_recovery_releases as recovery_release
    where recovery_release.release_ledger_transaction_id = v_tx.id
  ));
end;
$$;

create or replace function app_private.read_funding_principal_foundation(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_coverage text;
  v_eligible_text text;
  v_minimum_text text;
  v_minimum_krw bigint;
  v_minimum_micro bigint;
  v_lot_atomic bigint;
  v_lot_micro bigint;
  v_lot_count integer;
  v_epoch timestamptz;
  v_status text;
  v_net bigint;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;
  select summary.coverage, summary.eligible_principal_atomic
  into v_coverage, v_eligible_text
  from public.money_source_summaries as summary
  where summary.user_id = p_user_id;
  if v_coverage is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;

  select policy.config->>'minimumPrincipalKrw' into v_minimum_text
  from app_private.economy_policy_published as policy
  where policy.effective_from <= statement_timestamp()
    and (policy.effective_until is null or policy.effective_until > statement_timestamp())
  order by policy.effective_from desc
  limit 1;
  if v_minimum_text is null or v_minimum_text !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '55000', message = 'FUNDING_MINIMUM_POLICY_UNAVAILABLE';
  end if;
  v_minimum_krw := v_minimum_text::bigint;
  v_minimum_micro := app_private.funding_principal_micro_krw(v_minimum_krw);

  select introduced_at into v_epoch
  from app_private.funding_principal_epochs
  where version = 1;
  select coalesce(sum(lot.amount_atomic), 0), coalesce(sum(lot.amount_micro_krw), 0), count(*)::integer
  into v_lot_atomic, v_lot_micro, v_lot_count
  from public.funding_principal_lots as lot
  where lot.user_id = p_user_id;

  if v_coverage is distinct from 'COMPLETE' then
    return jsonb_build_object(
      'eligible_principal_micro_krw', null,
      'minimum_principal_micro_krw', v_minimum_micro::text,
      'funding_status', 'FUNDING_PRINCIPAL_UNRESOLVED',
      'lot_count', v_lot_count
    );
  end if;

  if exists (
    select 1
    from public.money_source_movements as movement
    where movement.user_id = p_user_id
      and movement.source_bucket = 'PRINCIPAL'
      and movement.movement_kind = 'CREDIT'
      and movement.recorded_at >= v_epoch
      and movement.amount_atomic <= 9223372036854
      and not exists (
        select 1 from public.funding_principal_lots as lot
        where lot.money_source_movement_id = movement.id
          and lot.amount_atomic = movement.amount_atomic
          and lot.effective_at = movement.effective_at
          and lot.origin_code = movement.origin_code
      )
  ) then
    raise exception using errcode = '55000', message = 'FUNDING_PRINCIPAL_LOT_MISMATCH';
  end if;

  if exists (
    select 1
    from public.money_source_movements as movement
    where movement.user_id = p_user_id
      and movement.source_bucket = 'PRINCIPAL'
      and movement.movement_kind = 'CREDIT'
      and movement.amount_atomic > 9223372036854
  ) then
    return jsonb_build_object(
      'eligible_principal_micro_krw', null,
      'minimum_principal_micro_krw', v_minimum_micro::text,
      'funding_status', 'FUNDING_PRINCIPAL_UNRESOLVED',
      'lot_count', v_lot_count
    );
  end if;

  if exists (
    select 1
    from public.money_source_movements as movement
    where movement.user_id = p_user_id
      and movement.source_bucket = 'PRINCIPAL'
      and movement.movement_kind = 'CREDIT'
      and movement.recorded_at < v_epoch
  ) or v_eligible_text is null
    or v_eligible_text::bigint is distinct from v_lot_atomic
  then
    return jsonb_build_object(
      'eligible_principal_micro_krw', null,
      'minimum_principal_micro_krw', v_minimum_micro::text,
      'funding_status', 'FUNDING_PRINCIPAL_UNRESOLVED',
      'lot_count', v_lot_count
    );
  end if;

  v_net := app_private.funding_principal_mining_eligible_micro(
    p_user_id, statement_timestamp());
  if v_net < v_minimum_micro then
    v_status := 'FUNDING_BELOW_MINIMUM';
  else
    v_status := 'FUNDING_MINIMUM_MET';
  end if;
  return jsonb_build_object(
    'eligible_principal_micro_krw', v_net::text,
    'minimum_principal_micro_krw', v_minimum_micro::text,
    'funding_status', v_status,
    'lot_count', v_lot_count
  );
end;
$$;

revoke all on function app_private.funding_principal_mining_eligible_micro(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_principal_mining_eligible_micro(uuid, timestamptz)
  to service_role;
revoke all on function app_private.plan_principal_recovery_newest_first(uuid, bigint, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function app_private.plan_principal_recovery_newest_first(uuid, bigint, timestamptz)
  to service_role;
revoke all on function app_private.preview_principal_recovery_newest_first(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function app_private.preview_principal_recovery_newest_first(uuid, bigint)
  to service_role;
revoke all on function app_private.lock_principal_recovery_hold(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.lock_principal_recovery_hold(uuid, uuid)
  to service_role;
revoke all on function app_private.finish_principal_recovery_hold(uuid, uuid, timestamptz, bigint, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.finish_principal_recovery_hold(uuid, uuid, timestamptz, bigint, text, uuid)
  to service_role;
revoke all on function app_private.apply_principal_recovery_newest_first(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.apply_principal_recovery_newest_first(uuid, uuid)
  to service_role;
revoke all on function app_private.apply_principal_recovery_original_lot(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.apply_principal_recovery_original_lot(uuid, uuid, uuid)
  to service_role;
revoke all on function app_private.record_principal_recovery_release(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.record_principal_recovery_release(uuid, uuid)
  to service_role;

create function app_private.assert_principal_recovery_movement(
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
    or p_move.wallet_ledger_id is not null
    or p_move.movement_kind not in ('RESERVE', 'RELEASE')
    or p_move.amount_atomic is null
    or p_move.amount_atomic <= 0
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
  elsif p_move.origin_code is distinct from 'PRINCIPAL_RECOVERY_RELEASE'
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
  then
    perform app_private.assert_principal_recovery_movement(new);
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
  then
    perform app_private.assert_principal_recovery_movement(p_move);
  else
    return false;
  end if;
  return true;
exception when sqlstate '55000' then
  return false;
end;
$$;

create or replace view public.money_source_summaries with (security_invoker = true) as
select a.user_id, 1 as schema_version,
  m.unclassified_wallet_entries::text as unclassified_wallet_entries,
  w.unconnected_withdrawals::text as unconnected_withdrawals,
  j.unclassified_journals::text as unclassified_journals,
  c.invalid_source_receipts::text as invalid_source_receipts,
  case when m.unclassified_wallet_entries + w.unconnected_withdrawals
    + j.unclassified_journals + c.invalid_source_receipts = 0
    then 'COMPLETE' else 'UNRESOLVED' end as coverage,
  case when m.unclassified_wallet_entries + w.unconnected_withdrawals
    + j.unclassified_journals + c.invalid_source_receipts = 0
    then c.principal::text end as eligible_principal_atomic,
  c.krw_deposits::text as recorded_krw_principal_deposits_atomic,
  c.usdt_credits::text as recorded_usdt_principal_credits_atomic,
  c.bonus::text as recorded_bonus_atomic,
  statement_timestamp() as observed_at,
  (select introduced_at from app_private.money_source_epochs where version = 1) as capture_started_at
from public.wallet_accounts as a
cross join lateral (
  select coalesce(sum(amount_atomic) filter (where verified and source_bucket = 'PRINCIPAL'), 0) as principal,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'KRW_DEPOSIT'), 0) as krw_deposits,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'USDT_KRW_DEPOSIT'), 0) as usdt_credits,
    coalesce(sum(amount_atomic) filter (where verified and source_bucket = 'BONUS'), 0) as bonus,
    count(*) filter (where not verified) as invalid_source_receipts
  from (select amount_atomic, source_bucket, origin_code,
      app_private.money_source_credit_verified(movement) as verified
    from public.money_source_movements as movement where user_id = a.user_id) as checked
) as c
cross join lateral (
  select count(*) as unclassified_wallet_entries
  from public.wallet_ledger as projection
  where projection.wallet_account_id = a.id and not exists (
    select 1 from public.money_source_movements as movement where movement.wallet_ledger_id = projection.id
  )
) as m
cross join lateral (
  select count(*) as unconnected_withdrawals
  from public.withdrawal_requests as request
  where request.user_id = a.user_id
    and request.currency = 'KRW'
    and not exists (
      select 1
      from public.funding_principal_recovery_allocations as allocation
      where allocation.user_id = request.user_id
        and allocation.hold_ledger_transaction_id = request.hold_ledger_transaction_id
    )
) as w
cross join lateral (
  select count(*) as unclassified_journals from public.ledger_transactions as journal
  join (
    select owned_header.id as journal_id from public.ledger_transactions as owned_header
      where owned_header.member_user_id = a.user_id and owned_header.currency = 'KRW'
    union
    select entry.transaction_id as journal_id from public.ledger_accounts as owned_account
      join public.ledger_entries as entry on entry.account_id = owned_account.id
      where owned_account.owner_user_id = a.user_id and owned_account.currency = 'KRW'
  ) as affected on affected.journal_id = journal.id
  where journal.currency = 'KRW' and not exists (
    select 1 from public.money_source_movements as movement
      where movement.ledger_transaction_id = journal.id and movement.user_id = a.user_id
  )
) as j
where a.currency = 'KRW';

revoke all on function app_private.assert_principal_recovery_movement(public.money_source_movements)
  from public, anon, authenticated, service_role;
grant execute on function app_private.assert_principal_recovery_movement(public.money_source_movements)
  to service_role;
revoke all on public.money_source_summaries from public, anon, authenticated, service_role;
grant select on public.money_source_summaries to service_role;

comment on table public.funding_principal_recovery_allocations is
  '원금 회수 hold의 lot 배분. 일반 회수는 NEWEST_FIRST, 특정 입금 취소는 ORIGINAL_LOT_TARGETED. lot 금액은 덮어쓰지 않는다.';
comment on table public.funding_principal_recovery_releases is
  '기존 release 원장이 성립한 뒤 그 시각부터 배분 예약을 되돌린다. 대기 구간 채굴은 만들지 않는다.';
comment on function app_private.preview_principal_recovery_newest_first(uuid, bigint) is
  '배분 미리보기만 한다. hold 전에는 채굴 기준 원금을 줄이지 않는다.';
comment on function app_private.apply_principal_recovery_newest_first(uuid, uuid) is
  '기존 출금 hold 원장이 HELD로 연결된 뒤에만 최근 lot부터 배분한다.';
comment on function app_private.apply_principal_recovery_original_lot(uuid, uuid, uuid) is
  '특정 입금의 원본 lot만 배분한다. 잔액이 부족하면 다른 lot으로 넘기지 않는다.';
comment on function app_private.record_principal_recovery_release(uuid, uuid) is
  '기존 release 원장 뒤에만 예약을 복구한다. 확정 채굴 보상을 회수하지 않는다.';
comment on function app_private.reject_undecided_principal_recovery(uuid, bigint) is
  'hold 원장 없이 호출되는 기존 입구다. 성공한 hold 전에는 예약하지 않으므로 계속 거절한다.';

commit;
