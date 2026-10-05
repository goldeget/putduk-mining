begin;

-- 워커 복구: 영구 실패는 그 시도에서 DEAD_LETTER가 되고,
-- 같은 재조정 요청은 성공한 실행을 다시 쓰지 않는다.
-- 정산 산술, 원금 lot 배분, 금액 계산은 바꾸지 않는다.

create unique index reconciliation_runs_request_scope_uidx
  on public.reconciliation_runs (request_id, scope);

create or replace function public.fail_outbox_event(
  p_event_id uuid,
  p_worker_id text,
  p_error_code text,
  p_retry_delay_seconds integer default 30
)
returns public.outbox_status
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_status public.outbox_status;
  v_permanent boolean;
begin
  if char_length(btrim(coalesce(p_error_code, ''))) not between 1 and 120
    or p_retry_delay_seconds not between 0 and 86400
  then
    raise exception using errcode = '22023', message = 'INVALID_OUTBOX_FAILURE_CONTEXT';
  end if;

  -- 지원하지 않는 유형과 호환되지 않는 봉투는 재시도하지 않는다.
  v_permanent := btrim(p_error_code) in (
    'UNSUPPORTED_EVENT_TYPE',
    'SAFE_MODE_EVENT_ENVELOPE_INVALID'
  );

  update public.outbox_events as event
  set
    status = case
      when event.attempt_count >= event.max_attempts or v_permanent
        then 'DEAD_LETTER'::public.outbox_status
      else 'FAILED'::public.outbox_status
    end,
    available_at = statement_timestamp() + make_interval(secs => p_retry_delay_seconds),
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = p_error_code
  where event.id = p_event_id
    and event.status = 'PROCESSING'
    and event.lease_owner = p_worker_id
  returning event.status into v_status;

  if v_status is null then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;
  return v_status;
end;
$$;

create or replace function public.fail_system_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_class text,
  p_retry_delay_seconds integer default 60
)
returns public.system_job_status
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_attempt integer;
  v_status public.system_job_status;
  v_permanent boolean;
begin
  if char_length(btrim(coalesce(p_error_code, ''))) not between 1 and 120
    or char_length(btrim(coalesce(p_error_class, ''))) not between 1 and 120
    or p_retry_delay_seconds not between 0 and 86400
  then
    raise exception using errcode = '22023', message = 'INVALID_JOB_FAILURE_CONTEXT';
  end if;

  v_permanent := upper(btrim(p_error_class)) = 'PERMANENT';

  update public.system_jobs as job
  set
    status = case
      when job.attempts >= job.max_attempts or v_permanent
        then 'DEAD_LETTER'::public.system_job_status
      else 'FAILED'::public.system_job_status
    end,
    available_at = statement_timestamp() + make_interval(secs => p_retry_delay_seconds),
    lease_owner = null,
    lease_expires_at = null,
    dead_lettered_at = case
      when job.attempts >= job.max_attempts or v_permanent then statement_timestamp()
      else null
    end,
    last_error_code = p_error_code
  where job.id = p_job_id
    and job.status = 'RUNNING'
    and job.lease_owner = p_worker_id
  returning job.attempts, job.status into v_attempt, v_status;

  if v_attempt is null then
    raise exception using errcode = '55000', message = 'JOB_LEASE_NOT_OWNED';
  end if;

  update public.system_job_attempts
  set
    status = case
      when v_status = 'DEAD_LETTER' then 'PERMANENT_FAILED'
      else 'RETRYABLE_FAILED'
    end,
    error_code = p_error_code,
    error_class = p_error_class,
    completed_at = statement_timestamp()
  where job_id = p_job_id and attempt_number = v_attempt;

  return v_status;
end;
$$;

create or replace function public.run_financial_reconciliation(p_request_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_checked_count bigint;
  v_mismatch_count bigint;
  v_run_id uuid;
  v_existing_status text;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'RECONCILIATION_REQUEST_ID_REQUIRED';
  end if;

  -- 같은 요청의 성공한 대조는 다시 실행하지 않는다. 원장과 잔액은 고치지 않는다.
  for v_try in 1..2 loop
    select run.id, run.status
    into v_run_id, v_existing_status
    from public.reconciliation_runs as run
    where run.request_id = p_request_id
      and run.scope = 'FINANCIAL_CORE'
    for update;

    if v_run_id is not null then
      if v_existing_status = 'SUCCEEDED' then
        return v_run_id;
      end if;
      raise exception using errcode = '55000', message = 'RECONCILIATION_REQUEST_NOT_TERMINAL';
    end if;

    begin
      insert into public.reconciliation_runs (request_id, scope)
      values (p_request_id, 'FINANCIAL_CORE')
      returning id into v_run_id;
      exit;
    exception
      when unique_violation then
        if v_try = 2 then
          raise;
        end if;
    end;
  end loop;

  if v_run_id is null then
    raise exception using errcode = '55000', message = 'RECONCILIATION_RUN_NOT_RECORDED';
  end if;

  insert into public.reconciliation_mismatches (
    run_id,
    mismatch_type,
    subject_type,
    subject_id,
    expected_value,
    actual_value
  )
  select
    v_run_id,
    'UNBALANCED_JOURNAL',
    'ledger_transaction',
    transaction.id::text,
    jsonb_build_object('minimum_entries', 2, 'debit_equals_credit', true, 'currency_count', 1),
    jsonb_build_object(
      'entry_count', count(entry.id),
      'debit_atomic', coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0)::text,
      'credit_atomic', coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0)::text,
      'currency_count', count(distinct account.currency)
    )
  from public.ledger_transactions as transaction
  left join public.ledger_entries as entry on entry.transaction_id = transaction.id
  left join public.ledger_accounts as account on account.id = entry.account_id
  group by transaction.id
  having count(entry.id) < 2
    or coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0)
      <> coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0)
    or count(distinct account.currency) <> 1;

  insert into public.reconciliation_mismatches (
    run_id,
    mismatch_type,
    subject_type,
    subject_id,
    expected_value,
    actual_value
  )
  select
    v_run_id,
    'WELCOME_REWARD_PROJECTION_MISMATCH',
    'trial_reward_conversion',
    conversion.id::text,
    jsonb_build_object(
      'amount_atomic', conversion.converted_amount_atomic::text,
      'wallet_projection_count', 1,
      'outbox_count', 1
    ),
    jsonb_build_object(
      'wallet_amount_atomic', coalesce(wallet.amount_atomic, 0)::text,
      'wallet_projection_count', case when wallet.id is null then 0 else 1 end,
      'outbox_count', event_summary.event_count,
      'debit_atomic', journal.debit_atomic::text,
      'credit_atomic', journal.credit_atomic::text
    )
  from public.trial_reward_conversions as conversion
  left join public.wallet_ledger as wallet on wallet.id = conversion.wallet_ledger_id
  left join lateral (
    select
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0) as debit_atomic,
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0) as credit_atomic
    from public.ledger_entries as entry
    where entry.transaction_id = conversion.ledger_transaction_id
  ) as journal on true
  left join lateral (
    select count(*)::integer as event_count
    from public.outbox_events as event
    where event.aggregate_id = conversion.id
      and event.event_type = 'TRIAL_REWARD_CONVERTED.v1'
  ) as event_summary on true
  where conversion.status = 'CONVERTED'
    and (
      wallet.id is null
      or coalesce(wallet.amount_atomic, 0) <> conversion.converted_amount_atomic
      or event_summary.event_count <> 1
      or journal.debit_atomic <> conversion.converted_amount_atomic
      or journal.credit_atomic <> conversion.converted_amount_atomic
    );

  -- 승인된 원화 입금과 DEPOSIT 분개·투영·아웃박스를 비교만 한다.
  insert into public.reconciliation_mismatches (
    run_id,
    mismatch_type,
    subject_type,
    subject_id,
    expected_value,
    actual_value
  )
  select
    v_run_id,
    'APPROVED_DEPOSIT_JOURNAL_MISMATCH',
    'deposit_request',
    request.id::text,
    jsonb_build_object(
      'currency', 'KRW',
      'approved_amount_atomic', expected.amount_atomic::text,
      'journal_count', 1,
      'projection_count', 1,
      'outbox_count', 1
    ),
    jsonb_build_object(
      'journal_count', journal_summary.journal_count,
      'debit_atomic', coalesce(journal_summary.debit_atomic, 0)::text,
      'credit_atomic', coalesce(journal_summary.credit_atomic, 0)::text,
      'projection_count', projection_summary.projection_count,
      'projection_atomic', coalesce(projection_summary.amount_atomic, 0)::text,
      'outbox_count', event_summary.event_count
    )
  from public.deposit_requests as request
  cross join lateral (
    select coalesce(
      request.approved_amount_atomic,
      (
        select ledger.amount_atomic
        from public.wallet_ledger as ledger
        where ledger.reference_type = 'deposit_request'
          and ledger.reference_id = request.id
          and ledger.entry_type = 'DEPOSIT'
          and ledger.direction = 'CREDIT'
        order by ledger.created_at
        limit 1
      ),
      request.amount_atomic
    )::numeric(38, 0) as amount_atomic
  ) as expected
  left join lateral (
    select
      count(distinct transaction.id)::integer as journal_count,
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0) as debit_atomic,
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0) as credit_atomic
    from public.ledger_transactions as transaction
    left join public.ledger_entries as entry on entry.transaction_id = transaction.id
    left join public.ledger_accounts as account on account.id = entry.account_id
    where transaction.reference_type = 'deposit_request'
      and transaction.reference_id = request.id
      and transaction.category = 'DEPOSIT'
      and transaction.currency = 'KRW'::public.currency_code
  ) as journal_summary on true
  left join lateral (
    select
      count(*)::integer as projection_count,
      coalesce(sum(ledger.amount_atomic), 0)::numeric(38, 0) as amount_atomic
    from public.wallet_ledger as ledger
    where ledger.reference_type = 'deposit_request'
      and ledger.reference_id = request.id
      and ledger.entry_type = 'DEPOSIT'
      and ledger.direction = 'CREDIT'
  ) as projection_summary on true
  left join lateral (
    select count(*)::integer as event_count
    from public.outbox_events as event
    where event.aggregate_id = request.id
      and event.event_type = 'DEPOSIT_CONFIRMED.v1'
  ) as event_summary on true
  where request.status = 'APPROVED'
    and request.currency = 'KRW'::public.currency_code
    and (
      journal_summary.journal_count <> 1
      or journal_summary.debit_atomic <> expected.amount_atomic
      or journal_summary.credit_atomic <> expected.amount_atomic
      or projection_summary.projection_count <> 1
      or projection_summary.amount_atomic <> expected.amount_atomic
      or event_summary.event_count <> 1
    );

  -- hold 중 부채 순액과 지갑 총잔액을 같다고 보지 않는다.
  -- 지갑 총잔액 = 부채 순액 + 분개된 미해제 hold.
  insert into public.reconciliation_mismatches (
    run_id,
    mismatch_type,
    subject_type,
    subject_id,
    expected_value,
    actual_value
  )
  select
    v_run_id,
    'KRW_WALLET_LIABILITY_HOLD_PARITY',
    'wallet_account',
    wallet.id::text,
    jsonb_build_object(
      'wallet_total_atomic', totals.wallet_net::text,
      'formula', 'liability_net + posted_open_hold'
    ),
    jsonb_build_object(
      'liability_net_atomic', totals.liability_net::text,
      'posted_open_hold_atomic', totals.open_hold::text,
      'ui_total_atomic', totals.wallet_net::text
    )
  from public.wallet_accounts as wallet
  cross join lateral (
    select
      coalesce((
        select sum(
          case
            when entry.direction = 'CREDIT' then entry.amount_atomic
            else -entry.amount_atomic
          end
        )
        from public.wallet_ledger as entry
        where entry.wallet_account_id = wallet.id
      ), 0)::numeric(38, 0) as wallet_net,
      coalesce((
        select sum(
          case
            when entry.side = 'CREDIT' then entry.amount_atomic
            else -entry.amount_atomic
          end
        )
        from public.ledger_entries as entry
        join public.ledger_accounts as liability on liability.id = entry.account_id
        where liability.owner_user_id = wallet.user_id
          and liability.currency = 'KRW'::public.currency_code
          and liability.account_class = 'LIABILITY'
          and liability.closed_at is null
      ), 0)::numeric(38, 0) as liability_net,
      coalesce((
        select sum(request.amount_atomic + request.fee_atomic)
        from public.withdrawal_requests as request
        where request.user_id = wallet.user_id
          and request.currency = 'KRW'::public.currency_code
          and request.wallet_account_id = wallet.id
          and request.hold_ledger_transaction_id is not null
          and request.release_ledger_transaction_id is null
          and request.finalize_ledger_transaction_id is null
          and request.status in (
            'REQUESTED',
            'HELD',
            'ADMIN_PROCESSING',
            'EXTERNAL_SENT_RECORDED',
            'REVIEWING',
            'APPROVED',
            'PROCESSING'
          )
      ), 0)::numeric(38, 0) as open_hold
  ) as totals
  where wallet.currency = 'KRW'::public.currency_code
    and wallet.closed_at is null
    and totals.wallet_net <> totals.liability_net + totals.open_hold;

  insert into public.reconciliation_mismatches (
    run_id,
    mismatch_type,
    subject_type,
    subject_id,
    expected_value,
    actual_value
  )
  select
    v_run_id,
    'EXTERNAL_SEND_LINK_MISMATCH',
    'withdrawal_request',
    request.id::text,
    jsonb_build_object(
      'currency', 'KRW',
      'destination_id', request.withdrawal_destination_id,
      'method', request.destination_type,
      'finalize_amount_atomic', (request.amount_atomic + request.fee_atomic)::text
    ),
    jsonb_build_object(
      'send_id', send.id,
      'send_method', send.method,
      'actual_krw_amount', send.actual_krw_amount,
      'actual_usdt_amount', send.actual_usdt_amount::text,
      'finalize_currency', finalize_journal.currency,
      'finalize_debit_atomic', coalesce(finalize_journal.debit_atomic, 0)::text
    )
  from public.withdrawal_requests as request
  left join public.withdrawal_external_sends as send
    on send.withdrawal_id = request.id
  left join lateral (
    select
      transaction.currency,
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'DEBIT'), 0) as debit_atomic,
      coalesce(sum(entry.amount_atomic) filter (where entry.side = 'CREDIT'), 0) as credit_atomic
    from public.ledger_transactions as transaction
    left join public.ledger_entries as entry on entry.transaction_id = transaction.id
    where transaction.id = request.finalize_ledger_transaction_id
    group by transaction.currency
  ) as finalize_journal on true
  where request.status in ('COMPLETED', 'LEDGER_FINALIZED')
    and request.currency = 'KRW'::public.currency_code
    and (
      send.id is null
      or send.method is distinct from request.destination_type
      or request.withdrawal_destination_id is null
      or request.finalize_ledger_transaction_id is null
      or finalize_journal.currency is distinct from 'KRW'::public.currency_code
      or finalize_journal.debit_atomic <> (request.amount_atomic + request.fee_atomic)::numeric(38, 0)
      or finalize_journal.credit_atomic <> (request.amount_atomic + request.fee_atomic)::numeric(38, 0)
      or (
        request.destination_type = 'KRW_BANK'
        and send.actual_krw_amount is null
      )
      or (
        request.destination_type = 'USDT_ADDRESS'
        and send.actual_usdt_amount is null
      )
    );

  select
    (select count(*) from public.ledger_transactions)
      + (select count(*) from public.trial_reward_conversions)
      + (
        select count(*)
        from public.deposit_requests
        where status = 'APPROVED'
          and currency = 'KRW'::public.currency_code
      )
      + (
        select count(*)
        from public.wallet_accounts
        where currency = 'KRW'::public.currency_code
          and closed_at is null
      ),
    (select count(*) from public.reconciliation_mismatches where run_id = v_run_id)
  into v_checked_count, v_mismatch_count;

  update public.reconciliation_runs
  set
    status = 'SUCCEEDED',
    checked_count = v_checked_count,
    mismatch_count = v_mismatch_count,
    totals = jsonb_build_object(
      'ledger_transactions', (select count(*) from public.ledger_transactions),
      'welcome_conversions', (select count(*) from public.trial_reward_conversions),
      'approved_krw_deposits', (
        select count(*)
        from public.deposit_requests
        where status = 'APPROVED'
          and currency = 'KRW'::public.currency_code
      )
    ),
    completed_at = statement_timestamp()
  where id = v_run_id;

  return v_run_id;
end;
$$;

revoke all on function public.fail_outbox_event(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.fail_system_job(uuid, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.run_financial_reconciliation(uuid)
  from public, anon, authenticated;

grant execute on function public.fail_outbox_event(uuid, text, text, integer) to service_role;
grant execute on function public.fail_system_job(uuid, text, text, text, integer) to service_role;
grant execute on function public.run_financial_reconciliation(uuid) to service_role;

comment on function public.fail_outbox_event(uuid, text, text, integer) is
  'Lease-owned outbox failure. Unsupported types and incompatible safe-mode envelopes become DEAD_LETTER on that attempt. Other failures stay retryable until max attempts.';
comment on function public.fail_system_job(uuid, text, text, text, integer) is
  'Lease-owned job failure. PERMANENT error class or exhausted attempts become DEAD_LETTER. Retryable failures stay FAILED.';
comment on function public.run_financial_reconciliation(uuid) is
  'Read-only financial checker. The same request id returns the existing succeeded run and never auto-repairs money.';

commit;
