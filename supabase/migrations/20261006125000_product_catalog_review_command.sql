begin;

-- Explicit operator receipts; no seed is approved or published by this migration.
create table app_private.product_catalog_receipts (
 id uuid primary key default gen_random_uuid(),
 catalog_id uuid not null references public.product_catalog_versions(id),
 revision integer not null check(revision between 1 and 3),
 state text not null check(state in ('PREVIEWED','APPROVED','PUBLISHED')),
 previous_revision_id uuid references app_private.product_catalog_receipts(id),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 snapshot_digest text not null check(snapshot_digest ~ '^[a-f0-9]{64}$'),
 publish_at timestamptz not null check(isfinite(publish_at)),
 actor_user_id uuid not null references auth.users(id),
 admin_session_id uuid not null references public.admin_sessions(id),
 step_up_grant_id uuid not null unique references public.admin_step_up_grants(id),
 audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
 outbox_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
 created_at timestamptz not null default clock_timestamp(),
 unique(catalog_id,revision), unique(catalog_id,state),
 check((revision=1 and state='PREVIEWED' and previous_revision_id is null)
   or (revision=2 and state='APPROVED' and previous_revision_id is not null)
   or (revision=3 and state='PUBLISHED' and previous_revision_id is not null)),
 check(snapshot_digest=app_private.funding_engine_digest(snapshot))
);
alter table app_private.product_catalog_receipts enable row level security;
alter table app_private.product_catalog_receipts force row level security;
revoke all on app_private.product_catalog_receipts from public,anon,authenticated,service_role;
grant select,insert on app_private.product_catalog_receipts to service_role;
create trigger product_catalog_receipts_append_only before update or delete
 on app_private.product_catalog_receipts for each row execute function app_private.prevent_row_mutation();

create function app_private.product_catalog_utc_instant(p_at timestamptz)
returns text language sql immutable security invoker set search_path=pg_catalog as $$
 select case when p_at is null then null else to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end;
$$;

create function app_private.product_catalog_source_snapshot(p_catalog uuid)
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('catalog',(to_jsonb(c)-array['status','approved_by','approved_at','published_at'])
      ||jsonb_build_object('created_at',app_private.product_catalog_utc_instant(c.created_at)),
   'products',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('created_at',app_private.product_catalog_utc_instant(p.created_at)) order by p.display_order,p.id)
      from public.mining_products p where p.catalog_version_id=c.id),'[]'::jsonb),
   'visuals',coalesce((select jsonb_agg(to_jsonb(v)||jsonb_build_object('created_at',app_private.product_catalog_utc_instant(v.created_at)) order by v.product_id,v.theme,v.asset_path)
      from public.product_visuals v join public.mining_products p on p.id=v.product_id
      where p.catalog_version_id=c.id),'[]'::jsonb))
 from public.product_catalog_versions c where c.id=p_catalog;
$$;

create function app_private.product_catalog_receipt_json(p_receipt app_private.product_catalog_receipts)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select jsonb_build_object('catalogId',p_receipt.catalog_id,'revisionId',p_receipt.id,
   'revision',p_receipt.revision,'state',p_receipt.state,
   'snapshotDigest',p_receipt.snapshot_digest,'publishAt',app_private.product_catalog_utc_instant(p_receipt.publish_at));
$$;

create function app_private.assert_product_catalog_receipt(p_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare r app_private.product_catalog_receipts%rowtype; a public.audit_logs%rowtype;
 e public.outbox_events%rowtype; previous app_private.product_catalog_receipts%rowtype;
begin
 select * into r from app_private.product_catalog_receipts where id=p_id;
 select * into a from public.audit_logs where id=r.audit_id;
 select * into e from public.outbox_events where id=r.outbox_id;
 if r.id is null or a.id is null or e.id is null
   or r.snapshot_digest is distinct from app_private.funding_engine_digest(r.snapshot)
   or a.actor_user_id is distinct from r.actor_user_id or a.actor_role is null or a.actor_role not in ('ADMIN','SUPER_ADMIN')
   or a.action is distinct from ('PRODUCT_CATALOG_'||(case r.state when 'PREVIEWED' then 'PREVIEW' when 'APPROVED' then 'APPROVE' else 'PUBLISH' end))
   or a.target_type is distinct from 'PRODUCT_CATALOG' or a.target_id is distinct from r.catalog_id::text
   or a.after_state is distinct from app_private.product_catalog_receipt_json(r)
   or a.metadata->>'snapshot_digest' is distinct from r.snapshot_digest
   or a.metadata->>'admin_session_id' is distinct from r.admin_session_id::text
   or e.event_type is distinct from 'PRODUCT_CATALOG_CHANGED.v1' or e.schema_version<>1
   or e.aggregate_type is distinct from 'product_catalog' or e.aggregate_id is distinct from r.catalog_id
   or e.actor_user_id is distinct from r.actor_user_id or e.request_id is distinct from a.request_id
   or e.correlation_id is distinct from a.request_id
   or e.payload is distinct from jsonb_build_object('audit_id',r.audit_id,'receipt_id',r.id,
      'state',r.state,'snapshot_digest',r.snapshot_digest)
   or not exists(select 1 from public.admin_step_up_grants g where g.id=r.step_up_grant_id
     and g.user_id=r.actor_user_id and g.admin_session_id=r.admin_session_id
     and g.command_family='PRODUCT_CATALOG' and g.consumed_at is not null and g.consume_request_id=a.request_id)
 then raise exception using errcode='55000',message='PRODUCT_CATALOG_RECEIPT_MISMATCH'; end if;
 if r.revision>1 then
   select * into previous from app_private.product_catalog_receipts where id=r.previous_revision_id;
   if previous.catalog_id is distinct from r.catalog_id or previous.revision is distinct from r.revision-1
     or previous.snapshot is distinct from r.snapshot or previous.publish_at is distinct from r.publish_at then
     raise exception using errcode='55000',message='PRODUCT_CATALOG_RECEIPT_MISMATCH'; end if;
 end if;
end;
$$;

create function app_private.assert_published_product_catalog(p_catalog uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.product_catalog_versions%rowtype; r app_private.product_catalog_receipts%rowtype;
 approval app_private.product_catalog_receipts%rowtype; item jsonb; rule public.product_rule_versions%rowtype;
 availability public.product_availability%rowtype;
begin
 select * into c from public.product_catalog_versions where id=p_catalog;
 select * into r from app_private.product_catalog_receipts where catalog_id=p_catalog and state='PUBLISHED';
 select * into approval from app_private.product_catalog_receipts where catalog_id=p_catalog and state='APPROVED';
 if c.status is distinct from 'PUBLISHED' or r.id is null or approval.id is null
   or c.approved_by is distinct from approval.actor_user_id or c.approved_at is distinct from approval.created_at
   or c.published_at is distinct from r.publish_at
   or r.snapshot->'source' is distinct from app_private.product_catalog_source_snapshot(p_catalog) then
   raise exception using errcode='55000',message='PRODUCT_CATALOG_PUBLICATION_REQUIRED'; end if;
 perform app_private.assert_product_catalog_receipt(r.id);
 perform app_private.assert_product_catalog_receipt(approval.id);
 perform app_private.assert_product_catalog_receipt(approval.previous_revision_id);
 for item in select value from jsonb_array_elements(r.snapshot->'neutralPlan') loop
   select * into rule from public.product_rule_versions where product_id=(item->>'productId')::uuid;
   select * into availability from public.product_availability where product_id=(item->>'productId')::uuid;
   if (select count(*) from public.product_rule_versions where product_id=(item->>'productId')::uuid)<>1
     or rule.rule_payload is distinct from '{}'::jsonb or rule.approved_by is distinct from approval.actor_user_id
     or rule.version is distinct from 1 or rule.effective_at is distinct from r.publish_at or rule.retired_at is not null
     or (select count(*) from public.product_availability where product_id=(item->>'productId')::uuid)<>1
     or availability.status is distinct from 'AVAILABLE' or availability.available_from is distinct from r.publish_at
     or availability.available_to is not null or availability.segment_key is not null then
     raise exception using errcode='55000',message='PRODUCT_CATALOG_NEUTRAL_PLAN_MISMATCH'; end if;
 end loop;
 return r.id;
end;
$$;

-- All child edits take the same lock as preview/approval. No concurrent edit can
-- slip between digest verification and freezing the approved snapshot.
create function app_private.serialize_product_catalog_mutation()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('putduk-mining.product-catalog',0));
 return null;
end;
$$;
do $catalog_locks$
declare t text;
begin
 foreach t in array array['product_catalog_versions','mining_products','product_rule_versions','product_visuals','product_availability'] loop
  execute format('create trigger a_product_catalog_serialization before insert or update or delete on public.%I for each statement execute function app_private.serialize_product_catalog_mutation()',t);
 end loop;
end;
$catalog_locks$;

create function app_private.validate_product_catalog_receipt_trigger()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 perform app_private.assert_product_catalog_receipt(new.id);
 return null;
end;
$$;
create constraint trigger product_catalog_receipt_seal after insert on app_private.product_catalog_receipts
 deferrable initially deferred for each row execute function app_private.validate_product_catalog_receipt_trigger();

create function app_private.validate_product_catalog_publication_trigger()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare r app_private.product_catalog_receipts%rowtype;
begin
 -- Owner-only synthetic SQL fixtures keep their existing seam. Application
 -- service-role status writes must have this reviewed command's actual seal.
 if current_user='service_role' and new.status in ('APPROVED','PUBLISHED') then
  if new.status='PUBLISHED' then perform app_private.assert_published_product_catalog(new.id);
  else
   select * into r from app_private.product_catalog_receipts where catalog_id=new.id and state='APPROVED';
   if r.id is null or new.approved_by is distinct from r.actor_user_id or new.approved_at is distinct from r.created_at then
    raise exception using errcode='55000',message='PRODUCT_CATALOG_APPROVAL_RECEIPT_REQUIRED'; end if;
   perform app_private.assert_product_catalog_receipt(r.id);
  end if;
 end if;
 return null;
end;
$$;
create constraint trigger product_catalog_publication_seal after insert or update on public.product_catalog_versions
 deferrable initially deferred for each row execute function app_private.validate_product_catalog_publication_trigger();

create function app_private.guard_product_catalog_event()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if old.event_type='PRODUCT_CATALOG_CHANGED.v1' or (tg_op<>'DELETE' and new.event_type='PRODUCT_CATALOG_CHANGED.v1') then
  if tg_op='DELETE' or (to_jsonb(old)-array['status','available_at','attempt_count','max_attempts','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at'])
    is distinct from (to_jsonb(new)-array['status','available_at','attempt_count','max_attempts','lease_owner','lease_expires_at','processed_at','last_error_code','updated_at']) then
   raise exception using errcode='55000',message='PRODUCT_CATALOG_EVENT_IMMUTABLE'; end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger product_catalog_event_immutable before update or delete on public.outbox_events
 for each row execute function app_private.guard_product_catalog_event();

create function app_private.guard_product_catalog_completion()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
 raise exception using errcode='55000',message='PRODUCT_CATALOG_COMPLETION_IMMUTABLE';
end;
$$;
revoke all on function app_private.guard_product_catalog_completion() from public,anon,authenticated,service_role;
create trigger product_catalog_completion_immutable before update or delete on app_private.idempotency_keys
 for each row when(old.scope='product.catalog' and old.status='COMPLETED')
 execute function app_private.guard_product_catalog_completion();

-- Closed privileged executor behind the actual-service canonical invoker.
-- This does not restore direct catalog UPDATE or rule/availability INSERT.
create function app_private.execute_product_catalog_command(
 p_operation text,p_catalog_id uuid,p_expected_revision uuid,p_expected_digest text,p_publish_at timestamptz,
 p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text,
 p_step_up_token text,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.product_catalog_versions%rowtype; r app_private.product_catalog_receipts%rowtype;
 previous app_private.product_catalog_receipts%rowtype; idem app_private.idempotency_keys%rowtype;
 role public.app_role; grant_id uuid; request_id uuid:=gen_random_uuid(); audit_id uuid:=gen_random_uuid();
 event_id uuid:=gen_random_uuid(); idem_id uuid; source jsonb; snapshot jsonb; plan jsonb;
 replay jsonb; replay_audit public.audit_logs%rowtype;
 request_hash text; state text; now_at timestamptz; item jsonb; proof public.admin_step_up_grants%rowtype;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role' then
   raise exception using errcode='42501',message='PRODUCT_CATALOG_SERVICE_ROLE_REQUIRED'; end if;
 if p_operation is null or p_operation not in ('PREVIEW','APPROVE','PUBLISH') or p_catalog_id is null
   or p_expected_digest is null or p_expected_digest !~ '^[a-f0-9]{64}$'
   or p_publish_at is null or not isfinite(p_publish_at)
   or char_length(btrim(coalesce(p_reason,''))) not between 10 and 500
   or char_length(coalesce(p_idempotency_key,'')) not between 8 and 200
   or char_length(coalesce(p_step_up_token,'')) not between 16 and 512 then
   raise exception using errcode='22023',message='INVALID_PRODUCT_CATALOG_COMMAND'; end if;
 perform pg_advisory_xact_lock(hashtextextended('putduk-mining.product-catalog',0));
 role:=app_private.assert_economy_policy_admin_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 request_hash:=app_private.funding_engine_digest(jsonb_build_object('operation',p_operation,'catalog',p_catalog_id,
   'revision',p_expected_revision,'digest',p_expected_digest,'publish_at',extract(epoch from p_publish_at),
   'actor',p_actor,'admin_session',p_admin_session_id,'auth_session',p_auth_session_id,'reason',btrim(p_reason),
   'proof_hash',encode(extensions.digest(p_step_up_token,'sha256'),'hex')));
 insert into app_private.idempotency_keys(scope,actor_id,idempotency_key,request_hash,status)
 values('product.catalog',p_actor,p_idempotency_key,request_hash,'PROCESSING')
 on conflict(scope,actor_id,idempotency_key) do nothing returning id into idem_id;
 if idem_id is null then
   select * into idem from app_private.idempotency_keys where scope='product.catalog' and actor_id=p_actor and idempotency_key=p_idempotency_key for update;
   if idem.request_hash is distinct from request_hash then raise exception using errcode='22023',message='IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
   if idem.status<>'COMPLETED' then raise exception using errcode='40001',message='PRODUCT_CATALOG_IN_PROGRESS'; end if;
   select * into r from app_private.product_catalog_receipts where id=(idem.response_payload->>'revisionId')::uuid;
   select * into replay_audit from public.audit_logs where id=r.audit_id;
   if r.id is null or r.catalog_id is distinct from p_catalog_id or r.actor_user_id is distinct from p_actor
      or r.admin_session_id is distinct from p_admin_session_id or r.publish_at is distinct from p_publish_at
      or r.previous_revision_id is distinct from p_expected_revision
      or r.state is distinct from (case p_operation when 'PREVIEW' then 'PREVIEWED' when 'APPROVE' then 'APPROVED' else 'PUBLISHED' end)
      or replay_audit.metadata->>'request_hash' is distinct from request_hash
      or idem.response_status is distinct from 200 or idem.completed_at is null then
     raise exception using errcode='55000',message='PRODUCT_CATALOG_RECEIPT_MISMATCH'; end if;
   perform app_private.assert_product_catalog_receipt(r.id);
   replay:=app_private.product_catalog_receipt_json(r);
   if replay is distinct from idem.response_payload then
     raise exception using errcode='55000',message='PRODUCT_CATALOG_RECEIPT_MISMATCH'; end if;
   return replay;
 end if;
 select * into proof from public.admin_step_up_grants where user_id=p_actor and admin_session_id=p_admin_session_id
   and command_family='PRODUCT_CATALOG' and token_hash=encode(extensions.digest(p_step_up_token,'sha256'),'hex') for update;
 if proof.id is null or proof.consumed_at is not null or proof.expires_at<=clock_timestamp() then
   raise exception using errcode='42501',message='STEP_UP_REQUIRED'; end if;
 select * into c from public.product_catalog_versions where id=p_catalog_id for update;
 select * into previous from app_private.product_catalog_receipts where catalog_id=p_catalog_id order by revision desc limit 1;
 if c.id is null or p_expected_revision is distinct from previous.id then
   raise exception using errcode='40001',message='PRODUCT_CATALOG_REVISION_CHANGED'; end if;
 if p_publish_at<=clock_timestamp() then raise exception using errcode='22023',message='INVALID_PRODUCT_CATALOG_PUBLISH_TIME'; end if;
 source:=app_private.product_catalog_source_snapshot(p_catalog_id);
 if p_operation='PREVIEW' then
   if c.status<>'DRAFT' or previous.id is not null or p_expected_digest is distinct from app_private.funding_engine_digest(source) then
     raise exception using errcode='40001',message='PRODUCT_CATALOG_PREVIEW_CHANGED'; end if;
   if jsonb_array_length(c.source_references) not between 1 and 64 or c.snapshot_date>(clock_timestamp() at time zone 'UTC')::date
      or not isfinite(c.created_at)
      or jsonb_array_length(source->'products') not between 1 and 128
      or exists(select 1 from public.mining_products p where p.catalog_version_id=p_catalog_id and not isfinite(p.created_at))
      or exists(select 1 from public.product_visuals v join public.mining_products p on p.id=v.product_id where p.catalog_version_id=p_catalog_id and not isfinite(v.created_at))
      or exists(select 1 from jsonb_array_elements(c.source_references) s
       where jsonb_typeof(s)<>'object' or coalesce(s->>'name','')='' or coalesce(s->>'url','') !~ '^https?://[^/@[:space:]]+(/[^[:space:]]*)?$')
      or exists(select 1 from public.product_rule_versions x join public.mining_products p on p.id=x.product_id where p.catalog_version_id=p_catalog_id)
      or exists(select 1 from public.product_availability x join public.mining_products p on p.id=x.product_id where p.catalog_version_id=p_catalog_id) then
     raise exception using errcode='55000',message='PRODUCT_CATALOG_DRAFT_UNSUPPORTED'; end if;
   select jsonb_agg(jsonb_build_object('productId',p.id,'ruleVersion',1,'rulePayload','{}'::jsonb,
      'availableFrom',app_private.product_catalog_utc_instant(p_publish_at),'availability','AVAILABLE') order by p.display_order,p.id) into plan
     from public.mining_products p where p.catalog_version_id=p_catalog_id;
   snapshot:=jsonb_build_object('source',source,'neutralPlan',plan,'publishAt',app_private.product_catalog_utc_instant(p_publish_at));
   state:='PREVIEWED';
 else
   if previous.state is distinct from (case p_operation when 'APPROVE' then 'PREVIEWED' else 'APPROVED' end)
      or previous.snapshot_digest is distinct from p_expected_digest or previous.publish_at is distinct from p_publish_at
      or previous.snapshot->'source' is distinct from source
      or c.status is distinct from (case p_operation when 'APPROVE' then 'DRAFT'::public.catalog_status else 'APPROVED'::public.catalog_status end) then
     raise exception using errcode='40001',message='PRODUCT_CATALOG_PREVIEW_CHANGED'; end if;
   perform app_private.assert_product_catalog_receipt(previous.id);
   snapshot:=previous.snapshot;
   if p_operation='APPROVE' then
     if exists(select 1 from public.product_rule_versions x join public.mining_products p on p.id=x.product_id where p.catalog_version_id=p_catalog_id)
       or exists(select 1 from public.product_availability x join public.mining_products p on p.id=x.product_id where p.catalog_version_id=p_catalog_id) then
       raise exception using errcode='55000',message='PRODUCT_CATALOG_DRAFT_UNSUPPORTED'; end if;
     for item in select value from jsonb_array_elements(snapshot->'neutralPlan') loop
       insert into public.product_rule_versions(product_id,version,effective_at,rule_payload,approved_by)
       values((item->>'productId')::uuid,1,p_publish_at,'{}',p_actor);
       insert into public.product_availability(product_id,status,available_from)
       values((item->>'productId')::uuid,'AVAILABLE',p_publish_at);
     end loop;
     state:='APPROVED';
   else state:='PUBLISHED'; end if;
 end if;
 -- Proof consumption, changes, receipts and idempotency live in one transaction.
 grant_id:=app_private.consume_admin_step_up_token(p_actor,p_step_up_token,'PRODUCT_CATALOG',request_id,p_admin_session_id);
 now_at:=clock_timestamp();
 if p_publish_at<=now_at then raise exception using errcode='22023',message='INVALID_PRODUCT_CATALOG_PUBLISH_TIME'; end if;
 if proof.expires_at<=now_at then raise exception using errcode='42501',message='STEP_UP_REQUIRED'; end if;
 perform app_private.assert_economy_policy_admin_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 insert into app_private.product_catalog_receipts(catalog_id,revision,state,previous_revision_id,snapshot,snapshot_digest,
    publish_at,actor_user_id,admin_session_id,step_up_grant_id,audit_id,outbox_id,created_at)
 values(p_catalog_id,coalesce(previous.revision,0)+1,state,previous.id,snapshot,app_private.funding_engine_digest(snapshot),
    p_publish_at,p_actor,p_admin_session_id,grant_id,audit_id,event_id,now_at) returning * into r;
 insert into public.audit_logs(id,actor_user_id,actor_role,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(audit_id,p_actor,role,'PRODUCT_CATALOG_'||p_operation,'PRODUCT_CATALOG',p_catalog_id::text,
   btrim(p_reason),request_id,app_private.product_catalog_receipt_json(r),jsonb_build_object('command_version',1,
    'admin_session_id',p_admin_session_id,'snapshot_digest',r.snapshot_digest,'step_up_grant_id',grant_id,'request_hash',request_hash),now_at);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key,available_at,last_error_code,occurred_at,created_at)
 values(event_id,'PRODUCT_CATALOG_CHANGED.v1',1,'product_catalog',p_catalog_id,p_actor,
   jsonb_build_object('audit_id',audit_id,'receipt_id',r.id,'state',state,'snapshot_digest',r.snapshot_digest),
   request_id,request_id,'product-catalog:'||p_actor::text||':'||p_idempotency_key,'infinity','CATALOG_CONSUMER_NOT_ENABLED',now_at,now_at);
 if state='APPROVED' then update public.product_catalog_versions set status='APPROVED',approved_by=p_actor,approved_at=now_at where id=p_catalog_id;
 elsif state='PUBLISHED' then
   update public.product_catalog_versions set status='PUBLISHED',published_at=p_publish_at where id=p_catalog_id;
   perform app_private.assert_published_product_catalog(p_catalog_id);
 end if;
 perform app_private.assert_product_catalog_receipt(r.id);
 perform app_private.assert_economy_policy_admin_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 if proof.expires_at<=clock_timestamp() then raise exception using errcode='42501',message='STEP_UP_REQUIRED'; end if;
 update app_private.idempotency_keys set status='COMPLETED',response_status=200,response_payload=app_private.product_catalog_receipt_json(r),completed_at=clock_timestamp(),locked_until=null where id=idem_id;
 return app_private.product_catalog_receipt_json(r);
end;
$$;

create function public.manage_product_catalog(
 p_operation text,p_catalog_id uuid,p_expected_revision uuid,p_expected_digest text,p_publish_at timestamptz,
 p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text,
 p_step_up_token text,p_reason text,p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='PRODUCT_CATALOG_SERVICE_ROLE_REQUIRED'; end if;
 return app_private.execute_product_catalog_command(p_operation,p_catalog_id,p_expected_revision,p_expected_digest,p_publish_at,
   p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal,p_step_up_token,p_reason,p_idempotency_key);
end;
$$;

create function public.read_product_catalog_review_state(p_catalog_id uuid,p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.product_catalog_versions%rowtype; r app_private.product_catalog_receipts%rowtype;
 role public.app_role; source jsonb; selected jsonb; catalogs jsonb;
begin
 if current_user<>'service_role' then raise exception using errcode='42501',message='PRODUCT_CATALOG_SERVICE_ROLE_REQUIRED'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.product-catalog',0));
 role:=app_private.assert_economy_policy_admin_context(p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
 -- Authorized operator access is recorded before reading private review receipts.
 insert into public.audit_logs(actor_user_id,actor_role,action,target_type,target_id,reason,request_id,metadata)
 values(p_actor,role,'PRODUCT_CATALOG_REVIEW_READ','PRODUCT_CATALOG_REVIEW',coalesce(p_catalog_id::text,'latest'),
   '상품 검토 목록 조회',gen_random_uuid(),jsonb_build_object('admin_session_id',p_admin_session_id));
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'version',x.version,'status',x.status) order by x.version desc),'[]') into catalogs
 from(select id,version,status from public.product_catalog_versions order by version desc limit 128)x;
 select * into c from public.product_catalog_versions where id=coalesce(p_catalog_id,
   (select id from public.product_catalog_versions order by version desc limit 1));
 if c.id is not null then
  source:=app_private.product_catalog_source_snapshot(c.id);
  select * into r from app_private.product_catalog_receipts where catalog_id=c.id order by revision desc limit 1;
  if r.id is not null then perform app_private.assert_product_catalog_receipt(r.id); end if;
  selected:=jsonb_build_object('catalogId',c.id,'version',c.version,'status',c.status,'snapshotDate',c.snapshot_date,
   'methodology',c.methodology,'sources',c.source_references,'sourceDigest',app_private.funding_engine_digest(source),
   'expectedDigest',coalesce(r.snapshot_digest,app_private.funding_engine_digest(source)),
   'latestReceipt',case when r.id is null then null else app_private.product_catalog_receipt_json(r) end,
   'supported',case when r.id is not null then true else
     not exists(select 1 from public.product_rule_versions x join public.mining_products p on p.id=x.product_id where p.catalog_version_id=c.id)
     and not exists(select 1 from public.product_availability x join public.mining_products p on p.id=x.product_id where p.catalog_version_id=c.id) end,
   'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'nameKo',p.name_ko,'nameEn',p.name_en,
     'descriptionKo',p.description_ko,'category',p.category,'displayOrder',p.display_order) order by p.display_order,p.id)
     from public.mining_products p where p.catalog_version_id=c.id),'[]'));
 end if;
 return jsonb_build_object('schemaVersion',1,'serverNow',clock_timestamp(),'catalogs',catalogs,'selected',selected);
end;
$$;

revoke all on function public.manage_product_catalog(text,uuid,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text),
 public.read_product_catalog_review_state(uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.manage_product_catalog(text,uuid,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text),
 public.read_product_catalog_review_state(uuid,uuid,uuid,text,text) to service_role;
revoke all on function app_private.product_catalog_utc_instant(timestamptz),app_private.execute_product_catalog_command(text,uuid,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text),
 app_private.product_catalog_source_snapshot(uuid),app_private.product_catalog_receipt_json(app_private.product_catalog_receipts),
 app_private.assert_product_catalog_receipt(uuid),app_private.assert_published_product_catalog(uuid),app_private.serialize_product_catalog_mutation(),
 app_private.validate_product_catalog_receipt_trigger(),app_private.validate_product_catalog_publication_trigger(),app_private.guard_product_catalog_event()
 from public,anon,authenticated;
grant execute on function app_private.product_catalog_utc_instant(timestamptz),app_private.execute_product_catalog_command(text,uuid,uuid,text,timestamptz,uuid,uuid,text,text,text,text,text),
 app_private.product_catalog_source_snapshot(uuid),app_private.product_catalog_receipt_json(app_private.product_catalog_receipts),
 app_private.assert_product_catalog_receipt(uuid),app_private.assert_published_product_catalog(uuid),app_private.serialize_product_catalog_mutation(),
 app_private.validate_product_catalog_receipt_trigger(),app_private.validate_product_catalog_publication_trigger(),app_private.guard_product_catalog_event()
 to service_role;

commit;
