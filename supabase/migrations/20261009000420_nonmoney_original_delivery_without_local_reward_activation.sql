begin;
-- Existing canonical consumer only: no public command alias or monetary writer.
-- Direct evaluator / operator approval default-disabled guards remain unchanged.
create or replace function app_private.consume_nonmoney_source(p_event_id uuid,p_worker_id text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;d public.event_consumer_deliveries%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='NONMONEY_CLOSED_EXECUTOR_REQUIRED';end if;
 select * into e from public.outbox_events where id=p_event_id for update;
 if e.status is distinct from 'PROCESSING'::public.outbox_status or e.lease_owner is distinct from p_worker_id or e.lease_expires_at is null or e.lease_expires_at<clock_timestamp() then raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';end if;
 -- Validate the actual sealed business original even when no local reward policy is active.
 -- Local reward activation is separate from ordinary domain-event acknowledgement.
 perform app_private.read_nonmoney_mission_original(e.id);
 if exists(select 1 from app_private.nonmoney_executor_configuration
  where singleton and local_qa_enabled
   and project_identity='putduk-mining-local-recovery-20261009-fi') then
  perform app_private.evaluate_nonmoney_original(e.id);
 end if;
 insert into public.event_consumer_deliveries(event_id,consumer_name,status,attempt_count,processed_at)
 values(e.id,'nonmoney_mission_original.v1','SUCCEEDED',1,clock_timestamp()) on conflict(event_id,consumer_name)do nothing;
 select * into d from public.event_consumer_deliveries where event_id=e.id and consumer_name='nonmoney_mission_original.v1';
 if d.status is distinct from 'SUCCEEDED'::public.consumer_delivery_status or d.attempt_count<>1 or d.processed_at is null or d.lease_owner is not null or d.lease_expires_at is not null or d.last_error_code is not null then raise exception using errcode='55000',message='NONMONEY_DELIVERY_INVALID';end if;
end;$$;
revoke all on function app_private.consume_nonmoney_source(uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.consume_nonmoney_source(uuid,text) to service_role;

commit;
