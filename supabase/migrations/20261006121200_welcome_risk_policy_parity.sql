begin;

-- Match the established deterministic welcome-reward qualification rule.
-- Shared IP alone is evidence, never automatic rejection. Material identity
-- reuse is held even at MEDIUM; other HIGH/CRITICAL findings remain blocking.
-- Existing conversion identity, cap, ledger, source capture and outbox remain.

create or replace function public.convert_trial_welcome_reward(
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
      and flag.flag_code <> 'SHARED_IP'
      and (
        flag.severity in ('HIGH', 'CRITICAL')
        or (flag.flag_code = 'IDENTITY_REUSE' and flag.severity = 'MEDIUM')
      )
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
      'blocking_risk_flags', 0,
      'shared_ip_alone_rejects', false,
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

commit;
