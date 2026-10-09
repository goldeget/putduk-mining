begin;

-- Complete the existing signup outbox with a source-verified internal audit ACK.
-- Original identity, consent and timeline writes remain owned by signup.
-- No money, notifications, marketing subscriptions or duplicate timeline writes.
create table app_private.member_profile_audit_receipts (
  event_id uuid primary key references public.outbox_events(id),
  delivery_id uuid not null unique references public.event_consumer_deliveries(id),
  user_id uuid not null,
  request_id uuid not null unique,
  source_snapshot jsonb not null,
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  processed_at timestamptz not null
);
alter table app_private.member_profile_audit_receipts enable row level security;
alter table app_private.member_profile_audit_receipts force row level security;
revoke all on app_private.member_profile_audit_receipts from public, anon, authenticated, service_role;
create trigger member_profile_audit_receipt_immutable
before update or delete on app_private.member_profile_audit_receipts
for each row execute function app_private.prevent_row_mutation();

create function app_private.read_member_profile_capture_original(p_event_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog as $$
declare
  e public.outbox_events%rowtype;
  i public.user_identity_profiles%rowtype;
  t public.user_consent_records%rowtype;
  p public.user_consent_records%rowtype;
  m public.user_consent_records%rowtype;
  l public.member_timeline_events%rowtype;
  mutable text[] := array['status','available_at','attempt_count','lease_owner',
    'lease_expires_at','processed_at','last_error_code','updated_at'];
begin
  select * into e from public.outbox_events where id = p_event_id;
  select * into i from public.user_identity_profiles where user_id = e.aggregate_id;
  select * into t from public.user_consent_records where user_id = e.aggregate_id
    and request_id = e.request_id and captured_via = 'SIGNUP' and consent_key = 'SERVICE_TERMS';
  select * into p from public.user_consent_records where user_id = e.aggregate_id
    and request_id = e.request_id and captured_via = 'SIGNUP' and consent_key = 'PRIVACY';
  select * into m from public.user_consent_records where user_id = e.aggregate_id
    and request_id = e.request_id and captured_via = 'SIGNUP' and consent_key = 'MARKETING';
  select * into l from public.member_timeline_events where user_id = e.aggregate_id
    and event_type = 'MEMBER_PROFILE_CAPTURED' and source_type = 'user_identity_profile'
    and source_id = e.aggregate_id and summary_code = 'SIGNUP_PROFILE_COMPLETED';
  if e.id is null or e.event_type is distinct from 'MEMBER_PROFILE_CAPTURED.v1'
    or e.schema_version <> 1 or e.aggregate_type is distinct from 'user_identity_profile'
    or e.actor_user_id is distinct from e.aggregate_id
    or e.idempotency_key is distinct from 'member-profile:' || e.aggregate_id::text
    or e.request_id is null or e.correlation_id is null
    or e.request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or e.request_id is distinct from e.correlation_id or e.causation_id is not null
    or i.user_id is null or t.id is null or p.id is null or m.id is null or l.id is null
    or not exists(select 1 from auth.users where id = e.aggregate_id)
    or not exists(select 1 from public.user_profiles where user_id = e.aggregate_id)
    or t.consent_version is distinct from 'TERMS-KO-2026-09-27'
    or p.consent_version is distinct from 'PRIVACY-KO-2026-09-27'
    or m.consent_version is distinct from 'MARKETING-KO-2026-09-27'
    or t.granted is distinct from true or p.granted is distinct from true
    or t.metadata is distinct from '{"locale":"ko-KR"}'::jsonb
    or p.metadata is distinct from '{"locale":"ko-KR"}'::jsonb
    or m.metadata is distinct from '{"locale":"ko-KR"}'::jsonb
    or e.payload is distinct from jsonb_build_object('user_id',e.aggregate_id,
      'required_consent_versions',jsonb_build_array(t.consent_version,p.consent_version),
      'marketing_granted',m.granted)
    or (select created_at from auth.users where id=e.aggregate_id) is null
    or least(i.created_at,t.captured_at,p.captured_at,m.captured_at,e.created_at,e.occurred_at)
      < (select created_at from auth.users where id=e.aggregate_id)
    or greatest(i.created_at,t.captured_at,p.captured_at,m.captured_at,e.created_at,e.occurred_at)
      > l.occurred_at
    or l.created_at < l.occurred_at
    or l.metadata is distinct from jsonb_build_object('consent_version',t.consent_version)
    or (select count(*) from public.user_consent_records where user_id=e.aggregate_id
      and request_id=e.request_id and captured_via='SIGNUP') <> 3
    or (select count(*) from public.member_timeline_events where user_id=e.aggregate_id
      and event_type='MEMBER_PROFILE_CAPTURED' and source_type='user_identity_profile'
      and source_id=e.aggregate_id and summary_code='SIGNUP_PROFILE_COMPLETED') <> 1
    or (select count(*) from public.outbox_events where event_type='MEMBER_PROFILE_CAPTURED.v1'
      and aggregate_id=e.aggregate_id) <> 1 then
    raise exception using errcode='55000', message='MEMBER_PROFILE_CAPTURE_ORIGINAL_INVALID';
  end if;
  -- Immutable captured consent, never the latest settings or user-editable JWT metadata.
  -- Identity existence/creation binds the owner; personal fields never enter this digest.
  return jsonb_build_object('event',to_jsonb(e)-mutable,
    'identity',jsonb_build_object('user_id',i.user_id,'created_at',i.created_at),
    'consents',jsonb_build_array(to_jsonb(t),to_jsonb(p),to_jsonb(m)),
    'timeline',to_jsonb(l));
end;$$;
revoke all on function app_private.read_member_profile_capture_original(uuid)
from public, anon, authenticated, service_role;

create function app_private.consume_member_profile_audit(p_event_id uuid,p_worker_id text)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  e public.outbox_events%rowtype;
  d public.event_consumer_deliveries%rowtype;
  r app_private.member_profile_audit_receipts%rowtype;
  snapshot jsonb;
  digest text;
begin
  if current_user <> 'postgres' or current_setting('role',true) is distinct from 'service_role'
    or auth.role() is distinct from 'service_role' then
    raise exception using errcode='42501', message='MEMBER_PROFILE_AUDIT_SERVICE_REQUIRED';
  end if;
  if char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 120 then
    raise exception using errcode='22023',message='INVALID_OUTBOX_WORKER_CONTEXT';
  end if;
  select * into e from public.outbox_events where id=p_event_id for update;
  if e.id is null or e.status is distinct from 'PROCESSING'::public.outbox_status
    or e.lease_owner is distinct from p_worker_id or e.lease_expires_at is null
    or e.lease_expires_at < clock_timestamp() then
    raise exception using errcode='55000', message='OUTBOX_LEASE_NOT_OWNED';
  end if;
  snapshot := app_private.read_member_profile_capture_original(e.id);
  digest := app_private.funding_engine_digest(snapshot);
  select * into r from app_private.member_profile_audit_receipts where event_id=e.id;
  if r.event_id is null then
    insert into public.event_consumer_deliveries(event_id,consumer_name,status,attempt_count,processed_at)
    values(e.id,'member_profile_audit.v1','SUCCEEDED',1,clock_timestamp()) returning * into d;
    insert into app_private.member_profile_audit_receipts
      (event_id,delivery_id,user_id,request_id,source_snapshot,source_digest,processed_at)
    values(e.id,d.id,e.aggregate_id,e.request_id,snapshot,digest,d.processed_at) returning * into r;
  end if;
  select * into d from public.event_consumer_deliveries where id=r.delivery_id;
  if row(r.event_id,r.user_id,r.request_id,r.source_snapshot,r.source_digest,d.event_id,
    d.consumer_name,d.status,d.attempt_count,d.processed_at)
    is distinct from row(e.id,e.aggregate_id,e.request_id,snapshot,digest,e.id,
      'member_profile_audit.v1','SUCCEEDED'::public.consumer_delivery_status,1,r.processed_at)
    or d.lease_owner is not null or d.lease_expires_at is not null or d.last_error_code is not null then
    raise exception using errcode='55000', message='MEMBER_PROFILE_AUDIT_RECEIPT_INVALID';
  end if;
  -- This exact closed owner executor also seals terminal state. A direct private
  -- call cannot commit an ACK without completing the same lease-owned original.
  update public.outbox_events set status='PROCESSED',processed_at=r.processed_at,
    lease_owner=null,lease_expires_at=null,last_error_code=null where id=e.id
    and status='PROCESSING' and lease_owner=p_worker_id and lease_expires_at>=clock_timestamp();
  if not found then raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';end if;
end;$$;
revoke all on function app_private.consume_member_profile_audit(uuid,text)
from public, anon, authenticated, service_role;
grant execute on function app_private.consume_member_profile_audit(uuid,text) to service_role;

create function app_private.guard_member_profile_capture_envelope()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare mutable text[] := array['status','available_at','attempt_count','lease_owner',
  'lease_expires_at','processed_at','last_error_code','updated_at'];
begin
  if tg_op='INSERT' then
    if new.event_type='MEMBER_PROFILE_CAPTURED.v1' or new.idempotency_key like 'member-profile:%' then
      if new.event_type is distinct from 'MEMBER_PROFILE_CAPTURED.v1' or new.schema_version<>1
        or new.aggregate_type is distinct from 'user_identity_profile'
        or new.actor_user_id is distinct from new.aggregate_id
        or new.request_id is null or new.correlation_id is null
        or new.request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or new.request_id is distinct from new.correlation_id or new.causation_id is not null
        or new.idempotency_key is distinct from 'member-profile:'||new.aggregate_id::text
        or new.payload - array['user_id','required_consent_versions','marketing_granted'] <> '{}'::jsonb
        or new.payload->'user_id' is distinct from to_jsonb(new.aggregate_id)
        or new.payload->'required_consent_versions' is distinct from
          '["TERMS-KO-2026-09-27","PRIVACY-KO-2026-09-27"]'::jsonb
        or jsonb_typeof(new.payload->'marketing_granted') is distinct from 'boolean' then
        raise exception using errcode='55000',message='MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID';
      end if;
    end if;
    return new;
  end if;
  if old.event_type='MEMBER_PROFILE_CAPTURED.v1' or old.idempotency_key like 'member-profile:%'
    or (tg_op<>'DELETE' and(new.event_type='MEMBER_PROFILE_CAPTURED.v1'
      or new.idempotency_key like 'member-profile:%')) then
    if tg_op='DELETE' or to_jsonb(new)-mutable is distinct from to_jsonb(old)-mutable then
      raise exception using errcode='55000',message='MEMBER_PROFILE_CAPTURE_ENVELOPE_IMMUTABLE';
    end if;
    if new.status='PROCESSED' and not exists(select 1 from public.event_consumer_deliveries
      where event_id=new.id and consumer_name='member_profile_audit.v1' and status='SUCCEEDED'
        and attempt_count=1 and processed_at=new.processed_at and lease_owner is null
        and lease_expires_at is null and last_error_code is null) then
      raise exception using errcode='55000',message='MEMBER_PROFILE_AUDIT_RECEIPT_INVALID';
    end if;
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function app_private.guard_member_profile_capture_envelope()
from public, anon, authenticated, service_role;
create trigger member_profile_capture_envelope_immutable before insert or update or delete on public.outbox_events
for each row execute function app_private.guard_member_profile_capture_envelope();

create function app_private.guard_member_profile_audit_delivery()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op='INSERT' then
    if new.consumer_name='member_profile_audit.v1' then
      if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role'
        or auth.role() is distinct from 'service_role'
        or new.status is distinct from 'SUCCEEDED'::public.consumer_delivery_status
        or new.attempt_count<>1 or new.processed_at is null or new.lease_owner is not null
        or new.lease_expires_at is not null or new.last_error_code is not null
        or not exists(select 1 from public.outbox_events where id=new.event_id
          and event_type='MEMBER_PROFILE_CAPTURED.v1' and status='PROCESSING'
          and lease_owner is not null and lease_expires_at>=clock_timestamp()) then
        raise exception using errcode='55000',message='MEMBER_PROFILE_AUDIT_DELIVERY_INVALID';
      end if;
    elsif exists(select 1 from public.outbox_events where id=new.event_id
      and event_type='MEMBER_PROFILE_CAPTURED.v1') then
      raise exception using errcode='55000',message='MEMBER_PROFILE_AUDIT_DELIVERY_INVALID';
    end if;
    return new;
  end if;
  if old.consumer_name='member_profile_audit.v1'
    or(tg_op<>'DELETE' and new.consumer_name='member_profile_audit.v1') then
    raise exception using errcode='55000',message='MEMBER_PROFILE_AUDIT_DELIVERY_IMMUTABLE';
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function app_private.guard_member_profile_audit_delivery()
from public, anon, authenticated, service_role;
create trigger member_profile_audit_delivery_sealed before insert or update or delete
on public.event_consumer_deliveries for each row
execute function app_private.guard_member_profile_audit_delivery();

-- The existing canonical completion function is appended below from the exact
-- integration source, changing only the exact profile dispatch branch.

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
  if exists(select 1 from public.outbox_events where id=p_event_id and event_type='LIVEOPS_CONTENT_CHANGED.v1')then
    perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.liveops-content',0));
  end if;
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
  elsif v_event.event_type = 'MEMBER_PROFILE_CAPTURED.v1' then
    perform app_private.consume_member_profile_audit(v_event.id,p_worker_id);
    return;
  elsif v_event.event_type = 'LIVEOPS_CONTENT_CHANGED.v1' then
    perform app_private.consume_liveops_publication(v_event.id,p_worker_id);
  elsif v_event.event_type = 'EVENT_PARTICIPATION_JOINED.v1' then
    perform app_private.consume_event_join(v_event.id,p_worker_id);
  elsif v_event.event_type in('USDT_MANUAL_DEPOSIT_CONFIRMED.v1','DEPOSIT_CONFIRMED.v1','WITHDRAWAL_COMPLETED.v1','TRIAL_REWARD_CONVERTED.v1','MINING_STARTED.v1','MINING_SETTLEMENT_COMPLETED.v1','TRIAL_COMPLETED.v1') then
    perform app_private.consume_nonmoney_source(v_event.id,p_worker_id);
   else raise exception using errcode='55000',message='OUTBOX_HANDLER_UNSUPPORTED';
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
