begin;

-- Ephemeral, server-owned password/MFA proofs. Never store passwords, OTPs or
-- plaintext tokens. Auth logout deletes the session and invalidates its proofs.
create table public.withdrawal_destination_step_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid not null references auth.sessions(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  method text not null check (method in ('KRW_BANK', 'USDT_ADDRESS')),
  destination_fingerprint text not null check (destination_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'DENIED', 'CONSUMED')),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp() + interval '5 minutes',
  verified_at timestamptz,
  consumed_at timestamptz,
  consumed_request_id uuid,
  constraint withdrawal_destination_step_up_ttl check (
    expires_at > created_at and expires_at <= created_at + interval '5 minutes'
  ),
  constraint withdrawal_destination_step_up_state check (
    (status in ('PENDING', 'DENIED') and verified_at is null and consumed_at is null and consumed_request_id is null)
    or (status = 'VERIFIED' and verified_at is not null and verified_at >= created_at and consumed_at is null and consumed_request_id is null)
    or (status = 'CONSUMED' and verified_at is not null and consumed_at is not null and verified_at >= created_at and consumed_at >= verified_at and consumed_request_id is not null)
  )
);
create index withdrawal_destination_step_ups_owner_time
  on public.withdrawal_destination_step_ups(user_id, created_at desc);
create index withdrawal_destination_step_ups_session
  on public.withdrawal_destination_step_ups(auth_session_id);
alter table public.withdrawal_destination_step_ups enable row level security;
alter table public.withdrawal_destination_step_ups force row level security;
revoke all on public.withdrawal_destination_step_ups from public, anon, authenticated, service_role;
grant select on public.withdrawal_destination_step_ups to service_role;
grant insert (id,user_id,auth_session_id,token_hash,method,destination_fingerprint)
  on public.withdrawal_destination_step_ups to service_role;
grant update (status,verified_at,consumed_at,consumed_request_id)
  on public.withdrawal_destination_step_ups to service_role;

create function app_private.guard_withdrawal_destination_step_up()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:' || new.user_id::text, 0));
    if new.status <> 'PENDING' or new.verified_at is not null or new.consumed_at is not null
      or new.created_at is distinct from statement_timestamp()
      or new.expires_at is distinct from statement_timestamp() + interval '5 minutes' then
      raise exception using errcode = '42501', message = 'WITHDRAWAL_REAUTH_INVALID';
    end if;
    -- Admission commits BEFORE the password provider call. Failed attempts count.
    if (select count(*) from public.security_events
        where user_id = new.user_id and event_type = 'WITHDRAWAL_DESTINATION_REAUTH_PENDING'
          and occurred_at > statement_timestamp() - interval '15 minutes') >= 5 then
      raise exception using errcode = '55000', message = 'WITHDRAWAL_REAUTH_RATE_LIMITED';
    end if;
  else
    if row(new.id,new.user_id,new.auth_session_id,new.token_hash,new.method,new.destination_fingerprint,new.created_at,new.expires_at)
      is distinct from row(old.id,old.user_id,old.auth_session_id,old.token_hash,old.method,old.destination_fingerprint,old.created_at,old.expires_at)
      or not ((old.status = 'PENDING' and new.status in ('VERIFIED','DENIED'))
        or (old.status = 'VERIFIED' and new.status = 'CONSUMED')) then
      raise exception using errcode = '42501', message = 'WITHDRAWAL_REAUTH_INVALID';
    end if;
    if new.status in ('VERIFIED','CONSUMED') and new.expires_at <= statement_timestamp() then
      raise exception using errcode = '42501', message = 'WITHDRAWAL_REAUTH_INVALID';
    end if;
    if old.status = 'PENDING' and new.status = 'VERIFIED' then
      new.verified_at := statement_timestamp();
    end if;
  end if;
  return new;
end;
$$;

create function app_private.audit_withdrawal_destination_step_up()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $$
begin
  insert into public.security_events(user_id,event_type,trusted_client_ip,ip_source,device_context,request_id)
  values (new.user_id,'WITHDRAWAL_DESTINATION_REAUTH_' || new.status,null,'NONE',
    jsonb_build_object('method',new.method,'grant_id',new.id),coalesce(new.consumed_request_id,new.id));
  return new;
end;
$$;
create trigger withdrawal_destination_step_up_guard before insert or update
on public.withdrawal_destination_step_ups for each row
execute function app_private.guard_withdrawal_destination_step_up();
create trigger withdrawal_destination_step_up_audit after insert or update
on public.withdrawal_destination_step_ups for each row
execute function app_private.audit_withdrawal_destination_step_up();

-- Same owner lock as the logical lifecycle. No new public command aliases.
create function app_private.authorize_withdrawal_destination_replacement(
  p_user_id uuid,p_method text,p_fingerprint text,p_token text,p_request_id uuid
)
returns void language plpgsql security invoker set search_path = pg_catalog
as $$
declare v_grant uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:' || p_user_id::text, 0));
  if not exists (select 1 from public.withdrawal_destinations
    where user_id = p_user_id and destination_type = p_method) then
    return; -- first registration remains immediately eligible, without funding
  end if;
  update public.withdrawal_destination_step_ups set status = 'CONSUMED',
    consumed_at = statement_timestamp(),consumed_request_id = p_request_id
  where user_id = p_user_id and method = p_method and destination_fingerprint = p_fingerprint
    and token_hash = encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
    and status = 'VERIFIED' and expires_at > statement_timestamp()
  returning id into v_grant;
  if v_grant is null then
    raise exception using errcode = '42501', message = 'WITHDRAWAL_REAUTH_REQUIRED';
  end if;
end;
$$;

-- Frozen signatures, safe mode, validation, history, encryption and protection
-- semantics retained. Only the old string-length "step-up" is replaced.
create or replace function public.register_krw_bank_destination(
  p_user_id uuid,p_encrypted_value bytea,p_value_fingerprint text,p_display_hint text,
  p_step_up_token text,p_request_id uuid,p_protection_hours integer default 24
)
returns uuid language plpgsql security invoker set search_path = pg_catalog
as $$
declare v_id uuid; v_prior uuid; v_protection_until timestamptz;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL','WITHDRAWAL']);
  if p_user_id is null or p_encrypted_value is null or octet_length(p_encrypted_value) < 16
    or char_length(btrim(coalesce(p_value_fingerprint,''))) < 8
    or char_length(btrim(coalesce(p_display_hint,''))) < 2 or p_request_id is null
    or coalesce(p_protection_hours,0) not between 1 and 168 then
    raise exception using errcode = '22023', message = 'INVALID_KRW_BANK_DESTINATION';
  end if;
  perform app_private.authorize_withdrawal_destination_replacement(
    p_user_id,'KRW_BANK',p_value_fingerprint,p_step_up_token,p_request_id);
  perform app_private.touch_command_rate_limit('REGISTER_KRW_BANK_DESTINATION',p_user_id::text,5,3600,3600);
  select id into v_prior from public.withdrawal_destinations
    where user_id = p_user_id and destination_type = 'KRW_BANK' and replaced_at is null for update;
  if v_prior is not null then
    update public.withdrawal_destinations set replaced_at = statement_timestamp() where id = v_prior;
    insert into public.withdrawal_destination_history(destination_id,user_id,destination_type,action,display_hint,value_fingerprint,actor_user_id,request_id)
    select id,user_id,destination_type,'REPLACED',display_hint,value_fingerprint,p_user_id,p_request_id
    from public.withdrawal_destinations where id = v_prior;
    v_protection_until := statement_timestamp() + make_interval(hours => p_protection_hours);
  else
    v_protection_until := statement_timestamp();
  end if;
  insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,display_hint,verification_status,verified_at,protection_until)
  values (p_user_id,'KRW_BANK',p_encrypted_value,p_value_fingerprint,p_display_hint,'VERIFIED',statement_timestamp(),v_protection_until)
  returning id into v_id;
  insert into public.withdrawal_destination_history(destination_id,user_id,destination_type,action,display_hint,value_fingerprint,metadata,actor_user_id,request_id)
  values (v_id,p_user_id,'KRW_BANK','REGISTERED',p_display_hint,p_value_fingerprint,
    jsonb_build_object('masked',true,'first_registration',v_prior is null,
      'step_up_token_hash',case when v_prior is not null then encode(extensions.digest(p_step_up_token,'sha256'),'hex') else null end),p_user_id,p_request_id);
  insert into public.security_events(user_id,event_type,trusted_client_ip,ip_source,device_context,request_id)
  values (p_user_id,'WITHDRAWAL_DESTINATION_REGISTERED',null,'NONE',
    jsonb_build_object('destination_type','KRW_BANK','destination_id',v_id),p_request_id);
  return v_id;
end;
$$;

create or replace function public.register_usdt_withdrawal_destination(
  p_user_id uuid,p_network text,p_address text,p_encrypted_value bytea,p_value_fingerprint text,
  p_display_hint text,p_step_up_token text,p_request_id uuid,p_protection_hours integer default 24
)
returns uuid language plpgsql security invoker set search_path = pg_catalog
as $$
declare v_network text := upper(btrim(coalesce(p_network,'')));
  v_address text := btrim(coalesce(p_address,'')); v_id uuid; v_prior uuid; v_protection_until timestamptz;
begin
  perform app_private.assert_not_safe_mode(array['GLOBAL','WITHDRAWAL']);
  if p_user_id is null or v_network not in ('TRC20','ERC20','BEP20')
    or char_length(v_address) not between 8 and 128
    or (v_network = 'TRC20' and v_address !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$')
    or (v_network in ('ERC20','BEP20') and v_address !~ '^0x[0-9a-fA-F]{40}$')
    or p_encrypted_value is null or octet_length(p_encrypted_value) < 16
    or char_length(btrim(coalesce(p_value_fingerprint,''))) < 8
    or char_length(btrim(coalesce(p_display_hint,''))) < 2 or p_request_id is null
    or coalesce(p_protection_hours,0) not between 1 and 168 then
    raise exception using errcode = '22023', message = 'INVALID_USDT_WITHDRAWAL_DESTINATION';
  end if;
  perform app_private.authorize_withdrawal_destination_replacement(
    p_user_id,'USDT_ADDRESS',p_value_fingerprint,p_step_up_token,p_request_id);
  perform app_private.touch_command_rate_limit('REGISTER_USDT_WITHDRAWAL_DESTINATION',p_user_id::text,5,3600,3600);
  select id into v_prior from public.withdrawal_destinations
    where user_id = p_user_id and destination_type = 'USDT_ADDRESS' and replaced_at is null for update;
  if v_prior is not null then
    update public.withdrawal_destinations set replaced_at = statement_timestamp() where id = v_prior;
    insert into public.withdrawal_destination_history(destination_id,user_id,destination_type,action,display_hint,value_fingerprint,actor_user_id,request_id,metadata)
    select id,user_id,destination_type,'REPLACED',display_hint,value_fingerprint,p_user_id,p_request_id,jsonb_build_object('network',v_network)
    from public.withdrawal_destinations where id = v_prior;
    v_protection_until := statement_timestamp() + make_interval(hours => p_protection_hours);
  else
    v_protection_until := statement_timestamp();
  end if;
  insert into public.withdrawal_destinations(user_id,destination_type,encrypted_value,value_fingerprint,display_hint,verification_status,verified_at,protection_until)
  values (p_user_id,'USDT_ADDRESS',p_encrypted_value,p_value_fingerprint,p_display_hint,'VERIFIED',statement_timestamp(),v_protection_until)
  returning id into v_id;
  insert into public.withdrawal_destination_history(destination_id,user_id,destination_type,action,display_hint,value_fingerprint,metadata,actor_user_id,request_id)
  values (v_id,p_user_id,'USDT_ADDRESS','REGISTERED',p_display_hint,p_value_fingerprint,
    jsonb_build_object('network',v_network,'masked',true,'first_registration',v_prior is null,
      'step_up_token_hash',case when v_prior is not null then encode(extensions.digest(p_step_up_token,'sha256'),'hex') else null end),p_user_id,p_request_id);
  insert into public.security_events(user_id,event_type,trusted_client_ip,ip_source,device_context,request_id)
  values (p_user_id,'WITHDRAWAL_DESTINATION_REGISTERED',null,'NONE',
    jsonb_build_object('destination_type','USDT_ADDRESS','network',v_network,'destination_id',v_id),p_request_id);
  return v_id;
end;
$$;

revoke all on function app_private.guard_withdrawal_destination_step_up() from public,anon,authenticated;
revoke all on function app_private.audit_withdrawal_destination_step_up() from public,anon,authenticated;
revoke all on function app_private.authorize_withdrawal_destination_replacement(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function app_private.guard_withdrawal_destination_step_up() to service_role;
grant execute on function app_private.audit_withdrawal_destination_step_up() to service_role;
grant execute on function app_private.authorize_withdrawal_destination_replacement(uuid,text,text,text,uuid) to service_role;
revoke all on function public.register_krw_bank_destination(uuid,bytea,text,text,text,uuid,integer) from public,anon,authenticated;
revoke all on function public.register_usdt_withdrawal_destination(uuid,text,text,bytea,text,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.register_krw_bank_destination(uuid,bytea,text,text,text,uuid,integer) to service_role;
grant execute on function public.register_usdt_withdrawal_destination(uuid,text,text,bytea,text,text,text,uuid,integer) to service_role;
comment on table public.withdrawal_destination_step_ups is
  'Service-only destination-bound password/MFA proof; 5-minute TTL, 5 attempts/15 minutes, atomic one-use replacement and logout cascade. No plaintext credentials.';
commit;
