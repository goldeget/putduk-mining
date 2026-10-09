begin;

-- Fold captured principal reservations, releases and finalizations separately.
-- FINALIZE consumes held principal; it never subtracts available principal twice.
-- Cumulative deposit evidence is preserved and unresolved histories stay NULL.
-- No migration backfills or edits a historical receipt or principal lot.

create or replace view public.money_source_summaries with (security_invoker = true) as
select a.user_id, 2 as schema_version,
  m.unclassified_wallet_entries::text as unclassified_wallet_entries,
  w.unconnected_withdrawals::text as unconnected_withdrawals,
  j.unclassified_journals::text as unclassified_journals,
  (c.invalid_source_receipts + p.invalid_fold)::text as invalid_source_receipts,
  case when m.unclassified_wallet_entries + w.unconnected_withdrawals
    + j.unclassified_journals + c.invalid_source_receipts + p.invalid_fold = 0
    then 'COMPLETE' else 'UNRESOLVED' end as coverage,
  case when m.unclassified_wallet_entries + w.unconnected_withdrawals
    + j.unclassified_journals + c.invalid_source_receipts + p.invalid_fold = 0
    then p.available::text end as eligible_principal_atomic,
  c.krw_deposits::text as recorded_krw_principal_deposits_atomic,
  c.usdt_credits::text as recorded_usdt_principal_credits_atomic,
  c.bonus::text as recorded_bonus_atomic,
  statement_timestamp() as observed_at,
  (select introduced_at from app_private.money_source_epochs where version = 1) as capture_started_at,
  case when m.unclassified_wallet_entries + w.unconnected_withdrawals
    + j.unclassified_journals + c.invalid_source_receipts + p.invalid_fold = 0
    then p.held::text end as held_principal_atomic,
  case when m.unclassified_wallet_entries + w.unconnected_withdrawals
    + j.unclassified_journals + c.invalid_source_receipts + p.invalid_fold = 0
    then c.principal_finalized::text end as recovered_principal_atomic
from public.wallet_accounts as a
cross join lateral (
  select coalesce(sum(amount_atomic) filter (where verified and source_bucket = 'PRINCIPAL' and movement_kind = 'CREDIT'), 0) as principal,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'KRW_DEPOSIT' and movement_kind = 'CREDIT'), 0) as krw_deposits,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'USDT_KRW_DEPOSIT' and movement_kind = 'CREDIT'), 0) as usdt_credits,
    coalesce(sum(amount_atomic) filter (where verified and source_bucket = 'BONUS' and movement_kind = 'CREDIT'), 0) as bonus,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'PRINCIPAL_RECOVERY_HOLD'
      and movement_kind = 'RESERVE'), 0) as principal_reserved,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'PRINCIPAL_RECOVERY_RELEASE'
      and movement_kind = 'RELEASE'), 0) as principal_released,
    coalesce(sum(amount_atomic) filter (where verified and origin_code = 'PRINCIPAL_RECOVERY_FINALIZE'
      and movement_kind = 'FINALIZE'), 0) as principal_finalized,
    count(*) filter (where not verified) as invalid_source_receipts
  from (select amount_atomic, source_bucket, origin_code, movement_kind,
      app_private.money_source_credit_verified(movement) as verified
    from public.money_source_movements as movement where user_id = a.user_id) as checked
) as c
cross join lateral (
  select c.principal - c.principal_reserved + c.principal_released as available,
    c.principal_reserved - c.principal_released - c.principal_finalized as held,
    case when c.principal - c.principal_reserved + c.principal_released < 0
      or c.principal_reserved - c.principal_released - c.principal_finalized < 0
      then 1 else 0 end as invalid_fold
) as p
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

create or replace function app_private.read_funding_principal_foundation(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_coverage text;
  v_eligible_text text;
  v_cumulative_text text;
  v_minimum_text text;
  v_minimum_krw bigint;
  v_minimum_micro bigint;
  v_lot_atomic bigint;
  v_lot_count integer;
  v_epoch timestamptz;
  v_status text;
  v_net bigint;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND';
  end if;
  select summary.coverage, summary.eligible_principal_atomic,
    (summary.recorded_krw_principal_deposits_atomic::numeric
      + summary.recorded_usdt_principal_credits_atomic::numeric)::text
  into v_coverage, v_eligible_text, v_cumulative_text
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
  select coalesce(sum(lot.amount_atomic), 0), count(*)::integer
  into v_lot_atomic, v_lot_count
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
    or v_cumulative_text::bigint is distinct from v_lot_atomic
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
  if v_net % 1000000 <> 0 or v_net / 1000000 <> v_eligible_text::bigint then
    raise exception using errcode = '55000', message = 'FUNDING_PRINCIPAL_LOT_MISMATCH';
  end if;
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

create or replace function app_private.verified_principal_remaining_atomic(p_user_id uuid)
returns bigint
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_coverage text;
  v_available text;
  v_micro bigint;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_REQUEST';
  end if;
  select coverage, eligible_principal_atomic into v_coverage, v_available
  from public.money_source_summaries where user_id = p_user_id;
  if v_coverage is distinct from 'COMPLETE' or v_available is null then
    raise exception using errcode = '55000',
      message = 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE';
  end if;
  v_micro := app_private.funding_principal_mining_eligible_micro(
    p_user_id, statement_timestamp());
  if v_micro is null or v_micro < 0 or v_micro % 1000000 <> 0
    or v_micro / 1000000 is distinct from v_available::bigint then
    raise exception using errcode = '55000', message = 'FUNDING_PRINCIPAL_LOT_MISMATCH';
  end if;
  return v_micro / 1000000;
end;
$$;

commit;
