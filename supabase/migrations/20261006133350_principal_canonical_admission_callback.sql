begin;

create or replace function app_private.capture_funding_withdrawal_clock_admission(p_withdrawal uuid,p_phase text,p_request uuid)
returns table(admission_id uuid,effective_at timestamptz)
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare original app_private.funding_withdrawal_clock_admissions%rowtype;
 request public.withdrawal_requests%rowtype;owner_id uuid;wallet_id uuid;hold_original uuid;
 snapshot jsonb;
begin
 -- Preserve the existing SQL-only service financial caller contract. This is
 -- not a member command and cannot be reached under authenticated SQL role,
 -- even if a forged JWT says service_role. No caller amount/time is accepted.
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception using errcode='42501',message='WITHDRAWAL_CLOCK_SERVICE_ROLE_REQUIRED'; end if;
 if p_withdrawal is null or p_request is null or p_phase not in('HOLD','RELEASE') or p_phase is null then
  raise exception using errcode='22023',message='WITHDRAWAL_CLOCK_ADMISSION_INVALID'; end if;
 select r.user_id into owner_id from public.withdrawal_requests r where r.id=p_withdrawal;
 if owner_id is null then raise exception using errcode='55000',message='WITHDRAWAL_NOT_FOUND'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||owner_id::text,0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:WITHDRAWAL',0));
 select r.* into request from public.withdrawal_requests r where r.id=p_withdrawal and r.user_id=owner_id for update;
 if request.id is null then raise exception using errcode='55000',message='WITHDRAWAL_NOT_FOUND'; end if;
 select a.* into original from app_private.funding_withdrawal_clock_admissions a
  where a.withdrawal_id=request.id and a.phase=p_phase;
 if original.id is not null then
  if original.journal_request_id is distinct from p_request then
   raise exception using errcode='22023',message='IDEMPOTENCY_KEY_REUSED'; end if;
  perform app_private.assert_funding_withdrawal_clock_admission(original.id);
  admission_id:=original.id;effective_at:=original.effective_at;return next;return;
 end if;
 -- Immutable phase replay precedes current fresh-admission requirements.
 -- Advisory/row locks do not refresh a REPEATABLE READ snapshot after waiting.
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='WITHDRAWAL_CLOCK_FRESH_SNAPSHOT_REQUIRED'; end if;
 if request.currency<>'KRW' or request.fee_atomic<>0
  or(p_phase='HOLD' and(request.status<>'REQUESTED' or request.hold_ledger_transaction_id is not null))
  or(p_phase='RELEASE' and(request.status not in('REQUESTED','HELD','ADMIN_PROCESSING','REVIEWING','APPROVED','PROCESSING')
   or request.hold_ledger_transaction_id is null or request.release_ledger_transaction_id is not null
   or exists(select 1 from public.withdrawal_external_sends s where s.withdrawal_id=request.id))) then
  raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_ADMISSION_ORIGINAL_REQUIRED'; end if;
 if p_phase='RELEASE' then
  select a.id into hold_original from app_private.funding_withdrawal_clock_admissions a
   where a.withdrawal_id=request.id and a.phase='HOLD';
  if hold_original is null then raise exception using errcode='55000',message='WITHDRAWAL_CLOCK_HOLD_ADMISSION_REQUIRED'; end if;
  perform app_private.assert_funding_withdrawal_clock_admission(hold_original);
 end if;
 select w.id into wallet_id from public.wallet_accounts w where w.id=request.wallet_account_id
  and w.user_id=owner_id and w.currency='KRW' and w.closed_at is null for update;
 if wallet_id is null then raise exception using errcode='55000',message='KRW_WALLET_NOT_FOUND'; end if;
 -- Ensure controlled ledger accounts BEFORE the sole financial clock; an
 -- account uniqueness wait must not introduce a pre-admission effective time.
 perform 1 from app_private.ensure_withdrawal_hold_accounts(owner_id);
 if exists(select 1 from app_private.funding_principal_recovery_intent_originals i where i.withdrawal_id=request.id) then
  -- New waits precede the same sole130 clock. No command-provided amount/time.
  perform pg_advisory_xact_lock(hashtextextended('putduk-funding-cycle:'||owner_id::text,0));
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.economy-policy',0));
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:NEW_MINING',0));
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
  perform 1 from public.ledger_accounts a where a.code='PUTDUK:MINING_REWARD_EXPENSE:KRW' for key share;
  if not found then raise exception using errcode='55000',message='FUNDING_MINING_EXPENSE_ACCOUNT_REQUIRED';end if;
 end if;
 original.id:=gen_random_uuid();original.schema_version:=1;original.user_id:=owner_id;original.withdrawal_id:=request.id;
 original.phase:=p_phase;original.hold_admission_id:=hold_original;original.amount_atomic:=request.amount_atomic+request.fee_atomic;
 original.journal_request_id:=p_request;original.request_snapshot:=app_private.funding_withdrawal_request_snapshot(request);
 original.audit_id:=gen_random_uuid();original.source_event_id:=gen_random_uuid();
 original.effective_at:=clock_timestamp();
 -- A concurrent canonical control may start AFTER this statement began.
 -- Authorize against this SAME admitted financial clock, never statement time.
 if exists(select 1 from public.safe_mode_controls c
   where c.component in('GLOBAL','WITHDRAWAL') and c.is_paused and c.starts_at<=original.effective_at) then
  raise exception using errcode='55000',message='SAFE_MODE_ACTIVE'; end if;
 snapshot:=app_private.funding_withdrawal_clock_snapshot(original);original.input_digest:=app_private.funding_engine_digest(snapshot);
 insert into app_private.funding_withdrawal_clock_admissions select original.*;
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(original.audit_id,owner_id,'FUNDING_WITHDRAWAL_CLOCK_ADMITTED','FUNDING_ENGINE_V1',original.id::text,
  'canonical source-bound withdrawal clock admission',p_request,snapshot,
  jsonb_build_object('input_digest',original.input_digest,'engine_contract',2),original.effective_at);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
  correlation_id,request_id,idempotency_key,occurred_at,created_at,available_at,last_error_code)
 values(original.source_event_id,'FUNDING_WITHDRAWAL_CLOCK_ADMITTED.v1',1,'funding_engine_v1',original.id,owner_id,
  jsonb_build_object('user_id',owner_id,'audit_id',original.audit_id,'input_digest',original.input_digest),p_request,p_request,
  'funding:'||original.id::text||':seal',original.effective_at,original.effective_at,'infinity','FUNDING_PRINCIPAL_CONDITION_ADAPTER_NOT_ENABLED');
 perform app_private.begin_principal_runtime_boundary(original.id);
 admission_id:=original.id;effective_at:=original.effective_at;return next;
end;
$$;


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
  v_clock uuid;
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
    select a.id into v_clock from app_private.funding_withdrawal_clock_admissions a
      join public.withdrawal_requests r on r.id=a.withdrawal_id
      where a.user_id=p_user_id and a.phase='HOLD' and r.hold_ledger_transaction_id=p_hold_id;
    if v_clock is not null then perform app_private.finish_principal_runtime_boundary(v_clock);end if;
  end if;
  return v_after;
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
    select a.* into v_admission from app_private.funding_withdrawal_clock_admissions a
      where a.withdrawal_id=v_request.id and a.phase='RELEASE';
    if v_admission.id is not null then
      perform app_private.assert_funding_withdrawal_clock_completion(v_admission.id);
      perform app_private.finish_principal_runtime_boundary(v_admission.id);
    end if;
    return v_request.release_ledger_transaction_id;
  end if;

  perform app_private.assert_not_safe_mode(array['GLOBAL', 'WITHDRAWAL']);

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
    perform app_private.finish_principal_runtime_boundary(v_admission.admission_id);
  end if;
  return v_release_tx;
end;
$$;


commit;
