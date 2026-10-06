begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok((select prosecdef and 'search_path=pg_catalog'=any(proconfig) from pg_proc where oid='public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)'::regprocedure),'allocation writer is one narrow fixed-path definer');
select ok(has_function_privilege('authenticated','public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)','EXECUTE')
 and not has_function_privilege('anon','public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)','EXECUTE')
 and not has_function_privilege('service_role','public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text)','EXECUTE'),'only authenticated member role can execute canonical allocation command');
select ok(not has_table_privilege('authenticated','app_private.funding_allocation_originals','SELECT')
 and not has_table_privilege('authenticated','app_private.funding_allocation_originals','INSERT')
 and not has_table_privilege('service_role','app_private.funding_allocation_originals','INSERT'),'no broad private member/service grants were added');

-- READ ownership uses a rollback-only sealed [] fixture, never runtime activation.
create temporary table allocation_ctx(member_id uuid,other_id uuid,catalog_id uuid,allocation_id uuid);
insert into allocation_ctx values('12510000-0000-4000-8000-000000000001','12510000-0000-4000-8000-000000000002',
 '12510000-0000-4000-8000-000000000003','12510000-0000-4000-8000-000000000004');
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
 created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select id,'authenticated','authenticated',id::text||'@allocation.putduk.test','',statement_timestamp(),'{}','{}',
 statement_timestamp(),statement_timestamp(),'','','','' from allocation_ctx cross join lateral unnest(array[member_id,other_id])id;
insert into public.product_catalog_versions(id,version,snapshot_date,methodology,source_references,content_digest,proposed_by)
 select catalog_id,(select max(version)+1 from public.product_catalog_versions),current_date,'Owner-only zero-selection read authority fixture',
 '[]',app_private.funding_engine_digest(jsonb_build_object('test_catalog',catalog_id)),'SYNTHETIC_LOCAL_TEST_ONLY' from allocation_ctx;
do $$declare x record; original app_private.funding_allocation_originals%rowtype; snapshot jsonb; request uuid:=gen_random_uuid();
begin
 select * into x from allocation_ctx; original.id:=x.allocation_id;original.user_id:=x.member_id;original.revision:=1;
 original.catalog_version_id:=x.catalog_id;original.products:='[]';original.effects:='{}';original.effective_at:=clock_timestamp();
 original.recorded_at:=original.effective_at;original.audit_id:=gen_random_uuid();original.source_event_id:=gen_random_uuid();
 snapshot:=app_private.funding_allocation_snapshot(original);original.input_digest:=app_private.funding_engine_digest(snapshot);
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata)
 values(original.audit_id,x.member_id,'FUNDING_ALLOCATION_CONFIRMED','FUNDING_ENGINE_V1',original.id::text,
 'POSTGRES_OWNER_ONLY read ownership fixture',request,snapshot,jsonb_build_object('input_digest',original.input_digest));
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key,available_at,last_error_code)
 values(original.source_event_id,'FUNDING_ALLOCATION_CONFIRMED.v1',1,'funding_engine_v1',original.id,x.member_id,
 jsonb_build_object('user_id',x.member_id,'audit_id',original.audit_id,'input_digest',original.input_digest),request,request,
 'funding:'||original.id::text||':seal','infinity','SYNTHETIC_LOCAL_TEST_ONLY');
 insert into app_private.funding_allocation_originals select original.*;
end$$;
grant select on allocation_ctx to authenticated;
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
-- Rollback-only owner fixture tests the immutable completion storage guard.
-- It is not a runtime transition or a successful member allocation claim.
insert into app_private.idempotency_keys(scope,actor_id,idempotency_key,request_hash,status,response_status,response_payload,completed_at)
select 'funding.allocation',member_id,'allocation-owner-only-completion-immutability',
 app_private.funding_engine_digest(jsonb_build_object('fixture_id',allocation_id)),'COMPLETED',200,
 '{"fixture_provenance":"POSTGRES_OWNER_ONLY_STORAGE_GUARD"}',clock_timestamp() from allocation_ctx;
select throws_ok($$update app_private.idempotency_keys set response_payload='{}' where scope='funding.allocation'
 and idempotency_key='allocation-owner-only-completion-immutability'$$,'55000','ALLOCATION_COMPLETION_IMMUTABLE',
 'completed allocation response cannot be forged even by owner UPDATE');
select throws_ok($$delete from app_private.idempotency_keys where scope='funding.allocation'
 and idempotency_key='allocation-owner-only-completion-immutability'$$,'55000','ALLOCATION_COMPLETION_IMMUTABLE',
 'completed allocation proof cannot disappear after accepted effects');
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select throws_ok($$select public.confirm_funding_allocation('READ',null,null,null,null,null)$$,'42501','ALLOCATION_MEMBER_AUTH_REQUIRED','direct RPC without verified JWT subject is refused');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',member_id)::text,true) from allocation_ctx;
set local role authenticated;
select is(public.confirm_funding_allocation('READ',null,null,null,null,null)->>'revision','1','actual authenticated READ sees own revision only');
select is(public.confirm_funding_allocation('READ',null,null,null,null,null)->>'allocationId',(select allocation_id::text from allocation_ctx),'owner READ returns its exact sealed fixture ID');
select is(public.confirm_funding_allocation('READ',null,null,null,null,null)->'products','[]'::jsonb,'explicit zero selection remains zero');
set local timezone='Asia/Seoul';
select ok((public.confirm_funding_allocation('READ',null,null,null,null,null)->>'effectiveAt') ~ '[.][0-9]{6}Z$',
 'safe member read emits fixed UTC microseconds in another time zone');
select throws_ok($$select public.confirm_funding_allocation('READ',(select catalog_id from allocation_ctx),null,null,null,null)$$,
 '22023','INVALID_ALLOCATION_READ','READ cannot smuggle mutation parameters');
select throws_ok($$select public.confirm_funding_allocation('CONFIRM',null,null,null,null,null)$$,
 '22023','INVALID_ALLOCATION_CONFIRM','malformed confirm never becomes read success');
select throws_ok($$select public.confirm_funding_allocation('UNKNOWN',null,null,null,null,null)$$,
 '22023','INVALID_ALLOCATION_OPERATION','canonical operation is explicit');
select throws_ok($$select public.confirm_funding_allocation('CONFIRM',(select catalog_id from allocation_ctx),repeat('0',64),-1,'[]','allocation-bad-revision')$$,
 '22023','INVALID_ALLOCATION_CONFIRM','negative optimistic revision is refused before any writes');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',other_id)::text,true) from allocation_ctx;
set local role authenticated;
select is(public.confirm_funding_allocation('READ',null,null,null,null,null)->>'revision','0','another actual member cannot read the first owner revision');
select ok(public.confirm_funding_allocation('READ',null,null,null,null,null)->>'allocationId' is null,'another member has no adopted allocation ID');
select throws_ok($$select * from app_private.funding_allocation_originals$$,'42501',null,'direct private table access remains forbidden');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('role','service_role','sub',member_id)::text,true) from allocation_ctx;
set local role authenticated;
select throws_ok($$select public.confirm_funding_allocation('READ',null,null,null,null,null)$$,
 '42501','ALLOCATION_MEMBER_AUTH_REQUIRED','a subject with the wrong JWT role is refused');
reset role;
select is((select count(*)::integer from app_private.funding_allocation_originals where user_id in (select member_id from allocation_ctx union all select other_id from allocation_ctx)),1,
 'read/denied confirm probes created no additional allocation');
select * from finish();
rollback;
