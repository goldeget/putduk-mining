begin;

alter table public.withdrawal_policies
  add column allows_welcome_reward boolean not null default false,
  add constraint withdrawal_policies_welcome_shape check (
    not allows_welcome_reward
    or (currency = 'KRW' and fee_atomic = 0)
  );

alter table public.withdrawal_requests
  add column withdrawal_destination_id uuid
    references public.withdrawal_destinations (id) on delete restrict,
  add column welcome_reward_conversion_id uuid
    references public.trial_reward_conversions (id) on delete restrict;

create unique index withdrawal_requests_welcome_conversion_unique_idx
  on public.withdrawal_requests (welcome_reward_conversion_id)
  where welcome_reward_conversion_id is not null;

create or replace function public.bootstrap_user(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1 from auth.users as auth_user where auth_user.id = p_user_id
  ) then
    raise exception using errcode = '22023', message = 'AUTH_USER_NOT_FOUND';
  end if;

  insert into public.user_profiles (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.user_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.notification_preferences (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.wallet_accounts (user_id, currency)
  values
    (p_user_id, 'KRW'::public.currency_code),
    (p_user_id, 'USDT'::public.currency_code)
  on conflict (user_id, currency) do nothing;

  insert into public.ledger_accounts (
    code,
    currency,
    account_class,
    normal_side,
    owner_user_id
  ) values
    (
      'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY',
      'KRW',
      'LIABILITY',
      'CREDIT',
      p_user_id
    ),
    (
      'USER:' || upper(p_user_id::text) || ':USDT:LIABILITY',
      'USDT',
      'LIABILITY',
      'CREDIT',
      p_user_id
    )
  on conflict (code) do nothing;

  insert into public.member_lifecycle_states (user_id, stage)
  values (p_user_id, 'SIGNED_UP')
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.bootstrap_user(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_user(uuid) to service_role;

create function public.convert_trial_welcome_reward(
  p_user_id uuid,
  p_idempotency_key text,
  p_request_id uuid,
  p_rule_version integer,
  p_risk_model_version text
)
returns table (
  conversion_id uuid,
  ledger_transaction_id uuid,
  converted_amount_atomic bigint,
  was_created boolean
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_trial public.trial_accounts%rowtype;
  v_completion public.trial_completions%rowtype;
  v_existing public.trial_reward_conversions%rowtype;
  v_wallet_account_id uuid;
  v_wallet_ledger_id uuid;
  v_member_ledger_account_id uuid;
  v_expense_ledger_account_id uuid;
  v_conversion_id uuid;
  v_ledger_transaction_id uuid;
  v_eligible_amount bigint;
  v_amount bigint;
  v_correlation_id uuid := gen_random_uuid();
begin
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_request_id is null or p_rule_version <= 0
    or char_length(btrim(coalesce(p_risk_model_version, ''))) not between 1 and 80
  then
    raise exception using errcode = '22023', message = 'INVALID_CONVERSION_CONTEXT';
  end if;

  if exists (
    select 1
    from public.safe_mode_controls as control
    where control.component in ('GLOBAL', 'TRIAL')
      and control.is_paused
      and control.starts_at <= statement_timestamp()
  ) then
    raise exception using errcode = '55000', message = 'WELCOME_REWARD_CONVERSION_PAUSED';
  end if;

  select conversion.*
  into v_existing
  from public.trial_reward_conversions as conversion
  where conversion.user_id = p_user_id
    and conversion.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    return query select
      v_existing.id,
      v_existing.ledger_transaction_id,
      v_existing.converted_amount_atomic,
      false;
    return;
  end if;

  select account.*
  into v_trial
  from public.trial_accounts as account
  where account.user_id = p_user_id
  for update;

  if v_trial.id is null then
    raise exception using errcode = '55000', message = 'TRIAL_ACCOUNT_NOT_FOUND';
  end if;

  select conversion.*
  into v_existing
  from public.trial_reward_conversions as conversion
  where conversion.trial_account_id = v_trial.id;

  if v_existing.id is not null then
    return query select
      v_existing.id,
      v_existing.ledger_transaction_id,
      v_existing.converted_amount_atomic,
      false;
    return;
  end if;

  select completion.*
  into v_completion
  from public.trial_completions as completion
  where completion.trial_account_id = v_trial.id;

  if v_completion.id is null or v_trial.status <> 'COMPLETED' then
    raise exception using errcode = '55000', message = 'TRIAL_NOT_COMPLETED';
  end if;

  if not exists (
    select 1
    from public.kyc_cases as kyc
    where kyc.user_id = p_user_id
      and kyc.status = 'APPROVED'
  ) then
    raise exception using errcode = '55000', message = 'WELCOME_REWARD_KYC_REQUIRED';
  end if;

  if exists (
    select 1
    from public.risk_flags as flag
    where flag.user_id = p_user_id
      and flag.resolved_at is null
      and flag.severity in ('HIGH', 'CRITICAL')
  ) then
    raise exception using errcode = '55000', message = 'WELCOME_REWARD_RISK_REVIEW_REQUIRED';
  end if;

  v_eligible_amount := v_completion.final_reward_atomic;
  v_amount := least(v_eligible_amount, 5000::bigint);
  if v_amount <= 0 then
    raise exception using errcode = '22003', message = 'WELCOME_REWARD_AMOUNT_UNAVAILABLE';
  end if;

  insert into public.ledger_accounts (
    code,
    currency,
    account_class,
    normal_side,
    is_controlled_asset
  ) values (
    'PUTDUK:WELCOME_REWARD_EXPENSE:KRW',
    'KRW',
    'EXPENSE',
    'DEBIT',
    false
  )
  on conflict (code) do nothing;

  insert into public.ledger_accounts (
    code,
    currency,
    account_class,
    normal_side,
    owner_user_id
  ) values (
    'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY',
    'KRW',
    'LIABILITY',
    'CREDIT',
    p_user_id
  )
  on conflict (code) do nothing;

  select account.id into v_expense_ledger_account_id
  from public.ledger_accounts as account
  where account.code = 'PUTDUK:WELCOME_REWARD_EXPENSE:KRW';

  select account.id into v_member_ledger_account_id
  from public.ledger_accounts as account
  where account.code = 'USER:' || upper(p_user_id::text) || ':KRW:LIABILITY';

  select wallet.id into v_wallet_account_id
  from public.wallet_accounts as wallet
  where wallet.user_id = p_user_id
    and wallet.currency = 'KRW'
    and wallet.closed_at is null
  for update;

  if v_wallet_account_id is null then
    raise exception using errcode = '55000', message = 'KRW_WALLET_NOT_FOUND';
  end if;

  insert into public.trial_reward_conversions (
    trial_account_id,
    user_id,
    status,
    eligible_amount_atomic,
    converted_amount_atomic,
    cap_amount_atomic,
    funding_required,
    rule_version,
    risk_model_version,
    idempotency_key,
    qualified_at
  ) values (
    v_trial.id,
    p_user_id,
    'APPROVED',
    v_eligible_amount,
    null,
    5000,
    false,
    p_rule_version,
    p_risk_model_version,
    p_idempotency_key,
    statement_timestamp()
  ) returning id into v_conversion_id;

  insert into public.trial_qualification_snapshots (
    conversion_id,
    rule_version,
    risk_model_version,
    kyc_status,
    decision,
    evidence
  ) values (
    v_conversion_id,
    p_rule_version,
    p_risk_model_version,
    'APPROVED',
    'APPROVED',
    jsonb_build_object(
      'trial_completed', true,
      'trial_reward_atomic', v_eligible_amount::text,
      'funding_required', false,
      'unresolved_high_risk_flags', 0,
      'hard_cap_atomic', 5000
    )
  );

  insert into public.ledger_transactions (
    category,
    currency,
    idempotency_key,
    reference_type,
    reference_id,
    member_user_id,
    request_id,
    correlation_id,
    description,
    metadata
  ) values (
    'TRIAL_REWARD_CONVERSION',
    'KRW',
    p_idempotency_key || ':ledger',
    'trial_reward_conversion',
    v_conversion_id,
    p_user_id,
    p_request_id,
    v_correlation_id,
    'PUTDUK START welcome reward conversion',
    jsonb_build_object('funding_required', false, 'cap_atomic', 5000)
  ) returning id into v_ledger_transaction_id;

  insert into public.ledger_entries (
    transaction_id, account_id, sequence, side, amount_atomic
  ) values
    (v_ledger_transaction_id, v_expense_ledger_account_id, 0, 'DEBIT', v_amount),
    (v_ledger_transaction_id, v_member_ledger_account_id, 1, 'CREDIT', v_amount);

  insert into public.wallet_ledger (
    wallet_account_id,
    user_id,
    direction,
    entry_type,
    amount_atomic,
    idempotency_key,
    reference_type,
    reference_id,
    reason
  ) values (
    v_wallet_account_id,
    p_user_id,
    'CREDIT',
    'TRIAL_REWARD_CONVERSION',
    v_amount,
    p_idempotency_key || ':wallet',
    'trial_reward_conversion',
    v_conversion_id,
    'PUTDUK START qualified welcome reward'
  ) returning id into v_wallet_ledger_id;

  update public.trial_reward_conversions
  set
    status = 'CONVERTED',
    converted_amount_atomic = v_amount,
    ledger_transaction_id = v_ledger_transaction_id,
    wallet_ledger_id = v_wallet_ledger_id,
    converted_at = statement_timestamp()
  where id = v_conversion_id;

  insert into public.outbox_events (
    event_type,
    schema_version,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    payload,
    correlation_id,
    request_id,
    idempotency_key
  ) values (
    'TRIAL_REWARD_CONVERTED.v1',
    1,
    'trial_reward_conversion',
    v_conversion_id,
    p_user_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'amount_atomic', v_amount::text,
      'currency', 'KRW',
      'funding_required', false,
      'ledger_transaction_id', v_ledger_transaction_id
    ),
    v_correlation_id,
    p_request_id,
    p_idempotency_key || ':event'
  );

  insert into public.member_lifecycle_states (user_id, stage, stage_reached_at)
  values (p_user_id, 'TRIAL_COMPLETED', statement_timestamp())
  on conflict (user_id) do update
  set
    stage = case
      when public.member_lifecycle_states.stage in ('SIGNED_UP', 'TRIAL_STARTED', 'FIRST_MINING')
        then 'TRIAL_COMPLETED'::public.member_lifecycle_stage
      else public.member_lifecycle_states.stage
    end,
    stage_reached_at = case
      when public.member_lifecycle_states.stage in ('SIGNED_UP', 'TRIAL_STARTED', 'FIRST_MINING')
        then statement_timestamp()
      else public.member_lifecycle_states.stage_reached_at
    end;

  return query select v_conversion_id, v_ledger_transaction_id, v_amount, true;
end;
$$;

revoke all on function public.convert_trial_welcome_reward(uuid, text, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.convert_trial_welcome_reward(uuid, text, uuid, integer, text)
  to service_role;

create function public.create_welcome_reward_withdrawal_request(
  p_user_id uuid,
  p_conversion_id uuid,
  p_withdrawal_policy_id uuid,
  p_destination_id uuid,
  p_idempotency_key text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_conversion public.trial_reward_conversions%rowtype;
  v_policy public.withdrawal_policies%rowtype;
  v_destination public.withdrawal_destinations%rowtype;
  v_balance bigint;
  v_held bigint;
  v_wallet_account_id uuid;
  v_request_id uuid;
  v_correlation_id uuid := gen_random_uuid();
begin
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200
    or p_request_id is null
  then
    raise exception using errcode = '22023', message = 'INVALID_WITHDRAWAL_CONTEXT';
  end if;


  if exists (
    select 1
    from public.safe_mode_controls as control
    where control.component in ('GLOBAL', 'WITHDRAWAL')
      and control.is_paused
      and control.starts_at <= statement_timestamp()
  ) then
    raise exception using errcode = '55000', message = 'WELCOME_WITHDRAWAL_PAUSED';
  end if;

  select request.id into v_request_id
  from public.withdrawal_requests as request
  where request.user_id = p_user_id
    and request.idempotency_key = p_idempotency_key;
  if v_request_id is not null then
    return v_request_id;
  end if;

  select conversion.* into v_conversion
  from public.trial_reward_conversions as conversion
  where conversion.id = p_conversion_id
    and conversion.user_id = p_user_id
    and conversion.status = 'CONVERTED'
  for update;
  if v_conversion.id is null then
    raise exception using errcode = '55000', message = 'WELCOME_REWARD_NOT_WITHDRAWABLE';
  end if;

  if exists (
    select 1 from public.withdrawal_requests as request
    where request.welcome_reward_conversion_id = p_conversion_id
  ) then
    raise exception using errcode = '23505', message = 'WELCOME_REWARD_WITHDRAWAL_EXISTS';
  end if;

  select policy.* into v_policy
  from public.withdrawal_policies as policy
  where policy.id = p_withdrawal_policy_id
    and policy.currency = 'KRW'
    and policy.is_enabled
    and policy.allows_welcome_reward
    and policy.fee_atomic = 0
    and policy.effective_at <= statement_timestamp()
    and (policy.expires_at is null or policy.expires_at > statement_timestamp());
  if v_policy.id is null then
    raise exception using errcode = '55000', message = 'WELCOME_WITHDRAWAL_POLICY_UNAVAILABLE';
  end if;

  select destination.* into v_destination
  from public.withdrawal_destinations as destination
  where destination.id = p_destination_id
    and destination.user_id = p_user_id
    and destination.destination_type = 'KRW_BANK'
    and destination.verification_status = 'VERIFIED'
    and destination.replaced_at is null
    and destination.protection_until <= statement_timestamp();
  if v_destination.id is null then
    raise exception using errcode = '55000', message = 'VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED';
  end if;

  if v_policy.destination_type <> v_destination.destination_type then
    raise exception using errcode = '22023', message = 'WITHDRAWAL_DESTINATION_POLICY_MISMATCH';
  end if;

  select account.id into v_wallet_account_id
  from public.wallet_accounts as account
  where account.user_id = p_user_id
    and account.currency = 'KRW'
    and account.closed_at is null
  for update;
  if v_wallet_account_id is null then
    raise exception using errcode = '55000', message = 'KRW_WALLET_NOT_FOUND';
  end if;

  select coalesce(sum(
    case when ledger.direction = 'CREDIT' then ledger.amount_atomic else -ledger.amount_atomic end
  ), 0)::bigint
  into v_balance
  from public.wallet_ledger as ledger
  where ledger.wallet_account_id = v_wallet_account_id;

  select coalesce(sum(request.amount_atomic + request.fee_atomic), 0)::bigint
  into v_held
  from public.withdrawal_requests as request
  where request.wallet_account_id = v_wallet_account_id
    and request.status in ('REQUESTED', 'REVIEWING', 'APPROVED', 'PROCESSING');

  if v_balance - v_held < v_conversion.converted_amount_atomic then
    raise exception using errcode = '22003', message = 'INSUFFICIENT_AVAILABLE_BALANCE';
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
    idempotency_key
  ) values (
    v_wallet_account_id,
    v_policy.id,
    v_destination.id,
    v_conversion.id,
    p_user_id,
    'KRW',
    v_conversion.converted_amount_atomic,
    0,
    'KRW_BANK',
    jsonb_build_object(
      'destination_id', v_destination.id,
      'display', v_destination.display_hint,
      'verified_at', v_destination.verified_at
    ),
    p_idempotency_key
  ) returning id into v_request_id;

  insert into public.outbox_events (
    event_type,
    schema_version,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    payload,
    correlation_id,
    request_id,
    idempotency_key
  ) values (
    'WITHDRAWAL_REQUESTED.v1',
    1,
    'withdrawal_request',
    v_request_id,
    p_user_id,
    jsonb_build_object(
      'user_id', p_user_id,
      'amount_atomic', v_conversion.converted_amount_atomic::text,
      'currency', 'KRW',
      'welcome_reward', true,
      'funding_required', false
    ),
    v_correlation_id,
    p_request_id,
    p_idempotency_key || ':event'
  );

  insert into public.transaction_receipts (
    receipt_number,
    user_id,
    transaction_type,
    source_type,
    source_id,
    amount_atomic,
    currency,
    status,
    requested_at,
    status_timeline
  ) values (
    'PDK-WELCOME-' || upper(replace(v_request_id::text, '-', '')),
    p_user_id,
    'WELCOME_REWARD_WITHDRAWAL',
    'withdrawal_request',
    v_request_id,
    v_conversion.converted_amount_atomic,
    'KRW',
    'REQUESTED',
    statement_timestamp(),
    jsonb_build_array(jsonb_build_object('status', 'REQUESTED', 'at', statement_timestamp()))
  );

  return v_request_id;
end;
$$;

revoke all on function public.create_welcome_reward_withdrawal_request(
  uuid, uuid, uuid, uuid, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_welcome_reward_withdrawal_request(
  uuid, uuid, uuid, uuid, text, uuid
) to service_role;

comment on function public.convert_trial_welcome_reward(uuid, text, uuid, integer, text) is
  'Service-only exactly-once PUTDUK START conversion: KYC/risk gate, <=5000 KRW balanced journal, wallet projection and outbox in one transaction.';
comment on function public.create_welcome_reward_withdrawal_request(uuid, uuid, uuid, uuid, text, uuid) is
  'Service-only verified-destination first withdrawal. No deposit or funding prerequisite is queried.';

create function public.run_financial_reconciliation(p_request_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_checked_count bigint;
  v_mismatch_count bigint;
  v_run_id uuid;
begin
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'RECONCILIATION_REQUEST_ID_REQUIRED';
  end if;

  insert into public.reconciliation_runs (request_id, scope)
  values (p_request_id, 'FINANCIAL_CORE')
  returning id into v_run_id;

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

  select
    (select count(*) from public.ledger_transactions)
      + (select count(*) from public.trial_reward_conversions),
    (select count(*) from public.reconciliation_mismatches where run_id = v_run_id)
  into v_checked_count, v_mismatch_count;

  update public.reconciliation_runs
  set
    status = 'SUCCEEDED',
    checked_count = v_checked_count,
    mismatch_count = v_mismatch_count,
    totals = jsonb_build_object(
      'ledger_transactions', (select count(*) from public.ledger_transactions),
      'welcome_conversions', (select count(*) from public.trial_reward_conversions)
    ),
    completed_at = statement_timestamp()
  where id = v_run_id;

  return v_run_id;
end;
$$;

revoke all on function public.run_financial_reconciliation(uuid)
  from public, anon, authenticated;
grant execute on function public.run_financial_reconciliation(uuid) to service_role;

comment on function public.run_financial_reconciliation(uuid) is
  'Read-only financial checker that records journal and welcome-reward projection mismatches; it never auto-repairs money.';

create function public.claim_outbox_events(
  p_worker_id text,
  p_batch_size integer default 50,
  p_lease_seconds integer default 60
)
returns setof public.outbox_events
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 120
    or p_batch_size not between 1 and 200
    or p_lease_seconds not between 10 and 3600
  then
    raise exception using errcode = '22023', message = 'INVALID_OUTBOX_CLAIM_CONTEXT';
  end if;

  update public.outbox_events as event
  set
    status = 'DEAD_LETTER',
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = coalesce(event.last_error_code, 'MAX_ATTEMPTS_EXHAUSTED')
  where event.attempt_count >= event.max_attempts
    and (
      event.status in ('PENDING', 'FAILED')
      or (event.status = 'PROCESSING' and event.lease_expires_at < statement_timestamp())
    );

  return query
  with candidates as (
    select event.id
    from public.outbox_events as event
    where event.attempt_count < event.max_attempts
      and (
        (event.status in ('PENDING', 'FAILED') and event.available_at <= statement_timestamp())
        or (event.status = 'PROCESSING' and event.lease_expires_at < statement_timestamp())
      )
    order by event.available_at, event.created_at, event.id
    for update skip locked
    limit p_batch_size
  )
  update public.outbox_events as event
  set
    status = 'PROCESSING',
    attempt_count = event.attempt_count + 1,
    lease_owner = p_worker_id,
    lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
    last_error_code = null
  from candidates
  where event.id = candidates.id
  returning event.*;
end;
$$;

create function public.complete_outbox_event(
  p_event_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  update public.outbox_events as event
  set
    status = 'PROCESSED',
    processed_at = statement_timestamp(),
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = null
  where event.id = p_event_id
    and event.status = 'PROCESSING'
    and event.lease_owner = p_worker_id
    and event.lease_expires_at >= statement_timestamp();

  if not found then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;
end;
$$;

create function public.fail_outbox_event(
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
begin
  if char_length(btrim(coalesce(p_error_code, ''))) not between 1 and 120
    or p_retry_delay_seconds not between 0 and 86400
  then
    raise exception using errcode = '22023', message = 'INVALID_OUTBOX_FAILURE_CONTEXT';
  end if;

  update public.outbox_events as event
  set
    status = case
      when event.attempt_count >= event.max_attempts
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

create function public.claim_system_jobs(
  p_worker_id text,
  p_batch_size integer default 25,
  p_lease_seconds integer default 120
)
returns setof public.system_jobs
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if char_length(btrim(coalesce(p_worker_id, ''))) not between 1 and 120
    or p_batch_size not between 1 and 100
    or p_lease_seconds not between 10 and 3600
  then
    raise exception using errcode = '22023', message = 'INVALID_JOB_CLAIM_CONTEXT';
  end if;

  update public.system_jobs as job
  set
    status = 'DEAD_LETTER',
    lease_owner = null,
    lease_expires_at = null,
    dead_lettered_at = statement_timestamp(),
    last_error_code = coalesce(job.last_error_code, 'MAX_ATTEMPTS_EXHAUSTED')
  where job.attempts >= job.max_attempts
    and (
      job.status in ('PENDING', 'FAILED')
      or (job.status = 'RUNNING' and job.lease_expires_at < statement_timestamp())
    );

  return query
  with candidates as (
    select job.id
    from public.system_jobs as job
    where job.attempts < job.max_attempts
      and (
        (job.status in ('PENDING', 'FAILED') and job.available_at <= statement_timestamp())
        or (job.status = 'RUNNING' and job.lease_expires_at < statement_timestamp())
      )
    order by job.priority, job.available_at, job.created_at, job.id
    for update skip locked
    limit p_batch_size
  ), claimed as (
    update public.system_jobs as job
    set
      status = 'RUNNING',
      attempts = job.attempts + 1,
      started_at = coalesce(job.started_at, statement_timestamp()),
      lease_owner = p_worker_id,
      lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
      last_error_code = null
    from candidates
    where job.id = candidates.id
    returning job.*
  ), attempts as (
    insert into public.system_job_attempts (
      job_id, attempt_number, worker_id, status, started_at
    )
    select claimed.id, claimed.attempts, p_worker_id, 'RUNNING', statement_timestamp()
    from claimed
    returning job_id
  )
  select claimed.*
  from claimed
  join attempts on attempts.job_id = claimed.id;
end;
$$;

create function public.complete_system_job(
  p_job_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_attempt integer;
begin
  update public.system_jobs as job
  set
    status = 'SUCCEEDED',
    completed_at = statement_timestamp(),
    lease_owner = null,
    lease_expires_at = null,
    last_error_code = null
  where job.id = p_job_id
    and job.status = 'RUNNING'
    and job.lease_owner = p_worker_id
    and job.lease_expires_at >= statement_timestamp()
  returning job.attempts into v_attempt;

  if v_attempt is null then
    raise exception using errcode = '55000', message = 'JOB_LEASE_NOT_OWNED';
  end if;

  update public.system_job_attempts
  set status = 'SUCCEEDED', completed_at = statement_timestamp()
  where job_id = p_job_id and attempt_number = v_attempt;
end;
$$;

create function public.fail_system_job(
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
begin
  if char_length(btrim(coalesce(p_error_code, ''))) not between 1 and 120
    or char_length(btrim(coalesce(p_error_class, ''))) not between 1 and 120
    or p_retry_delay_seconds not between 0 and 86400
  then
    raise exception using errcode = '22023', message = 'INVALID_JOB_FAILURE_CONTEXT';
  end if;

  update public.system_jobs as job
  set
    status = case
      when job.attempts >= job.max_attempts
        then 'DEAD_LETTER'::public.system_job_status
      else 'FAILED'::public.system_job_status
    end,
    available_at = statement_timestamp() + make_interval(secs => p_retry_delay_seconds),
    lease_owner = null,
    lease_expires_at = null,
    dead_lettered_at = case
      when job.attempts >= job.max_attempts then statement_timestamp()
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

revoke all on function public.claim_outbox_events(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_outbox_event(uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_outbox_event(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.claim_system_jobs(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.complete_system_job(uuid, text)
  from public, anon, authenticated;
revoke all on function public.fail_system_job(uuid, text, text, text, integer)
  from public, anon, authenticated;

grant execute on function public.claim_outbox_events(text, integer, integer) to service_role;
grant execute on function public.complete_outbox_event(uuid, text) to service_role;
grant execute on function public.fail_outbox_event(uuid, text, text, integer) to service_role;
grant execute on function public.claim_system_jobs(text, integer, integer) to service_role;
grant execute on function public.complete_system_job(uuid, text) to service_role;
grant execute on function public.fail_system_job(uuid, text, text, text, integer) to service_role;

comment on function public.claim_outbox_events(text, integer, integer) is
  'Durable SKIP LOCKED event claim with expiring worker leases and bounded attempts.';
comment on function public.claim_system_jobs(text, integer, integer) is
  'Durable priority job claim with attempt history, expiring leases and dead-letter exhaustion.';

-- AI-assisted proposal only. It remains DRAFT and therefore is invisible to
-- public catalog policies until an operator reviews, approves and publishes it.
insert into public.product_catalog_versions (
  id,
  version,
  status,
  snapshot_date,
  methodology,
  source_references,
  content_digest,
  proposed_by
) values (
  '20000000-0000-4000-8000-000000000001',
  1,
  'DRAFT',
  date '2026-09-27',
  'AI-assisted neutral launch proposal. Category coverage uses current public symbol/listing references and a dated crypto market-cap snapshot. Selection favors recognizability and category breadth, does not assert investment quality or expected return, and requires operator review before publication. No price is stored or used by PUTDUK rules.',
  jsonb_build_array(
    jsonb_build_object(
      'name', 'KRX Data System',
      'url', 'https://data.krx.co.kr/contents/MDC/MAIN/main.jspx',
      'accessed_on', '2026-09-27',
      'purpose', 'Korean listing and identifier review'
    ),
    jsonb_build_object(
      'name', 'Nasdaq Trader Symbol Lookup',
      'url', 'https://nasdaqtrader.com/Trader.aspx?id=symbollookup',
      'accessed_on', '2026-09-27',
      'purpose', 'U.S. symbol verification'
    ),
    jsonb_build_object(
      'name', 'LBMA',
      'url', 'https://www.lbma.org.uk/',
      'accessed_on', '2026-09-27',
      'purpose', 'Gold and silver category identity'
    ),
    jsonb_build_object(
      'name', 'CoinMarketCap historical snapshot',
      'url', 'https://coinmarketcap.com/historical/20260901/',
      'snapshot_on', '2026-09-01',
      'accessed_on', '2026-09-27',
      'purpose', 'Large-cap crypto category proposal'
    )
  ),
  encode(extensions.digest('putduk-catalog-v1-draft-2026-09-27'::text, 'sha256'), 'hex'),
  'AI_ASSISTED'
)
on conflict (version) do nothing;

insert into public.mining_products (
  id,
  catalog_version_id,
  world_id,
  code,
  slug,
  category,
  name_ko,
  name_en,
  description_ko,
  display_order,
  is_featured,
  trial_available,
  display_profile
)
select
  proposal.id::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  world.id,
  proposal.code,
  proposal.slug,
  proposal.category::public.product_category,
  proposal.name_ko,
  proposal.name_en,
  proposal.description_ko,
  proposal.display_order,
  proposal.is_featured,
  proposal.trial_available,
  proposal.display_profile::jsonb
from (
  values
    ('30000000-0000-4000-8000-000000000001', 'KOREA', '005930', 'samsung-electronics', 'KR_STOCK', '삼성전자 테마', 'Samsung Electronics Theme', 'PUTDUK 내부 규칙으로 운영되는 한국 대표 기업 가상 채굴 테마입니다.', 1, true, true, '{"difficulty":"neutral","risk":"display_only"}'),
    ('30000000-0000-4000-8000-000000000002', 'KOREA', '000660', 'sk-hynix', 'KR_STOCK', 'SK하이닉스 테마', 'SK hynix Theme', 'PUTDUK 내부 규칙으로 운영되는 한국 대표 기업 가상 채굴 테마입니다.', 2, false, false, '{"difficulty":"neutral","risk":"display_only"}'),
    ('30000000-0000-4000-8000-000000000003', 'USA', 'AAPL', 'apple', 'US_STOCK', '애플 테마', 'Apple Theme', 'PUTDUK 내부 규칙으로 운영되는 미국 대표 기업 가상 채굴 테마입니다.', 3, true, false, '{"difficulty":"neutral","risk":"display_only"}'),
    ('30000000-0000-4000-8000-000000000004', 'USA', 'MSFT', 'microsoft', 'US_STOCK', '마이크로소프트 테마', 'Microsoft Theme', 'PUTDUK 내부 규칙으로 운영되는 미국 대표 기업 가상 채굴 테마입니다.', 4, false, false, '{"difficulty":"neutral","risk":"display_only"}'),
    ('30000000-0000-4000-8000-000000000005', 'USA', 'NVDA', 'nvidia', 'US_STOCK', '엔비디아 테마', 'NVIDIA Theme', 'PUTDUK 내부 규칙으로 운영되는 미국 대표 기업 가상 채굴 테마입니다.', 5, false, false, '{"difficulty":"neutral","risk":"display_only"}'),
    ('30000000-0000-4000-8000-000000000006', 'GOLD', 'XAU', 'gold', 'GOLD', '골드 테마', 'Gold Theme', '외부 가격이 아닌 PUTDUK 내부 규칙으로 운영되는 골드 가상 채굴 테마입니다.', 6, true, false, '{"difficulty":"neutral","risk":"display_only"}'),
    ('30000000-0000-4000-8000-000000000007', 'SILVER', 'XAG', 'silver', 'SILVER', '실버 테마', 'Silver Theme', '외부 가격이 아닌 PUTDUK 내부 규칙으로 운영되는 실버 가상 채굴 테마입니다.', 7, false, false, '{"difficulty":"neutral","risk":"display_only"}'),
    ('30000000-0000-4000-8000-000000000008', 'CRYPTO', 'BTC', 'bitcoin', 'CRYPTO', '비트코인 테마', 'Bitcoin Theme', '시세와 무관한 PUTDUK 내부 규칙 기반 크립토 가상 채굴 테마입니다.', 8, true, false, '{"difficulty":"neutral","risk":"display_only"}'),
    ('30000000-0000-4000-8000-000000000009', 'CRYPTO', 'ETH', 'ethereum', 'CRYPTO', '이더리움 테마', 'Ethereum Theme', '시세와 무관한 PUTDUK 내부 규칙 기반 크립토 가상 채굴 테마입니다.', 9, false, false, '{"difficulty":"neutral","risk":"display_only"}'),
    ('30000000-0000-4000-8000-000000000010', 'CRYPTO', 'BNB', 'bnb', 'CRYPTO', 'BNB 테마', 'BNB Theme', '시세와 무관한 PUTDUK 내부 규칙 기반 크립토 가상 채굴 테마입니다.', 10, false, false, '{"difficulty":"neutral","risk":"display_only"}'),
    ('30000000-0000-4000-8000-000000000011', 'CRYPTO', 'XRP', 'xrp', 'CRYPTO', 'XRP 테마', 'XRP Theme', '시세와 무관한 PUTDUK 내부 규칙 기반 크립토 가상 채굴 테마입니다.', 11, false, false, '{"difficulty":"neutral","risk":"display_only"}')
) as proposal (
  id, world_code, code, slug, category, name_ko, name_en, description_ko,
  display_order, is_featured, trial_available, display_profile
)
join public.asset_worlds as world on world.code::text = proposal.world_code
on conflict (catalog_version_id, code) do nothing;

commit;
