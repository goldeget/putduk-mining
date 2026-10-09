begin;

--139 AUTHORING: preserve existing signature/INV/owner/ACL; no new public alias.
create or replace function public.finalize_withdrawal_ledger(
  p_withdrawal_id uuid,
  p_actor uuid,
  p_idempotency_key text
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
  v_finalize_tx uuid;
  v_wallet_ledger_id uuid;
  v_existing_reference uuid;
  v_amount bigint;
  v_wallet_account_id uuid;
  v_request_id uuid := gen_random_uuid();
  v_created_journal boolean := false;
  v_typed boolean := false;
  v_admission record;
  v_effective_at timestamptz;
  v_metadata jsonb;
begin
  -- Preserve existing nonprincipal/unbound behavior. Fresh typed principal
  -- admission uses current controls at its post-wait clock; replay comes first.
  v_typed := exists(select 1 from app_private.funding_principal_recovery_intent_originals i
    where i.withdrawal_id=p_withdrawal_id);
  if not v_typed then perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);end if;

  if p_withdrawal_id is null
    or p_actor is null
    or char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
  then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_FINALIZE';
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
  if v_typed then
    perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
    perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:WITHDRAWAL',0));
  end if;

  select request.* into v_request
  from public.withdrawal_requests as request
  where request.id = p_withdrawal_id
    and request.user_id = v_owner
  for update;

  if v_request.id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FOUND';
  end if;

  if v_request.finalize_ledger_transaction_id is not null then
    select a.* into v_admission from app_private.funding_withdrawal_clock_admissions a
      where a.withdrawal_id=v_request.id and a.phase='FINALIZE';
    if v_admission.id is not null then
      -- Completed financial replay verifies its sealed native journal only.
      -- The original transaction already completed or explicitly closed its
      -- derivative engine callback; replay must not create or re-admit it.
      perform app_private.assert_funding_withdrawal_clock_completion(v_admission.id);
    end if;
    return v_request.finalize_ledger_transaction_id;
  end if;

  if v_request.status in ('LEDGER_FINALIZED', 'COMPLETED') then
    return v_request.finalize_ledger_transaction_id;
  end if;

  if not exists (
    select 1 from public.withdrawal_external_sends as send
    where send.withdrawal_id = p_withdrawal_id
  ) then
    raise exception using errcode = '55000', message = 'EXTERNAL_SEND_REQUIRED';
  end if;

  if v_request.status <> 'EXTERNAL_SENT_RECORDED' then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_NOT_FINALIZABLE';
  end if;

  if v_request.hold_ledger_transaction_id is null then
    raise exception using errcode = '55000', message = 'WITHDRAWAL_HOLD_MISSING';
  end if;

  v_amount := v_request.amount_atomic + v_request.fee_atomic;
  select * into v_accounts from app_private.ensure_withdrawal_hold_accounts(v_request.user_id);

  select account.id into v_wallet_account_id
  from public.wallet_accounts as account
  where account.user_id = v_request.user_id
    and account.currency = 'KRW'
    and account.closed_at is null
  for update;

  -- Every native row/account wait precedes the existing closed130 sole clock.
  if v_typed then
    if not app_private.funding_hold_has_admitted_clock(v_request.hold_ledger_transaction_id) then
      raise exception using errcode='55000',message='FUNDING_FINALIZE_HOLD_ADMISSION_REQUIRED';end if;
    select a.* into v_admission from app_private.capture_funding_withdrawal_clock_admission(v_request.id,'FINALIZE',v_request_id) a;
    v_effective_at:=v_admission.effective_at;
    v_metadata:=jsonb_build_object('phase','FINALIZE','portion_clock_contract','HOLD_CANCEL_FINALIZE_V1',
      'clock_admission_id',v_admission.admission_id,
      'admitted_at_microseconds',((extract(epoch from v_effective_at)*1000000)::bigint)::text);
  end if;

  if v_typed then
  insert into public.ledger_transactions (
    category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, metadata, created_by, posted_at, created_at
  ) values (
    'WITHDRAWAL',
    'KRW',
    p_idempotency_key || ':finalize',
    'withdrawal_request',
    v_request.id,
    v_request.user_id,
    v_request_id,
    gen_random_uuid(),
    'Withdrawal ledger finalize after external send',
    v_metadata,
    p_actor, v_effective_at, v_effective_at
  )
  on conflict (idempotency_key) do nothing
  returning id into v_finalize_tx;
  else
  insert into public.ledger_transactions (
    category, currency, idempotency_key, reference_type, reference_id,
    member_user_id, request_id, correlation_id, description, metadata, created_by
  ) values (
    'WITHDRAWAL',
    'KRW',
    p_idempotency_key || ':finalize',
    'withdrawal_request',
    v_request.id,
    v_request.user_id,
    v_request_id,
    gen_random_uuid(),
    'Withdrawal ledger finalize after external send',
    jsonb_build_object('phase', 'FINALIZE'),
    p_actor
  )
  on conflict (idempotency_key) do nothing
  returning id into v_finalize_tx;
  end if;

  if v_finalize_tx is null then
    select transaction.id, transaction.reference_id
    into v_finalize_tx, v_existing_reference
    from public.ledger_transactions as transaction
    where transaction.idempotency_key = p_idempotency_key || ':finalize';

    if v_existing_reference is distinct from v_request.id
      or v_finalize_tx is null
    then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
    end if;
  else
    insert into public.ledger_entries (
      transaction_id, account_id, sequence, side, amount_atomic
    ) values
      (v_finalize_tx, v_accounts.hold_clearing_id, 0, 'DEBIT', v_amount),
      (v_finalize_tx, v_accounts.payout_cash_id, 1, 'CREDIT', v_amount);

    if v_typed then
    insert into public.wallet_ledger (
      wallet_account_id, user_id, direction, entry_type, amount_atomic,
      idempotency_key, reference_type, reference_id, reason, created_by, created_at
    ) values (
      v_wallet_account_id,
      v_request.user_id,
      'DEBIT',
      'WITHDRAWAL',
      v_amount,
      p_idempotency_key || ':wallet',
      'withdrawal_request',
      v_request.id,
      'Withdrawal finalized after external send',
      p_actor, v_effective_at
    )
    on conflict (idempotency_key) do nothing
    returning id into v_wallet_ledger_id;
    else
    insert into public.wallet_ledger (
      wallet_account_id, user_id, direction, entry_type, amount_atomic,
      idempotency_key, reference_type, reference_id, reason, created_by
    ) values (
      v_wallet_account_id,
      v_request.user_id,
      'DEBIT',
      'WITHDRAWAL',
      v_amount,
      p_idempotency_key || ':wallet',
      'withdrawal_request',
      v_request.id,
      'Withdrawal finalized after external send',
      p_actor
    )
    on conflict (idempotency_key) do nothing
    returning id into v_wallet_ledger_id;
    end if;

    if v_wallet_ledger_id is null then
      select ledger.id, ledger.reference_id
      into v_wallet_ledger_id, v_existing_reference
      from public.wallet_ledger as ledger
      where ledger.idempotency_key = p_idempotency_key || ':wallet';

      if v_existing_reference is distinct from v_request.id
        or v_wallet_ledger_id is null
      then
        raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';
      end if;
    end if;

    v_created_journal := true;
  end if;

  update public.withdrawal_requests
  set
    status = 'COMPLETED',
    finalize_ledger_transaction_id = v_finalize_tx,
    ledger_finalized_at = case when v_typed then v_effective_at else statement_timestamp() end,
    reviewed_by = coalesce(reviewed_by, p_actor),
    reviewed_at = coalesce(reviewed_at, case when v_typed then v_effective_at else statement_timestamp() end)
  where id = v_request.id
    and finalize_ledger_transaction_id is null;

  update public.transaction_receipts
  set
    status = 'COMPLETED',
    completed_at = case when v_typed then v_effective_at else statement_timestamp() end,
    ledger_transaction_id = v_finalize_tx,
    status_timeline = status_timeline || jsonb_build_array(
      jsonb_build_object('status', 'EXTERNAL_SENT_RECORDED', 'at', case when v_typed then v_effective_at else statement_timestamp() end),
      jsonb_build_object('status', 'LEDGER_FINALIZED', 'at', case when v_typed then v_effective_at else statement_timestamp() end),
      jsonb_build_object('status', 'COMPLETED', 'at', case when v_typed then v_effective_at else statement_timestamp() end)
    )
  where source_type = 'withdrawal_request'
    and source_id = v_request.id;

  if v_typed then
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key, occurred_at, created_at
  ) values (
    'WITHDRAWAL_COMPLETED.v1',
    1,
    'withdrawal_request',
    v_request.id,
    p_actor,
    jsonb_build_object(
      'finalize_ledger_transaction_id', v_finalize_tx,
      'amount_atomic', v_request.amount_atomic::text
    ),
    gen_random_uuid(),
    v_request_id,
    p_idempotency_key || ':event', v_effective_at, v_effective_at
  )
  on conflict (idempotency_key) do nothing;
  else
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_COMPLETED.v1',
    1,
    'withdrawal_request',
    v_request.id,
    p_actor,
    jsonb_build_object(
      'finalize_ledger_transaction_id', v_finalize_tx,
      'amount_atomic', v_request.amount_atomic::text
    ),
    gen_random_uuid(),
    v_request_id,
    p_idempotency_key || ':event'
  )
  on conflict (idempotency_key) do nothing;
  end if;

  if v_created_journal then
    perform app_private.record_money_command_link(
      'finalize_withdrawal_ledger',
      v_finalize_tx,
      p_actor,
      'finalize_withdrawal_ledger',
      'withdrawal_request',
      v_request.id,
      jsonb_build_object(
        'destination_id', v_request.withdrawal_destination_id,
        'currency', 'KRW',
        'amount_atomic', v_amount::text,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;

  if v_typed then
    -- Source disposition has finished during native request UPDATE, and final
    -- command receipt/event/audit now exist. New portion clocks are journal-
    -- bound originals, not a raw-trigger producer or generic principal debit.
    perform app_private.assert_funding_withdrawal_clock_completion(v_admission.admission_id);
    perform app_private.apply_funding_portion_disposition('FINALIZE',v_request.id);
    perform app_private.finish_principal_runtime_boundary(v_admission.admission_id);
  end if;
  return v_finalize_tx;
end;
$$;


commit;
