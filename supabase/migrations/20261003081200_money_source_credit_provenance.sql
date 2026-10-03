begin;

-- Prospective provenance only. No history scan, balance write or rule activation.
create table app_private.money_source_epochs (
  version integer primary key check (version = 1),
  introduced_at timestamptz not null default clock_timestamp()
);
insert into app_private.money_source_epochs(version) values (1);
revoke all on app_private.money_source_epochs from public, anon, authenticated, service_role;
grant select on app_private.money_source_epochs to service_role;

create table public.money_source_movements (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version = 1),
  user_id uuid not null references auth.users(id) on delete restrict,
  source_bucket text not null check (source_bucket in (
    'PRINCIPAL', 'MINING_REWARD', 'BONUS', 'OTHER_NON_PRINCIPAL'
  )),
  movement_kind text not null check (movement_kind in (
    'CREDIT', 'RESERVE', 'RELEASE', 'FINALIZE', 'REVERSE'
  )),
  origin_code text not null check (btrim(origin_code) <> ''),
  amount_atomic bigint not null check (amount_atomic > 0),
  ledger_transaction_id uuid not null references public.ledger_transactions(id) on delete restrict,
  wallet_ledger_id uuid references public.wallet_ledger(id) on delete restrict,
  source_event_id uuid not null references public.outbox_events(id) on delete restrict,
  effective_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  unique (ledger_transaction_id, source_bucket, movement_kind),
  unique (wallet_ledger_id, source_bucket, movement_kind),
  unique (source_event_id, source_bucket, movement_kind),
  check (movement_kind <> 'CREDIT' or wallet_ledger_id is not null)
);
create index money_source_movements_owner_time
  on public.money_source_movements(user_id, effective_at, id);
alter table public.money_source_movements enable row level security;
alter table public.money_source_movements force row level security;
revoke all on public.money_source_movements from public, anon, authenticated, service_role;
grant select, insert on public.money_source_movements to service_role;
create trigger money_source_movements_append_only
before update or delete on public.money_source_movements
for each row execute function app_private.prevent_row_mutation();

-- Only three original command receipts are supported in this capture phase.
-- Future withdrawal/correction kinds remain closed, including to service_role.
create function app_private.assert_money_source_credit(p_move public.money_source_movements)
returns void language plpgsql security invoker set search_path = pg_catalog
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
  else
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_COMMAND_NOT_CONNECTED';
  end if;
  -- The three frozen producers use the same base key for these receipts.
  -- Deposit request keys are separate from approval keys; only START stores it
  -- on the terminal domain row itself.
  v_command_key := left(v_journal.idempotency_key, length(v_journal.idempotency_key) - 7);
  if v_owner is null or v_amount is null or v_amount <= 0
    or p_move.user_id is distinct from v_owner or p_move.amount_atomic is distinct from v_amount
    or p_move.origin_code is distinct from v_origin or p_move.source_bucket is distinct from v_bucket
    or p_move.ledger_transaction_id is distinct from v_journal_id
    or p_move.wallet_ledger_id is distinct from v_wallet_id
    or p_move.effective_at is distinct from v_journal.posted_at
    or v_journal.member_user_id is distinct from v_owner
    -- The frozen START conversion has no journal created_by; its owner is
    -- verified against the actual conversion and event above. Deposits do.
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
    or (v_origin in ('KRW_DEPOSIT', 'WELCOME_REWARD')
      and v_event.payload->>'currency' is distinct from 'KRW')
    or (v_origin = 'KRW_DEPOSIT' and (
      v_event.payload->>'wallet_ledger_id' is distinct from v_wallet_id::text
      or v_event.payload->>'requested_amount_atomic' is distinct from v_requested_amount::text))
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
        and a.code = (case when v_category = 'DEPOSIT' then 'PUTDUK:OPERATING_CASH:KRW'
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
revoke all on function app_private.assert_money_source_credit(public.money_source_movements)
  from public, anon, authenticated;
grant execute on function app_private.assert_money_source_credit(public.money_source_movements) to service_role;

create function app_private.guard_money_source_movement()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  perform app_private.assert_money_source_credit(new);
  return new;
end;
$$;
revoke all on function app_private.guard_money_source_movement() from public, anon, authenticated;
grant execute on function app_private.guard_money_source_movement() to service_role;
create trigger money_source_movements_validate_receipt
before insert on public.money_source_movements
for each row execute function app_private.guard_money_source_movement();

create function app_private.capture_money_source_credit()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_journal public.ledger_transactions%rowtype;
  v_wallet_id uuid;
  v_amount bigint;
  v_owner uuid;
  v_bucket text;
  v_origin text;
begin
  if new.schema_version <> 1 or not (
    (new.event_type = 'DEPOSIT_CONFIRMED.v1' and new.aggregate_type = 'deposit_request')
    or (new.event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1' and new.aggregate_type = 'usdt_manual_deposit')
    or (new.event_type = 'TRIAL_REWARD_CONVERTED.v1' and new.aggregate_type = 'trial_reward_conversion')
  ) then return new; end if;
  if new.event_type = 'DEPOSIT_CONFIRMED.v1' then
    select user_id, approved_amount_atomic, wallet_ledger_id into v_owner, v_amount, v_wallet_id
      from public.deposit_requests where id = new.aggregate_id;
    v_bucket := 'PRINCIPAL'; v_origin := 'KRW_DEPOSIT';
  elsif new.event_type = 'USDT_MANUAL_DEPOSIT_CONFIRMED.v1' then
    select user_id, credited_krw, wallet_ledger_id into v_owner, v_amount, v_wallet_id
      from public.usdt_manual_deposits where id = new.aggregate_id;
    v_bucket := 'PRINCIPAL'; v_origin := 'USDT_KRW_DEPOSIT';
  else
    select user_id, converted_amount_atomic, wallet_ledger_id into v_owner, v_amount, v_wallet_id
      from public.trial_reward_conversions where id = new.aggregate_id;
    v_bucket := 'BONUS'; v_origin := 'WELCOME_REWARD';
  end if;
  select * into v_journal from public.ledger_transactions
    where id = nullif(new.payload->>'ledger_transaction_id', '')::uuid;
  -- Never retroactively classify a pre-migration journal, even if a later event is inserted.
  if v_journal.id is not null and v_journal.created_at <
    (select introduced_at from app_private.money_source_epochs where version = 1)
  then return new; end if;
  if v_owner is null or v_amount is null or v_wallet_id is null or v_journal.id is null then
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_RECEIPT_UNVERIFIED';
  end if;
  insert into public.money_source_movements (
    user_id, source_bucket, movement_kind, origin_code, amount_atomic,
    ledger_transaction_id, wallet_ledger_id, source_event_id, effective_at
  ) values (
    v_owner, v_bucket, 'CREDIT', v_origin, v_amount,
    v_journal.id, v_wallet_id, new.id, v_journal.posted_at
  );
  return new;
end;
$$;
revoke all on function app_private.capture_money_source_credit() from public, anon, authenticated;
grant execute on function app_private.capture_money_source_credit() to service_role;
create trigger outbox_capture_money_source_credit
after insert on public.outbox_events
for each row execute function app_private.capture_money_source_credit();

-- Audit and COMPLETED command keys are written after the original event.
-- Check them only at transaction completion or on final readback, never inside
-- the event INSERT trigger. START has neither an audit INSERT nor a command-key
-- record in its frozen producer; its conversion key is checked above instead.
create function app_private.assert_money_source_credit_complete(p_move public.money_source_movements)
returns void language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_event public.outbox_events%rowtype;
  v_journal public.ledger_transactions%rowtype;
  v_wallet public.wallet_ledger%rowtype;
  v_command_key text;
begin
  perform app_private.assert_money_source_credit(p_move);
  select * into v_event from public.outbox_events where id = p_move.source_event_id;
  select * into v_journal from public.ledger_transactions where id = p_move.ledger_transaction_id;
  select * into v_wallet from public.wallet_ledger where id = p_move.wallet_ledger_id;
  v_command_key := left(v_journal.idempotency_key, length(v_journal.idempotency_key) - 7);
  if (select count(*) from public.outbox_events as event
    where event.event_type = v_event.event_type and event.schema_version = 1
      and event.aggregate_type = v_event.aggregate_type and event.aggregate_id = v_event.aggregate_id) <> 1
  then
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_RECEIPT_UNVERIFIED';
  end if;
  if p_move.origin_code = 'KRW_DEPOSIT' then
    if (select count(*) from public.audit_logs as audit
      where audit.action = 'deposit.approve' and audit.target_type = 'deposit_request'
        and audit.target_id = v_event.aggregate_id::text and audit.actor_user_id = v_event.actor_user_id
        and audit.actor_role in ('SUPER_ADMIN', 'ADMIN') and audit.request_id = v_journal.request_id
        and btrim(audit.reason) = btrim(v_wallet.reason)
        and audit.metadata->>'operation' = 'approve_deposit_request'
        and audit.metadata->>'wallet_ledger_id' = v_wallet.id::text
        and audit.metadata->>'ledger_transaction_id' = v_journal.id::text
        and audit.metadata->>'approved_amount_atomic' = p_move.amount_atomic::text) <> 1
      or not exists (select 1 from app_private.idempotency_keys as command
        where command.scope = 'deposit.approve' and command.actor_id = v_event.actor_user_id
          and command.idempotency_key = v_command_key and command.status = 'COMPLETED'
          and command.response_payload->>'wallet_ledger_id' = v_wallet.id::text
          and command.response_payload->>'ledger_transaction_id' = v_journal.id::text)
    then
      raise exception using errcode = '55000', message = 'MONEY_SOURCE_RECEIPT_UNVERIFIED';
    end if;
  elsif p_move.origin_code = 'USDT_KRW_DEPOSIT' then
    if (select count(*) from public.audit_logs as audit
      where audit.action = 'usdt_manual_deposit.confirm' and audit.target_type = 'usdt_manual_deposit'
        and audit.target_id = v_event.aggregate_id::text and audit.actor_user_id = v_event.actor_user_id
        and audit.actor_role in ('SUPER_ADMIN', 'ADMIN') and audit.request_id = v_journal.request_id
        and btrim(audit.reason) = btrim(v_wallet.reason)
        and audit.after_state->>'ledger_transaction_id' = v_journal.id::text
        and audit.after_state->>'credited_krw' = p_move.amount_atomic::text) <> 1
      or not exists (select 1 from app_private.idempotency_keys as command
        where command.scope = 'usdt_manual_deposit.confirm' and command.actor_id is null
          and command.idempotency_key = v_command_key and command.status = 'COMPLETED'
          and command.response_payload->>'ledger_transaction_id' = v_journal.id::text
          and command.response_payload->>'credited_krw' = p_move.amount_atomic::text)
    then
      raise exception using errcode = '55000', message = 'MONEY_SOURCE_RECEIPT_UNVERIFIED';
    end if;
  end if;
end;
$$;
revoke all on function app_private.assert_money_source_credit_complete(public.money_source_movements)
  from public, anon, authenticated;
grant execute on function app_private.assert_money_source_credit_complete(public.money_source_movements) to service_role;

-- An AFTER INSERT capture alone cannot catch the KRW producer's outbox
-- ON CONFLICT DO NOTHING. These guards require the terminal domain receipt to
-- have one verified source before the same money transaction can commit.
create function app_private.guard_money_source_terminal_receipt()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_journal_id uuid;
  v_wallet_id uuid;
  v_origin text;
  v_created_at timestamptz;
  v_epoch timestamptz;
  v_aggregate_type text;
  v_move public.money_source_movements%rowtype;
begin
  if tg_table_name = 'deposit_requests' then
    select ledger_transaction_id, wallet_ledger_id into v_journal_id, v_wallet_id
      from public.deposit_requests where id = new.id and status = 'APPROVED' and currency = 'KRW';
    v_origin := 'KRW_DEPOSIT';
    v_aggregate_type := 'deposit_request';
  elsif tg_table_name = 'usdt_manual_deposits' then
    select ledger_transaction_id, wallet_ledger_id into v_journal_id, v_wallet_id
      from public.usdt_manual_deposits where id = new.id and status = 'CONFIRMED';
    v_origin := 'USDT_KRW_DEPOSIT';
    v_aggregate_type := 'usdt_manual_deposit';
  elsif tg_table_name = 'trial_reward_conversions' then
    select ledger_transaction_id, wallet_ledger_id into v_journal_id, v_wallet_id
      from public.trial_reward_conversions where id = new.id and status = 'CONVERTED';
    v_origin := 'WELCOME_REWARD';
    v_aggregate_type := 'trial_reward_conversion';
  else
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_COMMAND_NOT_CONNECTED';
  end if;
  select introduced_at into v_epoch from app_private.money_source_epochs where version = 1;
  select created_at into v_created_at from public.ledger_transactions where id = v_journal_id;
  -- Historical receipts stay unclassified. Do not add audit/key requirements
  -- to pre-capture journals or reconstruct them from a later retry.
  if v_epoch is not null and v_created_at < v_epoch then return null; end if;
  if v_epoch is null or v_journal_id is null or v_wallet_id is null or v_created_at is null
    or (select count(*) from public.money_source_movements as movement
      join public.outbox_events as event on event.id = movement.source_event_id
      where movement.ledger_transaction_id = v_journal_id and movement.wallet_ledger_id = v_wallet_id
        and movement.movement_kind = 'CREDIT' and movement.origin_code = v_origin
        and event.aggregate_type = v_aggregate_type and event.aggregate_id = new.id) <> 1
  then
    raise exception using errcode = '55000', message = 'MONEY_SOURCE_CAPTURE_INCOMPLETE';
  end if;
  select movement.* into v_move from public.money_source_movements as movement
    join public.outbox_events as event on event.id = movement.source_event_id
    where movement.ledger_transaction_id = v_journal_id and movement.wallet_ledger_id = v_wallet_id
      and movement.movement_kind = 'CREDIT' and movement.origin_code = v_origin
      and event.aggregate_type = v_aggregate_type and event.aggregate_id = new.id;
  perform app_private.assert_money_source_credit_complete(v_move);
  return null;
end;
$$;
revoke all on function app_private.guard_money_source_terminal_receipt() from public, anon, authenticated;
grant execute on function app_private.guard_money_source_terminal_receipt() to service_role;
create constraint trigger deposit_requests_money_source_complete
after insert or update on public.deposit_requests deferrable initially deferred
for each row when (new.status = 'APPROVED' and new.currency = 'KRW')
execute function app_private.guard_money_source_terminal_receipt();
create constraint trigger usdt_manual_deposits_money_source_complete
after insert or update on public.usdt_manual_deposits deferrable initially deferred
for each row when (new.status = 'CONFIRMED')
execute function app_private.guard_money_source_terminal_receipt();
create constraint trigger trial_reward_conversions_money_source_complete
after insert or update on public.trial_reward_conversions deferrable initially deferred
for each row when (new.status = 'CONVERTED')
execute function app_private.guard_money_source_terminal_receipt();

-- Admin-only projection. Unknown wallet entries or any unconnected withdrawal
-- block eligible principal rather than assuming withdrawals spent rewards first.
create function app_private.money_source_credit_verified(p_move public.money_source_movements)
returns boolean language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  perform app_private.assert_money_source_credit_complete(p_move);
  return true;
exception when sqlstate '55000' then
  return false;
end;
$$;
revoke all on function app_private.money_source_credit_verified(public.money_source_movements)
  from public, anon, authenticated;
grant execute on function app_private.money_source_credit_verified(public.money_source_movements) to service_role;

create view public.money_source_summaries with (security_invoker = true) as
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
  select count(*) as unconnected_withdrawals from public.withdrawal_requests
  where user_id = a.user_id and currency = 'KRW'
) as w
cross join lateral (
  select count(*) as unclassified_journals from public.ledger_transactions as journal
  join (
    -- Both paths are bounded by this member: the header owner index, or the
    -- account owner index followed by the entry account index. Include closed
    -- accounts and deduplicate journals; header metadata alone is not proof.
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
revoke all on public.money_source_summaries from public, anon, authenticated, service_role;
grant select on public.money_source_summaries to service_role;

comment on table public.money_source_movements is
  'Append-only provenance projection linked to original balanced KRW receipts; never a separate wallet. V1 capture supports new KRW/USDT principal and welcome BONUS only; no legacy backfill or economic activation.';
comment on view public.money_source_summaries is
  'Server-only source coverage. Eligible principal is NULL for unclassified wallet history or unconnected withdrawal provenance. Recorded totals are capture-period evidence, not lifetime statistics.';
commit;
