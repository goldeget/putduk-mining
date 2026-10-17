-- PRIMARY proposal only. Generate a fresh migration with the existing CLI; do not rewrite old migrations.
-- Same common writer, signature, invoker/search_path, advisory lock, replay and rolling windows.
-- Existing ACL is retained by CREATE OR REPLACE; no grants or definer changes.
begin;
create or replace function public.begin_ai_request(
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
    or p_input_redacted is null
    or jsonb_typeof(p_input_redacted) <> 'object'
    or char_length(btrim(coalesce(p_model_key, ''))) not between 1 and 120
    or coalesce(p_knowledge_version, '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'
    or p_per_minute_limit is null
    or p_per_minute_limit not between 1 and 5
    or p_per_day_limit is null
    or p_per_day_limit not between 1 and 100
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


commit;
