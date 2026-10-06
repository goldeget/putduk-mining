begin;

-- 검증된 채굴 수익이 수수료 0인 출금 전액을 덮을 때만 그 출처를 예약하고 hold한다.
-- 회원 출처 선택 API는 없다. 수익 전액 경로와 원금 전액 경로는 한 출금 안에서 섞지 않는다.
-- 수익이 부족하면 원금으로 채우지 않는다. BONUS는 일반 출금 출처가 아니다.
-- 배분은 effective_at DESC, recorded_at DESC, id DESC이고 부분 배분은 MINING_REWARD 안에서만 한다.
-- release, finalize, reverse 출처 행은 만들지 않는다.
-- record_mining_settlement는 호출하지 않는다. 읽기 함수는 원장을 쓰지 않는다.
-- 채굴 수익 CREDIT을 생산하는 명령은 열지 않는다. 이미 검증된 영수증만 예약한다.

insert into public.ledger_accounts (
  code, currency, account_class, normal_side, is_controlled_asset
) values (
  'PUTDUK:MINING_REWARD_EXPENSE:KRW', 'KRW', 'EXPENSE', 'DEBIT', false
)
on conflict (code) do nothing;

create table public.mining_reward_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  amount_atomic bigint not null check (amount_atomic > 0),
  ledger_transaction_id uuid not null unique
    references public.ledger_transactions (id) on delete restrict,
  wallet_ledger_id uuid not null unique
    references public.wallet_ledger (id) on delete restrict,
  source_event_id uuid not null unique
    references public.outbox_events (id) on delete restrict,
  effective_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  check (isfinite(effective_at))
);

create index mining_reward_credits_owner_effective
  on public.mining_reward_credits (user_id, effective_at, id);

alter table public.mining_reward_credits enable row level security;
alter table public.mining_reward_credits force row level security;
revoke all on public.mining_reward_credits
  from public, anon, authenticated, service_role;
grant select on public.mining_reward_credits to service_role;

create trigger mining_reward_credits_append_only
before update or delete on public.mining_reward_credits
for each row execute function app_private.prevent_row_mutation();

create table public.mining_reward_withdrawal_reservations (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  user_id uuid not null references auth.users (id) on delete restrict,
  credit_movement_id uuid not null
    references public.money_source_movements (id) on delete restrict,
  hold_ledger_transaction_id uuid not null
    references public.ledger_transactions (id) on delete restrict,
  amount_atomic bigint not null check (amount_atomic > 0),
  ordinal integer not null check (ordinal >= 0),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  unique (hold_ledger_transaction_id, credit_movement_id),
  unique (hold_ledger_transaction_id, ordinal),
  check (isfinite(effective_at))
);

create index mining_reward_withdrawal_reservations_credit
  on public.mining_reward_withdrawal_reservations (credit_movement_id);

alter table public.mining_reward_withdrawal_reservations enable row level security;
alter table public.mining_reward_withdrawal_reservations force row level security;
revoke all on public.mining_reward_withdrawal_reservations
  from public, anon, authenticated, service_role;
grant select, insert on public.mining_reward_withdrawal_reservations to service_role;

create trigger mining_reward_withdrawal_reservations_append_only
before update or delete on public.mining_reward_withdrawal_reservations
for each row execute function app_private.prevent_row_mutation();

-- 기존 세 생산자 검증은 유지한다. CREDIT이 아닌 출처 행은 계속 거절한다.
create or replace function app_private.assert_money_source_credit(
  p_move public.money_source_movements
) returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_event public.outbox_events%rowtype;
  v_journal public.ledger_transactions%rowtype;
  v_wallet public.wallet_ledger%rowtype;
  v_owner uuid;
  v_amount bigint;
  v_wallet_id uuid;
  v_journal_id uuid;
  v_category text;
  v_origin text;
  v_bucket text;
  v_amount_key text;
  v_requested_amount bigint;
  v_command_key text;
  v_conversion_key text;
begin
  if p_move.movement_kind <> 'CREDIT' then
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_COMMAND_NOT_CONNECTED';
  end if;
  select * into v_event from public.outbox_events where id = p_move.source_event_id;
  select * into v_journal from public.ledger_transactions where id = p_move.ledger_transaction_id;
  select * into v_wallet from public.wallet_ledger where id = p_move.wallet_ledger_id;
  if v_event.schema_version is distinct from 1 or v_journal.id is null
    or v_wallet.id is null or v_journal.currency <> 'KRW'
    or v_journal.created_at < (select introduced_at from app_private.money_source_epochs where version = 1)
  then
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_RECEIPT_UNVERIFIED';
  end if;
  if v_event.event_type = 'DEPOSIT_CONFIRMED.v1' and v_event.aggregate_type = 'deposit_request' then
    select user_id, approved_amount_atomic, ledger_transaction_id, wallet_ledger_id, amount_atomic
    into v_owner, v_amount, v_journal_id, v_wallet_id, v_requested_amount
    from public.deposit_requests where id = v_event.aggregate_id and status = 'APPROVED'
      and reviewed_by = v_event.actor_user_id and currency = 'KRW';
    v_category := 'DEPOSIT'; v_origin := 'KRW_DEPOSIT'; v_bucket := 'PRINCIPAL';
    v_amount_key := 'approved_amount_atomic';
  elsif v_event.event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1'
    and v_event.aggregate_type = 'usdt_manual_deposit' then
    select user_id, credited_krw, ledger_transaction_id, wallet_ledger_id
    into v_owner, v_amount, v_journal_id, v_wallet_id
    from public.usdt_manual_deposits where id = v_event.aggregate_id and status = 'CONFIRMED'
      and confirmed_by = v_event.actor_user_id and network_snapshot = 'TRC20';
    v_category := 'DEPOSIT'; v_origin := 'USDT_KRW_DEPOSIT'; v_bucket := 'PRINCIPAL';
    v_amount_key := 'credited_krw';
  elsif v_event.event_type = 'TRIAL_REWARD_CONVERTED.v1'
    and v_event.aggregate_type = 'trial_reward_conversion' then
    select user_id, converted_amount_atomic, ledger_transaction_id, wallet_ledger_id, idempotency_key
    into v_owner, v_amount, v_journal_id, v_wallet_id, v_conversion_key
    from public.trial_reward_conversions where id = v_event.aggregate_id and status = 'CONVERTED'
      and converted_amount_atomic between 1 and 5000 and user_id = v_event.actor_user_id;
    v_category := 'TRIAL_REWARD_CONVERSION'; v_origin := 'WELCOME_REWARD'; v_bucket := 'BONUS';
    v_amount_key := 'amount_atomic';
  elsif v_event.event_type = 'MINING_REWARD_CREDITED.v1'
    and v_event.aggregate_type = 'mining_reward_credit' then
    select credit.user_id, credit.amount_atomic, credit.ledger_transaction_id, credit.wallet_ledger_id
    into v_owner, v_amount, v_journal_id, v_wallet_id
    from public.mining_reward_credits as credit
    where credit.id = v_event.aggregate_id
      and credit.source_event_id = p_move.source_event_id
      and credit.effective_at = p_move.effective_at;
    v_category := 'MINING_REWARD'; v_origin := 'MINING_REWARD'; v_bucket := 'MINING_REWARD';
    v_amount_key := 'amount_atomic';
  else
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_COMMAND_NOT_CONNECTED';
  end if;
  v_command_key := left(v_journal.idempotency_key, length(v_journal.idempotency_key) - 7);
  if v_owner is null or v_amount is null or v_amount <= 0
    or p_move.user_id is distinct from v_owner or p_move.amount_atomic is distinct from v_amount
    or p_move.origin_code is distinct from v_origin or p_move.source_bucket is distinct from v_bucket
    or p_move.ledger_transaction_id is distinct from v_journal_id
    or p_move.wallet_ledger_id is distinct from v_wallet_id
    or p_move.effective_at is distinct from v_journal.posted_at
    or v_journal.member_user_id is distinct from v_owner
    or (v_category = 'DEPOSIT' and v_journal.created_by is distinct from v_event.actor_user_id)
    or v_journal.category::text is distinct from v_category
    or v_journal.reference_type is distinct from v_event.aggregate_type
    or v_journal.reference_id is distinct from v_event.aggregate_id
    or v_journal.request_id is distinct from v_event.request_id
    or v_journal.correlation_id is distinct from v_event.correlation_id
    or v_wallet.user_id is distinct from v_owner or v_wallet.direction <> 'CREDIT'
    or v_wallet.entry_type::text is distinct from v_category
    or v_wallet.amount_atomic is distinct from v_amount
    or v_wallet.reference_type is distinct from v_event.aggregate_type
    or v_wallet.reference_id is distinct from v_event.aggregate_id
    or (v_category = 'DEPOSIT' and v_wallet.created_by is distinct from v_event.actor_user_id)
    or right(v_journal.idempotency_key, 7) is distinct from ':ledger'
    or char_length(btrim(v_command_key)) not between 8 and 200
    or v_wallet.idempotency_key is distinct from (case
      when v_origin = 'KRW_DEPOSIT' then v_command_key else v_command_key || ':wallet' end)
    or v_event.idempotency_key is distinct from v_command_key || (case
      when v_origin = 'KRW_DEPOSIT' then ':deposit-event' else ':event' end)
    or (v_origin = 'WELCOME_REWARD' and v_conversion_key is distinct from v_command_key)
    or v_event.payload->>'user_id' is distinct from v_owner::text
    or v_event.payload->>v_amount_key is distinct from v_amount::text
    or v_event.payload->>'ledger_transaction_id' is distinct from v_journal_id::text
    or (v_origin in ('KRW_DEPOSIT', 'WELCOME_REWARD', 'MINING_REWARD')
      and v_event.payload->>'currency' is distinct from 'KRW')
    or (v_origin = 'KRW_DEPOSIT' and (
      v_event.payload->>'wallet_ledger_id' is distinct from v_wallet_id::text
      or v_event.payload->>'requested_amount_atomic' is distinct from v_requested_amount::text))
    or (v_origin = 'MINING_REWARD' and (
      v_event.payload->>'wallet_ledger_id' is distinct from v_wallet_id::text))
    or (v_origin = 'WELCOME_REWARD'
      and v_event.payload->'funding_required' is distinct from 'false'::jsonb)
    or not exists (select 1 from public.wallet_accounts as a
      where a.id = v_wallet.wallet_account_id and a.user_id = v_owner and a.currency = 'KRW')
    or (select count(*) from public.ledger_entries where transaction_id = v_journal_id) <> 2
    or not exists (select 1 from public.ledger_entries as e
      join public.ledger_accounts as a on a.id = e.account_id
      where e.transaction_id = v_journal_id and e.sequence = 1 and e.side = 'CREDIT'
        and e.amount_atomic = v_amount and a.owner_user_id = v_owner
        and a.code = 'USER:' || upper(v_owner::text) || ':KRW:LIABILITY'
        and a.account_class = 'LIABILITY' and a.currency = 'KRW'
        and a.normal_side = 'CREDIT' and not a.is_controlled_asset)
    or not exists (select 1 from public.ledger_entries as e
      join public.ledger_accounts as a on a.id = e.account_id
      where e.transaction_id = v_journal_id and e.sequence = 0 and e.side = 'DEBIT'
        and e.amount_atomic = v_amount and a.currency = 'KRW'
        and a.code = (case
          when v_category = 'DEPOSIT' then 'PUTDUK:OPERATING_CASH:KRW'
          when v_category = 'MINING_REWARD' then 'PUTDUK:MINING_REWARD_EXPENSE:KRW'
          else 'PUTDUK:WELCOME_REWARD_EXPENSE:KRW' end)
        and a.normal_side = 'DEBIT' and a.is_controlled_asset = (v_category = 'DEPOSIT')
        and a.owner_user_id is null and a.account_class = (case
          when v_category = 'DEPOSIT' then 'ASSET'::public.ledger_account_class
          else 'EXPENSE'::public.ledger_account_class end))
  then
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_RECEIPT_UNVERIFIED';
  end if;
end;
$$;

create or replace function app_private.verified_mining_reward_remaining_atomic(p_user_id uuid)
returns bigint
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
    and app_private.money_source_credit_verified(movement);
  if v_credit is null or v_reserved is null or v_credit < 0 or v_reserved < 0
    or v_reserved > v_credit then
    raise exception using errcode = '22003', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  return v_credit - v_reserved;
end;
$$;

create or replace function app_private.assert_general_withdrawal_source_covers(
  p_user_id uuid,
  p_amount_atomic bigint,
  p_fee_atomic bigint
) returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_need bigint;
  v_mining bigint;
  v_principal bigint;
begin
  if p_amount_atomic is null or p_amount_atomic <= 0
    or p_fee_atomic is null or p_fee_atomic < 0 then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_REQUEST';
  end if;
  if p_amount_atomic > 9223372036854775807 - p_fee_atomic then
    raise exception using errcode = '22003', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  v_need := p_amount_atomic + p_fee_atomic;
  v_mining := app_private.verified_mining_reward_remaining_atomic(p_user_id);
  if v_mining > 0 and v_mining < v_need then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  if v_mining >= v_need then
    if p_fee_atomic <> 0 then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
    end if;
    return;
  end if;
  if p_fee_atomic <> 0 then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
  v_principal := app_private.verified_principal_remaining_atomic(p_user_id);
  if v_principal < v_need then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_SOURCE_INSUFFICIENT';
  end if;
end;
$$;

create function app_private.guard_mining_reward_withdrawal_reservation()
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
  where reservation.credit_movement_id = new.credit_movement_id;
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

create trigger mining_reward_withdrawal_reservations_guard
before insert on public.mining_reward_withdrawal_reservations
for each row execute function app_private.guard_mining_reward_withdrawal_reservation();

create function app_private.reserve_verified_mining_reward_newest_first(
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

create or replace function app_private.request_withdrawal_with_hold(
  p_user_id uuid,
  p_destination_id uuid,
  p_amount_krw bigint,
  p_expected_destination_type text,
  p_idempotency_key text,
  p_welcome_reward_conversion_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_destination public.withdrawal_destinations%rowtype;
  v_policy public.withdrawal_policies%rowtype;
  v_wallet_account_id uuid;
  v_available bigint;
  v_request_id uuid;
  v_correlation_id uuid := gen_random_uuid();
  v_cmd_request_id uuid := gen_random_uuid();
  v_hold_tx uuid;
  v_fee bigint;
  v_mining_path boolean := false;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_user_id is null
    or p_destination_id is null
    or p_amount_krw is null
    or p_amount_krw <= 0
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_REQUEST';
  end if;

  select request.id into v_request_id
  from public.withdrawal_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = p_idempotency_key;
  if v_request_id is not null then
    return v_request_id;
  end if;

  if p_welcome_reward_conversion_id is null then
    perform pg_advisory_xact_lock(
      hashtextextended('putduk-funding-recovery:' || p_user_id::text, 0));
    perform app_private.assert_general_withdrawal_source_present(p_user_id);
  elsif not exists (
    select 1
    from public.trial_reward_conversions as conversion
    join public.money_source_movements as movement
      on movement.ledger_transaction_id = conversion.ledger_transaction_id
    where conversion.id = p_welcome_reward_conversion_id
      and conversion.user_id = p_user_id
      and conversion.status = 'CONVERTED'
      and conversion.converted_amount_atomic = p_amount_krw
      and conversion.funding_required = false
      and movement.user_id = p_user_id
      and movement.source_bucket = 'BONUS'
      and movement.origin_code = 'WELCOME_REWARD'
      and movement.movement_kind = 'CREDIT'
      and movement.amount_atomic = p_amount_krw
      and movement.wallet_ledger_id = conversion.wallet_ledger_id
      and exists (
        select 1 from public.trial_qualification_snapshots as qualification
        where qualification.conversion_id = conversion.id
          and qualification.decision = 'APPROVED'
          and qualification.kyc_status = 'APPROVED'
          and qualification.rule_version = conversion.rule_version
          and qualification.risk_model_version = conversion.risk_model_version
      )
      and app_private.money_source_credit_verified(movement)
  ) then
    raise exception using errcode = '55000', message = 'WELCOME_REWARD_NOT_WITHDRAWABLE';
  end if;

  select destination.* into v_destination
  from public.withdrawal_destinations as destination
  where destination.id = p_destination_id
    and destination.user_id = p_user_id
    and destination.destination_type = p_expected_destination_type
    and destination.verification_status = 'VERIFIED'
    and destination.replaced_at is null
    and destination.protection_until <= statement_timestamp()
  for update;

  if v_destination.id is null then
    raise exception using errcode = '55000', message = 'VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED';
  end if;

  select policy.* into v_policy
  from public.withdrawal_policies as policy
  where policy.currency = 'KRW'
    and policy.destination_type = p_expected_destination_type
    and policy.is_enabled
    and policy.effective_at <= statement_timestamp()
    and (policy.expires_at is null or policy.expires_at > statement_timestamp())
    and (
      p_welcome_reward_conversion_id is null
      or (policy.allows_welcome_reward and policy.fee_atomic = 0)
    )
  order by policy.version desc
  limit 1;

  if v_policy.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_POLICY_UNAVAILABLE';
  end if;

  if p_amount_krw < v_policy.minimum_amount_atomic then
    raise exception using errcode = '22003', message = 'WITHDRAWAL_BELOW_MINIMUM';
  end if;

  if p_welcome_reward_conversion_id is not null and p_amount_krw > 5000 then
    raise exception using errcode = '22003', message = 'WELCOME_WITHDRAWAL_CAP_EXCEEDED';
  end if;

  v_fee := v_policy.fee_atomic;

  select account.id into v_wallet_account_id
  from public.wallet_accounts as account
  where account.user_id = p_user_id
    and account.currency = 'KRW'
    and account.closed_at is null
  for update;

  if v_wallet_account_id is null then
    raise exception using errcode = '55000', message = 'KRW_WALLET_NOT_FOUND';
  end if;

  v_available := app_private.available_krw_balance(v_wallet_account_id);
  if v_available < (p_amount_krw + v_fee) then
    raise exception using errcode = '22003', message = 'INSUFFICIENT_AVAILABLE_BALANCE';
  end if;

  if p_welcome_reward_conversion_id is null then
    perform app_private.assert_general_withdrawal_source_covers(
      p_user_id, p_amount_krw, v_fee);
    v_mining_path := app_private.verified_mining_reward_remaining_atomic(p_user_id)
      >= (p_amount_krw + v_fee);
  end if;

  insert into public.withdrawal_requests (
    wallet_account_id,
    withdrawal_policy_id,
    withdrawal_destination_id,
    welcome_reward_conversion_id,
    user_id,
    currency,
    amount_atomic,
    fee_atomic,
    destination_type,
    destination_snapshot,
    status,
    idempotency_key
  ) values (
    v_wallet_account_id,
    v_policy.id,
    v_destination.id,
    p_welcome_reward_conversion_id,
    p_user_id,
    'KRW',
    p_amount_krw,
    v_fee,
    p_expected_destination_type,
    jsonb_build_object(
      'destination_id', v_destination.id,
      'display', v_destination.display_hint,
      'verified_at', v_destination.verified_at
    ),
    'REQUESTED',
    p_idempotency_key
  ) returning id into v_request_id;

  v_hold_tx := app_private.post_withdrawal_hold(
    p_user_id,
    v_request_id,
    p_amount_krw + v_fee,
    p_idempotency_key,
    v_cmd_request_id
  );

  update public.withdrawal_requests
  set
    status = 'HELD',
    hold_ledger_transaction_id = v_hold_tx,
    hold_posted_at = statement_timestamp()
  where id = v_request_id;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_REQUESTED.v1',
    1,
    'withdrawal_request',
    v_request_id,
    p_user_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'amount_atomic', p_amount_krw::text,
      'fee_atomic', v_fee::text,
      'currency', 'KRW',
      'destination_type', p_expected_destination_type,
      'hold_ledger_transaction_id', v_hold_tx,
      'welcome_reward', p_welcome_reward_conversion_id is not null
    ),
    v_correlation_id,
    v_cmd_request_id,
    p_idempotency_key || ':event'
  );

  insert into public.transaction_receipts (
    receipt_number, user_id, transaction_type, source_type, source_id,
    amount_atomic, currency, status, requested_at, status_timeline
  ) values (
    'PDK-WD-' || upper(replace(v_request_id::text, '-', '')),
    p_user_id,
    case
      when p_welcome_reward_conversion_id is not null then 'WELCOME_REWARD_WITHDRAWAL'
      else 'WITHDRAWAL'
    end,
    'withdrawal_request',
    v_request_id,
    p_amount_krw,
    'KRW',
    'HELD',
    statement_timestamp(),
    jsonb_build_array(
      jsonb_build_object('status', 'REQUESTED', 'at', statement_timestamp()),
      jsonb_build_object('status', 'HELD', 'at', statement_timestamp())
    )
  )
  on conflict (source_type, source_id) do nothing;

  if p_welcome_reward_conversion_id is null then
    if v_mining_path then
      perform app_private.reserve_verified_mining_reward_newest_first(
        p_user_id, v_hold_tx);
    else
      perform app_private.apply_principal_recovery_newest_first(p_user_id, v_hold_tx);
    end if;
  end if;

  return v_request_id;
end;
$$;

revoke all on function app_private.guard_mining_reward_withdrawal_reservation()
  from public, anon, authenticated, service_role;
grant execute on function app_private.guard_mining_reward_withdrawal_reservation()
  to service_role;
revoke all on function app_private.reserve_verified_mining_reward_newest_first(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.reserve_verified_mining_reward_newest_first(uuid, uuid)
  to service_role;

comment on function app_private.assert_general_withdrawal_source_covers(uuid, bigint, bigint) is
  '수수료 0일 때 검증된 채굴 수익 전액 또는 검증된 원금 전액만 통과한다. 한 출금에 섞지 않는다.';

comment on function app_private.reserve_verified_mining_reward_newest_first(uuid, uuid) is
  '검증된 MINING_REWARD CREDIT만 최신순으로 예약한다. 원금과 BONUS는 쓰지 않는다.';

comment on table public.mining_reward_withdrawal_reservations is
  '수수료 0 출금 hold에 묶인 검증된 채굴 수익 예약. release와 finalize 행은 없다.';

commit;
