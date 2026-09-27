begin;

-- AI accounting/audit commands are server-only entry points. Keep their table
-- mutation authority inside fixed-search-path functions instead of exposing
-- direct request/usage writes through the Data API service role.
alter function public.begin_ai_request(
  uuid,
  uuid,
  text,
  jsonb,
  text,
  text,
  integer,
  integer
) security definer;

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
) security definer;

alter function public.complete_ai_request(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  integer
) security definer;

alter function public.fail_ai_request(
  uuid,
  uuid,
  public.ai_request_status,
  text
) security definer;

revoke all privileges on table
  public.ai_requests,
  public.ai_usage,
  public.ai_cache
from service_role;

-- Member 360 may count request records, while the server semantic cache needs
-- only read/upsert authority. AI request and usage mutations stay RPC-only.
grant select on table public.ai_requests to service_role;
grant select, insert, update on table public.ai_cache to service_role;

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
  'Server-only AI admission with route audit. SECURITY DEFINER confines request writes to this validated command.';

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
  'Server-only terminal success command. SECURITY DEFINER confines request and usage writes to validated completion.';

comment on function public.fail_ai_request(
  uuid,
  uuid,
  public.ai_request_status,
  text
) is
  'Server-only terminal failure command. SECURITY DEFINER confines request mutation to validated failure states.';

commit;
