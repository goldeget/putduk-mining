-- Reviewed local recovery proposal only. Finance owns registration/apply and SQL verification.
-- Historical complete source is UNKNOWN; this implements the recovered canonical API.
-- NONE content is not evidence that 20 monetary reward campaigns are complete.
begin;
create table app_private.liveops_content_receipts (
 id uuid primary key default gen_random_uuid(),content_id uuid not null,
 kind text not null check(kind in ('EVENT','NOTICE')),revision integer not null check(revision>0),
 state text not null check(state in ('DRAFT','PREVIEWED','APPROVED','PUBLISHED','CANCELLED','ARCHIVED')),
 previous_revision_id uuid references app_private.liveops_content_receipts(id),snapshot jsonb not null,
 digest text not null check(digest ~ '^[a-f0-9]{64}$'),actor_id uuid not null references auth.users(id),
 admin_session_id uuid not null references public.admin_sessions(id),step_up_grant_id uuid not null unique references public.admin_step_up_grants(id),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 outbox_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 request_hash text not null,created_at timestamptz not null default clock_timestamp(),
 unique(content_id,revision),check(jsonb_typeof(snapshot)='object'),
 check(digest=app_private.funding_engine_digest(snapshot)),
 check((revision=1 and previous_revision_id is null) or (revision>1 and previous_revision_id is not null))
);
alter table app_private.liveops_content_receipts enable row level security;
alter table app_private.liveops_content_receipts force row level security;
revoke all on app_private.liveops_content_receipts from public,anon,authenticated,service_role;
create trigger liveops_receipts_append_only before update or delete on app_private.liveops_content_receipts
 for each row execute function app_private.prevent_row_mutation();
create function app_private.liveops_receipt_json(r app_private.liveops_content_receipts)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('contentKind',r.kind,'contentId',r.content_id,'revisionId',r.id,
 'revision',r.revision,'state',r.state,'digest',r.digest,'snapshot',r.snapshot,'auditId',r.audit_id,'outboxId',r.outbox_id);
$$;
create function app_private.liveops_operator_context(p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text)
returns public.app_role language plpgsql security invoker set search_path=pg_catalog as $$
declare role public.app_role;
begin
 role:=app_private.assert_economy_policy_admin_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 perform app_private.assert_recovery_admin_session(p_actor,p_admin_session_id,array['ADMIN','SUPER_ADMIN']);
 if not exists(select 1 from auth.sessions s where s.id::text=p_auth_session_id and s.user_id=p_actor and s.aal::text='aal2'
   and (s.not_after is null or s.not_after>clock_timestamp()))
 or not exists(select 1 from auth.mfa_factors f where f.user_id=p_actor and f.factor_type::text='totp' and f.status::text='verified') then
  raise exception using errcode='42501',message='MFA_REQUIRED'; end if;
 return role;
end;
$$;
create function app_private.validate_liveops_payload(p_kind text,p jsonb,p_ready boolean)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare n text;copy text;starts timestamptz;ends timestamptz;expected text[];
begin
 if jsonb_typeof(p) is distinct from 'object' or p->>'audience' is distinct from 'MEMBERS' or p->>'segment' is distinct from 'ALL_MEMBERS'
  or coalesce(p->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p->>'slug')>100
  or p->>'ctaRoute' not in ('/home','/start','/mining','/wallet','/wallet/deposit','/wallet/withdraw','/products','/events','/notifications','/menu','/menu/account','/menu/notifications','/support','/login','/about','/faq','/status','/changelog','/') then
  raise exception using errcode='22023',message='INVALID_LIVEOPS_PAYLOAD'; end if;
 expected:=array['slug','title','summary','body','ctaLabel','ctaRoute','audience','segment'];
 if p_kind='EVENT' then expected:=expected||array['cardTitle','rewardMode','participation','exclusion','startsAt','endsAt'];
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
create function app_private.assert_liveops_receipt(p_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare r app_private.liveops_content_receipts%rowtype;a public.audit_logs%rowtype;e public.outbox_events%rowtype;previous app_private.liveops_content_receipts%rowtype;
begin
 select * into r from app_private.liveops_content_receipts where id=p_id;
 select * into a from public.audit_logs where id=r.audit_id;select * into e from public.outbox_events where id=r.outbox_id;
 if r.id is null or a.id is null or e.id is null or r.digest is distinct from app_private.funding_engine_digest(r.snapshot)
 or a.actor_user_id is distinct from r.actor_id or a.actor_role not in ('ADMIN','SUPER_ADMIN') or a.actor_role is null
 or a.target_type is distinct from 'LIVEOPS_CONTENT' or a.target_id is distinct from r.content_id::text
 or a.after_state is distinct from app_private.liveops_receipt_json(r) or a.metadata->>'request_hash' is distinct from r.request_hash
 or e.aggregate_id is distinct from r.content_id or e.event_type is distinct from 'LIVEOPS_CONTENT_CHANGED.v1' or e.schema_version<>1
 or e.actor_user_id is distinct from r.actor_id or e.request_id is distinct from a.request_id or e.correlation_id is distinct from a.request_id
 or e.payload is distinct from jsonb_build_object('receipt_id',r.id,'audit_id',r.audit_id,'content_kind',r.kind,'content_id',r.content_id,'state',r.state,'digest',r.digest)
 or not exists(select 1 from public.admin_step_up_grants g where g.id=r.step_up_grant_id and g.user_id=r.actor_id
  and g.admin_session_id=r.admin_session_id and g.command_family='LIVEOPS_CONTENT' and g.consumed_at is not null and g.consume_request_id=a.request_id) then
  raise exception using errcode='55000',message='LIVEOPS_RECEIPT_MISMATCH'; end if;
 if r.revision>1 then select * into previous from app_private.liveops_content_receipts where id=r.previous_revision_id;
  if previous.content_id is distinct from r.content_id or previous.kind is distinct from r.kind or previous.revision<>r.revision-1 then
   raise exception using errcode='55000',message='LIVEOPS_RECEIPT_MISMATCH'; end if;
 end if;
 perform app_private.validate_liveops_payload(r.kind,r.snapshot,r.state in ('PREVIEWED','APPROVED','PUBLISHED'));
end;
$$;
create function app_private.execute_liveops_content(
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
create function public.manage_liveops_content(
 p_operation text,p_kind text,p_content_id uuid,p_expected_revision uuid,p_expected_digest text,p_payload jsonb,
 p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text,p_step_up_token text,p_reason text,p_idempotency_key text
)returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='LIVEOPS_SERVICE_ROLE_REQUIRED';end if;
 return app_private.execute_liveops_content(p_operation,p_kind,p_content_id,p_expected_revision,p_expected_digest,p_payload,p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal,p_step_up_token,p_reason,p_idempotency_key::uuid);
end;
$$;
create function app_private.read_liveops_content(p_kind text,p_content_id uuid,p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare role public.app_role;items jsonb;r record;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='LIVEOPS_SERVICE_ROLE_REQUIRED'; end if;
 role:=app_private.liveops_operator_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 if p_kind is null or p_kind not in ('EVENT','NOTICE') then raise exception using errcode='22023',message='INVALID_LIVEOPS_KIND';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.liveops-content',0));
 insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
 values(p_actor,role,'LIVEOPS_CONTENT_READ','LIVEOPS_CONTENT',coalesce(p_content_id::text,'list'),'이벤트와 공지 검토 조회',gen_random_uuid(),jsonb_build_object('admin_session_id',p_admin_session_id));
 for r in select distinct on(content_id) id,content_id from app_private.liveops_content_receipts where kind=p_kind and (p_content_id is null or content_id=p_content_id) order by content_id,revision desc loop perform app_private.assert_liveops_receipt(r.id);end loop;
 select coalesce(jsonb_agg(app_private.liveops_receipt_json(x::app_private.liveops_content_receipts) order by x.created_at desc),'[]') into items
 from(select distinct on(content_id) * from app_private.liveops_content_receipts where kind=p_kind and (p_content_id is null or content_id=p_content_id) order by content_id,revision desc limit 500)x;
 return jsonb_build_object('items',items);
end;
$$;
create function public.read_liveops_content_review(p_kind text,p_content_id uuid,p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='LIVEOPS_SERVICE_ROLE_REQUIRED';end if;
 return app_private.read_liveops_content(p_kind,p_content_id,p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
end;
$$;
revoke all on function public.manage_liveops_content(text,text,uuid,uuid,text,jsonb,uuid,uuid,text,text,text,text,text),public.read_liveops_content_review(text,uuid,uuid,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.manage_liveops_content(text,text,uuid,uuid,text,jsonb,uuid,uuid,text,text,text,text,text),public.read_liveops_content_review(text,uuid,uuid,uuid,text,text) to service_role;
revoke all on function app_private.execute_liveops_content(text,text,uuid,uuid,text,jsonb,uuid,uuid,text,text,text,text,uuid),app_private.read_liveops_content(text,uuid,uuid,uuid,text,text),
 app_private.liveops_operator_context(uuid,uuid,text,text),app_private.validate_liveops_payload(text,jsonb,boolean),app_private.assert_liveops_receipt(uuid),app_private.liveops_receipt_json(app_private.liveops_content_receipts)
 from public,anon,authenticated,service_role;
grant execute on function app_private.execute_liveops_content(text,text,uuid,uuid,text,jsonb,uuid,uuid,text,text,text,text,uuid),app_private.read_liveops_content(text,uuid,uuid,uuid,text,text) to service_role;

-- Completed receipts and their audit/outbox/idempotency are one immutable chain.
create function app_private.verify_liveops_receipt_commit() returns trigger
language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 perform app_private.assert_ai_provider_executor();
 perform app_private.assert_liveops_receipt(new.id);
 if not exists(select 1 from app_private.idempotency_keys i where i.scope='liveops.content'
  and i.actor_id=new.actor_id and i.request_hash=new.request_hash and i.status='COMPLETED'
  and i.response_payload=app_private.liveops_receipt_json(new)) then
  raise exception using errcode='55000',message='LIVEOPS_RECEIPT_MISMATCH';end if;
 return null;
end; $$;
revoke all on function app_private.verify_liveops_receipt_commit() from public,anon,authenticated,service_role;
create constraint trigger liveops_receipt_complete after insert on app_private.liveops_content_receipts
 deferrable initially deferred for each row execute function app_private.verify_liveops_receipt_commit();
create function app_private.guard_liveops_sealed_links() returns trigger
language plpgsql volatile security invoker set search_path=pg_catalog as $$
begin
 if tg_table_schema='app_private' and tg_table_name='idempotency_keys' then
  if old.scope='liveops.content' and old.status='COMPLETED' then
   raise exception using errcode='55000',message='LIVEOPS_OPERATIONAL_ORIGINAL_IMMUTABLE';end if;
 elsif tg_table_schema='public' and tg_table_name='outbox_events' then
  if exists(select 1 from app_private.liveops_content_receipts where outbox_id=old.id)
   and (tg_op='DELETE' or to_jsonb(new)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']
    is distinct from to_jsonb(old)-array['status','available_at','attempt_count','replay_generation','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']) then
   raise exception using errcode='55000',message='LIVEOPS_OPERATIONAL_ORIGINAL_IMMUTABLE';end if;
 else raise exception using errcode='55000',message='LIVEOPS_TRIGGER_CONTEXT_INVALID';end if;
 if tg_op='DELETE' then return old;end if;return new;
end; $$;
revoke all on function app_private.guard_liveops_sealed_links() from public,anon,authenticated,service_role;
grant execute on function app_private.guard_liveops_sealed_links() to service_role;
create trigger liveops_idempotency_immutable before update or delete on app_private.idempotency_keys
 for each row execute function app_private.guard_liveops_sealed_links();
create trigger liveops_outbox_immutable before update or delete on public.outbox_events
 for each row execute function app_private.guard_liveops_sealed_links();

commit;
