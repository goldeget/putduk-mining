begin;

create function app_private.record_signup_phone_history()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  insert into public.signup_phone_history (phone_e164, user_id, source)
  values (new.phone_e164, new.user_id, 'SIGNUP')
  on conflict (phone_e164) do nothing;

  -- verified_phone_at must never mean SMS/ownership verification.
  if new.verified_phone_at is not null then
    new.verified_phone_at := null;
  end if;

  return new;
end;
$$;

revoke all on function app_private.record_signup_phone_history()
  from public, anon, authenticated;

create trigger user_identity_profiles_record_signup_phone
before insert on public.user_identity_profiles
for each row execute function app_private.record_signup_phone_history();

create trigger user_identity_profiles_block_verified_phone_claim
before update of verified_phone_at on public.user_identity_profiles
for each row
when (new.verified_phone_at is distinct from old.verified_phone_at)
execute function app_private.record_signup_phone_history();

-- On update path the trigger still clears verified_phone_at claims.
create or replace function app_private.record_signup_phone_history()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.signup_phone_history (phone_e164, user_id, source)
    values (new.phone_e164, new.user_id, 'SIGNUP')
    on conflict (phone_e164) do nothing;
  end if;

  if new.verified_phone_at is not null then
    new.verified_phone_at := null;
  end if;

  return new;
end;
$$;

commit;
