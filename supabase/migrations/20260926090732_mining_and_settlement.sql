begin;

create table public.mining_farms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  world_id uuid not null references public.asset_worlds (id) on delete restrict,
  status public.mining_status not null default 'NORMAL',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint mining_farms_id_user_unique unique (id, user_id),
  constraint mining_farms_unique_world unique (user_id, world_id)
);

create table public.mining_equipment (
  id uuid primary key default gen_random_uuid(),
  mining_farm_id uuid not null,
  user_id uuid not null,
  equipment_code text not null,
  display_name_ko text not null,
  efficiency_bps integer not null default 10000,
  equipped_at timestamptz not null,
  unequipped_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint mining_equipment_farm_user_fk
    foreign key (mining_farm_id, user_id)
    references public.mining_farms (id, user_id) on delete cascade,
  constraint mining_equipment_code_format
    check (equipment_code ~ '^[A-Z0-9_]{2,32}$'),
  constraint mining_equipment_name_not_blank check (btrim(display_name_ko) <> ''),
  constraint mining_equipment_efficiency_range
    check (efficiency_bps between 0 and 100000),
  constraint mining_equipment_time_order
    check (unequipped_at is null or unequipped_at >= equipped_at)
);

create table public.mining_sessions (
  id uuid primary key default gen_random_uuid(),
  mining_farm_id uuid not null,
  user_id uuid not null,
  status public.mining_status not null default 'NORMAL',
  started_at timestamptz not null,
  last_settled_at timestamptz not null,
  ended_at timestamptz,
  starting_rule_version_id uuid not null
    references public.world_rule_versions (id) on delete restrict,
  idempotency_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint mining_sessions_farm_user_fk
    foreign key (mining_farm_id, user_id)
    references public.mining_farms (id, user_id) on delete cascade,
  constraint mining_sessions_id_user_unique unique (id, user_id),
  constraint mining_sessions_time_order
    check (
      last_settled_at >= started_at
      and (ended_at is null or ended_at >= last_settled_at)
    ),
  constraint mining_sessions_idempotency_key_not_blank
    check (btrim(idempotency_key) <> '')
);

create table public.mining_status_history (
  id uuid primary key default gen_random_uuid(),
  mining_farm_id uuid not null,
  user_id uuid not null,
  status public.mining_status not null,
  effective_at timestamptz not null,
  reason text not null,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint mining_status_history_farm_user_fk
    foreign key (mining_farm_id, user_id)
    references public.mining_farms (id, user_id) on delete cascade,
  constraint mining_status_history_reason_not_blank check (btrim(reason) <> ''),
  constraint mining_status_history_unique_effective
    unique (mining_farm_id, effective_at)
);

create table public.mining_settlements (
  id uuid primary key default gen_random_uuid(),
  mining_session_id uuid not null,
  user_id uuid not null,
  settled_from timestamptz not null,
  settled_to timestamptz not null,
  amount_atomic bigint not null,
  currency public.currency_code not null default 'KRW',
  segment_count integer not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default statement_timestamp(),
  constraint mining_settlements_session_user_fk
    foreign key (mining_session_id, user_id)
    references public.mining_sessions (id, user_id) on delete cascade,
  constraint mining_settlements_id_user_unique unique (id, user_id),
  constraint mining_settlements_time_order check (settled_to > settled_from),
  constraint mining_settlements_amount_non_negative check (amount_atomic >= 0),
  constraint mining_settlements_segments_positive check (segment_count > 0),
  constraint mining_settlements_idempotency_key_not_blank
    check (btrim(idempotency_key) <> ''),
  constraint mining_settlements_unique_interval
    unique (mining_session_id, settled_from, settled_to)
);

create table public.mining_settlement_segments (
  id uuid primary key default gen_random_uuid(),
  mining_settlement_id uuid not null,
  user_id uuid not null,
  sequence integer not null,
  settled_from timestamptz not null,
  settled_to timestamptz not null,
  amount_atomic bigint not null,
  rule_version_id uuid not null
    references public.world_rule_versions (id) on delete restrict,
  equipment_efficiency_bps integer not null,
  world_multiplier_bps integer not null,
  event_multiplier_bps integer not null,
  status_multiplier_bps integer not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint mining_settlement_segments_settlement_user_fk
    foreign key (mining_settlement_id, user_id)
    references public.mining_settlements (id, user_id) on delete cascade,
  constraint mining_settlement_segments_sequence_non_negative check (sequence >= 0),
  constraint mining_settlement_segments_time_order check (settled_to > settled_from),
  constraint mining_settlement_segments_amount_non_negative check (amount_atomic >= 0),
  constraint mining_settlement_segments_equipment_range
    check (equipment_efficiency_bps between 0 and 100000),
  constraint mining_settlement_segments_world_range
    check (world_multiplier_bps between 0 and 100000),
  constraint mining_settlement_segments_event_range
    check (event_multiplier_bps between 0 and 100000),
  constraint mining_settlement_segments_status_range
    check (status_multiplier_bps between 0 and 100000),
  constraint mining_settlement_segments_unique_sequence
    unique (mining_settlement_id, sequence)
);

create index mining_farms_user_id_idx on public.mining_farms (user_id);
create index mining_equipment_user_id_idx on public.mining_equipment (user_id);
create index mining_equipment_active_idx on public.mining_equipment (mining_farm_id)
  where unequipped_at is null;
create index mining_sessions_user_id_idx on public.mining_sessions (user_id);
create unique index mining_sessions_one_active_per_farm_idx
  on public.mining_sessions (mining_farm_id)
  where ended_at is null;
create index mining_status_history_user_effective_idx
  on public.mining_status_history (user_id, effective_at desc);
create index mining_settlements_user_created_idx
  on public.mining_settlements (user_id, created_at desc);
create index mining_settlement_segments_rule_version_idx
  on public.mining_settlement_segments (rule_version_id);

create trigger mining_farms_set_updated_at
before update on public.mining_farms
for each row execute function app_private.set_updated_at();
create trigger mining_sessions_set_updated_at
before update on public.mining_sessions
for each row execute function app_private.set_updated_at();
create trigger mining_status_history_prevent_update_delete
before update or delete on public.mining_status_history
for each row execute function app_private.prevent_row_mutation();
create trigger mining_settlements_prevent_update_delete
before update or delete on public.mining_settlements
for each row execute function app_private.prevent_row_mutation();
create trigger mining_settlement_segments_prevent_update_delete
before update or delete on public.mining_settlement_segments
for each row execute function app_private.prevent_row_mutation();

alter table public.mining_farms enable row level security;
alter table public.mining_farms force row level security;
alter table public.mining_equipment enable row level security;
alter table public.mining_equipment force row level security;
alter table public.mining_sessions enable row level security;
alter table public.mining_sessions force row level security;
alter table public.mining_status_history enable row level security;
alter table public.mining_status_history force row level security;
alter table public.mining_settlements enable row level security;
alter table public.mining_settlements force row level security;
alter table public.mining_settlement_segments enable row level security;
alter table public.mining_settlement_segments force row level security;

grant select on
  public.mining_farms,
  public.mining_equipment,
  public.mining_sessions,
  public.mining_status_history,
  public.mining_settlements,
  public.mining_settlement_segments
to authenticated;

create policy mining_farms_select_own
on public.mining_farms for select to authenticated
using ((select auth.uid()) = user_id);
create policy mining_equipment_select_own
on public.mining_equipment for select to authenticated
using ((select auth.uid()) = user_id);
create policy mining_sessions_select_own
on public.mining_sessions for select to authenticated
using ((select auth.uid()) = user_id);
create policy mining_status_history_select_own
on public.mining_status_history for select to authenticated
using ((select auth.uid()) = user_id);
create policy mining_settlements_select_own
on public.mining_settlements for select to authenticated
using ((select auth.uid()) = user_id);
create policy mining_settlement_segments_select_own
on public.mining_settlement_segments for select to authenticated
using ((select auth.uid()) = user_id);

comment on table public.mining_settlements is
  'Idempotent settlement interval headers. Detailed rule snapshots live in segments.';
comment on table public.mining_settlement_segments is
  'Effective-time segments prevent new rules from applying retroactively.';

commit;
