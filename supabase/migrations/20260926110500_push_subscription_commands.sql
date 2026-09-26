begin;

alter table public.push_subscriptions
  add constraint push_subscriptions_user_agent_length
  check (user_agent is null or char_length(user_agent) <= 512);

create function public.upsert_push_subscription(
  p_user_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth_secret text,
  p_expires_at timestamptz,
  p_user_agent text
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_subscription_id uuid;
begin
  if p_endpoint !~ '^https://'
    or char_length(p_endpoint) > 2048
    or char_length(p_p256dh) not between 32 and 512
    or char_length(p_auth_secret) not between 8 and 256
    or char_length(coalesce(p_user_agent, '')) > 512
  then
    raise exception using errcode = '22023', message = 'INVALID_PUSH_SUBSCRIPTION';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
  ) then
    raise exception using errcode = '22023', message = 'AUTH_USER_NOT_FOUND';
  end if;

  insert into public.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth_secret,
    user_agent,
    expires_at
  ) values (
    p_user_id,
    p_endpoint,
    p_p256dh,
    p_auth_secret,
    nullif(p_user_agent, ''),
    p_expires_at
  )
  on conflict (endpoint) do update
  set
    p256dh = excluded.p256dh,
    auth_secret = excluded.auth_secret,
    user_agent = excluded.user_agent,
    expires_at = excluded.expires_at,
    revoked_at = null
  where public.push_subscriptions.user_id = excluded.user_id
  returning id into v_subscription_id;

  if v_subscription_id is null then
    raise exception using errcode = '23505', message = 'PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT';
  end if;

  insert into public.notification_preferences (user_id, web_push_enabled)
  values (p_user_id, true)
  on conflict (user_id) do update
  set web_push_enabled = true;

  return v_subscription_id;
end;
$$;

create function public.revoke_push_subscription(
  p_user_id uuid,
  p_endpoint text
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_revoked boolean;
begin
  update public.push_subscriptions
  set revoked_at = statement_timestamp()
  where user_id = p_user_id
    and endpoint = p_endpoint
    and revoked_at is null;

  v_revoked := found;

  if not exists (
    select 1
    from public.push_subscriptions as subscription
    where subscription.user_id = p_user_id
      and subscription.revoked_at is null
      and (subscription.expires_at is null or subscription.expires_at > statement_timestamp())
  ) then
    update public.notification_preferences
    set web_push_enabled = false
    where user_id = p_user_id;
  end if;

  return v_revoked;
end;
$$;

revoke all on function public.upsert_push_subscription(
  uuid,
  text,
  text,
  text,
  timestamptz,
  text
) from public, anon, authenticated;
grant execute on function public.upsert_push_subscription(
  uuid,
  text,
  text,
  text,
  timestamptz,
  text
) to service_role;

revoke all on function public.revoke_push_subscription(uuid, text)
  from public, anon, authenticated;
grant execute on function public.revoke_push_subscription(uuid, text)
  to service_role;

comment on function public.upsert_push_subscription(
  uuid,
  text,
  text,
  text,
  timestamptz,
  text
) is 'Service-only atomic ownership-safe Web Push subscription registration.';
comment on function public.revoke_push_subscription(uuid, text) is
  'Service-only Web Push revocation that disables the preference when no active device remains.';

commit;
