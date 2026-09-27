begin;

alter table public.ai_requests
  add column route_kind text,
  add column route_key text,
  add column context_scope text,
  add column tool_name text;

alter table public.ai_requests
  add constraint ai_requests_route_kind
    check (
      route_kind is null
      or route_kind in (
        'cache',
        'general_safe',
        'high_capability',
        'low_cost',
        'static',
        'tool',
        'ui_help'
      )
    ),
  add constraint ai_requests_route_key_format
    check (
      route_key is null
      or route_key ~ '^[a-z][a-z0-9_]{1,79}$'
    ),
  add constraint ai_requests_context_scope
    check (
      context_scope is null
      or context_scope in (
        'ACCOUNT_STATE',
        'GENERAL_SAFE',
        'PUBLIC_FACTS_ONLY',
        'UI_HELP'
      )
    ),
  add constraint ai_requests_safety_classification_v2
    check (
      safety_classification is null
      or safety_classification in (
        'ABUSE_EVASION',
        'ACCOUNT_STATE',
        'ACTION_BOUNDARY',
        'CLARIFICATION',
        'CROSS_USER_DATA',
        'GENERAL_SAFE',
        'INTERNAL_DATA_REQUEST',
        'PRIVILEGE_ESCALATION',
        'PROMPT_INJECTION',
        'PUBLIC_FACTS_ONLY',
        'PUTDUK_KNOWLEDGE',
        'STATIC_FACT',
        'UI_HELP'
      )
    ),
  add constraint ai_requests_tool_name
    check (
      tool_name is null
      or tool_name in (
        'deposit.latest_status',
        'event.progress',
        'kyc.status',
        'mining.status',
        'mining.today_reward',
        'notification.recent',
        'referral.status',
        'trial.status',
        'wallet.summary',
        'withdrawal.latest_status'
      )
    ),
  add constraint ai_requests_route_audit_shape
    check (
      (
        route_kind is null
        and route_key is null
        and context_scope is null
        and tool_name is null
      )
      or (
        route_kind is not null
        and route_key is not null
        and context_scope is not null
        and (
          (route_kind = 'tool' and tool_name is not null and context_scope = 'ACCOUNT_STATE')
          or (
            route_kind <> 'tool'
            and tool_name is null
            and context_scope <> 'ACCOUNT_STATE'
          )
        )
      )
    ),
  add constraint ai_requests_route_classification_shape
    check (
      route_kind is null
      or (
        route_kind = 'tool'
        and context_scope = 'ACCOUNT_STATE'
        and safety_classification = 'ACCOUNT_STATE'
      )
      or (
        route_kind = 'general_safe'
        and context_scope = 'GENERAL_SAFE'
        and safety_classification = 'GENERAL_SAFE'
      )
      or (
        route_kind = 'ui_help'
        and context_scope = 'UI_HELP'
        and safety_classification = 'UI_HELP'
      )
      or (
        route_kind in ('cache', 'high_capability', 'low_cost')
        and context_scope = 'PUBLIC_FACTS_ONLY'
        and safety_classification = 'PUTDUK_KNOWLEDGE'
      )
      or (
        route_kind = 'static'
        and context_scope = 'PUBLIC_FACTS_ONLY'
        and safety_classification in (
          'ABUSE_EVASION',
          'ACTION_BOUNDARY',
          'CLARIFICATION',
          'CROSS_USER_DATA',
          'INTERNAL_DATA_REQUEST',
          'PRIVILEGE_ESCALATION',
          'PROMPT_INJECTION',
          'STATIC_FACT'
        )
      )
    );

create function public.begin_ai_request_v2(
  p_user_id uuid,
  p_client_message_id uuid,
  p_prompt_hash text,
  p_input_redacted jsonb,
  p_model_key text,
  p_knowledge_version text,
  p_per_minute_limit integer,
  p_per_day_limit integer,
  p_route_kind text,
  p_route_key text,
  p_context_scope text,
  p_safety_classification text,
  p_tool_name text default null
)
returns table (request_id uuid, is_new boolean)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_is_new boolean;
  v_request_id uuid;
begin
  if p_route_kind is null
    or p_route_kind not in (
      'cache',
      'general_safe',
      'high_capability',
      'low_cost',
      'static',
      'tool',
      'ui_help'
    )
    or coalesce(p_route_key, '') !~ '^[a-z][a-z0-9_]{1,79}$'
    or p_context_scope is null
    or p_context_scope not in (
      'ACCOUNT_STATE',
      'GENERAL_SAFE',
      'PUBLIC_FACTS_ONLY',
      'UI_HELP'
    )
    or p_safety_classification is null
    or p_safety_classification not in (
      'ABUSE_EVASION',
      'ACCOUNT_STATE',
      'ACTION_BOUNDARY',
      'CLARIFICATION',
      'CROSS_USER_DATA',
      'GENERAL_SAFE',
      'INTERNAL_DATA_REQUEST',
      'PRIVILEGE_ESCALATION',
      'PROMPT_INJECTION',
      'PUTDUK_KNOWLEDGE',
      'STATIC_FACT',
      'UI_HELP'
    )
    or (
      p_route_kind = 'tool'
      and (
        p_context_scope <> 'ACCOUNT_STATE'
        or p_safety_classification <> 'ACCOUNT_STATE'
        or p_tool_name is null
        or p_tool_name not in (
          'deposit.latest_status',
          'event.progress',
          'kyc.status',
          'mining.status',
          'mining.today_reward',
          'notification.recent',
          'referral.status',
          'trial.status',
          'wallet.summary',
          'withdrawal.latest_status'
        )
      )
    )
    or (
      p_route_kind <> 'tool'
      and (
        p_tool_name is not null
        or p_context_scope = 'ACCOUNT_STATE'
      )
    )
    or (
      p_route_kind = 'general_safe'
      and (
        p_context_scope <> 'GENERAL_SAFE'
        or p_safety_classification <> 'GENERAL_SAFE'
      )
    )
    or (
      p_route_kind = 'ui_help'
      and (
        p_context_scope <> 'UI_HELP'
        or p_safety_classification <> 'UI_HELP'
      )
    )
    or (
      p_route_kind in ('cache', 'high_capability', 'low_cost')
      and (
        p_context_scope <> 'PUBLIC_FACTS_ONLY'
        or p_safety_classification <> 'PUTDUK_KNOWLEDGE'
      )
    )
    or (
      p_route_kind = 'static'
      and (
        p_context_scope <> 'PUBLIC_FACTS_ONLY'
        or p_safety_classification not in (
          'ABUSE_EVASION',
          'ACTION_BOUNDARY',
          'CLARIFICATION',
          'CROSS_USER_DATA',
          'INTERNAL_DATA_REQUEST',
          'PRIVILEGE_ESCALATION',
          'PROMPT_INJECTION',
          'STATIC_FACT'
        )
      )
    )
  then
    raise exception using errcode = '22023', message = 'INVALID_AI_ROUTE_AUDIT';
  end if;

  select admission.request_id, admission.is_new
  into v_request_id, v_is_new
  from public.begin_ai_request(
    p_user_id,
    p_client_message_id,
    p_prompt_hash,
    p_input_redacted,
    p_model_key,
    p_knowledge_version,
    p_per_minute_limit,
    p_per_day_limit
  ) as admission;

  if v_is_new then
    update public.ai_requests
    set
      request_kind = 'ai_chat_turn',
      route_kind = p_route_kind,
      route_key = p_route_key,
      context_scope = p_context_scope,
      tool_name = p_tool_name,
      safety_classification = p_safety_classification
    where id = v_request_id
      and user_id = p_user_id;
  end if;

  return query select v_request_id, v_is_new;
end;
$$;

revoke all on function public.begin_ai_request_v2(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.begin_ai_request_v2(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text,
  text,
  text
) to service_role;

comment on function public.begin_ai_request_v2(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  integer,
  integer,
  text,
  text,
  text,
  text,
  text
) is
  'Service-only AI admission that records the truthful policy route and owned read-tool boundary.';
comment on column public.ai_requests.tool_name is
  'Allowlisted PUTDUK-owned read-only tool. Null for every non-tool route.';
comment on column public.ai_requests.context_scope is
  'Minimum context class used by the AI turn; raw domain tool results are never stored here.';

commit;
