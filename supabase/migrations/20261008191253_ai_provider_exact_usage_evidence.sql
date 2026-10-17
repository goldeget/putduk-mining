begin;
-- Preserve original exact provider nano USD separately from rounded budget micro USD.
alter table app_private.ai_provider_attempts add column provider_cost_nano_usd bigint check(provider_cost_nano_usd>=0),
  add column upstream_provider text check(char_length(btrim(upstream_provider)) between 1 and 120);
drop function public.settle_ai_provider_attempt(uuid,uuid,uuid,text,text,bigint,bigint,bigint,bigint);
create or replace function public.settle_ai_provider_attempt(
  p_user_id uuid, p_request_id uuid, p_attempt_id uuid, p_provider_request_id text,
  p_status text, p_input_tokens bigint, p_output_tokens bigint,
  p_cached_input_tokens bigint, p_cost_micro_usd bigint,
  p_cost_nano_usd bigint default null, p_upstream_provider text default null
) returns jsonb language plpgsql volatile security definer set search_path = pg_catalog as $$
declare attempt app_private.ai_provider_attempts%rowtype; release_budget boolean;
begin
  perform app_private.assert_ai_provider_executor();
  if p_cost_nano_usd < 0 or (p_cost_nano_usd is not null and
    p_cost_micro_usd is distinct from ceil(p_cost_nano_usd::numeric/1000)::bigint)
    or (p_upstream_provider is not null and char_length(btrim(p_upstream_provider)) not between 1 and 120) then
    raise exception using errcode='22023',message='AI_PROVIDER_EXACT_USAGE_INVALID';
  end if;
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
    and attempt.reported_cost_micro_usd is not distinct from p_cost_micro_usd
    and attempt.provider_cost_nano_usd is not distinct from p_cost_nano_usd
    and attempt.upstream_provider is not distinct from p_upstream_provider then
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
  if (attempt.provider_cost_nano_usd is not null and attempt.provider_cost_nano_usd is distinct from p_cost_nano_usd)
    or (attempt.upstream_provider is not null and attempt.upstream_provider is distinct from p_upstream_provider) then
    raise exception using errcode='55000',message='AI_PROVIDER_EVIDENCE_IMMUTABLE';
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
    provider_cost_nano_usd=p_cost_nano_usd, upstream_provider=p_upstream_provider,
    provider_request_id = p_provider_request_id, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    cached_input_tokens = p_cached_input_tokens, reported_cost_micro_usd = p_cost_micro_usd,
    charged_cost_micro_usd = case when release_budget then p_cost_micro_usd else null end,
    dispatched_at = case when p_status = 'DISPATCHED' then clock_timestamp() else dispatched_at end,
    completed_at = case when p_status in ('SUCCEEDED','FAILED','CANCELLED','NOT_SENT') then clock_timestamp() else null end,
    budget_released_at = case when release_budget then clock_timestamp() else null end
    where id = attempt.id returning * into attempt;
  insert into app_private.ai_provider_attempt_events(attempt_id, revision, status, evidence)
    values (attempt.id, attempt.revision, attempt.status, jsonb_build_object('providerRequestId',p_provider_request_id,
      'providerCostNanoUsd',p_cost_nano_usd::text,'upstreamProvider',p_upstream_provider,
      'inputTokens',p_input_tokens::text,'outputTokens',p_output_tokens::text,'cachedInputTokens',p_cached_input_tokens::text,
      'reportedCostMicroUsd',p_cost_micro_usd::text,'budgetReleased',release_budget));
  return app_private.ai_provider_attempt_json(attempt, false);
end;
$$;



revoke all on function public.settle_ai_provider_attempt(uuid,uuid,uuid,text,text,bigint,bigint,bigint,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.settle_ai_provider_attempt(uuid,uuid,uuid,text,text,bigint,bigint,bigint,bigint,bigint,text) to service_role;
commit;
