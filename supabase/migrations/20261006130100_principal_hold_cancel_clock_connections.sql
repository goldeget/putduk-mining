begin;

-- These original-bound INVOKER connectors add no relation, public alias,
-- credit hook, scheduler or privilege on money/portion facts.
create function app_private.funding_hold_has_admitted_clock(p_hold uuid)
returns boolean language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original public.ledger_transactions%rowtype; admission app_private.funding_withdrawal_clock_admissions%rowtype;
begin
 select t.* into original from public.ledger_transactions t where t.id=p_hold;
 if original.id is null or not(original.metadata ? 'portion_clock_contract') then return false; end if;
 if original.category <> 'WITHDRAWAL' or original.currency <> 'KRW'
  or original.reference_type is distinct from 'withdrawal_request'
  or original.member_user_id is null or original.metadata->>'phase' is distinct from 'HOLD'
  or original.metadata->>'portion_clock_contract' is distinct from 'HOLD_CANCEL_V1'
  or original.metadata->>'admitted_at_microseconds' is distinct from
    ((extract(epoch from original.posted_at)*1000000)::bigint)::text then
  raise exception using errcode='55000',message='FUNDING_HOLD_CLOCK_ORIGINAL_MISMATCH'; end if;
 if original.metadata->>'clock_admission_id' is null
  or original.metadata->>'clock_admission_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception using errcode='55000',message='FUNDING_HOLD_CLOCK_ADMISSION_REQUIRED'; end if;
 select a.* into admission from app_private.funding_withdrawal_clock_admissions a
  where a.id=(original.metadata->>'clock_admission_id')::uuid and a.phase='HOLD';
 if admission.user_id is distinct from original.member_user_id or admission.withdrawal_id is distinct from original.reference_id
  or admission.effective_at is distinct from original.posted_at then
  raise exception using errcode='55000',message='FUNDING_HOLD_CLOCK_ADMISSION_REQUIRED'; end if;
 perform app_private.assert_funding_withdrawal_clock_admission(admission.id);
 return true;
end;
$$;

create function app_private.connect_admitted_principal_hold_clocks(p_hold uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original public.ledger_transactions%rowtype; allocation record; transition app_private.funding_portion_transitions%rowtype;
begin
 if current_user <> 'service_role' then
  raise exception using errcode='42501',message='PRINCIPAL_RECOVERY_SERVICE_ROLE_REQUIRED'; end if;
 if not app_private.funding_hold_has_admitted_clock(p_hold) then return; end if;
 select t.* into original from public.ledger_transactions t where t.id=p_hold;
 perform app_private.assert_funding_portion_executor(original.member_user_id);
 -- Unsupported old/unbound history stays UNKNOWN; it never gains fabricated
 -- roots or retrospective clock acceptance just because finance can proceed.
 if not exists(select 1 from app_private.funding_engine_activations a
   where a.user_id=original.member_user_id and a.runtime_version=2)
  or (select coverage from public.money_source_summaries where user_id=original.member_user_id) is distinct from 'COMPLETE'
  or not exists(select 1 from public.funding_principal_recovery_allocations a where a.hold_ledger_transaction_id=p_hold)
  or exists(select 1 from public.funding_principal_recovery_allocations a where a.hold_ledger_transaction_id=p_hold
    and(a.user_id is distinct from original.member_user_id or a.policy_code is distinct from 'NEWEST_FIRST'))
  or exists(select 1 from public.funding_principal_lots l where l.user_id=original.member_user_id
   and not exists(select 1 from app_private.funding_principal_portions p
     join app_private.funding_portion_transitions t on t.id=p.introduced_by_transition_id
     where p.lot_id=l.id and p.parent_portion_id is null and p.user_id=l.user_id
      and t.kind='CREDIT' and t.original_id=l.id and t.effective_at=l.effective_at))
  or exists(select 1 from public.funding_principal_recovery_allocations a
    where a.user_id=original.member_user_id and a.hold_ledger_transaction_id<>p_hold
     and not exists(select 1 from app_private.funding_portion_transitions t where t.kind='HOLD' and t.original_id=a.id))
  or exists(select 1 from public.funding_principal_recovery_releases r
    where r.user_id=original.member_user_id
     and not exists(select 1 from app_private.funding_portion_transitions t where t.kind='RELEASE' and t.original_id=r.id))
  or exists(select 1 from public.withdrawal_requests r where r.user_id=original.member_user_id
    and r.status='COMPLETED' and exists(select 1 from public.funding_principal_recovery_allocations a
      where a.hold_ledger_transaction_id=r.hold_ledger_transaction_id)
     and not exists(select 1 from app_private.funding_portion_transitions t where t.kind='FINALIZE' and t.original_id=r.id)) then
  return;
 end if;
 -- All native allocations/source/revisions now exist. Existing strong source,
 -- newest-lot, shortest eligible-age, UUID tie, seal and conservation checks
 -- stay unchanged; a genuine supported corruption aborts the entire command.
 perform app_private.assert_funding_withdrawal_clock_completion((original.metadata->>'clock_admission_id')::uuid);
 for transition in select t.* from app_private.funding_portion_transitions t
   where t.user_id=original.member_user_id order by t.revision loop
  perform app_private.verify_funding_portion_fact(transition);
 end loop;
 for allocation in select a.id from public.funding_principal_recovery_allocations a
   where a.hold_ledger_transaction_id=p_hold order by a.ordinal loop
  perform app_private.apply_funding_portion_hold(allocation.id);
 end loop;
end;
$$;

create function app_private.connect_admitted_principal_release_clocks(p_release uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original public.funding_principal_recovery_releases%rowtype;
 journal public.ledger_transactions%rowtype; request public.withdrawal_requests%rowtype; hold_count bigint; clock_count bigint; admission_id uuid;
begin
 if current_user <> 'service_role' then
  raise exception using errcode='42501',message='PRINCIPAL_RECOVERY_SERVICE_ROLE_REQUIRED'; end if;
 select r.* into original from public.funding_principal_recovery_releases r where r.release_ledger_transaction_id=p_release;
 if original.id is null or not app_private.funding_hold_has_admitted_clock(original.hold_ledger_transaction_id) then return; end if;
 perform app_private.assert_funding_portion_executor(original.user_id);
 select count(*) into hold_count from public.funding_principal_recovery_allocations a
   where a.hold_ledger_transaction_id=original.hold_ledger_transaction_id;
 select count(*) into clock_count from public.funding_principal_recovery_allocations a
   join app_private.funding_portion_transitions t on t.kind='HOLD' and t.original_id=a.id
   where a.hold_ledger_transaction_id=original.hold_ledger_transaction_id;
 if clock_count=0 then return; end if;
 if clock_count is distinct from hold_count then
  raise exception using errcode='55000',message='FUNDING_HOLD_CLOCK_CONNECTION_INCOMPLETE'; end if;
 select t.* into journal from public.ledger_transactions t where t.id=p_release;
 select r.* into request from public.withdrawal_requests r where r.release_ledger_transaction_id=p_release;
 -- The native source disposition fires during UPDATE. Clock release waits for
 -- the canonical command's final audit, source and event, not an early trigger.
 if journal.member_user_id is distinct from original.user_id or request.user_id is distinct from original.user_id
  or request.hold_ledger_transaction_id is distinct from original.hold_ledger_transaction_id
  or request.hold_released_at is distinct from original.effective_at
  or request.status not in('CANCELLED','REJECTED')
  or journal.metadata->>'portion_clock_contract' is distinct from 'HOLD_CANCEL_V1'
  or journal.metadata->>'admitted_at_microseconds' is distinct from
    ((extract(epoch from journal.posted_at)*1000000)::bigint)::text
  or (select count(*) from public.audit_logs a where a.action='release_withdrawal_hold'
    and a.target_type='withdrawal_request' and a.target_id=request.id::text
    and a.actor_user_id=journal.created_by and a.metadata->>'operation'='release_withdrawal_hold'
    and a.metadata->>'result_id'=journal.id::text and a.metadata->>'amount_atomic'=request.amount_atomic::text)<>1
  or not exists(select 1 from public.transaction_receipts r where r.source_type='withdrawal_request'
    and r.source_id=request.id and r.user_id=original.user_id)
  or not exists(select 1 from public.outbox_events e where e.event_type='WITHDRAWAL_HOLD_RELEASED.v1'
    and e.aggregate_id=request.id and e.request_id=journal.request_id
    and e.payload->>'release_ledger_transaction_id'=journal.id::text) then
  raise exception using errcode='55000',message='FUNDING_RELEASE_COMMAND_COMPLETION_MISSING'; end if;
 select a.id into admission_id from app_private.funding_withdrawal_clock_admissions a
  where a.withdrawal_id=request.id and a.phase='RELEASE' and a.id=(journal.metadata->>'clock_admission_id')::uuid;
 if admission_id is null then raise exception using errcode='55000',message='FUNDING_RELEASE_CLOCK_ADMISSION_REQUIRED'; end if;
 perform app_private.assert_funding_withdrawal_clock_completion(admission_id);
 perform app_private.apply_funding_portion_disposition('RELEASE',original.id);
end;
$$;

revoke all on function app_private.funding_hold_has_admitted_clock(uuid),
 app_private.connect_admitted_principal_hold_clocks(uuid),app_private.connect_admitted_principal_release_clocks(uuid)
 from public,anon,authenticated,service_role;
grant execute on function app_private.funding_hold_has_admitted_clock(uuid),
 app_private.connect_admitted_principal_hold_clocks(uuid),app_private.connect_admitted_principal_release_clocks(uuid) to service_role;

create or replace function app_private.finish_principal_recovery_hold(
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
  v_event_at timestamptz;
begin
  v_event_at := case when app_private.funding_hold_has_admitted_clock(p_hold_id) then p_posted_at else statement_timestamp() end;
  v_after := app_private.funding_principal_mining_eligible_micro(p_user_id, p_posted_at);
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key, available_at, last_error_code, occurred_at, created_at
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
    'PRINCIPAL_RECOVERY_CONSUMER_NOT_ENABLED', v_event_at, v_event_at
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
  if p_policy_code = 'NEWEST_FIRST' then
    perform app_private.connect_admitted_principal_hold_clocks(p_hold_id);
  end if;
  return v_after;
end;
$$;

create or replace function app_private.record_principal_recovery_release(
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
  v_event_at timestamptz;
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

  v_event_at := case when app_private.funding_hold_has_admitted_clock(v_request.hold_ledger_transaction_id)
    then v_tx.posted_at else statement_timestamp() end;
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key, available_at, last_error_code, occurred_at, created_at
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
    'PRINCIPAL_RECOVERY_CONSUMER_NOT_ENABLED', v_event_at, v_event_at
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

create or replace function public.release_withdrawal_hold(
  p_withdrawal_id uuid,
  p_actor uuid,
  p_reason text,
  p_idempotency_key text,
  p_disposition text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_request public.withdrawal_requests%rowtype;
  v_owner uuid;
  v_accounts record;
  v_release_tx uuid;
  v_existing_reference uuid;
  v_amount bigint;
  v_request_id uuid := gen_random_uuid();
  v_disposition text := upper(btrim(coalesce(p_disposition, '')));
  v_created_journal boolean := false;
  v_admitted boolean;
  v_effective_at timestamptz;
  v_wallet uuid;
  v_metadata jsonb;
  v_admission record;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

  if p_withdrawal_id is null
    or p_actor is null
    or char_length(btrim(coalesce(p_reason, ''))) < 4
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
    or v_disposition not in ('REJECTED', 'CANCELLED')
  then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_RELEASE';
  end if;

  -- Resolve identity without a row lock, then take the member boundary first.
  -- Re-read after waiting: a row lock before this advisory lock reverses the
  -- order used by principal/mining reservations and can deadlock a finalizer.
  select request.user_id into v_owner
  from public.withdrawal_requests as request
  where request.id = p_withdrawal_id;
  if v_owner is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('putduk-funding-recovery:' || v_owner::text, 0));

  select request.* into v_request
  from public.withdrawal_requests as request
  where request.id = p_withdrawal_id
    and request.user_id = v_owner
  for update;

  if v_request.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FOUND';
  end if;

  if v_request.release_ledger_transaction_id is not null then
    return v_request.release_ledger_transaction_id;
  end if;

  if v_request.status in ('EXTERNAL_SENT_RECORDED', 'LEDGER_FINALIZED', 'COMPLETED') then
    raise exception using
      errcode = '55000',
      message = 'WITHDRAWAL_RELEASE_FORBIDDEN_AFTER_EXTERNAL_SEND';
  end if;

  if v_request.status not in (
    'REQUESTED', 'HELD', 'ADMIN_PROCESSING', 'REVIEWING', 'APPROVED', 'PROCESSING'
  ) then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_RELEASABLE';
  end if;

  if v_request.hold_ledger_transaction_id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_HOLD_MISSING';
  end if;

  v_admitted := app_private.funding_hold_has_admitted_clock(v_request.hold_ledger_transaction_id);
  if v_admitted then
    perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL', 0));
    perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:WITHDRAWAL', 0));
    select a.id into v_wallet from public.wallet_accounts a
      where a.id=v_request.wallet_account_id and a.user_id=v_request.user_id
        and a.currency='KRW' and a.closed_at is null for update;
    if v_wallet is null then raise exception using errcode='55000',message='KRW_WALLET_NOT_FOUND'; end if;
    perform app_private.assert_not_safe_mode(array['GLOBAL','WITHDRAWAL']);
  end if;
  v_amount := v_request.amount_atomic + v_request.fee_atomic;
  select * into v_accounts from app_private.ensure_withdrawal_hold_accounts(v_request.user_id);

  -- Preserve old unadmitted financial originals/fixture clocks. New contract
  -- releases capture one actual clock after every admission/account wait.
  v_effective_at := statement_timestamp();

  if v_admitted then
    select a.* into v_admission from app_private.capture_funding_withdrawal_clock_admission(
      v_request.id,'RELEASE',v_request_id) a;
    v_effective_at := v_admission.effective_at;
  end if;
  v_metadata := jsonb_build_object('phase','RELEASE','reason',p_reason,'disposition',v_disposition);
  if v_admitted then
    v_metadata := v_metadata || jsonb_build_object('portion_clock_contract','HOLD_CANCEL_V1',
      'clock_admission_id',v_admission.admission_id,
      'admitted_at_microseconds',((extract(epoch from v_effective_at)*1000000)::bigint)::text);
  end if;
  insert into public.ledger_transactions (
    category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, reversal_of_transaction_id, request_id, correlation_id,
    description, metadata, created_by, posted_at, created_at
  ) values (
    'REVERSAL',
    'KRW',
    p_idempotency_key || ':release',
    'withdrawal_request',
    v_request.id,
    v_request.user_id,
    v_request.hold_ledger_transaction_id,
    v_request_id,
    gen_random_uuid(),
    'Withdrawal hold release',
    v_metadata,
    p_actor, v_effective_at, v_effective_at
  )
  on conflict (idempotency_key) do nothing
  returning id into v_release_tx;

  if v_release_tx is null then
    select transaction.id, transaction.reference_id
    into v_release_tx, v_existing_reference
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = p_idempotency_key || ':release';

    select t.posted_at into v_effective_at from public.ledger_transactions t where t.id=v_release_tx;

    if v_existing_reference is distinct from v_request.id
      or v_release_tx is null
    then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
  else
    insert into public.ledger_entries (
      transaction_id, account_id, sequence, side, amount_atomic
    ) values
      (v_release_tx, v_accounts.hold_clearing_id, 0, 'DEBIT', v_amount),
      (v_release_tx, v_accounts.member_liability_id, 1, 'CREDIT', v_amount);
    v_created_journal := true;
  end if;

  update public.withdrawal_requests
  set
    status = v_disposition::public.withdrawal_status,
    release_ledger_transaction_id = v_release_tx,
    hold_released_at = v_effective_at,
    rejection_reason = p_reason,
    reviewed_by = p_actor,
    reviewed_at = v_effective_at
  where id = v_request.id
    and release_ledger_transaction_id is null;

  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key, occurred_at, created_at
  ) values (
    'WITHDRAWAL_HOLD_RELEASED.v1',
    1,
    'withdrawal_request',
    v_request.id,
    p_actor,
    jsonb_build_object(
      'release_ledger_transaction_id', v_release_tx,
      'reason', p_reason,
      'disposition', v_disposition
    ),
    gen_random_uuid(),
    v_request_id,
    p_idempotency_key || ':event', v_effective_at, v_effective_at
  )
  on conflict (idempotency_key) do nothing;

  if v_created_journal then
    perform app_private.record_money_command_link(
      'release_withdrawal_hold',
      v_release_tx,
      p_actor,
      p_reason,
      'withdrawal_request',
      v_request.id,
      jsonb_build_object(
        'disposition', v_disposition,
        'destination_id', v_request.withdrawal_destination_id,
        'currency', 'KRW',
        'amount_atomic', v_amount::text,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;

  if v_admitted then
    perform app_private.connect_admitted_principal_release_clocks(v_release_tx);
  end if;
  return v_release_tx;
end;
$$;

commit;
