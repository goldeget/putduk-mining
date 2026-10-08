begin;
-- Owner-approved contract extension: source-bound joining; reward is separate.
create table public.event_member_content(event_id uuid primary key references public.events(id),revision_id uuid not null unique references app_private.liveops_content_receipts(id),body_ko text not null,participation_ko text not null,exclusion_ko text not null,cta_label text not null,cta_route text not null,reward_mode text not null check(reward_mode='NONE'));
alter table public.event_member_content enable row level security;
alter table public.event_member_content force row level security;
revoke all on public.event_member_content from public,anon,authenticated,service_role;
grant select on public.event_member_content to authenticated;
create policy event_member_content_published on public.event_member_content for select to authenticated using(exists(select 1 from public.events e where e.id=event_id and e.status in('SCHEDULED','LIVE','ENDED') and e.published_at<=statement_timestamp()));
create trigger event_member_content_immutable before update or delete on public.event_member_content for each row execute function app_private.prevent_row_mutation();
create table app_private.event_join_originals(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.events(id),revision_id uuid not null references app_private.liveops_content_receipts(id),user_id uuid not null references auth.users(id),participant_id uuid not null unique references public.event_participants(id),joined_at timestamptz not null,audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,outbox_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,digest text not null,unique(event_id,user_id));
create table app_private.event_join_idempotency(user_id uuid not null references auth.users(id),key uuid not null,event_id uuid not null,revision_id uuid not null,join_id uuid not null references app_private.event_join_originals(id),request_id uuid not null,primary key(user_id,key));
alter table app_private.event_join_originals enable row level security;
alter table app_private.event_join_originals force row level security;
alter table app_private.event_join_idempotency enable row level security;
alter table app_private.event_join_idempotency force row level security;
revoke all on app_private.event_join_originals,app_private.event_join_idempotency from public,anon,authenticated,service_role;
grant select on app_private.event_join_originals,app_private.event_join_idempotency to service_role;
create trigger event_join_original_immutable before update or delete on app_private.event_join_originals for each row execute function app_private.prevent_row_mutation();
create trigger event_join_key_immutable before update or delete on app_private.event_join_idempotency for each row execute function app_private.prevent_row_mutation();
create function app_private.event_join_snapshot(p app_private.event_join_originals) returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$select to_jsonb(p)-array['digest','audit_id','outbox_id'];$$;
create function app_private.assert_event_join(p_id uuid) returns void language plpgsql security definer set search_path=pg_catalog as $$
declare j app_private.event_join_originals%rowtype;p public.event_participants%rowtype;a public.audit_logs%rowtype;e public.outbox_events%rowtype;
begin
 select * into j from app_private.event_join_originals where id=p_id;select * into p from public.event_participants where id=j.participant_id;
 select * into a from public.audit_logs where id=j.audit_id;select * into e from public.outbox_events where id=j.outbox_id;
 if j.id is null or row(p.user_id,p.event_id,p.joined_at) is distinct from row(j.user_id,j.event_id,j.joined_at)
 or p.progress is distinct from jsonb_build_object('content_revision_id',j.revision_id,'joined_outbox_id',j.outbox_id,'reward_mode','NONE')
 or j.digest is distinct from app_private.funding_engine_digest(app_private.event_join_snapshot(j))
 or a.id is null or a.action<>'EVENT_PARTICIPATION_JOINED' or a.actor_user_id is distinct from j.user_id
 or a.target_id is distinct from j.participant_id::text or a.after_state is distinct from app_private.event_join_snapshot(j)
 or e.id is null or e.event_type<>'EVENT_PARTICIPATION_JOINED.v1' or e.schema_version<>1 or e.actor_user_id is distinct from j.user_id
 or e.aggregate_type<>'event_participant' or e.aggregate_id is distinct from j.participant_id
 or e.payload is distinct from jsonb_build_object('event_id',j.event_id,'participant_id',j.participant_id,'user_id',j.user_id,'content_revision_id',j.revision_id,'reward_mode','NONE','join_original_id',j.id,'audit_id',j.audit_id,'digest',j.digest)
 then raise exception using errcode='55000',message='EVENT_JOIN_ORIGINAL_INVALID';end if;
end;$$;
create function app_private.verify_event_join() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin perform app_private.assert_event_join(new.id);return null;end;$$;
create constraint trigger event_join_complete after insert on app_private.event_join_originals deferrable initially deferred for each row execute function app_private.verify_event_join();
create function app_private.guard_event_join_envelope() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare bound boolean;mutable text[];
begin
 if tg_table_name='outbox_events' then bound:=exists(select 1 from app_private.event_join_originals where outbox_id=old.id);mutable:=array['status','available_at','attempt_count','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at'];
 else bound:=exists(select 1 from app_private.event_join_originals where participant_id=old.id);mutable:=array['status','completed_at','rewarded_at','updated_at'];end if;
 if bound and(tg_op='DELETE' or to_jsonb(new)-mutable is distinct from to_jsonb(old)-mutable) then raise exception using errcode='55000',message='EVENT_JOIN_ORIGINAL_IMMUTABLE';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
create trigger event_join_outbox_immutable before update or delete on public.outbox_events for each row execute function app_private.guard_event_join_envelope();
create trigger event_join_participant_immutable before update or delete on public.event_participants for each row execute function app_private.guard_event_join_envelope();
create function app_private.participate_published_event(p_event_id uuid,p_revision_id uuid,p_idempotency_key uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid;event public.events%rowtype;r app_private.liveops_content_receipts%rowtype;previous app_private.liveops_content_receipts%rowtype;p public.event_participants%rowtype;j app_private.event_join_originals%rowtype;k app_private.event_join_idempotency%rowtype;replay boolean:=false;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'authenticated' or auth.role() is distinct from 'authenticated' then raise exception using errcode='42501',message='EVENT_AUTH_REQUIRED';end if;
 actor:=auth.uid();if actor is null or p_event_id is null or p_revision_id is null or p_idempotency_key is null or p_request_id is null then raise exception using errcode='22023',message='INVALID_EVENT_PARTICIPATION';end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-event-key:'||actor::text||':'||p_idempotency_key::text,0));
 perform pg_advisory_xact_lock(hashtextextended('putduk-event-join:'||p_event_id::text||':'||actor::text,0));
 perform 1 from public.user_profiles where user_id=actor for share;if not found then raise exception using errcode='42501',message='EVENT_MEMBER_REQUIRED';end if;
 if not exists(select 1 from auth.users where id=actor and deleted_at is null and(banned_until is null or banned_until<=clock_timestamp()))
 or exists(select 1 from public.block_rules where user_id=actor and scope='ACCOUNT' and starts_at<=clock_timestamp() and(ends_at is null or ends_at>clock_timestamp())) then raise exception using errcode='42501',message='EVENT_MEMBER_RESTRICTED';end if;
 select * into k from app_private.event_join_idempotency where user_id=actor and key=p_idempotency_key;
 if k.key is not null and row(k.event_id,k.revision_id) is distinct from row(p_event_id,p_revision_id) then raise exception using errcode='22023',message='EVENT_IDEMPOTENCY_CONFLICT';end if;
 select * into event from public.events where id=p_event_id for share;
 select * into r from app_private.liveops_content_receipts where id=p_revision_id and content_id=p_event_id and kind='EVENT';
 select * into previous from app_private.liveops_content_receipts where id=r.previous_revision_id;
 if event.id is null or r.id is null or r.state is distinct from 'PUBLISHED' or previous.state is distinct from 'APPROVED' or previous.digest is distinct from r.digest
 or r.snapshot->>'rewardMode' is distinct from 'NONE' or event.status not in('SCHEDULED','LIVE','ENDED') or event.published_at is null or event.published_at>clock_timestamp()
 or not exists(select 1 from public.event_member_content where event_id=p_event_id and revision_id=p_revision_id)
 or exists(select 1 from app_private.liveops_content_receipts where content_id=p_event_id and kind='EVENT' and revision>r.revision) then raise exception using errcode='42501',message='EVENT_NOT_AVAILABLE';end if;
 perform app_private.assert_liveops_receipt(r.id);
 select * into j from app_private.event_join_originals where event_id=p_event_id and user_id=actor;
 if j.id is not null then if j.revision_id is distinct from p_revision_id then raise exception using errcode='40001',message='EVENT_REVISION_CHANGED';end if;perform app_private.assert_event_join(j.id);replay:=true;
 else
 if clock_timestamp()<event.starts_at or clock_timestamp()>=event.ends_at or event.status='ENDED' then raise exception using errcode='42501',message='EVENT_NOT_AVAILABLE';end if;
 j.id:=gen_random_uuid();j.user_id:=actor;j.event_id:=p_event_id;j.revision_id:=p_revision_id;j.participant_id:=gen_random_uuid();j.joined_at:=clock_timestamp();j.audit_id:=gen_random_uuid();j.outbox_id:=gen_random_uuid();
 j.digest:=app_private.funding_engine_digest(app_private.event_join_snapshot(j));
 insert into public.event_participants(id,event_id,user_id,joined_at,progress) values(j.participant_id,p_event_id,actor,j.joined_at,jsonb_build_object('content_revision_id',p_revision_id,'joined_outbox_id',j.outbox_id,'reward_mode','NONE'));
 insert into app_private.event_join_originals select j.*;
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata) values(j.audit_id,actor,'EVENT_PARTICIPATION_JOINED','event_participant',j.participant_id::text,'Member explicitly joined current published event',p_request_id,app_private.event_join_snapshot(j),jsonb_build_object('digest',j.digest));
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key) values(j.outbox_id,'EVENT_PARTICIPATION_JOINED.v1',1,'event_participant',j.participant_id,actor,jsonb_build_object('event_id',p_event_id,'participant_id',j.participant_id,'user_id',actor,'content_revision_id',p_revision_id,'reward_mode','NONE','join_original_id',j.id,'audit_id',j.audit_id,'digest',j.digest),p_request_id,p_request_id,'event-join:'||p_event_id::text||':'||actor::text);
 end if;
 if k.key is null then insert into app_private.event_join_idempotency values(actor,p_idempotency_key,p_event_id,p_revision_id,j.id,p_request_id);end if;
 select * into p from public.event_participants where id=j.participant_id;
 return jsonb_build_object('eventId',p_event_id,'revisionId',p_revision_id,'participantId',p.id,'status',p.status,'joinedAt',p.joined_at,'completedAt',p.completed_at,'rewardedAt',p.rewarded_at,'outboxId',j.outbox_id,'replayed',replay);
end;$$;
create function public.participate_published_event(p_event_id uuid,p_revision_id uuid,p_idempotency_key uuid,p_request_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog
begin atomic select app_private.participate_published_event(p_event_id,p_revision_id,p_idempotency_key,p_request_id);end;
revoke all on function app_private.participate_published_event(uuid,uuid,uuid,uuid),public.participate_published_event(uuid,uuid,uuid,uuid),app_private.assert_event_join(uuid),app_private.verify_event_join(),app_private.guard_event_join_envelope(),app_private.event_join_snapshot(app_private.event_join_originals) from public,anon,authenticated,service_role;
grant execute on function public.participate_published_event(uuid,uuid,uuid,uuid),app_private.participate_published_event(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function app_private.assert_event_join(uuid),app_private.event_join_snapshot(app_private.event_join_originals) to service_role;

create function app_private.validate_event_member_projection() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.liveops_content_receipts%rowtype;prev app_private.liveops_content_receipts%rowtype;e public.events%rowtype;
begin
 select * into r from app_private.liveops_content_receipts where id=new.revision_id;select * into prev from app_private.liveops_content_receipts where id=r.previous_revision_id;
 select * into e from public.events where id=new.event_id;
 if r.content_id is distinct from new.event_id or r.kind is distinct from 'EVENT' or r.state is distinct from 'PUBLISHED' or prev.state is distinct from 'APPROVED' or prev.digest is distinct from r.digest
 or row(new.body_ko,new.participation_ko,new.exclusion_ko,new.cta_label,new.cta_route,new.reward_mode) is distinct from row(r.snapshot->>'body',r.snapshot->>'participation',r.snapshot->>'exclusion',r.snapshot->>'ctaLabel',r.snapshot->>'ctaRoute',r.snapshot->>'rewardMode')
 or row(e.slug,e.title_ko,e.summary_ko,e.starts_at,e.ends_at) is distinct from row(r.snapshot->>'slug',r.snapshot->>'title',r.snapshot->>'summary',(r.snapshot->>'startsAt')::timestamptz,(r.snapshot->>'endsAt')::timestamptz)
 then raise exception using errcode='55000',message='EVENT_CONTENT_SOURCE_INVALID';end if;
 perform app_private.assert_liveops_receipt(r.id);return new;
end;$$;
create trigger event_member_projection_validate before insert on public.event_member_content for each row execute function app_private.validate_event_member_projection();
create function app_private.verify_event_participant_join() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare j uuid;p public.event_participants%rowtype;
begin
 if exists(select 1 from public.event_member_content where event_id=new.event_id) then
 select id into j from app_private.event_join_originals where participant_id=new.id;if j is null then raise exception using errcode='55000',message='EVENT_JOIN_ORIGINAL_REQUIRED';end if;
 perform app_private.assert_event_join(j);select * into p from public.event_participants where id=new.id;
 if p.status is distinct from 'JOINED'::public.event_participant_status or p.completed_at is not null or p.rewarded_at is not null then raise exception using errcode='55000',message='EVENT_REWARD_ORIGINAL_REQUIRED';end if;
 end if;return null;
end;$$;
create constraint trigger event_participant_join_complete after insert or update on public.event_participants deferrable initially deferred for each row execute function app_private.verify_event_participant_join();
revoke all on function app_private.validate_event_member_projection(),app_private.verify_event_participant_join() from public,anon,authenticated,service_role;

create or replace function app_private.execute_liveops_content(
 p_operation text,p_kind text,p_content_id uuid,p_expected_revision uuid,p_expected_digest text,p_payload jsonb,
 p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text,p_step_up_token text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare role public.app_role;previous app_private.liveops_content_receipts%rowtype;r app_private.liveops_content_receipts%rowtype;
 idem app_private.idempotency_keys%rowtype;idem_id uuid;request_id uuid:=gen_random_uuid();aid uuid:=gen_random_uuid();eid uuid:=gen_random_uuid();
 v_content_id uuid;request_hash text;state text;snapshot jsonb;grant_id uuid;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='LIVEOPS_SERVICE_ROLE_REQUIRED'; end if;
 role:=app_private.liveops_operator_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 if p_operation is null or p_operation not in ('CREATE_DRAFT','UPDATE_DRAFT','PREVIEW','APPROVE','PUBLISH','CANCEL','ARCHIVE') or p_kind is null or p_kind not in ('EVENT','NOTICE')
 or char_length(btrim(coalesce(p_reason,''))) not between 10 and 500 or p_idempotency_key is null or char_length(coalesce(p_step_up_token,'')) not between 16 and 512 then
  raise exception using errcode='22023',message='INVALID_LIVEOPS_COMMAND'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-mining.liveops-content',0));
 request_hash:=app_private.funding_engine_digest(jsonb_build_object('operation',p_operation,'kind',p_kind,'content_id',p_content_id,
 'expected_revision',p_expected_revision,'expected_digest',p_expected_digest,'payload',p_payload,'actor',p_actor,'admin_session',p_admin_session_id,
 'auth_session',p_auth_session_id,'reason',btrim(p_reason),'proof_hash',encode(extensions.digest(p_step_up_token,'sha256'),'hex')));
 insert into app_private.idempotency_keys(scope,actor_id,idempotency_key,request_hash,status)
 values('liveops.content',p_actor,p_idempotency_key::text,request_hash,'PROCESSING') on conflict(scope,actor_id,idempotency_key) do nothing returning id into idem_id;
 if idem_id is null then
  select * into idem from app_private.idempotency_keys where scope='liveops.content' and actor_id=p_actor and idempotency_key=p_idempotency_key::text for update;
  if idem.request_hash is distinct from request_hash then raise exception using errcode='22023',message='IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
  if idem.status<>'COMPLETED' then raise exception using errcode='40001',message='LIVEOPS_IN_PROGRESS'; end if;
  select * into r from app_private.liveops_content_receipts where id=(idem.response_payload->>'revisionId')::uuid;
  perform app_private.assert_liveops_receipt(r.id);
  if r.request_hash is distinct from request_hash or idem.response_payload is distinct from app_private.liveops_receipt_json(r) then raise exception using errcode='55000',message='LIVEOPS_RECEIPT_MISMATCH'; end if;
  return idem.response_payload;
 end if;
 if p_operation='CREATE_DRAFT' then
  if p_content_id is not null or p_expected_revision is not null or p_expected_digest is not null then raise exception using errcode='22023',message='INVALID_LIVEOPS_COMMAND'; end if;
  v_content_id:=gen_random_uuid();snapshot:=p_payload;state:='DRAFT';
 else
  v_content_id:=p_content_id;
  select * into previous from app_private.liveops_content_receipts where content_id=p_content_id order by revision desc limit 1;
  if previous.id is null or previous.kind is distinct from p_kind or previous.id is distinct from p_expected_revision or previous.digest is distinct from p_expected_digest then
   raise exception using errcode='40001',message='LIVEOPS_REVISION_MISMATCH'; end if;
  perform app_private.assert_liveops_receipt(previous.id);
  snapshot:=previous.snapshot;
  if p_operation='UPDATE_DRAFT' and previous.state in ('DRAFT','PREVIEWED','APPROVED') then snapshot:=p_payload;state:='DRAFT';
  elsif p_operation='PREVIEW' and previous.state='DRAFT' then state:='PREVIEWED';
  elsif p_operation='APPROVE' and previous.state='PREVIEWED' then state:='APPROVED';
  elsif p_operation='PUBLISH' and previous.state='APPROVED' then state:='PUBLISHED';
  elsif p_operation='CANCEL' and p_kind='EVENT' and previous.state='PUBLISHED' then state:='CANCELLED';
  elsif p_operation='ARCHIVE' and p_kind='NOTICE' and previous.state='PUBLISHED' then state:='ARCHIVED';
  else raise exception using errcode='40001',message='LIVEOPS_REVISION_STATE'; end if;
  if p_operation<>'UPDATE_DRAFT' and p_payload is not null then raise exception using errcode='22023',message='INVALID_LIVEOPS_PAYLOAD'; end if;
 end if;
 perform app_private.validate_liveops_payload(p_kind,snapshot,state in ('PREVIEWED','APPROVED','PUBLISHED'));
 if state='PUBLISHED' and coalesce((snapshot->>'endsAt')::timestamptz,(snapshot->>'expiresAt')::timestamptz,'infinity')<=clock_timestamp() then
  raise exception using errcode='22023',message='LIVEOPS_WINDOW_ENDED'; end if;
 grant_id:=app_private.consume_admin_step_up_token(p_actor,p_step_up_token,'LIVEOPS_CONTENT',request_id,p_admin_session_id);
 insert into app_private.liveops_content_receipts(content_id,kind,revision,state,previous_revision_id,snapshot,digest,actor_id,admin_session_id,step_up_grant_id,audit_id,outbox_id,request_hash)
 values(v_content_id,p_kind,coalesce(previous.revision,0)+1,state,previous.id,snapshot,app_private.funding_engine_digest(snapshot),p_actor,p_admin_session_id,grant_id,aid,eid,request_hash) returning * into r;
 insert into public.audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,request_id,after_state,metadata)
 values(aid,p_actor,role,'LIVEOPS_CONTENT_'||p_operation,'LIVEOPS_CONTENT',v_content_id::text,btrim(p_reason),request_id,app_private.liveops_receipt_json(r),
 jsonb_build_object('admin_session_id',p_admin_session_id,'step_up_grant_id',grant_id,'request_hash',request_hash));
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key)
 values(eid,'LIVEOPS_CONTENT_CHANGED.v1',1,'liveops_content',v_content_id,p_actor,
 jsonb_build_object('receipt_id',r.id,'audit_id',aid,'content_kind',p_kind,'content_id',v_content_id,'state',state,'digest',r.digest),request_id,request_id,'liveops-content:'||p_actor::text||':'||p_idempotency_key::text);
 if state='PUBLISHED' and p_kind='EVENT' then
  insert into public.events(id,slug,title_ko,summary_ko,status,starts_at,ends_at,published_at,created_by,updated_by)
  values(v_content_id,snapshot->>'slug',snapshot->>'title',snapshot->>'summary','SCHEDULED',(snapshot->>'startsAt')::timestamptz,(snapshot->>'endsAt')::timestamptz,clock_timestamp(),p_actor,p_actor);
  insert into public.event_rules(event_id,version,rule_payload,effective_from,created_by) values(v_content_id,r.revision,snapshot,(snapshot->>'startsAt')::timestamptz,p_actor);
  insert into public.event_member_content(event_id,revision_id,body_ko,participation_ko,exclusion_ko,cta_label,cta_route,reward_mode)
  values(v_content_id,r.id,snapshot->>'body',snapshot->>'participation',snapshot->>'exclusion',snapshot->>'ctaLabel',snapshot->>'ctaRoute','NONE');
 elsif state='PUBLISHED' and p_kind='NOTICE' then
  insert into public.notices(id,slug,title_ko,summary_ko,body_markdown,status,is_pinned,published_at,expires_at,created_by,updated_by)
  values(v_content_id,snapshot->>'slug',snapshot->>'title',snapshot->>'summary',snapshot->>'body','PUBLISHED',(snapshot->>'isPinned')::boolean,(snapshot->>'publishedAt')::timestamptz,(snapshot->>'expiresAt')::timestamptz,p_actor,p_actor);
 elsif state='CANCELLED' then update public.events set status='CANCELLED',updated_by=p_actor where id=v_content_id;
 elsif state='ARCHIVED' then update public.notices set status='ARCHIVED',updated_by=p_actor where id=v_content_id;end if;
 perform app_private.assert_liveops_receipt(r.id);
 perform app_private.liveops_operator_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 update app_private.idempotency_keys set status='COMPLETED',response_status=200,response_payload=app_private.liveops_receipt_json(r),completed_at=clock_timestamp(),locked_until=null where id=idem_id;
 return app_private.liveops_receipt_json(r);
end;
$$;
commit;
