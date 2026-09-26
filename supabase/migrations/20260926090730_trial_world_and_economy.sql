begin;

create type public.trial_ledger_entry_type as enum (
  'MINING_REWARD',
  'REVERSAL',
  'ADMIN_ADJUSTMENT'
);
create type public.trial_completion_reason as enum ('QUOTA', 'TIME');

create table public.asset_worlds (
  id uuid primary key default gen_random_uuid(),
  code public.world_code not null unique,
  name text not null,
  display_name_ko text not null,
  sort_order smallint not null,
  is_active boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint asset_worlds_sort_order_positive check (sort_order > 0),
  constraint asset_worlds_names_not_blank
    check (btrim(name) <> '' and btrim(display_name_ko) <> '')
);

create table public.world_instruments (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.asset_worlds (id) on delete restrict,
  code text not null,
  display_name_ko text not null,
  is_active boolean not null default false,
  sort_order smallint not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint world_instruments_code_format check (code ~ '^[A-Z0-9_]{2,24}$'),
  constraint world_instruments_sort_order_positive check (sort_order > 0),
  constraint world_instruments_unique_code unique (world_id, code)
);

create table public.world_rules (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.asset_worlds (id) on delete restrict,
  name text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint world_rules_name_not_blank check (btrim(name) <> ''),
  constraint world_rules_unique_name unique (world_id, name)
);

create table public.world_rule_versions (
  id uuid primary key default gen_random_uuid(),
  world_rule_id uuid not null references public.world_rules (id) on delete restrict,
  version integer not null,
  effective_at timestamptz not null,
  base_mining_rate_atomic bigint not null,
  world_multiplier_bps integer not null default 10000,
  rule_payload jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint world_rule_versions_version_positive check (version > 0),
  constraint world_rule_versions_rate_positive check (base_mining_rate_atomic > 0),
  constraint world_rule_versions_multiplier_range
    check (world_multiplier_bps between 0 and 100000),
  constraint world_rule_versions_payload_object
    check (jsonb_typeof(rule_payload) = 'object'),
  constraint world_rule_versions_unique_version unique (world_rule_id, version),
  constraint world_rule_versions_unique_effective_at unique (world_rule_id, effective_at)
);

create table public.trial_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null,
  is_enabled boolean not null default false,
  duration_seconds integer not null,
  quota_bps integer not null default 10000,
  target_reward_krw numeric(20, 2) not null,
  first_result_target_seconds integer not null,
  first_world_id uuid not null references public.asset_worlds (id) on delete restrict,
  auto_mining_enabled boolean not null default true,
  completion_copy text not null,
  completion_cta text not null default '내 채굴 시작하기',
  effective_at timestamptz not null,
  retired_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint trial_programs_name_not_blank check (btrim(name) <> ''),
  constraint trial_programs_version_positive check (version > 0),
  constraint trial_programs_duration_max_24h
    check (duration_seconds between 1 and 86400),
  constraint trial_programs_full_quota check (quota_bps = 10000),
  constraint trial_programs_target_reward_range
    check (target_reward_krw between 3000 and 10000),
  constraint trial_programs_first_result_timing
    check (first_result_target_seconds between 1 and least(duration_seconds, 900)),
  constraint trial_programs_effective_window
    check (retired_at is null or retired_at > effective_at),
  constraint trial_programs_completion_copy_not_blank
    check (btrim(completion_copy) <> '' and btrim(completion_cta) <> ''),
  constraint trial_programs_unique_version unique (name, version)
);

create table public.trial_reward_curves (
  id uuid primary key default gen_random_uuid(),
  trial_program_id uuid not null references public.trial_programs (id) on delete restrict,
  version integer not null,
  effective_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint trial_reward_curves_version_positive check (version > 0),
  constraint trial_reward_curves_unique_version unique (trial_program_id, version),
  constraint trial_reward_curves_unique_effective_at unique (trial_program_id, effective_at)
);

create table public.trial_reward_curve_points (
  id uuid primary key default gen_random_uuid(),
  trial_reward_curve_id uuid not null
    references public.trial_reward_curves (id) on delete cascade,
  sequence integer not null,
  elapsed_seconds integer not null,
  cumulative_quota_bps integer not null,
  cumulative_reward_bps integer not null,
  constraint trial_reward_curve_points_sequence_non_negative check (sequence >= 0),
  constraint trial_reward_curve_points_elapsed_non_negative check (elapsed_seconds >= 0),
  constraint trial_reward_curve_points_quota_range
    check (cumulative_quota_bps between 0 and 10000),
  constraint trial_reward_curve_points_reward_range
    check (cumulative_reward_bps between 0 and 10000),
  constraint trial_reward_curve_points_unique_sequence
    unique (trial_reward_curve_id, sequence),
  constraint trial_reward_curve_points_unique_elapsed
    unique (trial_reward_curve_id, elapsed_seconds)
);

create table public.trial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  trial_program_id uuid not null references public.trial_programs (id) on delete restrict,
  trial_program_version integer not null,
  world_id uuid not null references public.asset_worlds (id) on delete restrict,
  status public.trial_status not null default 'READY',
  started_at timestamptz,
  expires_at timestamptz,
  last_settled_at timestamptz,
  quota_consumed_bps integer not null default 0,
  reward_atomic bigint not null default 0,
  target_reward_krw numeric(20, 2) not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint trial_accounts_id_user_unique unique (id, user_id),
  constraint trial_accounts_program_version_positive check (trial_program_version > 0),
  constraint trial_accounts_quota_range check (quota_consumed_bps between 0 and 10000),
  constraint trial_accounts_reward_non_negative check (reward_atomic >= 0),
  constraint trial_accounts_target_reward_range
    check (target_reward_krw between 3000 and 10000),
  constraint trial_accounts_time_pair
    check ((started_at is null) = (expires_at is null)),
  constraint trial_accounts_max_24h
    check (
      started_at is null
      or (expires_at > started_at and expires_at <= started_at + interval '24 hours')
    ),
  constraint trial_accounts_last_settlement_window
    check (
      last_settled_at is null
      or (started_at is not null and last_settled_at between started_at and expires_at)
    )
);

create table public.trial_sessions (
  id uuid primary key default gen_random_uuid(),
  trial_account_id uuid not null,
  user_id uuid not null,
  started_at timestamptz not null,
  last_settled_at timestamptz not null,
  ended_at timestamptz,
  idempotency_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  constraint trial_sessions_account_user_fk
    foreign key (trial_account_id, user_id)
    references public.trial_accounts (id, user_id) on delete cascade,
  constraint trial_sessions_time_order
    check (
      last_settled_at >= started_at
      and (ended_at is null or ended_at >= last_settled_at)
    ),
  constraint trial_sessions_idempotency_key_not_blank
    check (btrim(idempotency_key) <> '')
);

create table public.trial_ledger (
  id uuid primary key default gen_random_uuid(),
  trial_account_id uuid not null,
  user_id uuid not null,
  direction public.ledger_direction not null,
  entry_type public.trial_ledger_entry_type not null,
  amount_atomic bigint not null,
  idempotency_key text not null unique,
  source_type text not null,
  source_id uuid,
  reason text,
  created_at timestamptz not null default statement_timestamp(),
  constraint trial_ledger_account_user_fk
    foreign key (trial_account_id, user_id)
    references public.trial_accounts (id, user_id) on delete cascade,
  constraint trial_ledger_amount_positive check (amount_atomic > 0),
  constraint trial_ledger_idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint trial_ledger_source_type_not_blank check (btrim(source_type) <> ''),
  constraint trial_ledger_admin_reason
    check (entry_type <> 'ADMIN_ADJUSTMENT' or btrim(coalesce(reason, '')) <> '')
);

create table public.trial_completions (
  id uuid primary key default gen_random_uuid(),
  trial_account_id uuid not null unique,
  user_id uuid not null,
  reason public.trial_completion_reason not null,
  final_quota_bps integer not null,
  final_reward_atomic bigint not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint trial_completions_account_user_fk
    foreign key (trial_account_id, user_id)
    references public.trial_accounts (id, user_id) on delete cascade,
  constraint trial_completions_quota_range check (final_quota_bps between 0 and 10000),
  constraint trial_completions_reward_non_negative check (final_reward_atomic >= 0),
  constraint trial_completions_quota_reason
    check (reason <> 'QUOTA' or final_quota_bps = 10000)
);

create index world_instruments_world_id_idx on public.world_instruments (world_id);
create index world_rules_world_id_idx on public.world_rules (world_id);
create index world_rule_versions_effective_idx
  on public.world_rule_versions (world_rule_id, effective_at desc);
create index trial_programs_effective_idx
  on public.trial_programs (is_enabled, effective_at desc);
create index trial_reward_curves_effective_idx
  on public.trial_reward_curves (trial_program_id, effective_at desc);
create index trial_accounts_user_id_idx on public.trial_accounts (user_id);
create index trial_sessions_user_id_idx on public.trial_sessions (user_id);
create index trial_sessions_active_idx on public.trial_sessions (trial_account_id)
  where ended_at is null;
create index trial_ledger_user_created_idx on public.trial_ledger (user_id, created_at desc);
create index trial_completions_user_id_idx on public.trial_completions (user_id);

create trigger asset_worlds_set_updated_at
before update on public.asset_worlds
for each row execute function app_private.set_updated_at();
create trigger world_rules_set_updated_at
before update on public.world_rules
for each row execute function app_private.set_updated_at();
create trigger trial_programs_set_updated_at
before update on public.trial_programs
for each row execute function app_private.set_updated_at();
create trigger trial_accounts_set_updated_at
before update on public.trial_accounts
for each row execute function app_private.set_updated_at();
create trigger trial_ledger_prevent_update_delete
before update or delete on public.trial_ledger
for each row execute function app_private.prevent_row_mutation();

alter table public.asset_worlds enable row level security;
alter table public.asset_worlds force row level security;
alter table public.world_instruments enable row level security;
alter table public.world_instruments force row level security;
alter table public.world_rules enable row level security;
alter table public.world_rules force row level security;
alter table public.world_rule_versions enable row level security;
alter table public.world_rule_versions force row level security;
alter table public.trial_programs enable row level security;
alter table public.trial_programs force row level security;
alter table public.trial_reward_curves enable row level security;
alter table public.trial_reward_curves force row level security;
alter table public.trial_reward_curve_points enable row level security;
alter table public.trial_reward_curve_points force row level security;
alter table public.trial_accounts enable row level security;
alter table public.trial_accounts force row level security;
alter table public.trial_sessions enable row level security;
alter table public.trial_sessions force row level security;
alter table public.trial_ledger enable row level security;
alter table public.trial_ledger force row level security;
alter table public.trial_completions enable row level security;
alter table public.trial_completions force row level security;

grant select on public.asset_worlds, public.world_instruments to anon, authenticated;
grant select on
  public.trial_accounts,
  public.trial_sessions,
  public.trial_ledger,
  public.trial_completions
to authenticated;

create policy asset_worlds_read_active
on public.asset_worlds
for select
to anon, authenticated
using (is_active);

create policy world_instruments_read_active
on public.world_instruments
for select
to anon, authenticated
using (
  is_active
  and exists (
    select 1
    from public.asset_worlds
    where asset_worlds.id = world_instruments.world_id
      and asset_worlds.is_active
  )
);

create policy trial_accounts_select_own
on public.trial_accounts
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy trial_sessions_select_own
on public.trial_sessions
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy trial_ledger_select_own
on public.trial_ledger
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy trial_completions_select_own
on public.trial_completions
for select
to authenticated
using ((select auth.uid()) = user_id);

insert into public.asset_worlds (code, name, display_name_ko, sort_order, is_active)
values
  ('KOREA', 'Korea', '코리아', 1, true),
  ('USA', 'USA', '미국', 2, true),
  ('GOLD', 'Gold', '골드', 3, true),
  ('SILVER', 'Silver', '실버', 4, true),
  ('CRYPTO', 'Crypto', '크립토', 5, true)
on conflict (code) do nothing;

comment on table public.trial_programs is
  'Versioned PUTDUK START configuration. No production reward values are seeded.';
comment on table public.trial_ledger is
  'Append-only trial accounting, completely separate from wallet_ledger.';
comment on table public.world_rule_versions is
  'Effective-time versions prevent retroactive economic rule application.';

commit;
