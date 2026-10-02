begin;

-- Auth grants must still be fresh when actually consumed, including time spent
-- waiting for the owner/row lock. Statement start time is not that instant.
create or replace function app_private.guard_withdrawal_destination_step_up()
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
    if new.status in ('VERIFIED','CONSUMED') and new.expires_at <= clock_timestamp() then
      raise exception using errcode = '42501', message = 'WITHDRAWAL_REAUTH_INVALID';
    end if;
    if old.status = 'PENDING' and new.status = 'VERIFIED' then
      new.verified_at := clock_timestamp();
    end if;
  end if;
  return new;
end;
$$;

create or replace function app_private.authorize_withdrawal_destination_replacement(
  p_user_id uuid,p_method text,p_fingerprint text,p_token text,p_request_id uuid
)
returns void language plpgsql security invoker set search_path = pg_catalog
as $$
declare v_grant uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:' || p_user_id::text, 0));
  if not exists (select 1 from public.withdrawal_destinations
    where user_id = p_user_id and destination_type = p_method) then
    return;
  end if;
  update public.withdrawal_destination_step_ups set status = 'CONSUMED',
    consumed_at = clock_timestamp(),consumed_request_id = p_request_id
  where user_id = p_user_id and method = p_method and destination_fingerprint = p_fingerprint
    and token_hash = encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
    and status = 'VERIFIED' and expires_at > clock_timestamp()
  returning id into v_grant;
  if v_grant is null then
    raise exception using errcode = '42501', message = 'WITHDRAWAL_REAUTH_REQUIRED';
  end if;
end;
$$;

revoke all on function app_private.guard_withdrawal_destination_step_up() from public,anon,authenticated;
revoke all on function app_private.authorize_withdrawal_destination_replacement(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function app_private.guard_withdrawal_destination_step_up() to service_role;
grant execute on function app_private.authorize_withdrawal_destination_replacement(uuid,text,text,text,uuid) to service_role;
commit;
