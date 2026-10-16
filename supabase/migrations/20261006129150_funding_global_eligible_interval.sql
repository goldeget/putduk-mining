begin;

-- Read-only global timeline. Called under the existing member lock; the GLOBAL
-- command takes its component-exclusive lock and never acquires member locks.
create function app_private.funding_global_eligible_interval(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_global_control_originals%rowtype;
 latest app_private.funding_global_control_originals%rowtype; current_control public.safe_mode_controls%rowtype;
 first_at timestamptz; baseline_known boolean; paused boolean:=false; cursor_at timestamptz;
 elapsed bigint:=0; ids jsonb:='[]'::jsonb; boundary timestamptz; count_originals bigint:=0;
begin
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
  or p_to<p_from or p_to>clock_timestamp() then
  raise exception using errcode='22023',message='FUNDING_GLOBAL_INTERVAL_INVALID'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='25000',message='FUNDING_RUNTIME_FRESH_SNAPSHOT_REQUIRED'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 select o.* into latest from app_private.funding_global_control_originals o order by o.revision desc limit 1;
 select c.* into current_control from public.safe_mode_controls c where c.component='GLOBAL';
 if latest.id is null then
  if current_control.id is not null or exists(select 1 from public.audit_logs a where a.target_type='SAFE_MODE' and a.target_id='GLOBAL') then
   raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_HISTORY_UNKNOWN'; end if;
  return jsonb_build_object('eligible_microseconds',((extract(epoch from p_to-p_from)*1000000)::bigint)::text,
   'paused_at_end',false,'control_original_ids',ids);
 end if;
 if current_control.id is distinct from latest.control_id or current_control.is_paused is distinct from latest.is_paused
  or current_control.starts_at is distinct from latest.effective_at
  or not exists(select 1 from public.audit_logs a where a.id=latest.audit_id
   and current_control.request_id=a.request_id and current_control.changed_by=a.actor_user_id
   and current_control.reason=a.reason and current_control.review_at is not distinct from(a.metadata->>'review_at')::timestamptz) then
  raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_HISTORY_UNKNOWN'; end if;
 select o.effective_at,o.baseline_known into first_at,baseline_known from app_private.funding_global_control_originals o
  order by o.revision limit 1;
 if not baseline_known and p_from<first_at then
  raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_HISTORY_UNKNOWN'; end if;
 cursor_at:=p_from;
 for original in select o.* from app_private.funding_global_control_originals o order by o.revision loop
  count_originals:=count_originals+1;
  if original.revision<>count_originals then
   raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_CHAIN_MISMATCH'; end if;
  perform app_private.assert_funding_global_control_original(original.id);
  if original.effective_at<=p_from then
   paused:=original.is_paused;
   -- Only the effective baseline receipt is needed, never future receipts.
   ids:=jsonb_build_array(original.id);
  elsif original.effective_at<=p_to then
   boundary:=original.effective_at;
   if not paused then elapsed:=elapsed+(extract(epoch from boundary-cursor_at)*1000000)::bigint; end if;
   cursor_at:=boundary; paused:=original.is_paused; ids:=ids||jsonb_build_array(original.id);
  end if;
 end loop;
 if count_originals<>latest.revision then
  raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_CHAIN_MISMATCH'; end if;
 -- A canonical GLOBAL command omitted by the AFTER hook is uncertainty, even
 -- if its current state happens to equal the last proved state.
 if exists(select 1 from public.audit_logs a where a.target_type='SAFE_MODE' and a.target_id='GLOBAL'
  and a.created_at>=first_at and not exists(select 1 from app_private.funding_global_control_originals o where o.audit_id=a.id)) then
  raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_HISTORY_UNKNOWN'; end if;
 if not paused then elapsed:=elapsed+(extract(epoch from p_to-cursor_at)*1000000)::bigint; end if;
 return jsonb_build_object('eligible_microseconds',elapsed::text,'paused_at_end',paused,'control_original_ids',ids);
end;
$$;

create function app_private.assert_funding_global_execution_allowed() returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare instant timestamptz; timeline jsonb;
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:SETTLEMENT',0));
 instant:=clock_timestamp(); timeline:=app_private.funding_global_eligible_interval(instant,instant);
 if timeline->>'paused_at_end'='true' or exists(select 1 from public.safe_mode_controls c
  where c.component='SETTLEMENT' and c.is_paused and c.starts_at<=instant) then
  raise exception using errcode='55000',message='SAFE_MODE_ACTIVE'; end if;
end;
$$;

-- Finance retains its existing GLOBAL stop independently of engine inputs.
-- Unsealed control history does not prevent a legitimate unpaused deposit;
-- the engine then records its existing audited UNRESOLVED outcome instead.
create function app_private.assert_funding_global_credit_allowed() returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 if exists(select 1 from public.safe_mode_controls c where c.component='GLOBAL'
  and c.is_paused and c.starts_at<=clock_timestamp()) then
  raise exception using errcode='55000',message='SAFE_MODE_ACTIVE'; end if;
end;
$$;

revoke all on function app_private.funding_global_eligible_interval(timestamptz,timestamptz),
 app_private.assert_funding_global_execution_allowed(),app_private.assert_funding_global_credit_allowed()
 from public,anon,authenticated,service_role;
grant execute on function app_private.funding_global_eligible_interval(timestamptz,timestamptz),
 app_private.assert_funding_global_execution_allowed(),app_private.assert_funding_global_credit_allowed() to service_role;
commit;
