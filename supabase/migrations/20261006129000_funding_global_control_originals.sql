begin;

-- Forward-only GLOBAL originals from the existing canonical operator audit
-- command. No member control producer, backfill, automatic release or scheduler.
create table app_private.funding_global_control_originals(
 id uuid primary key default gen_random_uuid(),revision bigint not null unique check(revision>0),
 previous_original_id uuid unique references app_private.funding_global_control_originals(id),
 control_id uuid not null references public.safe_mode_controls(id),
 is_paused boolean not null,baseline_known boolean not null,
 effective_at timestamptz not null check(isfinite(effective_at)),
 audit_id uuid not null unique references public.audit_logs(id),
 source_event_id uuid not null unique references public.outbox_events(id),
 command_key_id uuid not null unique references app_private.idempotency_keys(id),
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 recorded_at timestamptz not null,
 check((revision=1 and previous_original_id is null) or(revision>1 and previous_original_id is not null)),
 check(recorded_at=effective_at)
);
alter table app_private.funding_global_control_originals enable row level security;
alter table app_private.funding_global_control_originals force row level security;
revoke all on app_private.funding_global_control_originals from public,anon,authenticated,service_role;
grant select on app_private.funding_global_control_originals to service_role;
create trigger funding_global_control_append_only before update or delete on app_private.funding_global_control_originals
 for each row execute function app_private.prevent_row_mutation();

create function app_private.funding_global_control_snapshot(p app_private.funding_global_control_originals)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('control_contract_version',1,'component','GLOBAL','revision',p.revision::text,
 'previous_original_id',p.previous_original_id,'control_id',p.control_id,'is_paused',p.is_paused,
 'baseline_known',p.baseline_known,'audit_id',p.audit_id,'source_event_id',p.source_event_id,
 'command_key_id',p.command_key_id,
 'effective_at_microseconds',((extract(epoch from p.effective_at)*1000000)::bigint)::text);
$$;

create function app_private.assert_funding_global_control_original(p_original uuid) returns void
language plpgsql volatile security invoker set search_path=pg_catalog as $$
declare original app_private.funding_global_control_originals%rowtype;
 previous app_private.funding_global_control_originals%rowtype;
 audit public.audit_logs%rowtype; event public.outbox_events%rowtype; command app_private.idempotency_keys%rowtype;
begin
 select o.* into original from app_private.funding_global_control_originals o where o.id=p_original;
 select a.* into audit from public.audit_logs a where a.id=original.audit_id;
 select e.* into event from public.outbox_events e where e.id=original.source_event_id;
 select k.* into command from app_private.idempotency_keys k where k.id=original.command_key_id;
 select o.* into previous from app_private.funding_global_control_originals o where o.id=original.previous_original_id;
 if original.id is null or original.effective_at>clock_timestamp()
  or original.revision is distinct from coalesce(previous.revision,0)+1
  or(previous.id is not null and(original.effective_at<previous.effective_at
   or original.control_id is distinct from previous.control_id or original.baseline_known is distinct from previous.baseline_known))
  or original.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_global_control_snapshot(original))
  or audit.id is null or audit.target_type is distinct from 'SAFE_MODE' or audit.target_id is distinct from 'GLOBAL'
  or audit.metadata->'command_version' is distinct from '1'::jsonb
  or audit.action is distinct from(case when original.is_paused then 'SAFE_MODE_ENABLED' else 'SAFE_MODE_DISABLED' end)
  or audit.actor_user_id is null or audit.actor_role not in('ADMIN','SUPER_ADMIN')
  or audit.actor_role is null or audit.created_at is distinct from original.effective_at
  or audit.reason is null or char_length(btrim(audit.reason)) not between 10 and 500
  or audit.after_state->>'id' is distinct from original.control_id::text
  or audit.after_state->>'component' is distinct from 'GLOBAL'
  or audit.after_state->'is_paused' is distinct from to_jsonb(original.is_paused)
  or(audit.after_state->>'starts_at')::timestamptz is distinct from original.effective_at
  or audit.after_state->>'changed_by' is distinct from audit.actor_user_id::text
  or audit.after_state->>'request_id' is distinct from audit.request_id::text
  or audit.metadata->>'component' is distinct from 'GLOBAL'
  or audit.metadata->'is_paused' is distinct from to_jsonb(original.is_paused)
  or audit.metadata->>'request_hash' !~ '^[a-f0-9]{64}$'
  or audit.metadata->>'request_hash' is null
  or command.id is null or command.scope is distinct from 'safe_mode.control' or command.actor_id is not null
  or command.idempotency_key is distinct from audit.metadata->>'idempotency_key'
  or command.request_hash is distinct from audit.metadata->>'request_hash'
  or command.request_hash is distinct from encode(extensions.digest(convert_to(jsonb_build_object(
   'actor',audit.actor_user_id,'component','GLOBAL','is_paused',original.is_paused,
   'reason',btrim(audit.reason),'review_at_epoch',extract(epoch from(audit.metadata->>'review_at')::timestamptz),
   'expected_request_id',(audit.metadata->>'expected_request_id')::uuid)::text,'UTF8'),'sha256'),'hex')
  or command.status is distinct from 'COMPLETED' or command.response_status is distinct from 200
  or command.completed_at is distinct from original.effective_at
  or command.response_payload is distinct from jsonb_build_object('audit_id',audit.id,'control_id',original.control_id)
  or event.id is null or event.event_type is distinct from 'SAFE_MODE_CHANGED.v1' or event.schema_version<>1
  or event.aggregate_type is distinct from 'safe_mode_control' or event.aggregate_id is distinct from original.control_id
  or event.actor_user_id is distinct from audit.actor_user_id or event.request_id is distinct from audit.request_id
  or event.correlation_id is distinct from audit.request_id
  or(select count(*) from public.outbox_events e where e.event_type='SAFE_MODE_CHANGED.v1'
   and e.payload->>'audit_id'=audit.id::text)<>1
  or event.idempotency_key is distinct from 'safe-mode:'||command.idempotency_key
  or event.occurred_at is distinct from original.effective_at or event.created_at is distinct from original.effective_at
  or event.payload-'review_at' is distinct from jsonb_build_object('audit_id',audit.id,'component','GLOBAL',
   'is_paused',original.is_paused,'request_hash',command.request_hash)
  or not(event.payload ? 'review_at')
  or(event.payload->>'review_at')::timestamptz is distinct from(audit.metadata->>'review_at')::timestamptz then
  raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_ORIGINAL_MISMATCH'; end if;
 if previous.id is not null then
  if audit.before_state->>'request_id' is distinct from(select a.request_id::text from public.audit_logs a where a.id=previous.audit_id)
   or audit.before_state->>'id' is distinct from previous.control_id::text
   or audit.before_state->'is_paused' is distinct from to_jsonb(previous.is_paused)
   or(audit.before_state->>'starts_at')::timestamptz is distinct from previous.effective_at then
   raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_CHAIN_MISMATCH'; end if;
 elsif original.baseline_known and(audit.before_state is not null or exists(select 1 from public.audit_logs a
  where a.target_type='SAFE_MODE' and a.target_id='GLOBAL' and a.id<>audit.id and a.created_at<=original.effective_at)) then
  raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_BASELINE_UNKNOWN';
 end if;
end;
$$;

create function app_private.capture_funding_global_control_original() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare original app_private.funding_global_control_originals%rowtype;
 previous app_private.funding_global_control_originals%rowtype;
begin
 if tg_table_schema<>'public' or tg_table_name<>'audit_logs' or tg_op<>'INSERT'
  or tg_when<>'AFTER' or tg_level<>'ROW' then
  raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_TRIGGER_CONTEXT_INVALID'; end if;
 if new.target_type is distinct from 'SAFE_MODE' or new.target_id is distinct from 'GLOBAL'
  or new.metadata->'command_version' is distinct from '1'::jsonb then return null; end if;
 if current_setting('role',true) is distinct from 'service_role'
  or current_setting('transaction_isolation')<>'read committed' then
  raise exception using errcode='42501',message='FUNDING_GLOBAL_CONTROL_CANONICAL_EXECUTOR_REQUIRED'; end if;
 -- The existing INVOKER command validated the live operator before this AFTER
 -- hook. Recheck the exact original's subject; no SQL role is impersonated.
 perform app_private.require_operator_role(new.actor_user_id,array['ADMIN','SUPER_ADMIN']::public.app_role[]);
 perform pg_advisory_xact_lock(hashtextextended('putduk-mining.safe-mode:GLOBAL',0));
 select o.* into previous from app_private.funding_global_control_originals o order by o.revision desc limit 1;
 original.id:=gen_random_uuid(); original.revision:=coalesce(previous.revision,0)+1;
 original.previous_original_id:=previous.id; original.control_id:=(new.after_state->>'id')::uuid;
 original.is_paused:=(new.after_state->>'is_paused')::boolean;
 original.effective_at:=(new.after_state->>'starts_at')::timestamptz; original.recorded_at:=original.effective_at;
 original.baseline_known:=case when previous.id is not null then previous.baseline_known
  else new.before_state is null and not exists(select 1 from public.audit_logs a
   where a.target_type='SAFE_MODE' and a.target_id='GLOBAL' and a.id<>new.id and a.created_at<=original.effective_at) end;
 original.audit_id:=new.id;
 select e.id into original.source_event_id from public.outbox_events e where e.event_type='SAFE_MODE_CHANGED.v1'
  and e.payload->>'audit_id'=new.id::text;
 select k.id into original.command_key_id from app_private.idempotency_keys k where k.scope='safe_mode.control'
  and k.actor_id is null and k.idempotency_key=new.metadata->>'idempotency_key';
 original.input_digest:=app_private.funding_engine_digest(app_private.funding_global_control_snapshot(original));
 insert into app_private.funding_global_control_originals select original.*;
 perform app_private.assert_funding_global_control_original(original.id);
 return null;
end;
$$;
-- The later canonical command migration installs this AFTER hook only after
-- replacing statement time with the locked command's one authoritative clock.

create function app_private.verify_funding_global_control_commit() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 if tg_table_schema<>'app_private' or tg_table_name<>'funding_global_control_originals'
  or tg_op<>'INSERT' or tg_when<>'AFTER' or tg_level<>'ROW' then
  raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_COMMIT_CONTEXT_INVALID'; end if;
 if(current_setting('role',true)='service_role'
  or(current_setting('role',true) in('none','postgres') and session_user='postgres')) is not true then
  raise exception using errcode='42501',message='FUNDING_GLOBAL_CONTROL_COMMIT_CONTEXT_FORBIDDEN'; end if;
 perform app_private.assert_funding_global_control_original(new.id);
 return null;
end;
$$;
create constraint trigger funding_global_control_complete after insert on app_private.funding_global_control_originals
 deferrable initially deferred for each row execute function app_private.verify_funding_global_control_commit();

create function app_private.guard_funding_global_control_original_links() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if tg_table_schema='app_private' and tg_table_name='idempotency_keys' then
  if exists(select 1 from app_private.funding_global_control_originals o where o.command_key_id=old.id) then
   raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_COMPLETION_IMMUTABLE'; end if;
 elsif tg_table_schema='public' and tg_table_name='outbox_events' then
  if exists(select 1 from app_private.funding_global_control_originals o where o.source_event_id=old.id)
   and(tg_op='DELETE' or to_jsonb(new)-array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']
    is distinct from to_jsonb(old)-array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']) then
   raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_EVENT_IMMUTABLE'; end if;
 else raise exception using errcode='55000',message='FUNDING_GLOBAL_CONTROL_LINK_CONTEXT_INVALID'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger funding_global_control_key_original before update or delete on app_private.idempotency_keys
 for each row execute function app_private.guard_funding_global_control_original_links();
create trigger funding_global_control_event_original before update or delete on public.outbox_events
 for each row execute function app_private.guard_funding_global_control_original_links();

revoke all on function app_private.funding_global_control_snapshot(app_private.funding_global_control_originals),
 app_private.assert_funding_global_control_original(uuid),app_private.capture_funding_global_control_original(),
 app_private.verify_funding_global_control_commit(),app_private.guard_funding_global_control_original_links()
 from public,anon,authenticated,service_role;
grant execute on function app_private.funding_global_control_snapshot(app_private.funding_global_control_originals),
 app_private.assert_funding_global_control_original(uuid),app_private.guard_funding_global_control_original_links() to service_role;
commit;
