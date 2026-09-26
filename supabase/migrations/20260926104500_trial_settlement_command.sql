begin;

create function public.settle_trial(
  p_user_id uuid,
  p_idempotency_key text
)
returns table (
  trial_account_id uuid,
  status public.trial_status,
  quota_consumed_bps integer,
  reward_atomic bigint,
  completion_reason public.trial_completion_reason
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_account public.trial_accounts%rowtype;
  v_completion_reason public.trial_completion_reason;
  v_curve_id uuid;
  v_elapsed_seconds integer;
  v_existing_status text;
  v_idempotency_id uuid;
  v_now timestamptz := statement_timestamp();
  v_previous public.trial_reward_curve_points%rowtype;
  v_next public.trial_reward_curve_points%rowtype;
  v_quota_bps integer;
  v_reward_bps integer;
  v_reward_delta bigint;
  v_session public.trial_sessions%rowtype;
  v_settle_to timestamptz;
  v_target_reward_atomic bigint;
begin
  if char_length(btrim(coalesce(p_idempotency_key, ''))) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_IDEMPOTENCY_KEY';
  end if;

  insert into app_private.idempotency_keys (
    scope,
    actor_id,
    idempotency_key,
    request_hash,
    status,
    locked_until
  ) values (
    'trial.settle',
    p_user_id,
    p_idempotency_key,
    encode(extensions.digest(p_user_id::text, 'sha256'), 'hex'),
    'PROCESSING',
    v_now + interval '5 minutes'
  )
  on conflict (scope, actor_id, idempotency_key) do nothing
  returning id into v_idempotency_id;

  if v_idempotency_id is null then
    select key_record.status
    into v_existing_status
    from app_private.idempotency_keys as key_record
    where key_record.scope = 'trial.settle'
      and key_record.actor_id = p_user_id
      and key_record.idempotency_key = p_idempotency_key;

    if v_existing_status <> 'COMPLETED' then
      raise exception using errcode = '40001', message = 'TRIAL_SETTLEMENT_IN_PROGRESS';
    end if;
  end if;

  select account.*
  into v_account
  from public.trial_accounts as account
  where account.user_id = p_user_id
  for update;

  if v_account.id is null then
    raise exception using errcode = 'P0001', message = 'TRIAL_ACCOUNT_NOT_FOUND';
  end if;

  if v_existing_status = 'COMPLETED'
    or v_account.status in ('COMPLETED', 'EXPIRED')
  then
    select completion.reason
    into v_completion_reason
    from public.trial_completions as completion
    where completion.trial_account_id = v_account.id;

    if v_idempotency_id is not null then
      update app_private.idempotency_keys
      set
        status = 'COMPLETED',
        response_status = 200,
        response_payload = jsonb_build_object('trial_account_id', v_account.id),
        completed_at = statement_timestamp(),
        locked_until = null
      where id = v_idempotency_id;
    end if;

    return query
    select
      v_account.id,
      v_account.status,
      v_account.quota_consumed_bps,
      v_account.reward_atomic,
      v_completion_reason;
    return;
  end if;

  if v_account.status <> 'ACTIVE'
    or v_account.started_at is null
    or v_account.expires_at is null
    or v_account.last_settled_at is null
  then
    raise exception using errcode = '55000', message = 'TRIAL_NOT_ACTIVE';
  end if;

  select session.*
  into v_session
  from public.trial_sessions as session
  where session.trial_account_id = v_account.id
    and session.user_id = p_user_id
    and session.ended_at is null
  order by session.started_at desc
  limit 1
  for update;

  if v_session.id is null then
    raise exception using errcode = 'P0001', message = 'ACTIVE_TRIAL_SESSION_MISSING';
  end if;

  v_settle_to := least(v_now, v_account.expires_at);

  select curve.id
  into v_curve_id
  from public.trial_reward_curves as curve
  where curve.trial_program_id = v_account.trial_program_id
    and curve.effective_at <= v_account.started_at
  order by curve.effective_at desc, curve.version desc
  limit 1;

  if v_curve_id is null then
    raise exception using errcode = 'P0001', message = 'TRIAL_REWARD_CURVE_UNAVAILABLE';
  end if;

  v_elapsed_seconds := greatest(
    0,
    floor(extract(epoch from v_settle_to - v_account.started_at))::integer
  );

  select point.*
  into v_previous
  from public.trial_reward_curve_points as point
  where point.trial_reward_curve_id = v_curve_id
    and point.elapsed_seconds <= v_elapsed_seconds
  order by point.elapsed_seconds desc
  limit 1;

  select point.*
  into v_next
  from public.trial_reward_curve_points as point
  where point.trial_reward_curve_id = v_curve_id
    and point.elapsed_seconds >= v_elapsed_seconds
  order by point.elapsed_seconds asc
  limit 1;

  if v_previous.id is null or v_next.id is null then
    raise exception using errcode = 'P0001', message = 'TRIAL_REWARD_CURVE_INCOMPLETE';
  end if;

  if v_previous.elapsed_seconds = v_next.elapsed_seconds then
    v_quota_bps := v_previous.cumulative_quota_bps;
    v_reward_bps := v_previous.cumulative_reward_bps;
  else
    v_quota_bps := v_previous.cumulative_quota_bps + floor(
      (v_next.cumulative_quota_bps - v_previous.cumulative_quota_bps)::numeric
      * (v_elapsed_seconds - v_previous.elapsed_seconds)::numeric
      / (v_next.elapsed_seconds - v_previous.elapsed_seconds)::numeric
    )::integer;
    v_reward_bps := v_previous.cumulative_reward_bps + floor(
      (v_next.cumulative_reward_bps - v_previous.cumulative_reward_bps)::numeric
      * (v_elapsed_seconds - v_previous.elapsed_seconds)::numeric
      / (v_next.elapsed_seconds - v_previous.elapsed_seconds)::numeric
    )::integer;
  end if;

  v_quota_bps := least(10000, v_quota_bps);
  v_reward_bps := least(10000, v_reward_bps);
  v_target_reward_atomic := floor(
    v_account.target_reward_krw * v_reward_bps::numeric / 10000
  )::bigint;

  if v_quota_bps < v_account.quota_consumed_bps
    or v_target_reward_atomic < v_account.reward_atomic
  then
    raise exception using errcode = 'P0001', message = 'TRIAL_REWARD_CURVE_NON_MONOTONIC';
  end if;

  v_reward_delta := v_target_reward_atomic - v_account.reward_atomic;

  if v_reward_delta > 0 then
    insert into public.trial_ledger (
      trial_account_id,
      user_id,
      direction,
      entry_type,
      amount_atomic,
      idempotency_key,
      source_type,
      source_id
    ) values (
      v_account.id,
      p_user_id,
      'CREDIT',
      'MINING_REWARD',
      v_reward_delta,
      p_idempotency_key,
      'trial_session',
      v_session.id
    );
  end if;

  if v_quota_bps >= 10000 then
    v_completion_reason := 'QUOTA';
  elsif v_settle_to >= v_account.expires_at then
    v_completion_reason := 'TIME';
  else
    v_completion_reason := null;
  end if;

  update public.trial_accounts
  set
    quota_consumed_bps = v_quota_bps,
    reward_atomic = v_target_reward_atomic,
    last_settled_at = v_settle_to,
    status = case
      when v_completion_reason is null then 'ACTIVE'::public.trial_status
      else 'COMPLETED'::public.trial_status
    end
  where id = v_account.id;

  update public.trial_sessions
  set
    last_settled_at = v_settle_to,
    ended_at = case
      when v_completion_reason is null then null
      else v_settle_to
    end
  where id = v_session.id;

  if v_completion_reason is not null then
    insert into public.trial_completions (
      trial_account_id,
      user_id,
      reason,
      final_quota_bps,
      final_reward_atomic,
      completed_at
    ) values (
      v_account.id,
      p_user_id,
      v_completion_reason,
      v_quota_bps,
      v_target_reward_atomic,
      v_settle_to
    )
    on conflict on constraint trial_completions_trial_account_id_key do nothing;
  end if;

  update app_private.idempotency_keys
  set
    status = 'COMPLETED',
    response_status = 200,
    response_payload = jsonb_build_object(
      'trial_account_id', v_account.id,
      'status', case when v_completion_reason is null then 'ACTIVE' else 'COMPLETED' end,
      'quota_consumed_bps', v_quota_bps,
      'reward_atomic', v_target_reward_atomic
    ),
    completed_at = statement_timestamp(),
    locked_until = null
  where id = v_idempotency_id;

  return query
  select
    v_account.id,
    case
      when v_completion_reason is null then 'ACTIVE'::public.trial_status
      else 'COMPLETED'::public.trial_status
    end,
    v_quota_bps,
    v_target_reward_atomic,
    v_completion_reason;
end;
$$;

revoke all on function public.settle_trial(uuid, text)
  from public, anon, authenticated;
grant execute on function public.settle_trial(uuid, text) to service_role;

comment on function public.settle_trial(uuid, text) is
  'Service-only, server-time trial settlement with interpolated versioned curve, idempotency, append-only ledger delta, and atomic completion.';

commit;
