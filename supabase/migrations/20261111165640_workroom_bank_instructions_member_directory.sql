begin;

alter table public.user_identity_profiles add column birth_sex_digit text;
alter table public.user_identity_profiles add constraint user_identity_profiles_birth_sex_digit
 check(birth_sex_digit is null or (birth_sex_digit ~ '^[1-8]$' and
  ((birth_sex_digit in('1','2','5','6') and extract(year from date_of_birth) between 1900 and 1999) or
   (birth_sex_digit in('3','4','7','8') and extract(year from date_of_birth) between 2000 and 2099))));
create function app_private.capture_signup_birth_digit() returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 select u.raw_user_meta_data->>'birth_sex_digit' into new.birth_sex_digit from auth.users u where u.id=new.user_id;
 return new;
end$$;
revoke all on function app_private.capture_signup_birth_digit() from public,anon,authenticated,service_role;
create trigger user_identity_profiles_capture_birth_digit before insert on public.user_identity_profiles
 for each row execute function app_private.capture_signup_birth_digit();

create table public.krw_deposit_settings (
 id boolean primary key default true check(id),
 mode text not null check(mode in ('ACCOUNT','CONTACT')),
 bank_name text not null default '', account_number text not null default '', account_holder text not null default '',
 contact_message text not null default '1:1 상담 후 계좌 발급' check(length(btrim(contact_message)) between 2 and 200),
 version integer not null default 1 check(version>0),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid references auth.users(id),
 check(length(bank_name)<=30 and length(account_holder)<=40 and length(account_number)<=30),
 check((mode='CONTACT' and bank_name='' and account_number='' and account_holder='') or
 (mode='ACCOUNT' and length(btrim(bank_name))>=2 and length(btrim(account_holder))>=2
  and account_number ~ '^[0-9][0-9-]{6,28}[0-9]$' and position('--' in account_number)=0
  and length(replace(account_number,'-',''))>=8))
);
alter table public.krw_deposit_settings enable row level security;
alter table public.krw_deposit_settings force row level security;
revoke all on public.krw_deposit_settings from public, anon, authenticated, service_role;
grant select on public.krw_deposit_settings to authenticated, service_role;
grant update on public.krw_deposit_settings to service_role;
create policy krw_deposit_settings_member_read on public.krw_deposit_settings for select to authenticated using(true);
insert into public.krw_deposit_settings(id,mode) values(true,'CONTACT');

create function public.set_krw_deposit_settings(
 p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text,p_request_id uuid,
 p_expected_version integer,p_mode text,p_bank_name text,p_account_number text,p_account_holder text,p_contact_message text,p_reason text
) returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare actor_role public.app_role; current_row public.krw_deposit_settings%rowtype; next_version integer;
begin
 actor_role:=app_private.assert_economy_policy_admin_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 perform app_private.assert_not_safe_mode(array['GLOBAL','DEPOSIT']);
 if p_request_id is null or not exists(select 1 from public.admin_step_up_grants g
  where g.user_id=p_actor and g.admin_session_id=p_admin_session_id and g.command_family='DEPOSIT_INSTRUCTION'
  and g.consume_request_id=p_request_id and g.consumed_at>clock_timestamp()-interval '10 minutes') then
  raise exception using errcode='42501',message='STEP_UP_REQUIRED';
 end if;
 if p_mode is null or p_mode not in('ACCOUNT','CONTACT') or p_reason is null or length(btrim(p_reason)) not between 10 and 500
 or p_contact_message is null or length(btrim(p_contact_message)) not between 2 and 200
 or p_bank_name is null or p_account_number is null or p_account_holder is null then
  raise exception using errcode='22023',message='INVALID_KRW_INSTRUCTION';
 end if;
 select * into current_row from public.krw_deposit_settings where id for update;
 if current_row.version is distinct from p_expected_version then raise exception 'KRW_INSTRUCTION_STALE';end if;
 -- A consumed step-up request may mutate this setting only once.
 if exists(select 1 from public.audit_logs where action='KRW_DEPOSIT_SETTINGS_SET' and request_id=p_request_id) then raise exception 'REQUEST_ALREADY_USED';end if;
 update public.krw_deposit_settings set mode=p_mode,
 bank_name=case when p_mode='ACCOUNT' then btrim(p_bank_name) else '' end,
 account_number=case when p_mode='ACCOUNT' then btrim(p_account_number) else '' end,
 account_holder=case when p_mode='ACCOUNT' then btrim(p_account_holder) else '' end,
 contact_message=btrim(p_contact_message),version=version+1,updated_at=clock_timestamp(),updated_by=p_actor
 where id returning version into next_version;
 insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,before_state,after_state)
 values(p_actor,actor_role,'KRW_DEPOSIT_SETTINGS_SET','KRW_DEPOSIT_SETTINGS','primary',p_reason,p_request_id,
 jsonb_build_object('mode',current_row.mode,'version',current_row.version),jsonb_build_object('mode',p_mode,'version',next_version));
 return next_version;
end$$;
revoke all on function public.set_krw_deposit_settings(uuid,uuid,text,text,uuid,integer,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.set_krw_deposit_settings(uuid,uuid,text,text,uuid,integer,text,text,text,text,text,text) to service_role;

-- Server-only, append-only signup context. Never backfill an unobserved IP.
create table public.member_registration_context (
 user_id uuid primary key references auth.users(id) on delete cascade,
 signup_ip inet, ip_source text not null check(ip_source in('CLOUDFLARE_VERIFIED','NONE')),
 referral_code text not null check(length(referral_code) between 15 and 67),
 workroom_acknowledged boolean not null check(workroom_acknowledged),
 captured_at timestamptz not null default clock_timestamp(),
 check((signup_ip is null)=(ip_source='NONE'))
);
alter table public.member_registration_context enable row level security;
alter table public.member_registration_context force row level security;
revoke all on public.member_registration_context from public,anon,authenticated,service_role;
grant select,insert on public.member_registration_context to service_role;
create trigger member_registration_context_immutable before update on public.member_registration_context
 for each row execute function app_private.prevent_row_mutation();
create index user_identity_profiles_joined_idx on public.user_identity_profiles(created_at desc,user_id desc);

commit;
