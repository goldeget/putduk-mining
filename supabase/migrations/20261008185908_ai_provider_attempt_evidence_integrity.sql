begin;
-- Refinements follow the applied foundation; no historical migration is rewritten.
alter table app_private.ai_provider_budget add constraint ai_paid_authorization_present
  check (not paid_enabled or (authorization_reference is not null and char_length(btrim(authorization_reference)) >= 8));
alter table app_private.ai_provider_attempts add constraint ai_provider_exact_approved_model
  check ((provider = 'nvidia' and model_key in ('openai/gpt-oss-20b','google/diffusiongemma-26b-a4b-it'))
    or (provider = 'openrouter' and not paid and model_key = 'apodex/apodex-1.1-mini:free')
    or (provider = 'openrouter' and paid and model_key = 'anthropic/claude-haiku-5.5'));
create or replace function public.reserve_ai_provider_attempt(
  p_user_id uuid, p_request_id uuid, p_attempt_key text, p_provider text,
  p_model_key text, p_max_cost_micro_usd bigint, p_paid boolean
) returns jsonb language plpgsql volatile security definer set search_path = pg_catalog as $$
declare request public.ai_requests%rowtype; attempt app_private.ai_provider_attempts%rowtype;
  budget app_private.ai_provider_budget%rowtype; member_limit bigint; member_committed numeric;
begin
  perform app_private.assert_ai_provider_executor();
  if p_user_id is null or p_request_id is null or p_paid is null
    or char_length(btrim(coalesce(p_attempt_key, ''))) not between 8 and 160
    or p_provider is null or p_provider not in ('nvidia', 'openrouter')
    or char_length(btrim(coalesce(p_model_key, ''))) not between 1 and 160
    or p_max_cost_micro_usd is null or p_max_cost_micro_usd not between 0 and 10000000
    or (p_paid and p_max_cost_micro_usd = 0) or (not p_paid and p_max_cost_micro_usd <> 0)
    or (p_provider = 'openrouter' and p_paid is distinct from (right(p_model_key, 5) <> ':free'))
    or (p_provider = 'nvidia' and (p_paid or p_model_key not in ('openai/gpt-oss-20b','google/diffusiongemma-26b-a4b-it')))
    or (p_provider = 'openrouter' and not p_paid and p_model_key <> 'apodex/apodex-1.1-mini:free')
    or (p_provider = 'openrouter' and p_paid and p_model_key <> 'anthropic/claude-haiku-5.5') then
    raise exception using errcode = '22023', message = 'AI_PROVIDER_ATTEMPT_INVALID';
  end if;
  -- Every admission locks in this order. Unknown/dispatched paid attempts retain
  -- their reservation; timers and request cancellation do not return that budget.
  select * into budget from app_private.ai_provider_budget where scope = 'GLOBAL' for update;
  select * into request from public.ai_requests where id = p_request_id and user_id = p_user_id for update;
  if request.id is null then raise exception using errcode = '42501', message = 'AI_REQUEST_NOT_OWNED'; end if;
  select * into attempt from app_private.ai_provider_attempts where request_id = p_request_id and attempt_key = p_attempt_key for update;
  if attempt.id is not null then
    if attempt.user_id is distinct from p_user_id or attempt.provider is distinct from p_provider
      or attempt.model_key is distinct from p_model_key or attempt.paid is distinct from p_paid
      or attempt.reserved_cost_micro_usd is distinct from p_max_cost_micro_usd then
      raise exception using errcode = '55000', message = 'AI_PROVIDER_ATTEMPT_REPLAY_MISMATCH';
    end if;
    return app_private.ai_provider_attempt_json(attempt, true);
  end if;
  if request.status <> 'RUNNING' then raise exception using errcode = '55000', message = 'AI_REQUEST_NOT_RUNNING'; end if;
  if p_provider = 'openrouter' and not p_paid and not exists (
    select 1 from app_private.ai_openrouter_free_admissions where request_id = p_request_id and user_id = p_user_id
  ) then raise exception using errcode = '55000', message = 'AI_OPENROUTER_FREE_ADMISSION_REQUIRED'; end if;
  if p_paid then
    if budget.blocked or not budget.paid_enabled or budget.authorization_reference is null then
      raise exception using errcode = '42501', message = 'AI_PAID_EXECUTION_NOT_AUTHORIZED';
    end if;
    select cap_micro_usd into member_limit from app_private.ai_provider_member_limits where user_id = p_user_id;
    if member_limit is null then raise exception using errcode = '42501', message = 'AI_MEMBER_PAID_LIMIT_NOT_AUTHORIZED'; end if;
    select coalesce(sum(coalesce(charged_cost_micro_usd, reserved_cost_micro_usd)), 0) into member_committed
      from app_private.ai_provider_attempts where user_id = p_user_id and paid and status <> 'NOT_SENT';
    if member_committed + p_max_cost_micro_usd > member_limit
      or budget.spent_micro_usd + budget.reserved_micro_usd + p_max_cost_micro_usd > budget.cap_micro_usd then
      raise exception using errcode = 'P0001', message = 'AI_PAID_BUDGET_EXHAUSTED';
    end if;
    update app_private.ai_provider_budget set reserved_micro_usd = reserved_micro_usd + p_max_cost_micro_usd where scope = 'GLOBAL';
  end if;
  insert into app_private.ai_provider_attempts(user_id, request_id, attempt_key, provider, model_key, paid, reserved_cost_micro_usd)
    values (p_user_id, p_request_id, p_attempt_key, p_provider, p_model_key, p_paid, p_max_cost_micro_usd) returning * into attempt;
  insert into app_private.ai_provider_attempt_events(attempt_id, revision, status, evidence)
    values(attempt.id, 0, 'RESERVED', jsonb_build_object('requestId', p_request_id, 'provider', p_provider,
      'model', p_model_key, 'paid', p_paid, 'reservedCostMicroUsd', p_max_cost_micro_usd::text));
  return app_private.ai_provider_attempt_json(attempt, false);
end;
$$;


create or replace function public.settle_ai_provider_attempt(
  p_user_id uuid, p_request_id uuid, p_attempt_id uuid, p_provider_request_id text,
  p_status text, p_input_tokens bigint, p_output_tokens bigint,
  p_cached_input_tokens bigint, p_cost_micro_usd bigint
) returns jsonb language plpgsql volatile security definer set search_path = pg_catalog as $$
declare attempt app_private.ai_provider_attempts%rowtype; release_budget boolean;
begin
  perform app_private.assert_ai_provider_executor();
  if p_status is null or p_status not in ('DISPATCHED','SUCCEEDED','FAILED','CANCELLED','UNKNOWN','NOT_SENT')
    or p_input_tokens < 0 or p_output_tokens < 0 or p_cached_input_tokens < 0 or p_cost_micro_usd < 0
    or (p_provider_request_id is not null and char_length(p_provider_request_id) not between 1 and 200)
    or (p_status = 'DISPATCHED' and (p_provider_request_id is not null or p_input_tokens is not null
      or p_output_tokens is not null or p_cached_input_tokens is not null or p_cost_micro_usd is not null)) then
    raise exception using errcode = '22023', message = 'AI_PROVIDER_SETTLEMENT_INVALID';
  end if;
  perform 1 from app_private.ai_provider_budget where scope = 'GLOBAL' for update;
  select * into attempt from app_private.ai_provider_attempts
    where id = p_attempt_id and request_id = p_request_id and user_id = p_user_id for update;
  if attempt.id is null then raise exception using errcode = '42501', message = 'AI_PROVIDER_ATTEMPT_NOT_OWNED'; end if;
  if attempt.status = p_status and attempt.provider_request_id is not distinct from p_provider_request_id
    and attempt.input_tokens is not distinct from p_input_tokens and attempt.output_tokens is not distinct from p_output_tokens
    and attempt.cached_input_tokens is not distinct from p_cached_input_tokens
    and attempt.reported_cost_micro_usd is not distinct from p_cost_micro_usd then
    return app_private.ai_provider_attempt_json(attempt, true);
  end if;
  if (p_status = 'DISPATCHED' and attempt.status <> 'RESERVED')
    or (p_status = 'NOT_SENT' and (attempt.status <> 'RESERVED' or p_cost_micro_usd is distinct from 0::bigint
      or p_provider_request_id is not null or coalesce(p_input_tokens,0) <> 0 or coalesce(p_output_tokens,0) <> 0
      or coalesce(p_cached_input_tokens,0) <> 0))
    or (p_status not in ('DISPATCHED','NOT_SENT') and attempt.status not in ('DISPATCHED','UNKNOWN')
      and not (p_status = attempt.status and attempt.status in ('SUCCEEDED','FAILED','CANCELLED')
        and attempt.charged_cost_micro_usd is null and attempt.budget_released_at is null)) then
    raise exception using errcode = '55000', message = 'AI_PROVIDER_ATTEMPT_TRANSITION_INVALID';
  end if;
  -- Known provider evidence can be refined from NULL, never rewritten.
  if (attempt.provider_request_id is not null and attempt.provider_request_id is distinct from p_provider_request_id)
    or (attempt.input_tokens is not null and attempt.input_tokens is distinct from p_input_tokens)
    or (attempt.output_tokens is not null and attempt.output_tokens is distinct from p_output_tokens)
    or (attempt.cached_input_tokens is not null and attempt.cached_input_tokens is distinct from p_cached_input_tokens)
    or (attempt.reported_cost_micro_usd is not null and attempt.reported_cost_micro_usd is distinct from p_cost_micro_usd) then
    raise exception using errcode = '55000', message = 'AI_PROVIDER_EVIDENCE_IMMUTABLE';
  end if;
  if not attempt.paid and p_cost_micro_usd > 0 then
    raise exception using errcode = '55000', message = 'AI_FREE_PROVIDER_REPORTED_PAID_COST';
  end if;
  release_budget := p_status = 'NOT_SENT'
    or (p_status in ('SUCCEEDED','FAILED','CANCELLED') and p_cost_micro_usd is not null);
  if attempt.paid and release_budget then
    -- Unexpected provider overage is recorded honestly and disables subsequent
    -- paid calls. It must never be converted into zero or silently discarded.
    update app_private.ai_provider_budget set
      reserved_micro_usd = reserved_micro_usd - attempt.reserved_cost_micro_usd,
      spent_micro_usd = spent_micro_usd + p_cost_micro_usd,
      blocked = blocked or p_cost_micro_usd > attempt.reserved_cost_micro_usd
        or spent_micro_usd + reserved_micro_usd - attempt.reserved_cost_micro_usd + p_cost_micro_usd > cap_micro_usd
      where scope = 'GLOBAL';
  end if;
  update app_private.ai_provider_attempts set status = p_status, revision = revision + 1,
    provider_request_id = p_provider_request_id, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    cached_input_tokens = p_cached_input_tokens, reported_cost_micro_usd = p_cost_micro_usd,
    charged_cost_micro_usd = case when release_budget then p_cost_micro_usd else null end,
    dispatched_at = case when p_status = 'DISPATCHED' then clock_timestamp() else dispatched_at end,
    completed_at = case when p_status in ('SUCCEEDED','FAILED','CANCELLED','NOT_SENT') then clock_timestamp() else null end,
    budget_released_at = case when release_budget then clock_timestamp() else null end
    where id = attempt.id returning * into attempt;
  insert into app_private.ai_provider_attempt_events(attempt_id, revision, status, evidence)
    values (attempt.id, attempt.revision, attempt.status, jsonb_build_object('providerRequestId',p_provider_request_id,
      'inputTokens',p_input_tokens::text,'outputTokens',p_output_tokens::text,'cachedInputTokens',p_cached_input_tokens::text,
      'reportedCostMicroUsd',p_cost_micro_usd::text,'budgetReleased',release_budget));
  return app_private.ai_provider_attempt_json(attempt, false);
end;
$$;


create function public.read_ai_provider_usage(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog as $$
declare result jsonb; member_cap bigint; member_enabled boolean;
begin
  perform app_private.assert_ai_provider_executor();
  if p_user_id is null or not exists (select 1 from auth.users where id=p_user_id) then
    raise exception using errcode='42501', message='AI_REQUEST_NOT_OWNED';
  end if;
  select limits.cap_micro_usd, budget.paid_enabled and not budget.blocked
    into member_cap, member_enabled from app_private.ai_provider_member_limits limits
    cross join app_private.ai_provider_budget budget where limits.user_id=p_user_id and budget.scope='GLOBAL';
  with lanes(lane) as (values ('nvidia'),('free'),('paid')),
  usage as (select case when provider='nvidia' then 'nvidia' when paid then 'paid' else 'free' end lane,
    count(*) attempt_count,
    count(*) filter(where status='SUCCEEDED') succeeded,
    count(*) filter(where status='FAILED') failed,
    count(*) filter(where status='CANCELLED') cancelled,
    count(*) filter(where status='UNKNOWN' or (dispatched_at is not null and charged_cost_micro_usd is null)) unknown,
    case when count(*) filter(where input_tokens is null and status<>'NOT_SENT')=0 then coalesce(sum(input_tokens),0)::text end input_tokens,
    case when count(*) filter(where output_tokens is null and status<>'NOT_SENT')=0 then coalesce(sum(output_tokens),0)::text end output_tokens,
    case when count(*) filter(where charged_cost_micro_usd is null and status<>'NOT_SENT')=0 then coalesce(sum(charged_cost_micro_usd),0)::text end cost_micro_usd,
    coalesce(sum(reserved_cost_micro_usd) filter(where paid and budget_released_at is null),0)::text reserved_micro_usd
    from app_private.ai_provider_attempts where user_id=p_user_id group by 1)
  select jsonb_object_agg(lanes.lane,jsonb_build_object('attemptCount',coalesce(usage.attempt_count,0),
    'succeeded',coalesce(usage.succeeded,0),'failed',coalesce(usage.failed,0),
    'cancelled',coalesce(usage.cancelled,0),'unknown',coalesce(usage.unknown,0),
    'inputTokens',usage.input_tokens,'outputTokens',usage.output_tokens,
    'costMicroUsd',usage.cost_micro_usd,'reservedCostMicroUsd',coalesce(usage.reserved_micro_usd,'0')))
    into result from lanes left join usage using(lane);
  return result || jsonb_build_object('memberPaidEnabled',coalesce(member_enabled,false),'memberPaidCapMicroUsd',member_cap::text);
end;
$$;
revoke all on function public.read_ai_provider_usage(uuid) from public,anon,authenticated;
grant execute on function public.read_ai_provider_usage(uuid) to service_role;
commit;
