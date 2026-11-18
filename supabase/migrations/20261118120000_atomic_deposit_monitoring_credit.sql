begin;

-- Approved deposits are credited to monitoring balance exactly once.
-- The same transaction also creates a member notification receipt.

alter table app_private.workroom_monitoring_settings
  drop constraint if exists workroom_monitoring_settings_signup_bonus_krw_check;
alter table app_private.workroom_monitoring_settings
  add constraint workroom_monitoring_settings_signup_bonus_krw_check
  check (signup_bonus_krw >= 0);

update app_private.workroom_monitoring_settings
set signup_bonus_krw = 0,
    updated_at = clock_timestamp()
where id = 1;

-- Recover the historical welcome bonus once, only while it remains available.
do $$
declare
  v_bonus app_private.workroom_signup_bonuses%rowtype;
  v_balance bigint;
  v_recover bigint;
begin
  for v_bonus in
    select *
    from app_private.workroom_signup_bonuses
    where recovered_at is null
      and amount_krw > 0
    for update
  loop
    select balance
    into v_balance
    from app_private.workroom_accounts
    where user_id = v_bonus.user_id
    for update;

    if v_balance is not null and v_balance > 0 then
      v_recover := least(v_balance, v_bonus.amount_krw);

      update app_private.workroom_accounts
      set balance = balance - v_recover
      where user_id = v_bonus.user_id
      returning balance into v_balance;

      insert into app_private.workroom_ledger (
        user_id, amount, balance_after, kind, note
      ) values (
        v_bonus.user_id,
        -v_recover,
        v_balance,
        'BONUS_RECOVERY',
        'Historical free welcome bonus removed'
      );
    end if;

    update app_private.workroom_signup_bonuses
    set recovered_at = clock_timestamp(), recovered_by = null
    where user_id = v_bonus.user_id;
  end loop;
end;
$$;

create or replace function app_private.workroom_initialize(p_user uuid, p_referral text) returns void
language plpgsql security invoker set search_path = pg_catalog as $$
declare
  n text;
begin
  select left(coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(u.raw_user_meta_data ->> 'legal_name'), ''), '회원'), 40)
  into n
  from auth.users u
  left join public.user_profiles p on p.user_id = u.id
  where u.id = p_user;

  insert into app_private.workroom_accounts (user_id, name, balance, room, referral)
  values (p_user, coalesce(n, '회원'), 0, 'WR-' || upper(replace(p_user::text, '-', '')), p_referral)
  on conflict (user_id) do nothing;
end$$;

create or replace function app_private.apply_approved_deposit_monitoring_credit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_amount bigint;
  v_balance bigint;
  v_note text;
begin
  if tg_table_name = 'deposit_requests' then
    if old.status is not distinct from new.status or new.status <> 'APPROVED' then
      return new;
    end if;
    v_amount := new.approved_amount_atomic;
  elsif tg_table_name = 'usdt_manual_deposits' then
    if old.status is not distinct from new.status or new.status <> 'CONFIRMED' then
      return new;
    end if;
    v_amount := new.credited_krw;
  else
    return new;
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception using errcode = '22023', message = 'MONITORING_DEPOSIT_AMOUNT_INVALID';
  end if;

  insert into app_private.workroom_accounts (user_id, name, balance, room, referral)
  select new.user_id,
         left(coalesce(nullif(btrim(p.display_name), ''), '회원'), 40),
         0,
         'WR-' || upper(replace(new.user_id::text, '-', '')),
         null
  from auth.users u
  left join public.user_profiles p on p.user_id = u.id
  where u.id = new.user_id
  on conflict (user_id) do nothing;

  v_note := case tg_table_name
    when 'deposit_requests' then '입금 승인 모니터링 잔액 충전 · ' || new.id::text
    else 'USDT 입금 승인 모니터링 잔액 충전 · ' || new.id::text
  end;

  if exists (
    select 1 from app_private.workroom_ledger
    where user_id = new.user_id
      and kind = 'DEPOSIT'
      and note = v_note
  ) then
    return new;
  end if;

  update app_private.workroom_accounts
  set balance = balance + v_amount
  where user_id = new.user_id
  returning balance into v_balance;

  if v_balance is null then
    raise exception using errcode = '55000', message = 'MONITORING_ACCOUNT_NOT_FOUND';
  end if;

  insert into app_private.workroom_ledger (user_id, amount, balance_after, kind, note)
  values (new.user_id, v_amount, v_balance, 'DEPOSIT', v_note);

  return new;
end$$;

revoke all on function app_private.apply_approved_deposit_monitoring_credit() from public, anon, authenticated, service_role;

drop trigger if exists deposit_request_monitoring_credit on public.deposit_requests;
create trigger deposit_request_monitoring_credit
after update of status, approved_amount_atomic on public.deposit_requests
for each row execute function app_private.apply_approved_deposit_monitoring_credit();

drop trigger if exists usdt_deposit_monitoring_credit on public.usdt_manual_deposits;
create trigger usdt_deposit_monitoring_credit
after update of status, credited_krw on public.usdt_manual_deposits
for each row execute function app_private.apply_approved_deposit_monitoring_credit();

commit;
