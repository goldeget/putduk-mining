begin;

-- BACKEND FIRST: distinguish source-approved informational guides from joins.
-- No source drafts, real content, rewards, recipients or schedules are seeded.
-- Replace the existing narrowed functions; preserve owners, grants and roster.
alter table public.event_member_content add column participation_mode text not null
 default 'JOIN' check (participation_mode in ('GUIDE','JOIN'));

create or replace function app_private.validate_liveops_payload(p_kind text,p jsonb,p_ready boolean)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare n text;copy text;starts timestamptz;ends timestamptz;expected text[];
begin
 if jsonb_typeof(p) is distinct from 'object' or p->>'audience' is distinct from 'MEMBERS' or p->>'segment' is distinct from 'ALL_MEMBERS'
  or coalesce(p->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p->>'slug')>100
  or p->>'ctaRoute' not in ('/home','/start','/mining','/wallet','/wallet/deposit','/wallet/withdraw','/products','/events','/notifications','/menu','/menu/account','/menu/notifications','/support','/login','/about','/faq','/status','/changelog','/') then
  raise exception using errcode='22023',message='INVALID_LIVEOPS_PAYLOAD'; end if;
 expected:=array['slug','title','summary','body','ctaLabel','ctaRoute','audience','segment'];
 if p_kind='EVENT' then
  expected:=expected||array['cardTitle','rewardMode','participation','exclusion','startsAt','endsAt'];
  -- Missing mode remains the historical explicit JOIN contract. Present null,
  -- unknown, or non-string mode cannot silently acquire that permission.
  if p ? 'participationMode' then
   if jsonb_typeof(p->'participationMode') is distinct from 'string'
    or p->>'participationMode' not in ('GUIDE','JOIN') then
    raise exception using errcode='22023',message='INVALID_EVENT_PARTICIPATION_MODE';
   end if;
   expected:=expected||array['participationMode'];
  end if;
 elsif p_kind='NOTICE' then expected:=expected||array['publishedAt','expiresAt','isPinned'];
 else raise exception using errcode='22023',message='INVALID_LIVEOPS_KIND'; end if;
 if (select array_agg(k order by k) from jsonb_object_keys(p)k) is distinct from (select array_agg(k order by k) from unnest(expected)k) then
  raise exception using errcode='22023',message='INVALID_LIVEOPS_PAYLOAD'; end if;
 foreach n in array array['title','summary','body','ctaLabel'] loop
  if jsonb_typeof(p->n) is distinct from 'string' or char_length(btrim(p->>n))<1 or char_length(p->>n)>
   (case n when 'title' then case p_kind when 'EVENT' then 100 else 120 end when 'summary' then 500 when 'body' then 20000 else 80 end) then
   raise exception using errcode='22023',message='INVALID_LIVEOPS_COPY'; end if;
 end loop;
 select string_agg(value,' ') into copy from jsonb_each_text(p) where key in ('title','summary','body','ctaLabel','cardTitle','participation','exclusion');
 if not p_ready then copy:=regexp_replace(copy,'\{\{[a-z_]+\}\}','','g'); end if;
 if copy ~* '<[!/?a-z]|admin[.]mining[.]putduk[.]com|service_role|SUPABASE_SECRET_KEY|가상[[:space:]]*채굴|virtual[[:space:]]+mining'
  or (p_ready and copy ~ '\{\{|\}\}') then raise exception using errcode='22023',message='INVALID_LIVEOPS_COPY'; end if;
 if p_kind='EVENT' then
  if p->>'rewardMode' is distinct from 'NONE' then raise exception using errcode='22023',message='INVALID_LIVEOPS_REWARD_POLICY'; end if;
  foreach n in array array['cardTitle','participation','exclusion'] loop
   if jsonb_typeof(p->n) is distinct from 'string' or char_length(btrim(p->>n))<1 or char_length(p->>n)>(case n when 'cardTitle' then 100 else 2000 end) then
    raise exception using errcode='22023',message='INVALID_LIVEOPS_COPY'; end if;
  end loop;
  starts:=(p->>'startsAt')::timestamptz;ends:=(p->>'endsAt')::timestamptz;
  if (starts is null)<>(ends is null) or (p_ready and starts is null) or ends<=starts
    or (starts is not null and (not isfinite(starts) or not isfinite(ends))) then raise exception using errcode='22023',message='INVALID_LIVEOPS_WINDOW'; end if;
 else
  starts:=(p->>'publishedAt')::timestamptz;ends:=(p->>'expiresAt')::timestamptz;
  if jsonb_typeof(p->'isPinned') is distinct from 'boolean' or (p_ready and starts is null) or ends<=starts
    or (starts is not null and not isfinite(starts)) or (ends is not null and not isfinite(ends)) then raise exception using errcode='22023',message='INVALID_LIVEOPS_WINDOW'; end if;
 end if;
end;
$$;

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
  insert into public.event_member_content(event_id,revision_id,body_ko,participation_ko,exclusion_ko,cta_label,cta_route,reward_mode,participation_mode)
  values(v_content_id,r.id,snapshot->>'body',snapshot->>'participation',snapshot->>'exclusion',snapshot->>'ctaLabel',snapshot->>'ctaRoute','NONE',coalesce(snapshot->>'participationMode','JOIN'));
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

create or replace function app_private.validate_event_member_projection() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.liveops_content_receipts%rowtype;prev app_private.liveops_content_receipts%rowtype;e public.events%rowtype;
begin
 select * into r from app_private.liveops_content_receipts where id=new.revision_id;select * into prev from app_private.liveops_content_receipts where id=r.previous_revision_id;
 select * into e from public.events where id=new.event_id;
 if r.content_id is distinct from new.event_id or r.kind is distinct from 'EVENT' or r.state is distinct from 'PUBLISHED' or prev.state is distinct from 'APPROVED' or prev.digest is distinct from r.digest
 or row(new.body_ko,new.participation_ko,new.exclusion_ko,new.cta_label,new.cta_route,new.reward_mode) is distinct from row(r.snapshot->>'body',r.snapshot->>'participation',r.snapshot->>'exclusion',r.snapshot->>'ctaLabel',r.snapshot->>'ctaRoute',r.snapshot->>'rewardMode')
 or new.participation_mode is distinct from coalesce(r.snapshot->>'participationMode','JOIN')
 or row(e.slug,e.title_ko,e.summary_ko,e.starts_at,e.ends_at) is distinct from row(r.snapshot->>'slug',r.snapshot->>'title',r.snapshot->>'summary',(r.snapshot->>'startsAt')::timestamptz,(r.snapshot->>'endsAt')::timestamptz)
 then raise exception using errcode='55000',message='EVENT_CONTENT_SOURCE_INVALID';end if;
 perform app_private.assert_liveops_receipt(r.id);return new;
end;$$;

create or replace function app_private.participate_published_event(p_event_id uuid,p_revision_id uuid,p_idempotency_key uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
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
 -- Informational guides never create a participant, idempotency receipt,
 -- reward claim or member-join audit/outbox, including a cash overload call.
 if coalesce(r.snapshot->>'participationMode','JOIN')='GUIDE' then
  raise exception using errcode='42501',message='EVENT_GUIDE_NOT_JOINABLE';
 end if;
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

commit;
