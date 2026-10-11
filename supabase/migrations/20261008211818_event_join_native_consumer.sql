begin;
-- Trigger-only closed read access; do not grant private CMS rows to workers.
alter function app_private.guard_liveops_sealed_links() security definer;
-- Existing worker command extension. Joining is not mission completion or reward.
create table app_private.event_join_consumer_receipts(
 join_id uuid primary key references app_private.event_join_originals(id),
 outbox_id uuid not null unique references public.outbox_events(id),
 delivery_id uuid not null unique references public.event_consumer_deliveries(id),
 digest text not null,processed_at timestamptz not null);
alter table app_private.event_join_consumer_receipts enable row level security;
alter table app_private.event_join_consumer_receipts force row level security;
revoke all on app_private.event_join_consumer_receipts from public,anon,authenticated,service_role;
grant select on app_private.event_join_consumer_receipts to service_role;
create trigger event_join_consumer_receipt_immutable before update or delete on app_private.event_join_consumer_receipts for each row execute function app_private.prevent_row_mutation();
create function app_private.consume_event_join(p_event_id uuid,p_worker_id text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;j app_private.event_join_originals%rowtype;r app_private.event_join_consumer_receipts%rowtype;d public.event_consumer_deliveries%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='EVENT_CONSUMER_SERVICE_REQUIRED';end if;
 select * into e from public.outbox_events where id=p_event_id for update;
 if e.status is distinct from 'PROCESSING'::public.outbox_status or e.lease_owner is distinct from p_worker_id or e.lease_expires_at is null or e.lease_expires_at<clock_timestamp() then raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';end if;
 select * into j from app_private.event_join_originals where outbox_id=e.id;
 if j.id is null or e.event_type is distinct from 'EVENT_PARTICIPATION_JOINED.v1' then raise exception using errcode='55000',message='EVENT_JOIN_ORIGINAL_INVALID';end if;
 perform app_private.assert_event_join(j.id);
 select * into r from app_private.event_join_consumer_receipts where join_id=j.id;
 if r.join_id is null then
  insert into public.event_consumer_deliveries(event_id,consumer_name,status,attempt_count,processed_at)
  values(e.id,'member_event_join.v1','SUCCEEDED',1,clock_timestamp()) returning * into d;
  insert into app_private.event_join_consumer_receipts values(j.id,e.id,d.id,j.digest,d.processed_at) returning * into r;
 end if;
 select * into d from public.event_consumer_deliveries where id=r.delivery_id;
 if row(r.outbox_id,r.digest,d.event_id,d.consumer_name,d.status,d.attempt_count,d.processed_at) is distinct from row(e.id,j.digest,e.id,'member_event_join.v1','SUCCEEDED'::public.consumer_delivery_status,1,r.processed_at)
 or d.lease_owner is not null or d.lease_expires_at is not null or d.last_error_code is not null then raise exception using errcode='55000',message='EVENT_JOIN_DELIVERY_INVALID';end if;
end;$$;
revoke all on function app_private.consume_event_join(uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.consume_event_join(uuid,text) to service_role;
create function app_private.guard_event_join_delivery() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from app_private.event_join_consumer_receipts where delivery_id=old.id) then raise exception using errcode='55000',message='EVENT_JOIN_DELIVERY_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function app_private.guard_event_join_delivery() from public,anon,authenticated,service_role;
create trigger event_join_delivery_immutable before update or delete on public.event_consumer_deliveries for each row execute function app_private.guard_event_join_delivery();
create or replace function public.complete_outbox_event(
  p_event_id uuid,
  p_worker_id text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_event public.outbox_events%rowtype;
  v_audit public.audit_logs%rowtype;
  v_key app_private.idempotency_keys%rowtype;
  v_delivery public.event_consumer_deliveries%rowtype;
begin
  select event.* into v_event from public.outbox_events as event
  where event.id = p_event_id for update;
  if v_event.id is null or v_event.status <> 'PROCESSING'
    or v_event.lease_owner is distinct from p_worker_id
    or v_event.lease_expires_at is null
    or v_event.lease_expires_at < clock_timestamp() then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;

  if v_event.event_type = 'SAFE_MODE_CHANGED.v1' then
    select audit.* into v_audit from public.audit_logs as audit
    where audit.id::text = v_event.payload->>'audit_id';
    select logical_key.* into v_key from app_private.idempotency_keys as logical_key
    where logical_key.scope = 'safe_mode.control' and logical_key.actor_id is null
      and logical_key.idempotency_key = v_audit.metadata->>'idempotency_key';
    if v_event.schema_version <> 1 or v_event.aggregate_type <> 'safe_mode_control'
      or v_event.payload - array['audit_id', 'component', 'is_paused', 'review_at', 'request_hash'] <> '{}'::jsonb
      or v_audit.id is null or v_key.id is null
      or v_audit.target_type is distinct from 'SAFE_MODE'
      or v_audit.action not in ('SAFE_MODE_ENABLED', 'SAFE_MODE_DISABLED')
      or v_audit.metadata->'command_version' is distinct from '1'::jsonb
      or v_audit.actor_user_id is distinct from v_event.actor_user_id
      or v_audit.request_id is distinct from v_event.request_id
      or v_event.correlation_id is distinct from v_audit.request_id
      or v_audit.after_state->>'id' is distinct from v_event.aggregate_id::text
      or v_audit.after_state->>'component' is distinct from v_audit.target_id
      or v_event.payload->>'component' is distinct from v_audit.target_id
      or v_event.payload->'is_paused' is distinct from v_audit.after_state->'is_paused'
      or v_event.payload->'is_paused' is distinct from to_jsonb(v_audit.action = 'SAFE_MODE_ENABLED')
      or v_event.payload->'review_at' is distinct from v_audit.after_state->'review_at'
      or v_event.payload->>'request_hash' is distinct from v_audit.metadata->>'request_hash'
      or v_event.idempotency_key is distinct from 'safe-mode:' || v_key.idempotency_key
      or v_key.status <> 'COMPLETED' or v_key.completed_at is null
      or v_key.response_status is distinct from 200
      or v_key.request_hash is distinct from v_event.payload->>'request_hash'
      or v_key.response_payload->>'audit_id' is distinct from v_audit.id::text
      or v_key.response_payload->>'control_id' is distinct from v_event.aggregate_id::text
      or not exists (select 1 from public.safe_mode_controls as control
        where control.id = v_event.aggregate_id and control.component = v_audit.target_id)
      or (select count(*) from public.outbox_events as original
        where original.event_type = 'SAFE_MODE_CHANGED.v1'
          and original.payload->>'audit_id' = v_audit.id::text) <> 1 then
      raise exception using errcode = '55000', message = 'SAFE_MODE_EVENT_RECEIPT_MISMATCH';
    end if;
    insert into public.event_consumer_deliveries (
      event_id, consumer_name, status, attempt_count, processed_at
    ) values (
      v_event.id, 'operator_safe_mode_audit.v1', 'SUCCEEDED', 1, statement_timestamp()
    ) on conflict (event_id, consumer_name) do nothing;
    select delivery.* into v_delivery from public.event_consumer_deliveries as delivery
    where delivery.event_id = v_event.id and delivery.consumer_name = 'operator_safe_mode_audit.v1';
    if v_delivery.status is distinct from 'SUCCEEDED' or v_delivery.processed_at is null
      or v_delivery.attempt_count <> 1 or v_delivery.lease_owner is not null
      or v_delivery.lease_expires_at is not null or v_delivery.last_error_code is not null then
      raise exception using errcode = '55000', message = 'SAFE_MODE_DELIVERY_RECEIPT_MISMATCH';
    end if;
  elsif v_event.event_type = 'EVENT_PARTICIPATION_JOINED.v1' then
    perform app_private.consume_event_join(v_event.id,p_worker_id);
  end if;

  update public.outbox_events set status = 'PROCESSED',
    processed_at = statement_timestamp(), lease_owner = null,
    lease_expires_at = null, last_error_code = null where id = v_event.id
    and status = 'PROCESSING' and lease_owner = p_worker_id
    and lease_expires_at >= clock_timestamp();
  if not found then
    raise exception using errcode = '55000', message = 'OUTBOX_LEASE_NOT_OWNED';
  end if;
end;
$$;

commit;
