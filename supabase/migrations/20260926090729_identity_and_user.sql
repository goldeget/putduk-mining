begin;

create table public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_path text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint user_profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 40),
  constraint user_profiles_avatar_path_not_url
    check (avatar_path is null or avatar_path !~* '^https?://')
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  constraint user_roles_unique_active_role unique nulls not distinct (user_id, role, revoked_at),
  constraint user_roles_revocation_order
    check (revoked_at is null or revoked_at >= granted_at)
);

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  locale text not null default 'ko-KR',
  timezone text not null default 'Asia/Seoul',
  reduced_motion text not null default 'system',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint user_settings_locale_format check (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint user_settings_reduced_motion
    check (reduced_motion in ('system', 'reduce', 'no-preference'))
);

create index user_roles_user_id_idx on public.user_roles (user_id);
create index user_roles_active_idx on public.user_roles (user_id, role)
  where revoked_at is null;

create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute function app_private.set_updated_at();

create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function app_private.set_updated_at();

alter table public.user_profiles enable row level security;
alter table public.user_profiles force row level security;
alter table public.user_roles enable row level security;
alter table public.user_roles force row level security;
alter table public.user_settings enable row level security;
alter table public.user_settings force row level security;

grant select on public.user_profiles to authenticated;
grant update (display_name, avatar_path) on public.user_profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select on public.user_settings to authenticated;
grant update (locale, timezone, reduced_motion) on public.user_settings to authenticated;

create policy user_profiles_select_own
on public.user_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_profiles_update_own
on public.user_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy user_roles_select_own
on public.user_roles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_settings_select_own
on public.user_settings
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy user_settings_update_own
on public.user_settings
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

comment on table public.user_roles is
  'Server-managed authorization roles. Never derive authority from raw_user_meta_data.';
comment on column public.user_profiles.avatar_path is
  'Storage-relative path only; external URLs are rejected.';

commit;
