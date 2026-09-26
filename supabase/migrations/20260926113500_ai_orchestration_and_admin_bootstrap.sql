begin;

alter table public.ai_requests
  add column client_message_id uuid,
  add column knowledge_version text,
  add column provider_request_id text,
  add column response_character_count integer;

alter table public.ai_requests
  add constraint ai_requests_knowledge_version_format
    check (
      knowledge_version is null
      or knowledge_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'
    ),
  add constraint ai_requests_provider_request_id_length
    check (
      provider_request_id is null
      or char_length(provider_request_id) between 1 and 200
    ),
  add constraint ai_requests_response_character_count
    check (
      response_character_count is null
      or response_character_count >= 0
    );

create unique index ai_requests_user_client_message_unique
  on public.ai_requests (user_id, client_message_id)
  where client_message_id is not null;

create function public.begin_ai_request(
  p_user_id uuid,
  p_client_message_id uuid,
  p_prompt_hash text,
  p_input_redacted jsonb,
  p_model_key text,
  p_knowledge_version text,
  p_per_minute_limit integer,
  p_per_day_limit integer
)
returns table (request_id uuid, is_new boolean)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_daily_count integer;
  v_existing_id uuid;
  v_minute_count integer;
  v_request_id uuid;
begin
  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
  ) then
    raise exception using errcode = '22023', message = 'AUTH_USER_NOT_FOUND';
  end if;

  if p_client_message_id is null
    or coalesce(p_prompt_hash, '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_input_redacted) <> 'object'
    or char_length(btrim(coalesce(p_model_key, ''))) not between 1 and 120
    or coalesce(p_knowledge_version, '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'
    or p_per_minute_limit not between 1 and 60
    or p_per_day_limit not between 1 and 5000
  then
    raise exception using errcode = '22023', message = 'INVALID_AI_REQUEST';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select request.id
  into v_existing_id
  from public.ai_requests as request
  where request.user_id = p_user_id
    and request.client_message_id = p_client_message_id;

  if v_existing_id is not null then
    return query select v_existing_id, false;
    return;
  end if;

  select count(*)::integer
  into v_minute_count
  from public.ai_requests as request
  where request.user_id = p_user_id
    and request.created_at >= statement_timestamp() - interval '1 minute';

  if v_minute_count >= p_per_minute_limit then
    raise exception using errcode = 'P0001', message = 'AI_RATE_LIMITED_MINUTE';
  end if;

  select count(*)::integer
  into v_daily_count
  from public.ai_requests as request
  where request.user_id = p_user_id
    and request.created_at >= statement_timestamp() - interval '24 hours';

  if v_daily_count >= p_per_day_limit then
    raise exception using errcode = 'P0001', message = 'AI_RATE_LIMITED_DAY';
  end if;

  insert into public.ai_requests (
    user_id,
    request_kind,
    client_message_id,
    prompt_hash,
    input_redacted,
    status,
    model_key,
    knowledge_version,
    safety_classification,
    started_at
  ) values (
    p_user_id,
    'public_facts_question',
    p_client_message_id,
    p_prompt_hash,
    p_input_redacted,
    'RUNNING',
    p_model_key,
    p_knowledge_version,
    'PUBLIC_FACTS_ONLY',
    statement_timestamp()
  )
  returning id into v_request_id;

  return query select v_request_id, true;
end;
$$;

revoke all on function public.begin_ai_request(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.begin_ai_request(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  integer,
  integer
) to service_role;

create function public.complete_ai_request(
  p_request_id uuid,
  p_user_id uuid,
  p_provider_request_id text,
  p_provider_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_input_tokens integer,
  p_response_character_count integer
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_request public.ai_requests%rowtype;
begin
  if char_length(btrim(coalesce(p_provider_request_id, ''))) not between 1 and 200
    or char_length(btrim(coalesce(p_provider_model, ''))) not between 1 and 120
    or p_input_tokens < 0
    or p_output_tokens < 0
    or p_cached_input_tokens < 0
    or p_response_character_count < 0
  then
    raise exception using errcode = '22023', message = 'INVALID_AI_COMPLETION';
  end if;

  select request.*
  into v_request
  from public.ai_requests as request
  where request.id = p_request_id
    and request.user_id = p_user_id
  for update;

  if v_request.id is null then
    raise exception using errcode = '22023', message = 'AI_REQUEST_NOT_FOUND';
  end if;

  if v_request.status = 'SUCCEEDED' then
    return;
  end if;

  if v_request.status <> 'RUNNING' then
    raise exception using errcode = '55000', message = 'AI_REQUEST_NOT_RUNNING';
  end if;

  update public.ai_requests
  set
    status = 'SUCCEEDED',
    model_key = p_provider_model,
    provider_request_id = p_provider_request_id,
    response_character_count = p_response_character_count,
    error_code = null,
    completed_at = statement_timestamp()
  where id = p_request_id;

  insert into public.ai_usage (
    request_id,
    user_id,
    input_tokens,
    output_tokens,
    cached_input_tokens,
    model_key
  ) values (
    p_request_id,
    p_user_id,
    p_input_tokens,
    p_output_tokens,
    p_cached_input_tokens,
    p_provider_model
  )
  on conflict (request_id) do nothing;
end;
$$;

revoke all on function public.complete_ai_request(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function public.complete_ai_request(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  integer
) to service_role;

create function public.fail_ai_request(
  p_request_id uuid,
  p_user_id uuid,
  p_status public.ai_request_status,
  p_error_code text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_status public.ai_request_status;
begin
  if p_status not in ('FAILED', 'CANCELLED')
    or char_length(btrim(coalesce(p_error_code, ''))) not between 1 and 80
  then
    raise exception using errcode = '22023', message = 'INVALID_AI_FAILURE';
  end if;

  select request.status
  into v_status
  from public.ai_requests as request
  where request.id = p_request_id
    and request.user_id = p_user_id
  for update;

  if v_status is null then
    raise exception using errcode = '22023', message = 'AI_REQUEST_NOT_FOUND';
  end if;

  if v_status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then
    return;
  end if;

  update public.ai_requests
  set
    status = p_status,
    error_code = p_error_code,
    completed_at = statement_timestamp()
  where id = p_request_id;
end;
$$;

revoke all on function public.fail_ai_request(
  uuid,
  uuid,
  public.ai_request_status,
  text
) from public, anon, authenticated;
grant execute on function public.fail_ai_request(
  uuid,
  uuid,
  public.ai_request_status,
  text
) to service_role;

create function public.bootstrap_first_super_admin(
  p_user_id uuid,
  p_reason text,
  p_confirmation text,
  p_request_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_role_id uuid;
begin
  if p_confirmation <> 'BOOTSTRAP_FIRST_SUPER_ADMIN'
    or char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500
    or p_request_id is null
  then
    raise exception using errcode = '22023', message = 'INVALID_ADMIN_BOOTSTRAP';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
  ) then
    raise exception using errcode = '22023', message = 'AUTH_USER_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('putduk:first-super-admin', 0));

  if exists (select 1 from public.user_roles) then
    raise exception using errcode = '55000', message = 'FIRST_ADMIN_ALREADY_BOOTSTRAPPED';
  end if;

  insert into public.user_roles (
    user_id,
    role,
    granted_by
  ) values (
    p_user_id,
    'SUPER_ADMIN',
    p_user_id
  )
  returning id into v_role_id;

  insert into public.audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    request_id,
    after_state,
    metadata
  ) values (
    p_user_id,
    'SUPER_ADMIN',
    'role.bootstrap_first_super_admin',
    'user_role',
    v_role_id::text,
    p_reason,
    p_request_id,
    jsonb_build_object(
      'role_id', v_role_id,
      'user_id', p_user_id,
      'role', 'SUPER_ADMIN'
    ),
    jsonb_build_object('bootstrap', true)
  );

  return v_role_id;
end;
$$;

revoke all on function public.bootstrap_first_super_admin(
  uuid,
  text,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.bootstrap_first_super_admin(
  uuid,
  text,
  text,
  uuid
) to service_role;

comment on function public.begin_ai_request(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  integer,
  integer
) is 'Service-only AI request admission with per-user idempotency and atomic rate limits.';
comment on function public.complete_ai_request(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  integer
) is 'Service-only terminal AI success transition with append-only token usage.';
comment on function public.fail_ai_request(
  uuid,
  uuid,
  public.ai_request_status,
  text
) is 'Service-only terminal AI failure or cancellation transition.';
comment on function public.bootstrap_first_super_admin(
  uuid,
  text,
  text,
  uuid
) is 'One-time first SUPER_ADMIN bootstrap. Refuses execution after any role row exists.';

commit;
