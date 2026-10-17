begin;
-- BACKEND FIRST: reuse the existing MFA/revision/digest/idempotency CMS.
-- This migration registers no source FAQ, campaign, schedule or recipient.
alter table app_private.liveops_content_receipts drop constraint liveops_content_receipts_kind_check;
alter table app_private.liveops_content_receipts add constraint liveops_content_receipts_kind_check check(kind in ('EVENT','NOTICE','FAQ'));

create function app_private.validate_member_faq_payload(p jsonb,p_ready boolean) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare entry jsonb;copy text;starts timestamptz;ends timestamptz;
begin
 if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>65536
 or(select array_agg(k order by k)from jsonb_object_keys(p)k) is distinct from
  array['audience','entries','expiresAt','locale','publishedAt','segment','slug','sourceDigest','summary','title']::text[]
 or p->>'slug' is distinct from 'member-faq' or p->>'audience' is distinct from 'MEMBERS'
 or p->>'segment' is distinct from 'ALL_MEMBERS' or p->>'locale' is distinct from 'ko-KR'
 or p->>'sourceDigest' is distinct from '4f0b01d18c82ceb6e477eabe72446afc76abd63d5bd82450e9bbc5799fc8533b'
 or jsonb_typeof(p->'title') is distinct from 'string' or char_length(btrim(p->>'title')) not between 1 and 140
 or jsonb_typeof(p->'summary') is distinct from 'string' or char_length(btrim(p->>'summary')) not between 1 and 600
 or jsonb_typeof(p->'entries') is distinct from 'array' then
  raise exception using errcode='22023',message='INVALID_LIVEOPS_FAQ_PAYLOAD';end if;
 if jsonb_array_length(p->'entries') not between 1 and 100 then
  raise exception using errcode='22023',message='INVALID_LIVEOPS_FAQ_PAYLOAD';end if;
 for entry in select value from jsonb_array_elements(p->'entries')loop
  if jsonb_typeof(entry) is distinct from 'object'
   or(select array_agg(k order by k)from jsonb_object_keys(entry)k) is distinct from array['answer','question','stableEntryId']::text[]
   or jsonb_typeof(entry->'stableEntryId') is distinct from 'string'
   or coalesce(entry->>'stableEntryId','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(entry->>'stableEntryId')>100
   or jsonb_typeof(entry->'question') is distinct from 'string' or char_length(btrim(entry->>'question')) not between 1 and 200
   or jsonb_typeof(entry->'answer') is distinct from 'string' or char_length(btrim(entry->>'answer')) not between 1 and 4000 then
    raise exception using errcode='22023',message='INVALID_LIVEOPS_FAQ_ENTRY';end if;
 end loop;
 if(select count(distinct value->>'stableEntryId')from jsonb_array_elements(p->'entries'))<>jsonb_array_length(p->'entries')then
  raise exception using errcode='22023',message='INVALID_LIVEOPS_FAQ_ENTRY';end if;
 copy:=(p->>'title')||' '||(p->>'summary')||' '||
  (select string_agg((value->>'question')||' '||(value->>'answer'),' ')from jsonb_array_elements(p->'entries'));
 if not p_ready then copy:=regexp_replace(copy,'\{\{[a-z_]+\}\}','','g');end if;
 if copy ~* '<[!/?a-z]|admin[.]mining[.]putduk[.]com|service_role|SUPABASE_SECRET_KEY|가상[[:space:]]*채굴|virtual[[:space:]]+mining|[a-z]:[\\/]|app_private|auth[.]sessions'
 or(p_ready and copy ~ '\{\{|\}\}')then raise exception using errcode='22023',message='INVALID_LIVEOPS_COPY';end if;
 if jsonb_typeof(p->'publishedAt') not in ('string','null') or jsonb_typeof(p->'expiresAt') not in ('string','null') then
  raise exception using errcode='22023',message='INVALID_LIVEOPS_WINDOW';end if;
 starts:=(p->>'publishedAt')::timestamptz;ends:=(p->>'expiresAt')::timestamptz;
 if(p_ready and starts is null)or(ends is not null and starts is null)or ends<=starts
  or(starts is not null and not isfinite(starts))or(ends is not null and not isfinite(ends))then
  raise exception using errcode='22023',message='INVALID_LIVEOPS_WINDOW';end if;
end;$$;
revoke all on function app_private.validate_member_faq_payload(jsonb,boolean)from public,anon,authenticated,service_role;

create function app_private.validate_member_faq_projection() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare r app_private.liveops_content_receipts%rowtype;previous app_private.liveops_content_receipts%rowtype;d public.trust_documents%rowtype;
begin
 select * into d from public.trust_documents where id=new.document_id;
 if d.slug is distinct from 'member-faq' then return new;end if;
 select * into r from app_private.liveops_content_receipts where id=new.id;
 select * into previous from app_private.liveops_content_receipts where id=r.previous_revision_id;
 if r.id is null or r.kind is distinct from 'FAQ' or r.state is distinct from 'PUBLISHED'
 or previous.state is distinct from 'APPROVED' or previous.digest is distinct from r.digest
 or row(new.document_id,new.version,new.payload,new.content_hash,new.effective_at,new.created_by)
  is distinct from row(r.content_id,r.revision,r.snapshot,r.digest,(r.snapshot->>'publishedAt')::timestamptz,r.actor_id)
 or d.document_kind is distinct from 'faq' or d.visibility is distinct from 'AUTHENTICATED'::public.trust_visibility
 then raise exception using errcode='55000',message='FAQ_PROJECTION_SOURCE_INVALID';end if;
 perform app_private.assert_liveops_receipt(r.id);return new;
end;$$;
create trigger member_faq_projection_validate before insert on public.trust_versions for each row execute function app_private.validate_member_faq_projection();

create function app_private.guard_member_faq_projection() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare r app_private.liveops_content_receipts%rowtype;bound boolean;
begin
 if tg_table_name='trust_versions' then
  bound:=exists(select 1 from app_private.liveops_content_receipts where id=old.id and kind='FAQ');
  if bound or(tg_op='UPDATE' and exists(select 1 from public.trust_documents where id=new.document_id and slug='member-faq'))then
   raise exception using errcode='55000',message='FAQ_PROJECTION_IMMUTABLE';end if;
 else
  if tg_op='INSERT' then
   if new.slug='member-faq' then
    select * into r from app_private.liveops_content_receipts where kind='FAQ' and content_id=new.id order by revision desc limit 1;
    if r.id is null or r.state is distinct from 'PUBLISHED'
     or row(new.document_kind,new.title_ko,new.summary_ko,new.visibility,new.status,new.published_at,new.created_by,new.updated_by)
      is distinct from row('faq'::text,r.snapshot->>'title',r.snapshot->>'summary','AUTHENTICATED'::public.trust_visibility,'PUBLISHED'::public.content_status,
       (r.snapshot->>'publishedAt')::timestamptz,r.actor_id,r.actor_id)
     then raise exception using errcode='55000',message='FAQ_PROJECTION_SOURCE_INVALID';end if;
    perform app_private.assert_liveops_receipt(r.id);
   end if;return new;
  end if;
  if tg_op='UPDATE' and old.slug is distinct from 'member-faq' and new.slug='member-faq' then
   raise exception using errcode='55000',message='FAQ_PROJECTION_IMMUTABLE';end if;
  bound:=old.slug='member-faq';
  if bound then
   select * into r from app_private.liveops_content_receipts where kind='FAQ' and content_id=old.id order by revision desc limit 1;
   if tg_op='DELETE' or to_jsonb(new)-array['status','published_at','updated_by','updated_at'] is distinct from to_jsonb(old)-array['status','published_at','updated_by','updated_at']
    or r.id is null or r.state not in ('PUBLISHED','ARCHIVED') or new.updated_by is distinct from r.actor_id
    or new.status::text is distinct from r.state
    or(new.published_at is distinct from case when r.state='ARCHIVED'then old.published_at when old.status='ARCHIVED'then(r.snapshot->>'publishedAt')::timestamptz else least(old.published_at,(r.snapshot->>'publishedAt')::timestamptz)end)
    then raise exception using errcode='55000',message='FAQ_PROJECTION_IMMUTABLE';end if;
   perform app_private.assert_liveops_receipt(r.id);
  end if;
 end if;
 if tg_op='DELETE'then return old;end if;return new;
end;$$;
create trigger member_faq_version_immutable before update or delete on public.trust_versions for each row execute function app_private.guard_member_faq_projection();
create trigger member_faq_document_sealed before insert or update or delete on public.trust_documents for each row execute function app_private.guard_member_faq_projection();
revoke all on function app_private.validate_member_faq_projection(),app_private.guard_member_faq_projection()from public,anon,authenticated,service_role;

-- Existing PUBLIC policies stay unchanged; this narrow member document is new.
create policy member_faq_document_read on public.trust_documents for select to authenticated using(
 slug='member-faq' and document_kind='faq' and visibility='AUTHENTICATED' and status='PUBLISHED'
 and published_at<=statement_timestamp() and auth.uid() is not null and auth.role()='authenticated');
create policy member_faq_version_read on public.trust_versions for select to authenticated using(
 effective_at<=statement_timestamp() and exists(select 1 from public.trust_documents d where d.id=document_id
  and d.slug='member-faq' and d.document_kind='faq' and d.visibility='AUTHENTICATED' and d.status='PUBLISHED'
  and d.published_at<=statement_timestamp()) and auth.uid() is not null and auth.role()='authenticated');

create function public.read_member_faq()returns jsonb
language sql stable security invoker set search_path=pg_catalog as $$
 with latest as(
 select d.id as document_id,v.id,v.version,v.payload from public.trust_versions v join public.trust_documents d on d.id=v.document_id
 where current_user='authenticated' and auth.role()='authenticated' and auth.uid()is not null
 and d.slug='member-faq' and d.document_kind='faq' and d.visibility='AUTHENTICATED' and d.status='PUBLISHED'
 and d.published_at<=statement_timestamp() and v.effective_at<=statement_timestamp()
 order by v.version desc limit 1)
 select jsonb_build_object('contentId',document_id,'revisionId',id,'revision',version,'title',payload->>'title',
 'summary',payload->>'summary','locale',payload->>'locale','audience',payload->>'audience','entries',payload->'entries',
 'publishedAt',payload->>'publishedAt','expiresAt',payload->>'expiresAt','sourceDigest',payload->>'sourceDigest')
 from latest where coalesce((payload->>'expiresAt')::timestamptz,'infinity')>statement_timestamp();
$$;
revoke all on function public.read_member_faq()from public,anon,authenticated,service_role;
grant execute on function public.read_member_faq()to authenticated;

create or replace function app_private.validate_liveops_payload(p_kind text,p jsonb,p_ready boolean)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare n text;copy text;starts timestamptz;ends timestamptz;expected text[];
begin
 if p_kind='FAQ' then
  perform app_private.validate_member_faq_payload(p,p_ready);return;
 end if;
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
 if p_operation is null or p_operation not in ('CREATE_DRAFT','UPDATE_DRAFT','PREVIEW','APPROVE','PUBLISH','CANCEL','ARCHIVE') or p_kind is null or p_kind not in ('EVENT','NOTICE','FAQ')
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
  if p_kind='FAQ' and exists(select 1 from app_private.liveops_content_receipts where kind='FAQ') then
   raise exception using errcode='40001',message='LIVEOPS_FAQ_EXISTING_REVISION_REQUIRED';end if;
  v_content_id:=gen_random_uuid();snapshot:=p_payload;state:='DRAFT';
 else
  v_content_id:=p_content_id;
  select * into previous from app_private.liveops_content_receipts where content_id=p_content_id order by revision desc limit 1;
  if previous.id is null or previous.kind is distinct from p_kind or previous.id is distinct from p_expected_revision or previous.digest is distinct from p_expected_digest then
   raise exception using errcode='40001',message='LIVEOPS_REVISION_MISMATCH'; end if;
  perform app_private.assert_liveops_receipt(previous.id);
  snapshot:=previous.snapshot;
  if p_operation='UPDATE_DRAFT' and (previous.state in ('DRAFT','PREVIEWED','APPROVED') or(p_kind='FAQ' and previous.state in ('PUBLISHED','ARCHIVED'))) then snapshot:=p_payload;state:='DRAFT';
  elsif p_operation='PREVIEW' and previous.state='DRAFT' then state:='PREVIEWED';
  elsif p_operation='APPROVE' and previous.state='PREVIEWED' then state:='APPROVED';
  elsif p_operation='PUBLISH' and previous.state='APPROVED' then state:='PUBLISHED';
  elsif p_operation='CANCEL' and p_kind='EVENT' and previous.state='PUBLISHED' then state:='CANCELLED';
  elsif p_operation='ARCHIVE' and p_kind in ('NOTICE','FAQ') and previous.state='PUBLISHED' then state:='ARCHIVED';
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
 elsif state='PUBLISHED' and p_kind='FAQ' then
  -- The shared sealed receipt is the draft/approval source. Only PUBLISH gets
  -- a public trust version; old approved metadata stays stable until due.
  insert into public.trust_documents(id,slug,document_kind,title_ko,summary_ko,visibility,status,published_at,created_by,updated_by)
  values(v_content_id,'member-faq','faq',snapshot->>'title',snapshot->>'summary','AUTHENTICATED','PUBLISHED',(snapshot->>'publishedAt')::timestamptz,p_actor,p_actor)
  on conflict(id) do update set status='PUBLISHED',
   published_at=case when public.trust_documents.status='ARCHIVED' then excluded.published_at
    else least(public.trust_documents.published_at,excluded.published_at)end,updated_by=p_actor,updated_at=clock_timestamp();
  insert into public.trust_versions(id,document_id,version,payload,content_hash,effective_at,created_by)
  values(r.id,v_content_id,r.revision,snapshot,r.digest,(snapshot->>'publishedAt')::timestamptz,p_actor);
 elsif state='PUBLISHED' and p_kind='NOTICE' then
  insert into public.notices(id,slug,title_ko,summary_ko,body_markdown,status,is_pinned,published_at,expires_at,created_by,updated_by)
  values(v_content_id,snapshot->>'slug',snapshot->>'title',snapshot->>'summary',snapshot->>'body','PUBLISHED',(snapshot->>'isPinned')::boolean,(snapshot->>'publishedAt')::timestamptz,(snapshot->>'expiresAt')::timestamptz,p_actor,p_actor);
 elsif state='CANCELLED' then update public.events set status='CANCELLED',updated_by=p_actor where id=v_content_id;
 elsif state='ARCHIVED' and p_kind='FAQ' then update public.trust_documents set status='ARCHIVED',updated_by=p_actor,updated_at=clock_timestamp() where id=v_content_id;
 elsif state='ARCHIVED' then update public.notices set status='ARCHIVED',updated_by=p_actor where id=v_content_id;end if;
 perform app_private.assert_liveops_receipt(r.id);
 perform app_private.liveops_operator_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 update app_private.idempotency_keys set status='COMPLETED',response_status=200,response_payload=app_private.liveops_receipt_json(r),completed_at=clock_timestamp(),locked_until=null where id=idem_id;
 return app_private.liveops_receipt_json(r);
end;
$$;

create or replace function app_private.read_liveops_content(p_kind text,p_content_id uuid,p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare role public.app_role;items jsonb;r record;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' or auth.role() is distinct from 'service_role' then raise exception using errcode='42501',message='LIVEOPS_SERVICE_ROLE_REQUIRED'; end if;
 role:=app_private.liveops_operator_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 if p_kind is null or p_kind not in ('EVENT','NOTICE','FAQ') then raise exception using errcode='22023',message='INVALID_LIVEOPS_KIND';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.liveops-content',0));
 insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
 values(p_actor,role,'LIVEOPS_CONTENT_READ','LIVEOPS_CONTENT',coalesce(p_content_id::text,'list'),'이벤트와 공지 검토 조회',gen_random_uuid(),jsonb_build_object('admin_session_id',p_admin_session_id));
 for r in select distinct on(content_id) id,content_id from app_private.liveops_content_receipts where kind=p_kind and (p_content_id is null or content_id=p_content_id) order by content_id,revision desc loop perform app_private.assert_liveops_receipt(r.id);end loop;
 select coalesce(jsonb_agg(app_private.liveops_receipt_json(x::app_private.liveops_content_receipts) order by x.created_at desc),'[]') into items
 from(select distinct on(content_id) * from app_private.liveops_content_receipts where kind=p_kind and (p_content_id is null or content_id=p_content_id) order by content_id,revision desc limit 500)x;
 return jsonb_build_object('items',items);
end;
$$;

create or replace function app_private.consume_liveops_publication(p_event_id uuid,p_worker_id text)returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare e public.outbox_events%rowtype;r app_private.liveops_content_receipts%rowtype;j app_private.liveops_fanout_job_originals%rowtype;
at timestamptz:=clock_timestamp();payload jsonb;frozen_count integer;
begin
 perform app_private.assert_push_worker_context();
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.liveops-content',0));
 select * into e from public.outbox_events where id=p_event_id for update;
 if e.id is null or e.status<>'PROCESSING' or e.lease_owner is distinct from p_worker_id or e.lease_expires_at is null or e.lease_expires_at<at then
  raise exception using errcode='55000',message='OUTBOX_LEASE_NOT_OWNED';end if;
 if e.event_type is distinct from 'LIVEOPS_CONTENT_CHANGED.v1' or e.schema_version<>1 or e.aggregate_type<>'liveops_content' then
  raise exception using errcode='55000',message='LIVEOPS_PUBLICATION_SOURCE_REQUIRED';end if;
 select * into r from app_private.liveops_content_receipts where outbox_id=e.id;
 perform app_private.assert_liveops_receipt(r.id);
 -- FAQ publication is a versioned member read, not an authorization to alert
 -- every member. Preserve the existing EVENT/NOTICE notification consumer.
 if r.state<>'PUBLISHED' or r.kind='FAQ' then return;end if;
 if r.snapshot->>'audience' is distinct from 'MEMBERS' or r.snapshot->>'segment' is distinct from 'ALL_MEMBERS' then
  raise exception using errcode='55000',message='LIVEOPS_AUDIENCE_NOT_SUPPORTED';end if;
 if exists(select 1 from app_private.liveops_content_receipts where content_id=r.content_id and revision>r.revision)
  or(r.kind='EVENT'and not exists(select 1 from public.events where id=r.content_id and published_at is not null and status in('SCHEDULED','LIVE')and ends_at>at))
  or(r.kind='NOTICE'and not exists(select 1 from public.notices where id=r.content_id and status='PUBLISHED'and(expires_at is null or expires_at>at)))then return;end if;
 select * into j from app_private.liveops_fanout_job_originals where revision_id=r.id and chunk_number=1;
 if j.job_id is not null then
  if j.source_event_id is distinct from e.id or j.digest is distinct from app_private.funding_engine_digest(to_jsonb(j)-'digest')then
   raise exception using errcode='55000',message='LIVEOPS_FANOUT_JOB_ORIGINAL_INVALID';end if;
  perform app_private.assert_liveops_fanout_job(j.job_id);return;end if;
 insert into app_private.liveops_publication_cohort(revision_id,user_id)
 select r.id,p.user_id from public.user_profiles p join auth.users u on u.id=p.user_id where p.created_at<=r.created_at and u.created_at<=r.created_at;
 get diagnostics frozen_count=row_count;
 j.job_id:=gen_random_uuid();j.revision_id:=r.id;j.source_event_id:=e.id;j.after_user_id:=null;j.chunk_number:=1;j.cohort_count:=frozen_count;
 j.digest:=app_private.funding_engine_digest(to_jsonb(j)-'digest');
 payload:=jsonb_build_object('revision_id',j.revision_id,'source_event_id',j.source_event_id,'chunk_number',1,'after_user_id',null);
 insert into public.system_jobs(id,job_type,idempotency_key,payload,payload_version,available_at)
 values(j.job_id,'LIVEOPS_PUBLICATION_FANOUT_V1','liveops-fanout:'||r.id::text||':1',payload,1,at);
 insert into app_private.liveops_fanout_job_originals select j.*;
 -- Source intake is durably queued, not claimed as all-recipient notification delivery.
 insert into public.event_consumer_deliveries(event_id,consumer_name,status,attempt_count,processed_at)
 values(e.id,'liveops_publication_enqueue.v1','SUCCEEDED',1,at)on conflict(event_id,consumer_name)do nothing;
end;$$;

commit;
