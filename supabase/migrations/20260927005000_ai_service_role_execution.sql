begin;

-- AI accounting/audit commands are server-only entry points. They remain
-- SECURITY INVOKER so the repository-wide no-SECURITY-DEFINER invariant holds.
-- The Data API service role receives only the table and column privileges each
-- validated command actually needs.
alter function public.begin_ai_request(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  integer,
  integer
) security invoker;

alter function public.begin_ai_request_v2(
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
) security invoker;

alter function public.complete_ai_request(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  integer
) security invoker;

alter function public.fail_ai_request(
  uuid,
  uuid,
  public.ai_request_status,
  text
) security invoker;

revoke all privileges on table
  public.ai_requests,
  public.ai_usage,
  public.ai_cache
from service_role;

grant select (id) on table auth.users to service_role;

-- Admission/completion functions inspect the full request row. Mutations are
-- restricted to the exact columns used by those commands, so service_role does
-- not receive a table-level INSERT or UPDATE privilege.
grant select on table public.ai_requests to service_role;
grant insert (
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
) on table public.ai_requests to service_role;
grant update (
  status,
  model_key,
  provider_request_id,
  response_character_count,
  error_code,
  completed_at,
  request_kind,
  route_kind,
  route_key,
  context_scope,
  tool_name,
  safety_classification
) on table public.ai_requests to service_role;

grant select (request_id) on table public.ai_usage to service_role;
grant insert (
  request_id,
  user_id,
  input_tokens,
  output_tokens,
  cached_input_tokens,
  model_key
) on table public.ai_usage to service_role;

-- Member 360 may count request records, while the server semantic cache needs
-- only read/upsert authority over its versioned public-knowledge fields.
grant select (
  cache_key,
  knowledge_version,
  response_payload,
  expires_at
) on table public.ai_cache to service_role;
grant insert (
  cache_key,
  knowledge_version,
  response_payload,
  expires_at
) on table public.ai_cache to service_role;
grant update (
  knowledge_version,
  response_payload,
  expires_at
) on table public.ai_cache to service_role;

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
  'Server-only AI admission with route audit. SECURITY INVOKER uses explicit least-privilege service-role grants.';

comment on function public.complete_ai_request(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  integer
) is
  'Server-only terminal success command. SECURITY INVOKER uses explicit least-privilege service-role grants.';

comment on function public.fail_ai_request(
  uuid,
  uuid,
  public.ai_request_status,
  text
) is
  'Server-only terminal failure command. SECURITY INVOKER uses explicit least-privilege service-role grants.';

commit;
