-- V1 members hold withdrawable value in KRW only. USDT deposit/withdrawal are
-- rails against KRW; bootstrap must not create a user USDT wallet account or
-- balance snapshot surface that product copy forbids.

create or replace function public.bootstrap_user(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'AUTH_USER_NOT_FOUND';
  end if;

  insert into public.user_profiles (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.user_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.notification_preferences (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.wallet_accounts (user_id, currency)
  values (p_user_id, 'KRW'::public.currency_code)
  on conflict (user_id, currency) do nothing;
end;
$$;

revoke all on function public.bootstrap_user(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_user(uuid) to service_role;

comment on function public.bootstrap_user(uuid) is
  'Ensures profile/settings and the KRW wallet only. USDT is not a member wallet currency.';
