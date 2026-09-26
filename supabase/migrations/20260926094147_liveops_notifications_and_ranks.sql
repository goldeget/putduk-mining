begin;

create type public.content_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
create type public.event_status as enum (
  'DRAFT',
  'SCHEDULED',
  'LIVE',
  'ENDED',
  'CANCELLED'
);
create type public.event_participant_status as enum (
  'JOINED',
  'COMPLETED',
  'REWARDED',
  'DISQUALIFIED'
);
create type public.notification_channel as enum ('IN_APP', 'WEB_PUSH');
create type public.notification_delivery_status as enum (
  'PENDING',
  'SENT',
  'DELIVERED',
  'FAILED',
  'CANCELLED'
);

create table public.rank_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version integer not null,
  name_ko text not null,
  minimum_lifetime_mined_atomic bigint not null,
  badge_asset_path text,
  benefits jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint rank_definitions_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  constraint rank_definitions_positive_version check (version > 0),
  constraint rank_definitions_non_negative_threshold
    check (minimum_lifetime_mined_atomic >= 0),
  constraint rank_definitions_badge_path_not_url
    check (badge_asset_path is null or badge_asset_path !~* '^https?://'),
  constraint rank_definitions_effective_window
    check (effective_to is null or effective_to > effective_from),
  constraint rank_definitions_unique_version unique (code, version)
);

create table public.user_rank_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  rank_definition_id uuid not null references public.rank_definitions (id),
  lifetime_mined_atomic bigint not null default 0,
  achieved_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint user_rank_progress_non_negative_total
    check (lifetime_mined_atomic >= 0)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title_ko text not null,
  summary_ko text not null,
  status public.event_status not null default 'DRAFT',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint events_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint events_title_length check (char_length(title_ko) between 1 and 100),
  constraint events_summary_length check (char_length(summary_ko) between 1 and 500),
  constraint events_time_window check (ends_at > starts_at),
  constraint events_publication_state check (
    (status = 'DRAFT' and published_at is null)
    or (status <> 'DRAFT' and published_at is not null)
  )
);

create table public.event_rules (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  version integer not null,
  rule_payload jsonb not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  constraint event_rules_positive_version check (version > 0),
  constraint event_rules_object_payload
    check (jsonb_typeof(rule_payload) = 'object'),
  constraint event_rules_effective_window
    check (effective_to is null or effective_to > effective_from),
  constraint event_rules_unique_version unique (event_id, version)
);

create table public.event_rewards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  event_rule_id uuid not null references public.event_rules (id),
  reward_code text not null,
  amount_atomic bigint not null,
  currency public.currency_code not null,
  maximum_per_user integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  constraint event_rewards_code_format
    check (reward_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  constraint event_rewards_positive_amount check (amount_atomic > 0),
  constraint event_rewards_positive_limit check (maximum_per_user > 0),
  constraint event_rewards_unique_code unique (event_id, reward_code)
);

create table public.event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status public.event_participant_status not null default 'JOINED',
  progress jsonb not null default '{}'::jsonb,
  joined_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  rewarded_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  constraint event_participants_object_progress
    check (jsonb_typeof(progress) = 'object'),
  constraint event_participants_completion_order
    check (completed_at is null or completed_at >= joined_at),
  constraint event_participants_reward_order
    check (rewarded_at is null or (completed_at is not null and rewarded_at >= completed_at)),
  constraint event_participants_unique_user unique (event_id, user_id)
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title_ko text not null,
  summary_ko text not null,
  body_markdown text not null,
  status public.content_status not null default 'DRAFT',
  is_pinned boolean not null default false,
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint notices_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint notices_title_length check (char_length(title_ko) between 1 and 120),
  constraint notices_summary_length check (char_length(summary_ko) between 1 and 500),
  constraint notices_publication_state check (
    (status = 'DRAFT' and published_at is null)
    or (status <> 'DRAFT' and published_at is not null)
  ),
  constraint notices_expiration_order
    check (expires_at is null or published_at is null or expires_at > published_at)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null,
  title_ko text not null,
  body_ko text not null,
  route text,
  read_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint notifications_category_format
    check (category ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint notifications_title_length check (char_length(title_ko) between 1 and 100),
  constraint notifications_body_length check (char_length(body_ko) between 1 and 500),
  constraint notifications_internal_route
    check (route is null or (route ~ '^/[a-zA-Z0-9/_?=&.-]*$' and route !~ '^//')),
  constraint notifications_read_order check (read_at is null or read_at >= created_at),
  constraint notifications_expiration_order
    check (expires_at is null or expires_at > created_at)
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  channel public.notification_channel not null,
  status public.notification_delivery_status not null default 'PENDING',
  attempt_count integer not null default 0,
  provider_message_id text,
  error_code text,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint notification_deliveries_non_negative_attempts check (attempt_count >= 0),
  constraint notification_deliveries_error_code_length
    check (error_code is null or char_length(error_code) <= 80)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint push_subscriptions_https_endpoint check (endpoint ~ '^https://'),
  constraint push_subscriptions_key_length
    check (char_length(p256dh) between 32 and 512 and char_length(auth_secret) between 8 and 256),
  constraint push_subscriptions_revocation_order
    check (revoked_at is null or revoked_at >= created_at)
);

create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  mining_enabled boolean not null default true,
  wallet_enabled boolean not null default true,
  events_enabled boolean not null default true,
  service_enabled boolean not null default true,
  marketing_enabled boolean not null default false,
  web_push_enabled boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint notification_preferences_quiet_hours_pair
    check (
      (quiet_hours_start is null and quiet_hours_end is null)
      or (quiet_hours_start is not null and quiet_hours_end is not null)
    )
);

create index rank_definitions_effective_idx
  on public.rank_definitions (code, effective_from desc)
  where is_active;
create index user_rank_progress_rank_idx
  on public.user_rank_progress (rank_definition_id);
create index events_publication_idx
  on public.events (status, starts_at, ends_at)
  where published_at is not null;
create index event_rules_event_effective_idx
  on public.event_rules (event_id, effective_from desc);
create index event_rewards_rule_idx
  on public.event_rewards (event_rule_id);
create index event_participants_user_idx
  on public.event_participants (user_id, joined_at desc);
create index notices_published_idx
  on public.notices (is_pinned desc, published_at desc)
  where status = 'PUBLISHED';
create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;
create index notification_deliveries_pending_idx
  on public.notification_deliveries (next_attempt_at, created_at)
  where status = 'PENDING';
create index notification_deliveries_user_idx
  on public.notification_deliveries (user_id, created_at desc);
create index push_subscriptions_active_user_idx
  on public.push_subscriptions (user_id)
  where revoked_at is null;

create trigger rank_definitions_prevent_update_delete
before update or delete on public.rank_definitions
for each row execute function app_private.prevent_row_mutation();

create trigger user_rank_progress_set_updated_at
before update on public.user_rank_progress
for each row execute function app_private.set_updated_at();

create trigger events_set_updated_at
before update on public.events
for each row execute function app_private.set_updated_at();

create trigger event_rules_prevent_update_delete
before update or delete on public.event_rules
for each row execute function app_private.prevent_row_mutation();

create trigger event_rewards_prevent_update_delete
before update or delete on public.event_rewards
for each row execute function app_private.prevent_row_mutation();

create trigger event_participants_set_updated_at
before update on public.event_participants
for each row execute function app_private.set_updated_at();

create trigger notices_set_updated_at
before update on public.notices
for each row execute function app_private.set_updated_at();

create trigger notification_deliveries_set_updated_at
before update on public.notification_deliveries
for each row execute function app_private.set_updated_at();

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function app_private.set_updated_at();

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function app_private.set_updated_at();

alter table public.rank_definitions enable row level security;
alter table public.rank_definitions force row level security;
alter table public.user_rank_progress enable row level security;
alter table public.user_rank_progress force row level security;
alter table public.events enable row level security;
alter table public.events force row level security;
alter table public.event_rules enable row level security;
alter table public.event_rules force row level security;
alter table public.event_rewards enable row level security;
alter table public.event_rewards force row level security;
alter table public.event_participants enable row level security;
alter table public.event_participants force row level security;
alter table public.notices enable row level security;
alter table public.notices force row level security;
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_deliveries force row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

grant select on public.rank_definitions, public.events, public.event_rewards, public.notices
  to anon, authenticated;
grant select on
  public.user_rank_progress,
  public.event_participants,
  public.notifications,
  public.notification_preferences
  to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant update (
  mining_enabled,
  wallet_enabled,
  events_enabled,
  service_enabled,
  marketing_enabled,
  web_push_enabled,
  quiet_hours_start,
  quiet_hours_end,
  timezone
) on public.notification_preferences to authenticated;

create policy rank_definitions_read_active
on public.rank_definitions
for select
to anon, authenticated
using (
  is_active
  and effective_from <= statement_timestamp()
  and (effective_to is null or effective_to > statement_timestamp())
);

create policy user_rank_progress_select_own
on public.user_rank_progress
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy events_read_published
on public.events
for select
to anon, authenticated
using (
  published_at is not null
  and published_at <= statement_timestamp()
  and status in ('SCHEDULED', 'LIVE', 'ENDED')
);

create policy event_rewards_read_for_published_event
on public.event_rewards
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.events as event
    where event.id = event_rewards.event_id
      and event.published_at is not null
      and event.published_at <= statement_timestamp()
      and event.status in ('SCHEDULED', 'LIVE', 'ENDED')
  )
);

create policy event_participants_select_own
on public.event_participants
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy notices_read_published
on public.notices
for select
to anon, authenticated
using (
  status = 'PUBLISHED'
  and published_at is not null
  and published_at <= statement_timestamp()
  and (expires_at is null or expires_at > statement_timestamp())
);

create policy notifications_select_own
on public.notifications
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy notifications_mark_own_read
on public.notifications
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy notification_preferences_select_own
on public.notification_preferences
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy notification_preferences_update_own
on public.notification_preferences
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

comment on table public.rank_definitions is
  'Append-only rank rule versions. Production thresholds are operator-controlled and are not seeded.';
comment on table public.push_subscriptions is
  'Server-only Web Push credentials. No client SELECT policy or grant is permitted.';
comment on table public.notification_deliveries is
  'Server-only delivery state. User-visible notification content is stored separately.';

commit;
