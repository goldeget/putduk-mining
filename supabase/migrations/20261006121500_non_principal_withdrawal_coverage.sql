begin;

-- Coverage reads the existing immutable reservation/conversion and command
-- receipts. It never inserts a source movement, wallet debit, or old backfill.
-- Only the frozen zero-fee MINING_REWARD and qualified START paths are covered.

create function app_private.withdrawal_coverage_entries_verified(
  p_journal_id uuid, p_user_id uuid, p_amount_atomic bigint, p_phase text
) returns boolean
language sql stable security invoker set search_path = pg_catalog
as $$
  select p_amount_atomic > 0 and p_phase in ('HOLD', 'RELEASE', 'FINALIZE')
    and (select count(*) from public.ledger_entries where transaction_id = p_journal_id) = 2
    and exists (
      select 1 from public.ledger_entries entry
      join public.ledger_accounts account on account.id = entry.account_id
      where entry.transaction_id = p_journal_id and entry.sequence = 0
        and entry.side = 'DEBIT' and entry.amount_atomic = p_amount_atomic
        and account.currency = 'KRW' and not account.is_controlled_asset
        and account.normal_side = 'CREDIT'
        and account.code = case when p_phase = 'HOLD'
          then 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY'
          else 'PUTDUK:WITHDRAWAL_HOLD:KRW' end
        and account.account_class::text = case when p_phase = 'HOLD' then 'LIABILITY' else 'CLEARING' end
        and account.owner_user_id is not distinct from case when p_phase = 'HOLD' then p_user_id end
    ) and exists (
      select 1 from public.ledger_entries entry
      join public.ledger_accounts account on account.id = entry.account_id
      where entry.transaction_id = p_journal_id and entry.sequence = 1
        and entry.side = 'CREDIT' and entry.amount_atomic = p_amount_atomic
        and account.currency = 'KRW'
        and account.code = case p_phase
          when 'HOLD' then 'PUTDUK:WITHDRAWAL_HOLD:KRW'
          when 'RELEASE' then 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY'
          else 'PUTDUK:OPERATING_CASH:KRW' end
        and account.account_class::text = case p_phase
          when 'HOLD' then 'CLEARING' when 'RELEASE' then 'LIABILITY' else 'ASSET' end
        and account.normal_side::text = case when p_phase = 'FINALIZE' then 'DEBIT' else 'CREDIT' end
        and account.is_controlled_asset = (p_phase = 'FINALIZE')
        and account.owner_user_id is not distinct from case when p_phase = 'RELEASE' then p_user_id end
    );
$$;

create function app_private.non_principal_withdrawal_coverage_verified(
  p_request public.withdrawal_requests
) returns boolean
-- Existing verified-source assertions are VOLATILE readers. Match their
-- snapshot contract; this function still performs SELECTs only, with no writes.
language plpgsql volatile security invoker set search_path = pg_catalog
as $$
declare
  v_hold public.ledger_transactions%rowtype;
  v_terminal public.ledger_transactions%rowtype;
  v_conversion public.trial_reward_conversions%rowtype;
  v_phase text;
  v_operation text;
  v_key text;
  v_wallet_id uuid;
  v_reserved numeric;
  v_welcome boolean := p_request.welcome_reward_conversion_id is not null;
begin
  if p_request.id is null or p_request.user_id is null
    or p_request.currency::text is distinct from 'KRW'
    or p_request.amount_atomic is null or p_request.amount_atomic <= 0
    or p_request.fee_atomic is distinct from 0
    or p_request.destination_type not in ('KRW_BANK', 'USDT_ADDRESS')
    or p_request.hold_ledger_transaction_id is null
    or p_request.hold_posted_at is null
    or not exists (select 1 from public.wallet_accounts account
      where account.id = p_request.wallet_account_id
        and account.user_id = p_request.user_id and account.currency = 'KRW')
    or exists (select 1 from public.funding_principal_recovery_allocations allocation
      where allocation.hold_ledger_transaction_id = p_request.hold_ledger_transaction_id)
  then return false; end if;

  select * into v_hold from public.ledger_transactions
  where id = p_request.hold_ledger_transaction_id;
  if v_hold.id is null or v_hold.category::text is distinct from 'WITHDRAWAL'
    or v_hold.currency::text is distinct from 'KRW'
    or v_hold.member_user_id is distinct from p_request.user_id
    or v_hold.reference_type is distinct from 'withdrawal_request'
    or v_hold.reference_id is distinct from p_request.id
    or v_hold.metadata->>'phase' is distinct from 'HOLD'
    or v_hold.metadata->>'amount_atomic' is distinct from p_request.amount_atomic::text
    or v_hold.idempotency_key is distinct from p_request.idempotency_key || ':hold'
    or v_hold.request_id is null or v_hold.correlation_id is null
    or v_hold.created_at < (select introduced_at from app_private.money_source_epochs where version = 1)
    or not app_private.withdrawal_coverage_entries_verified(
      v_hold.id, p_request.user_id, p_request.amount_atomic, 'HOLD')
    or (select count(*) from public.outbox_events event
      where event.event_type = 'WITHDRAWAL_REQUESTED.v1' and event.schema_version = 1
        and event.aggregate_type = 'withdrawal_request' and event.aggregate_id = p_request.id
        and event.actor_user_id = p_request.user_id and event.request_id = v_hold.request_id
        and event.idempotency_key = p_request.idempotency_key || ':event'
        and event.payload->>'user_id' = p_request.user_id::text
        and event.payload->>'amount_atomic' = p_request.amount_atomic::text
        and event.payload->>'fee_atomic' = '0' and event.payload->>'currency' = 'KRW'
        and event.payload->>'destination_type' = p_request.destination_type
        and event.payload->>'hold_ledger_transaction_id' = v_hold.id::text
        and event.payload->'welcome_reward' = to_jsonb(v_welcome)) <> 1
    or (select count(*) from public.transaction_receipts receipt
      where receipt.source_type = 'withdrawal_request' and receipt.source_id = p_request.id
        and receipt.user_id = p_request.user_id and receipt.currency = 'KRW'
        and receipt.amount_atomic = p_request.amount_atomic
        and receipt.transaction_type = case when v_welcome then 'WELCOME_REWARD_WITHDRAWAL' else 'WITHDRAWAL' end) <> 1
  then return false; end if;

  if v_welcome then
    select * into v_conversion from public.trial_reward_conversions
    where id = p_request.welcome_reward_conversion_id;
    if v_conversion.id is null or v_conversion.user_id is distinct from p_request.user_id
      or v_conversion.status::text is distinct from 'CONVERTED'
      or v_conversion.converted_amount_atomic is distinct from p_request.amount_atomic
      or v_conversion.funding_required is distinct from false
      or p_request.amount_atomic > 5000
      or (select count(*) from public.withdrawal_requests request
        where request.welcome_reward_conversion_id = v_conversion.id) <> 1
      or exists (select 1 from public.mining_reward_withdrawal_reservations reservation
        where reservation.hold_ledger_transaction_id = v_hold.id)
      or not exists (select 1 from public.trial_qualification_snapshots qualification
        where qualification.conversion_id = v_conversion.id
          and qualification.decision = 'APPROVED' and qualification.kyc_status = 'APPROVED'
          and qualification.rule_version = v_conversion.rule_version
          and qualification.risk_model_version = v_conversion.risk_model_version)
      or (select count(*) from public.money_source_movements movement
        where movement.user_id = p_request.user_id and movement.source_bucket = 'BONUS'
          and movement.movement_kind = 'CREDIT' and movement.origin_code = 'WELCOME_REWARD'
          and movement.amount_atomic = p_request.amount_atomic
          and movement.ledger_transaction_id = v_conversion.ledger_transaction_id
          and movement.wallet_ledger_id = v_conversion.wallet_ledger_id
          and app_private.money_source_credit_verified(movement)) <> 1
    then return false; end if;
  else
    select coalesce(sum(reservation.amount_atomic), 0) into v_reserved
    from public.mining_reward_withdrawal_reservations reservation
    where reservation.hold_ledger_transaction_id = v_hold.id;
    if v_reserved is distinct from p_request.amount_atomic::numeric
      or exists (
        select 1 from public.mining_reward_withdrawal_reservations reservation
        left join public.money_source_movements credit on credit.id = reservation.credit_movement_id
        where reservation.hold_ledger_transaction_id = v_hold.id
          and (reservation.user_id is distinct from p_request.user_id
            or credit.user_id is distinct from p_request.user_id
            or credit.source_bucket is distinct from 'MINING_REWARD'
            or credit.movement_kind is distinct from 'CREDIT'
            or not app_private.money_source_credit_verified(credit))
      )
    then return false; end if;
  end if;

  if p_request.status in ('COMPLETED', 'CANCELLED', 'REJECTED') then
    if p_request.status = 'COMPLETED' then
      if p_request.finalize_ledger_transaction_id is null
        or p_request.release_ledger_transaction_id is not null
        or p_request.ledger_finalized_at is null
        or not exists (select 1 from public.withdrawal_external_sends send
          where send.withdrawal_id = p_request.id and send.method = p_request.destination_type)
      then return false; end if;
      v_phase := 'FINALIZE'; v_operation := 'finalize_withdrawal_ledger';
      select * into v_terminal from public.ledger_transactions
      where id = p_request.finalize_ledger_transaction_id;
      v_key := left(v_terminal.idempotency_key, length(v_terminal.idempotency_key) - 9);
      if right(v_terminal.idempotency_key, 9) is distinct from ':finalize'
        or (select count(*) from public.wallet_ledger projection
          where projection.reference_type = 'withdrawal_request' and projection.reference_id = p_request.id) <> 1
      then return false; end if;
      select projection.id into v_wallet_id from public.wallet_ledger projection
      where projection.user_id = p_request.user_id and projection.wallet_account_id = p_request.wallet_account_id
        and projection.direction = 'DEBIT' and projection.entry_type::text = 'WITHDRAWAL'
        and projection.amount_atomic = p_request.amount_atomic
        and projection.reference_type = 'withdrawal_request' and projection.reference_id = p_request.id
        and projection.idempotency_key = v_key || ':wallet'
        and projection.created_by = v_terminal.created_by;
      if v_wallet_id is null
        or not exists (select 1 from public.transaction_receipts receipt
          where receipt.source_type = 'withdrawal_request' and receipt.source_id = p_request.id
            and receipt.status = 'COMPLETED' and receipt.ledger_transaction_id = v_terminal.id)
        or (select count(*) from public.outbox_events event
          where event.event_type = 'WITHDRAWAL_COMPLETED.v1' and event.schema_version = 1
            and event.aggregate_type = 'withdrawal_request' and event.aggregate_id = p_request.id
            and event.actor_user_id = v_terminal.created_by and event.request_id = v_terminal.request_id
            and event.idempotency_key = v_key || ':event'
            and event.payload->>'finalize_ledger_transaction_id' = v_terminal.id::text
            and event.payload->>'amount_atomic' = p_request.amount_atomic::text) <> 1
      then return false; end if;
    else
      if p_request.release_ledger_transaction_id is null
        or p_request.finalize_ledger_transaction_id is not null
        or p_request.hold_released_at is null
        or exists (select 1 from public.withdrawal_external_sends send where send.withdrawal_id = p_request.id)
        or exists (select 1 from public.wallet_ledger projection
          where projection.reference_type = 'withdrawal_request' and projection.reference_id = p_request.id)
      then return false; end if;
      v_phase := 'RELEASE'; v_operation := 'release_withdrawal_hold';
      select * into v_terminal from public.ledger_transactions
      where id = p_request.release_ledger_transaction_id;
      v_key := left(v_terminal.idempotency_key, length(v_terminal.idempotency_key) - 8);
      if right(v_terminal.idempotency_key, 8) is distinct from ':release'
        or v_terminal.category::text is distinct from 'REVERSAL'
        or v_terminal.reversal_of_transaction_id is distinct from v_hold.id
        or v_terminal.metadata->>'disposition' is distinct from p_request.status::text
        or v_terminal.metadata->>'reason' is distinct from p_request.rejection_reason
        or (select count(*) from public.outbox_events event
          where event.event_type = 'WITHDRAWAL_HOLD_RELEASED.v1' and event.schema_version = 1
            and event.aggregate_type = 'withdrawal_request' and event.aggregate_id = p_request.id
            and event.actor_user_id = v_terminal.created_by and event.request_id = v_terminal.request_id
            and event.idempotency_key = v_key || ':event'
            and event.payload->>'release_ledger_transaction_id' = v_terminal.id::text
            and event.payload->>'disposition' = p_request.status::text
            and event.payload->>'reason' = p_request.rejection_reason) <> 1
      then return false; end if;
    end if;

    if v_terminal.id is null or v_terminal.currency::text is distinct from 'KRW'
      or v_terminal.member_user_id is distinct from p_request.user_id
      or v_terminal.reference_type is distinct from 'withdrawal_request'
      or v_terminal.reference_id is distinct from p_request.id
      or v_terminal.metadata->>'phase' is distinct from v_phase
      or v_terminal.created_by is null or v_terminal.request_id is null
      or (v_phase = 'FINALIZE' and v_terminal.category::text is distinct from 'WITHDRAWAL')
      or not app_private.withdrawal_coverage_entries_verified(
        v_terminal.id, p_request.user_id, p_request.amount_atomic, v_phase)
      or (select count(*) from public.audit_logs audit
        where audit.action = v_operation and audit.target_type = 'withdrawal_request'
          and audit.target_id = p_request.id::text and audit.actor_user_id = v_terminal.created_by
          and audit.metadata->>'operation' = v_operation
          and audit.metadata->>'result_id' = v_terminal.id::text
          and audit.metadata->>'actor_user_id' = v_terminal.created_by::text
          and audit.metadata->>'destination_id' = p_request.withdrawal_destination_id::text
          and audit.metadata->>'currency' = 'KRW'
          and audit.metadata->>'amount_atomic' = p_request.amount_atomic::text
          and audit.metadata->>'idempotency_key' = v_key) <> 1
    then return false; end if;

    -- Mining has its own immutable terminal source receipt. START instead has
    -- the qualified conversion bound above; do not invent a second source row.
    if not v_welcome and (select count(*) from public.money_source_movements movement
      where movement.user_id = p_request.user_id and movement.source_bucket = 'MINING_REWARD'
        and movement.movement_kind = v_phase
        and movement.origin_code = case v_phase when 'FINALIZE'
          then 'MINING_REWARD_WITHDRAWAL_FINALIZE' else 'MINING_REWARD_WITHDRAWAL_RELEASE' end
        and movement.amount_atomic = p_request.amount_atomic
        and movement.ledger_transaction_id = v_terminal.id
        and movement.wallet_ledger_id is not distinct from v_wallet_id
        and app_private.money_source_credit_verified(movement)) <> 1
    then return false; end if;
    return true;
  end if;

  -- Active requests retain their proven source while the reservation is held.
  -- A terminal ID/debit in an active state is never guessed into coverage.
  return p_request.status in ('HELD', 'ADMIN_PROCESSING', 'REVIEWING', 'APPROVED', 'PROCESSING', 'EXTERNAL_SENT_RECORDED')
    and p_request.release_ledger_transaction_id is null and p_request.finalize_ledger_transaction_id is null
    and not exists (select 1 from public.wallet_ledger projection
      where projection.reference_type = 'withdrawal_request' and projection.reference_id = p_request.id)
    and case when p_request.status = 'EXTERNAL_SENT_RECORDED' then exists (
      select 1 from public.withdrawal_external_sends send
      where send.withdrawal_id = p_request.id and send.method = p_request.destination_type
    ) else not exists (select 1 from public.withdrawal_external_sends send where send.withdrawal_id = p_request.id) end;
end;
$$;

revoke all on function app_private.withdrawal_coverage_entries_verified(uuid, uuid, bigint, text),
  app_private.non_principal_withdrawal_coverage_verified(public.withdrawal_requests)
  from public, anon, authenticated;
grant execute on function app_private.withdrawal_coverage_entries_verified(uuid, uuid, bigint, text),
  app_private.non_principal_withdrawal_coverage_verified(public.withdrawal_requests) to service_role;

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
  ) and not exists (
    select 1 from public.withdrawal_requests request
    where request.user_id = a.user_id and request.wallet_account_id = projection.wallet_account_id
      and request.welcome_reward_conversion_id is not null and request.status = 'COMPLETED'
      and projection.reference_type = 'withdrawal_request' and projection.reference_id = request.id
      and projection.user_id = request.user_id and projection.direction = 'DEBIT'
      and projection.entry_type::text = 'WITHDRAWAL' and projection.amount_atomic = request.amount_atomic
      and app_private.non_principal_withdrawal_coverage_verified(request)
  )
) as m
cross join lateral (
  select count(*) as unconnected_withdrawals
  from public.withdrawal_requests as request
  where request.user_id = a.user_id
    and request.currency = 'KRW'
    and not app_private.non_principal_withdrawal_coverage_verified(request)
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
  ) and not exists (
    select 1 from public.withdrawal_requests request
    where request.user_id = a.user_id
      and journal.id in (request.hold_ledger_transaction_id,
        request.release_ledger_transaction_id, request.finalize_ledger_transaction_id)
      and app_private.non_principal_withdrawal_coverage_verified(request)
  )
) as j
where a.currency = 'KRW';

comment on function app_private.non_principal_withdrawal_coverage_verified(public.withdrawal_requests) is
  'Read-only exact command coverage for sealed zero-fee mining reservations or qualified START conversion originals; does not create source movements or reinterpret unclassified history.';

commit;
