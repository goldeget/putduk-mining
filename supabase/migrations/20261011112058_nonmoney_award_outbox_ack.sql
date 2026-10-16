begin;
-- Acknowledgement only: the existing evaluator already commits the award,
-- in-app notification (or sealed suppression) and device fanout atomically.
-- Preserve the installed dispatcher body instead of copying an older revision.
do $$
begin
  if to_regprocedure('app_private.complete_system_outbox_original(uuid,text)') is not null then
    raise exception 'OUTBOX_ORIGINAL_ALIAS_ALREADY_EXISTS';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    join pg_catalog.pg_roles r on r.oid=p.proowner
    where n.nspname='public' and p.proname='complete_outbox_event'
      and p.oid=to_regprocedure('public.complete_outbox_event(uuid,text)')
      and not p.prosecdef and r.rolname='postgres'
  ) then
    raise exception 'OUTBOX_ORIGINAL_DISPATCHER_BOUNDARY_CHANGED';
  end if;
end;
$$;
alter function public.complete_outbox_event(uuid,text)
  rename to complete_system_outbox_original;
alter function public.complete_system_outbox_original(uuid,text)
  set schema app_private;
revoke all on function app_private.complete_system_outbox_original(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function app_private.complete_system_outbox_original(uuid,text)
  to service_role;

create function app_private.ack_nonmoney_award_outbox(p_event uuid,p_worker text)
returns void language plpgsql volatile security definer set search_path=pg_catalog as $$
declare
  e public.outbox_events%rowtype;
  w public.member_event_awards%rowtype;
  d public.event_consumer_deliveries%rowtype;
begin
  if current_user<>'postgres'
    or current_setting('role',true) is distinct from 'service_role'
    or auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';
  end if;
  if char_length(btrim(coalesce(p_worker,''))) not between 1 and 120 then
    raise exception using errcode='22023',message='INVALID_OUTBOX_CLAIM_CONTEXT';
  end if;
  select * into e from public.outbox_events where id=p_event for update;
  if e.id is null or e.status is distinct from 'PROCESSING'::public.outbox_status
    or e.lease_owner is distinct from p_worker
    or e.lease_expires_at is null or e.lease_expires_at<=clock_timestamp() then
    raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';
  end if;
  if e.event_type is distinct from 'EVENT_REWARD_GRANTED.v1'
    or e.schema_version is distinct from 1
    or e.aggregate_type is distinct from 'event_reward' then
    raise exception using errcode='55000',message='NONMONEY_AWARD_EVENT_REQUIRED';
  end if;
  select * into w from public.member_event_awards where outbox_id=e.id;
  if w.id is null or w.id is distinct from e.aggregate_id then
    raise exception using errcode='55000',message='NONMONEY_AWARD_ORIGINAL_REQUIRED';
  end if;
  -- These existing validators bind owner, approved policy, prior join, actual
  -- business source, immutable award/audit/envelope and persisted/suppressed notice.
  perform app_private.assert_nonmoney_award(w.id);
  perform app_private.assert_nonmoney_notification(w.id);
  insert into public.event_consumer_deliveries(
    event_id,consumer_name,status,attempt_count,processed_at
  ) values(e.id,'nonmoney_award_ack.v1','SUCCEEDED',1,clock_timestamp())
  on conflict(event_id,consumer_name) do nothing;
  select * into d from public.event_consumer_deliveries
    where event_id=e.id and consumer_name='nonmoney_award_ack.v1';
  if d.status is distinct from 'SUCCEEDED'::public.consumer_delivery_status
    or d.attempt_count is distinct from 1 or d.processed_at is null
    or d.lease_owner is not null or d.lease_expires_at is not null
    or d.last_error_code is not null then
    raise exception using errcode='55000',message='NONMONEY_AWARD_ACK_RECEIPT_INVALID';
  end if;
  update public.outbox_events
    set status='PROCESSED',processed_at=clock_timestamp(),
      lease_owner=null,lease_expires_at=null,last_error_code=null
    where id=e.id and status='PROCESSING' and lease_owner=p_worker
      and lease_expires_at>clock_timestamp();
  if not found then
    raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';
  end if;
end;
$$;
alter function app_private.ack_nonmoney_award_outbox(uuid,text) owner to postgres;
revoke all on function app_private.ack_nonmoney_award_outbox(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function app_private.ack_nonmoney_award_outbox(uuid,text)
  to service_role;

create function public.complete_outbox_event(p_event_id uuid,p_worker_id text)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if exists(select 1 from public.outbox_events
    where id=p_event_id and event_type='EVENT_REWARD_GRANTED.v1') then
    perform app_private.ack_nonmoney_award_outbox(p_event_id,p_worker_id);
  else
    perform app_private.complete_system_outbox_original(p_event_id,p_worker_id);
  end if;
end;
$$;
alter function public.complete_outbox_event(uuid,text) owner to postgres;
revoke all on function public.complete_outbox_event(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.complete_outbox_event(uuid,text) to service_role;
comment on function public.complete_outbox_event(uuid,text) is
  'Owned-lease dispatcher. Nonmoney award events validate existing award/notification originals and acknowledge only; all other event types delegate to the preserved installed dispatcher.';
commit;
