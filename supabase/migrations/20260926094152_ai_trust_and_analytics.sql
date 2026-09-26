begin;

create type public.ai_request_status as enum (
  'RECEIVED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);
create type public.trust_visibility as enum ('PUBLIC', 'AUTHENTICATED', 'INTERNAL');

create table app_private.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  actor_id uuid references auth.users (id) on delete set null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'PROCESSING',
  response_status integer,
  response_payload jsonb,
  locked_until timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  constraint idempotency_keys_scope_format
    check (scope ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  constraint idempotency_keys_key_length
    check (char_length(idempotency_key) between 8 and 200),
  constraint idempotency_keys_request_hash_format
    check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint idempotency_keys_status
    check (status in ('PROCESSING', 'COMPLETED', 'FAILED')),
  constraint idempotency_keys_response_status
    check (response_status is null or response_status between 100 and 599),
  constraint idempotency_keys_completion_order
    check (completed_at is null or completed_at >= created_at),
  constraint idempotency_keys_unique_scope unique nulls not distinct (
    scope,
    actor_id,
    idempotency_key
  )
);

revoke all on table app_private.idempotency_keys from public, anon, authenticated;

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request_kind text not null,
  prompt_hash text not null,
  input_redacted jsonb not null default '{}'::jsonb,
  status public.ai_request_status not null default 'RECEIVED',
  model_key text,
  safety_classification text,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint ai_requests_kind_format
    check (request_kind ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint ai_requests_prompt_hash_format
    check (prompt_hash ~ '^[a-f0-9]{64}$'),
  constraint ai_requests_input_object
    check (jsonb_typeof(input_redacted) = 'object'),
  constraint ai_requests_error_code_length
    check (error_code is null or char_length(error_code) <= 80),
  constraint ai_requests_time_order
    check (
      (started_at is null or started_at >= created_at)
      and (completed_at is null or (started_at is not null and completed_at >= started_at))
    )
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.ai_requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  model_key text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint ai_usage_non_negative_tokens
    check (input_tokens >= 0 and output_tokens >= 0 and cached_input_tokens >= 0),
  constraint ai_usage_unique_request unique (request_id)
);

create table public.ai_cache (
  cache_key text primary key,
  knowledge_version text not null,
  response_payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint ai_cache_key_format check (cache_key ~ '^[a-f0-9]{64}$'),
  constraint ai_cache_object_payload
    check (jsonb_typeof(response_payload) = 'object'),
  constraint ai_cache_expiration_order check (expires_at > created_at)
);

create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid references public.ai_requests (id) on delete set null,
  report_type text not null,
  title_ko text not null,
  report_payload jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint ai_reports_type_format
    check (report_type ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint ai_reports_title_length check (char_length(title_ko) between 1 and 120),
  constraint ai_reports_object_payload
    check (jsonb_typeof(report_payload) = 'object')
);

create table public.ai_knowledge (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  version integer not null,
  title_ko text not null,
  content_markdown text not null,
  content_hash text not null,
  status public.content_status not null default 'DRAFT',
  effective_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint ai_knowledge_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint ai_knowledge_positive_version check (version > 0),
  constraint ai_knowledge_hash_format check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint ai_knowledge_publication_state check (
    (status = 'DRAFT' and effective_at is null)
    or (status <> 'DRAFT' and effective_at is not null)
  ),
  constraint ai_knowledge_unique_version unique (slug, version)
);

create table public.trust_facts (
  id uuid primary key default gen_random_uuid(),
  fact_key text not null unique,
  label_ko text not null,
  visibility public.trust_visibility not null default 'PUBLIC',
  is_active boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  constraint trust_facts_key_format check (fact_key ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  constraint trust_facts_label_length check (char_length(label_ko) between 1 and 120)
);

create table public.trust_documents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  document_kind text not null,
  title_ko text not null,
  summary_ko text not null,
  visibility public.trust_visibility not null default 'PUBLIC',
  status public.content_status not null default 'DRAFT',
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint trust_documents_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint trust_documents_kind_format
    check (document_kind ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint trust_documents_title_length check (char_length(title_ko) between 1 and 140),
  constraint trust_documents_summary_length check (char_length(summary_ko) between 1 and 600),
  constraint trust_documents_publication_state check (
    (status = 'DRAFT' and published_at is null)
    or (status <> 'DRAFT' and published_at is not null)
  )
);

create table public.trust_versions (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid references public.trust_facts (id) on delete cascade,
  document_id uuid references public.trust_documents (id) on delete cascade,
  version integer not null,
  payload jsonb not null,
  content_hash text not null,
  effective_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint trust_versions_single_parent
    check ((fact_id is not null)::integer + (document_id is not null)::integer = 1),
  constraint trust_versions_positive_version check (version > 0),
  constraint trust_versions_object_payload check (jsonb_typeof(payload) = 'object'),
  constraint trust_versions_hash_format check (content_hash ~ '^[a-f0-9]{64}$')
);

create unique index trust_versions_fact_version_unique
  on public.trust_versions (fact_id, version)
  where fact_id is not null;
create unique index trust_versions_document_version_unique
  on public.trust_versions (document_id, version)
  where document_id is not null;

create table public.trust_sources (
  id uuid primary key default gen_random_uuid(),
  trust_version_id uuid not null references public.trust_versions (id) on delete cascade,
  source_type text not null,
  label text not null,
  source_locator text not null,
  verified_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint trust_sources_type_format
    check (source_type ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint trust_sources_label_length check (char_length(label) between 1 and 200),
  constraint trust_sources_locator_length check (char_length(source_locator) between 1 and 1000)
);

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  user_id uuid references auth.users (id) on delete set null,
  anonymous_id uuid,
  session_id uuid not null,
  request_id uuid,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  received_at timestamptz not null default statement_timestamp(),
  constraint analytics_events_name_format
    check (event_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint analytics_events_actor check (user_id is not null or anonymous_id is not null),
  constraint analytics_events_object_properties
    check (jsonb_typeof(properties) = 'object'),
  constraint analytics_events_clock_skew
    check (occurred_at <= received_at + interval '5 minutes')
);

create index idempotency_keys_expiry_idx
  on app_private.idempotency_keys (locked_until)
  where status = 'PROCESSING';
create index ai_requests_user_created_idx
  on public.ai_requests (user_id, created_at desc);
create index ai_requests_running_idx
  on public.ai_requests (created_at)
  where status in ('RECEIVED', 'RUNNING');
create index ai_usage_user_created_idx
  on public.ai_usage (user_id, created_at desc);
create index ai_cache_expiry_idx on public.ai_cache (expires_at);
create index ai_reports_user_created_idx
  on public.ai_reports (user_id, created_at desc);
create index ai_knowledge_effective_idx
  on public.ai_knowledge (slug, effective_at desc)
  where status = 'PUBLISHED';
create index trust_documents_public_idx
  on public.trust_documents (document_kind, published_at desc)
  where status = 'PUBLISHED' and visibility = 'PUBLIC';
create index trust_versions_fact_effective_idx
  on public.trust_versions (fact_id, effective_at desc)
  where fact_id is not null;
create index trust_versions_document_effective_idx
  on public.trust_versions (document_id, effective_at desc)
  where document_id is not null;
create index trust_sources_version_idx
  on public.trust_sources (trust_version_id);
create index analytics_events_name_time_idx
  on public.analytics_events (event_name, occurred_at desc);
create index analytics_events_user_time_idx
  on public.analytics_events (user_id, occurred_at desc)
  where user_id is not null;
create index analytics_events_anonymous_time_idx
  on public.analytics_events (anonymous_id, occurred_at desc)
  where anonymous_id is not null;

create trigger ai_requests_set_updated_at
before update on public.ai_requests
for each row execute function app_private.set_updated_at();

create trigger ai_usage_prevent_update_delete
before update or delete on public.ai_usage
for each row execute function app_private.prevent_row_mutation();

create trigger ai_knowledge_prevent_update_delete
before update or delete on public.ai_knowledge
for each row execute function app_private.prevent_row_mutation();

create trigger trust_documents_set_updated_at
before update on public.trust_documents
for each row execute function app_private.set_updated_at();

create trigger trust_versions_prevent_update_delete
before update or delete on public.trust_versions
for each row execute function app_private.prevent_row_mutation();

create trigger trust_sources_prevent_update_delete
before update or delete on public.trust_sources
for each row execute function app_private.prevent_row_mutation();

create trigger analytics_events_prevent_update_delete
before update or delete on public.analytics_events
for each row execute function app_private.prevent_row_mutation();

alter table public.ai_requests enable row level security;
alter table public.ai_requests force row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;
alter table public.ai_cache enable row level security;
alter table public.ai_cache force row level security;
alter table public.ai_reports enable row level security;
alter table public.ai_reports force row level security;
alter table public.ai_knowledge enable row level security;
alter table public.ai_knowledge force row level security;
alter table public.trust_facts enable row level security;
alter table public.trust_facts force row level security;
alter table public.trust_documents enable row level security;
alter table public.trust_documents force row level security;
alter table public.trust_versions enable row level security;
alter table public.trust_versions force row level security;
alter table public.trust_sources enable row level security;
alter table public.trust_sources force row level security;
alter table public.analytics_events enable row level security;
alter table public.analytics_events force row level security;

grant select on public.ai_requests, public.ai_usage, public.ai_reports to authenticated;
grant select on
  public.trust_facts,
  public.trust_documents,
  public.trust_versions,
  public.trust_sources
  to anon, authenticated;

create policy ai_requests_select_own
on public.ai_requests
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy ai_usage_select_own
on public.ai_usage
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy ai_reports_select_own
on public.ai_reports
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy trust_facts_read_public
on public.trust_facts
for select
to anon, authenticated
using (visibility = 'PUBLIC' and is_active);

create policy trust_documents_read_public
on public.trust_documents
for select
to anon, authenticated
using (
  visibility = 'PUBLIC'
  and status = 'PUBLISHED'
  and published_at is not null
  and published_at <= statement_timestamp()
);

create policy trust_versions_read_public
on public.trust_versions
for select
to anon, authenticated
using (
  effective_at <= statement_timestamp()
  and (
    exists (
      select 1
      from public.trust_facts as fact
      where fact.id = trust_versions.fact_id
        and fact.visibility = 'PUBLIC'
        and fact.is_active
    )
    or exists (
      select 1
      from public.trust_documents as document
      where document.id = trust_versions.document_id
        and document.visibility = 'PUBLIC'
        and document.status = 'PUBLISHED'
        and document.published_at is not null
        and document.published_at <= statement_timestamp()
    )
  )
);

create policy trust_sources_read_public
on public.trust_sources
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.trust_versions as version
    where version.id = trust_sources.trust_version_id
      and version.effective_at <= statement_timestamp()
      and (
        exists (
          select 1
          from public.trust_facts as fact
          where fact.id = version.fact_id
            and fact.visibility = 'PUBLIC'
            and fact.is_active
        )
        or exists (
          select 1
          from public.trust_documents as document
          where document.id = version.document_id
            and document.visibility = 'PUBLIC'
            and document.status = 'PUBLISHED'
            and document.published_at is not null
            and document.published_at <= statement_timestamp()
        )
      )
  )
);

comment on table public.ai_requests is
  'AI orchestration audit rows. The AI domain cannot mutate wallets, ledgers, approvals, rewards, or economic rules.';
comment on column public.ai_requests.input_redacted is
  'Only the minimum redacted request context needed for audit; secrets and raw credentials are forbidden.';
comment on table public.ai_cache is
  'Server-only response cache. No client grants or policies are defined.';
comment on table public.analytics_events is
  'Append-only server-ingested product events. Client direct INSERT is intentionally unavailable.';
comment on table app_private.idempotency_keys is
  'Private operation deduplication records for server-side mutation endpoints.';

commit;
