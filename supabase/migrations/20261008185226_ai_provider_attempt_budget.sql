begin;

-- LOCAL recovery: original Cloud T23-25 require provider evidence, separately
-- counted free calls and an atomic cumulative USD 10 ceiling. No paid execution
-- is enabled by this migration, an environment flag, or a provider API key.
create table app_private.ai_provider_budget (
  scope text primary key check (scope = 'GLOBAL'),
  cap_micro_usd bigint not null check (cap_micro_usd = 10000000),
  spent_micro_usd bigint not null default 0 check (spent_micro_usd >= 0),
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  paid_enabled boolean not null default false,
  blocked boolean not null default false,
  authorization_reference text,
  check (not paid_enabled or char_length(btrim(authorization_reference)) >= 8),
  check (spent_micro_usd + reserved_micro_usd <= cap_micro_usd or blocked)
);
insert into app_private.ai_provider_budget(scope, cap_micro_usd) values ('GLOBAL', 10000000);

create table app_private.ai_provider_member_limits (
  user_id uuid primary key references auth.users(id),
  cap_micro_usd bigint not null check (cap_micro_usd between 1 and 10000000),
  authorization_reference text not null check (char_length(btrim(authorization_reference)) >= 8)
);

create table app_private.ai_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  request_id uuid not null references public.ai_requests(id),
  attempt_key text not null check (char_length(btrim(attempt_key)) between 8 and 160),
  provider text not null check (provider in ('nvidia', 'openrouter')),
  model_key text not null check (char_length(btrim(model_key)) between 1 and 160),
  paid boolean not null,
  reserved_cost_micro_usd bigint not null check (reserved_cost_micro_usd >= 0),
  charged_cost_micro_usd bigint check (charged_cost_micro_usd >= 0),
  reported_cost_micro_usd bigint check (reported_cost_micro_usd >= 0),
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  cached_input_tokens bigint check (cached_input_tokens >= 0),
  provider_request_id text check (char_length(provider_request_id) between 1 and 200),
  status text not null default 'RESERVED'
    check (status in ('RESERVED','DISPATCHED','SUCCEEDED','FAILED','CANCELLED','UNKNOWN','NOT_SENT')),
  revision integer not null default 0 check (revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  budget_released_at timestamptz,
  unique (request_id, attempt_key),
  check ((paid and reserved_cost_micro_usd > 0) or (not paid and reserved_cost_micro_usd = 0)),
  check (provider <> 'openrouter' or paid = (right(model_key, 5) <> ':free')),
  check (provider <> 'nvidia' or not paid),
  check ((provider = 'nvidia' and model_key in ('openai/gpt-oss-20b','google/diffusiongemma-26b-a4b-it'))
    or (provider = 'openrouter' and not paid and model_key = 'apodex/apodex-1.1-mini:free')
    or (provider = 'openrouter' and paid and model_key = 'anthropic/claude-haiku-5.5'))
);
create index ai_provider_attempts_member_budget_idx on app_private.ai_provider_attempts(user_id) where paid;

create table app_private.ai_provider_attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references app_private.ai_provider_attempts(id),
  revision integer not null,
  status text not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  occurred_at timestamptz not null default clock_timestamp(),
  unique (attempt_id, revision)
);
create trigger ai_provider_attempt_events_append_only
before update or delete on app_private.ai_provider_attempt_events
for each row execute function app_private.prevent_row_mutation();

create table app_private.ai_openrouter_free_admissions (
  request_id uuid primary key references public.ai_requests(id),
  user_id uuid not null references auth.users(id),
  admitted_at timestamptz not null default clock_timestamp()
);
create index ai_openrouter_free_admissions_member_time_idx
  on app_private.ai_openrouter_free_admissions(user_id, admitted_at);
create trigger ai_openrouter_free_admissions_append_only
before update or delete on app_private.ai_openrouter_free_admissions
for each row execute function app_private.prevent_row_mutation();

do $lock$
declare target text;
begin
  foreach target in array array['ai_provider_budget','ai_provider_member_limits',
    'ai_provider_attempts','ai_provider_attempt_events','ai_openrouter_free_admissions'] loop
    execute format('alter table app_private.%I enable row level security', target);
    execute format('alter table app_private.%I force row level security', target);
    execute format('revoke all on app_private.%I from public, anon, authenticated, service_role', target);
  end loop;
end;
$lock$;

create function app_private.assert_ai_provider_executor() returns void
language plpgsql stable security invoker set search_path = pg_catalog as $$
begin
  if current_user <> 'postgres' or current_setting('role', true) is distinct from 'service_role'
    or auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'AI_PROVIDER_SERVICE_EXECUTOR_REQUIRED';
  end if;
end;
$$;
revoke all on function app_private.assert_ai_provider_executor() from public, anon, authenticated, service_role;

create function app_private.ai_provider_attempt_json(p_attempt app_private.ai_provider_attempts, p_replay boolean)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  select jsonb_build_object('id', p_attempt.id, 'status', p_attempt.status, 'replay', p_replay,
    'reservedCostMicroUsd', p_attempt.reserved_cost_micro_usd::text,
    'chargedCostMicroUsd', p_attempt.charged_cost_micro_usd::text,
    'reportedCostMicroUsd', p_attempt.reported_cost_micro_usd::text,
    'inputTokens', p_attempt.input_tokens::text, 'outputTokens', p_attempt.output_tokens::text,
    'cachedInputTokens', p_attempt.cached_input_tokens::text);
$$;
revoke all on function app_private.ai_provider_attempt_json(app_private.ai_provider_attempts, boolean)
  from public, anon, authenticated, service_role;

create function public.admit_openrouter_free_request(
  p_request_id uuid, p_user_id uuid, p_per_minute_limit integer, p_per_day_limit integer
) returns jsonb language plpgsql volatile security definer set search_path = pg_catalog as $$
declare request public.ai_requests%rowtype; existing app_private.ai_openrouter_free_admissions%rowtype;
begin
  perform app_private.assert_ai_provider_executor();
  if p_per_minute_limit is null or p_per_minute_limit not between 1 and 5
    or p_per_day_limit is null or p_per_day_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'AI_OPENROUTER_FREE_LIMIT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('putduk-ai-free:' || p_user_id::text, 0));
  select * into request from public.ai_requests where id = p_request_id and user_id = p_user_id for update;
  if request.id is null then raise exception using errcode = '42501', message = 'AI_REQUEST_NOT_OWNED'; end if;
  select * into existing from app_private.ai_openrouter_free_admissions where request_id = p_request_id;
  if existing.request_id is not null then
    return jsonb_build_object('admitted', true, 'replay', true, 'requestId', p_request_id);
  end if;
  if request.status <> 'RUNNING' then
    raise exception using errcode = '55000', message = 'AI_REQUEST_NOT_RUNNING';
  end if;
  if (select count(*) from app_private.ai_openrouter_free_admissions
      where user_id = p_user_id and admitted_at >= clock_timestamp() - interval '1 minute') >= p_per_minute_limit then
    raise exception using errcode = 'P0001', message = 'AI_OPENROUTER_FREE_RATE_LIMITED_MINUTE';
  end if;
  if (select count(*) from app_private.ai_openrouter_free_admissions
      where user_id = p_user_id and admitted_at >= clock_timestamp() - interval '24 hours') >= p_per_day_limit then
    raise exception using errcode = 'P0001', message = 'AI_OPENROUTER_FREE_RATE_LIMITED_DAY';
  end if;
  insert into app_private.ai_openrouter_free_admissions(request_id, user_id) values (p_request_id, p_user_id);
  return jsonb_build_object('admitted', true, 'replay', false, 'requestId', p_request_id);
end;
$$;

create function public.reserve_ai_provider_attempt(
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

create function public.settle_ai_provider_attempt(
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

revoke all on function public.admit_openrouter_free_request(uuid,uuid,integer,integer)
  from public, anon, authenticated;
revoke all on function public.reserve_ai_provider_attempt(uuid,uuid,text,text,text,bigint,boolean)
  from public, anon, authenticated;
revoke all on function public.settle_ai_provider_attempt(uuid,uuid,uuid,text,text,bigint,bigint,bigint,bigint)
  from public, anon, authenticated;
grant execute on function public.admit_openrouter_free_request(uuid,uuid,integer,integer),
  public.reserve_ai_provider_attempt(uuid,uuid,text,text,text,bigint,boolean),
  public.settle_ai_provider_attempt(uuid,uuid,uuid,text,text,bigint,bigint,bigint,bigint) to service_role;

commit;
