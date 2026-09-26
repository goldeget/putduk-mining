begin;

create type public.system_component_status as enum (
  'OPERATIONAL',
  'DEGRADED',
  'MAINTENANCE',
  'OUTAGE'
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_role public.app_role,
  action text not null,
  target_type text not null,
  target_id text,
  reason text not null,
  request_id uuid not null,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  constraint audit_logs_action_not_blank check (btrim(action) <> ''),
  constraint audit_logs_target_type_not_blank check (btrim(target_type) <> ''),
  constraint audit_logs_reason_not_blank check (btrim(reason) <> ''),
  constraint audit_logs_before_state_object
    check (before_state is null or jsonb_typeof(before_state) = 'object'),
  constraint audit_logs_after_state_object
    check (after_state is null or jsonb_typeof(after_state) = 'object'),
  constraint audit_logs_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create table public.system_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  status public.system_job_status not null default 'PENDING',
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  available_at timestamptz not null default statement_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint system_jobs_type_not_blank check (btrim(job_type) <> ''),
  constraint system_jobs_idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint system_jobs_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint system_jobs_attempts_non_negative check (attempts >= 0),
  constraint system_jobs_time_order
    check (
      (started_at is null or started_at >= created_at)
      and (completed_at is null or (started_at is not null and completed_at >= started_at))
    )
);

create table public.system_status (
  id uuid primary key default gen_random_uuid(),
  component text not null unique,
  status public.system_component_status not null,
  public_message_ko text not null,
  is_public boolean not null default false,
  observed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint system_status_component_not_blank check (btrim(component) <> ''),
  constraint system_status_message_not_blank check (btrim(public_message_ko) <> '')
);

create index audit_logs_actor_created_idx
  on public.audit_logs (actor_user_id, created_at desc);
create index audit_logs_target_created_idx
  on public.audit_logs (target_type, target_id, created_at desc);
create index audit_logs_request_id_idx on public.audit_logs (request_id);
create index system_jobs_ready_idx on public.system_jobs (status, available_at)
  where status in ('PENDING', 'FAILED');
create index system_status_public_idx on public.system_status (is_public, component);

create trigger audit_logs_prevent_update_delete
before update or delete on public.audit_logs
for each row execute function app_private.prevent_row_mutation();
create trigger system_jobs_set_updated_at
before update on public.system_jobs
for each row execute function app_private.set_updated_at();
create trigger system_status_set_updated_at
before update on public.system_status
for each row execute function app_private.set_updated_at();

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
alter table public.system_jobs enable row level security;
alter table public.system_jobs force row level security;
alter table public.system_status enable row level security;
alter table public.system_status force row level security;

grant select on public.system_status to anon, authenticated;

create policy system_status_read_public
on public.system_status
for select
to anon, authenticated
using (is_public);

comment on table public.audit_logs is
  'Append-only privileged action audit trail. Every record requires a human-readable reason.';
comment on table public.system_jobs is
  'Idempotent background work queue metadata; execution belongs to trusted workers.';

commit;
