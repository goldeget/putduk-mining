begin;

-- Principal Revision foundation.
-- 기존 KRW 입금 승인 / USDT 확인 후 KRW principal credit이 같은 트랜잭션에서
-- 남기는 PRINCIPAL credit에만 lot과 증가 revision을 붙인다.
-- 새 원장 쓰기, public command alias, 과거 원장 backfill, Tier 활성화,
-- entitlement, cycle, settlement는 만들지 않는다.
-- 부분 원금 회수의 lot 배분은 정해지지 않았다. 감소 revision은 거절한다.

create table app_private.funding_principal_epochs (
  version integer primary key check (version = 1),
  introduced_at timestamptz not null default clock_timestamp()
);
insert into app_private.funding_principal_epochs(version) values (1);
revoke all on app_private.funding_principal_epochs from public, anon, authenticated, service_role;
grant select on app_private.funding_principal_epochs to service_role;

create table public.funding_principal_lots (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  user_id uuid not null references auth.users(id) on delete restrict,
  money_source_movement_id uuid not null unique
    references public.money_source_movements(id) on delete restrict,
  ledger_transaction_id uuid not null unique
    references public.ledger_transactions(id) on delete restrict,
  source_event_id uuid not null unique
    references public.outbox_events(id) on delete restrict,
  origin_code text not null check (origin_code in (
    'KRW_DEPOSIT', 'USDT_KRW_DEPOSIT', 'PRINCIPAL_CORRECTION'
  )),
  amount_atomic bigint not null check (amount_atomic > 0),
  amount_micro_krw bigint not null check (amount_micro_krw > 0),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint funding_principal_lots_micro_exact
    check (amount_micro_krw = amount_atomic * 1000000)
);
create index funding_principal_lots_owner_effective
  on public.funding_principal_lots(user_id, effective_at, id);
alter table public.funding_principal_lots enable row level security;
alter table public.funding_principal_lots force row level security;
revoke all on public.funding_principal_lots from public, anon, authenticated, service_role;
grant select, insert on public.funding_principal_lots to service_role;
create trigger funding_principal_lots_append_only
before update or delete on public.funding_principal_lots
for each row execute function app_private.prevent_row_mutation();

create table public.funding_principal_revisions (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  user_id uuid not null references auth.users(id) on delete restrict,
  lot_id uuid not null references public.funding_principal_lots(id) on delete restrict,
  money_source_movement_id uuid not null unique
    references public.money_source_movements(id) on delete restrict,
  ledger_transaction_id uuid not null
    references public.ledger_transactions(id) on delete restrict,
  source_event_id uuid not null
    references public.outbox_events(id) on delete restrict,
  direction text not null check (direction in ('INCREASE', 'DECREASE')),
  delta_micro_krw bigint not null check (delta_micro_krw > 0),
  eligible_principal_micro_krw_after bigint not null
    check (eligible_principal_micro_krw_after >= delta_micro_krw),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp()
);
create index funding_principal_revisions_owner_effective
  on public.funding_principal_revisions(user_id, effective_at, id);
alter table public.funding_principal_revisions enable row level security;
alter table public.funding_principal_revisions force row level security;
revoke all on public.funding_principal_revisions from public, anon, authenticated, service_role;
grant select, insert on public.funding_principal_revisions to service_role;
create trigger funding_principal_revisions_append_only
before update or delete on public.funding_principal_revisions
for each row execute function app_private.prevent_row_mutation();

-- bigint micro-KRW. 1 KRW = 1_000_000. numeric 잔액을 만들지 않는다.
-- 5_000_000_000 KRW는 5_000_000_000_000_000 micro이며 bigint 안에 들어간다.
create function app_private.funding_principal_micro_krw(p_amount_atomic bigint)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if p_amount_atomic is null or p_amount_atomic <= 0 or p_amount_atomic > 9223372036854 then
    raise exception using errcode = '22003', message = 'PRINCIPAL_MICRO_OVERFLOW';
  end if;
  return p_amount_atomic * 1000000;
end;
$$;
revoke all on function app_private.funding_principal_micro_krw(bigint)
  from public, anon, authenticated, service_role;
grant execute on function app_private.funding_principal_micro_krw(bigint) to service_role;

create function app_private.guard_funding_principal_lot()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_move public.money_source_movements%rowtype;
begin
  select movement.* into v_move
  from public.money_source_movements as movement
  where movement.id = new.money_source_movement_id;
  if v_move.id is null
    or v_move.user_id is distinct from new.user_id
    or v_move.ledger_transaction_id is distinct from new.ledger_transaction_id
    or v_move.source_event_id is distinct from new.source_event_id
    or v_move.effective_at is distinct from new.effective_at
    or v_move.amount_atomic is distinct from new.amount_atomic
    or v_move.origin_code is distinct from new.origin_code
    or v_move.source_bucket is distinct from 'PRINCIPAL'
    or v_move.movement_kind is distinct from 'CREDIT'
    or new.origin_code not in ('KRW_DEPOSIT', 'USDT_KRW_DEPOSIT', 'PRINCIPAL_CORRECTION')
    or new.amount_micro_krw is distinct from app_private.funding_principal_micro_krw(new.amount_atomic)
  then
    raise exception using errcode = '55000', message = 'FUNDING_PRINCIPAL_ORIGIN_REJECTED';
  end if;
  perform app_private.assert_money_source_credit(v_move);
  return new;
end;
$$;
revoke all on function app_private.guard_funding_principal_lot()
  from public, anon, authenticated, service_role;
grant execute on function app_private.guard_funding_principal_lot() to service_role;
create trigger funding_principal_lots_verify_source
before insert on public.funding_principal_lots
for each row execute function app_private.guard_funding_principal_lot();

create function app_private.guard_funding_principal_revision()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_lot public.funding_principal_lots%rowtype;
  v_eligible bigint;
begin
  -- 어떤 lot에서 뺄지는 정해지지 않았다. 전액 차감으로 이 결정을 우회하지 않는다.
  if new.direction = 'DECREASE' then
    raise exception using errcode = '55000', message = 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED';
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
  then
    raise exception using errcode = '55000', message = 'FUNDING_PRINCIPAL_LOT_MISMATCH';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_funding_principal_revision()
  from public, anon, authenticated, service_role;
grant execute on function app_private.guard_funding_principal_revision() to service_role;
create trigger funding_principal_revisions_verify_increase
before insert on public.funding_principal_revisions
for each row execute function app_private.guard_funding_principal_revision();

create function app_private.capture_funding_principal_lot()
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
  select coalesce(sum(lot.amount_micro_krw), 0) into v_eligible
  from public.funding_principal_lots as lot
  where lot.user_id = new.user_id;
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
revoke all on function app_private.capture_funding_principal_lot()
  from public, anon, authenticated, service_role;
grant execute on function app_private.capture_funding_principal_lot() to service_role;
create trigger money_source_capture_funding_principal_lot
after insert on public.money_source_movements
for each row
when (new.source_bucket = 'PRINCIPAL' and new.movement_kind = 'CREDIT')
execute function app_private.capture_funding_principal_lot();

-- 조회만 한다. Tier, entitlement, cycle, settlement를 쓰지 않는다.
create function app_private.read_funding_principal_foundation(p_user_id uuid)
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

  if v_lot_micro < v_minimum_micro then
    v_status := 'FUNDING_BELOW_MINIMUM';
  else
    v_status := 'FUNDING_MINIMUM_MET';
  end if;
  return jsonb_build_object(
    'eligible_principal_micro_krw', v_lot_micro::text,
    'minimum_principal_micro_krw', v_minimum_micro::text,
    'funding_status', v_status,
    'lot_count', v_lot_count
  );
end;
$$;
revoke all on function app_private.read_funding_principal_foundation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.read_funding_principal_foundation(uuid) to service_role;

-- 배분 규칙이 없으므로 금액을 어떤 lot에도 반영하지 않는다.
create function app_private.reject_undecided_principal_recovery(
  p_user_id uuid,
  p_amount_micro_krw bigint
) returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if p_user_id is null or p_amount_micro_krw is null or p_amount_micro_krw <= 0 then
    raise exception using errcode = '22023', message = 'PRINCIPAL_RECOVERY_AMOUNT_INVALID';
  end if;
  raise exception using errcode = '55000', message = 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED';
end;
$$;
revoke all on function app_private.reject_undecided_principal_recovery(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function app_private.reject_undecided_principal_recovery(uuid, bigint) to service_role;

comment on table public.funding_principal_lots is
  '인정 원금 lot. 각 credit의 effective_at을 유지하며 이후 입금이 기존 lot 시각을 바꾸지 않는다. 보너스와 채굴 수익 lot은 없다.';
comment on table public.funding_principal_revisions is
  '원금 증감의 불변 기록. 감소는 lot 배분이 정해지기 전까지 거절된다. 엔진 활성화 기록이 아니다.';
comment on function app_private.read_funding_principal_foundation(uuid) is
  '최소 원금 미만은 FUNDING_BELOW_MINIMUM으로만 돌려준다. Tier와 채굴 주기를 켜지 않는다.';
comment on function app_private.reject_undecided_principal_recovery(uuid, bigint) is
  '부분 원금 회수 배분이 미정이므로 lot을 줄이지 않고 PRINCIPAL_LOT_ALLOCATION_UNDECIDED로 거절한다.';

commit;
