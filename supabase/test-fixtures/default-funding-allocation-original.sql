-- SYNTHETIC postgres-owner-only reference fixture for the DISCONNECTED private
-- engine foundation. The repository has NO production catalog publication /
-- member allocation producer. These sealed originals prove input validation in
-- isolation; they are never a service/member grant, default assignment or proof
-- of an implemented allocation UX. Actual deposit/posting commands in tests are
-- real, and are separately identified in the test file.
create function pg_temp.plant_default_funding_allocation_original(p_user uuid,p_admin uuid,p_published boolean default true)
returns uuid language plpgsql security invoker set search_path=pg_catalog as $$
declare v_catalog uuid:=gen_random_uuid(); v_product uuid:=gen_random_uuid(); v_rule uuid:=gen_random_uuid();
 v_a app_private.funding_allocation_originals%rowtype; v_snapshot jsonb; v_request uuid:=gen_random_uuid();
 v_instant timestamptz:=clock_timestamp(); v_version integer;
begin
 if current_user<>'postgres' then raise exception using errcode='42501',message='FUNDING_ALLOCATION_FIXTURE_OWNER_ONLY'; end if;
 select coalesce(max(version),0)+1 into v_version from public.product_catalog_versions;
 insert into public.product_catalog_versions(id,version,status,snapshot_date,methodology,source_references,content_digest,proposed_by)
 values(v_catalog,v_version,'DRAFT',v_instant::date,'owner-only synthetic neutral foundation fixture',
   '[{"kind":"SYNTHETIC_LOCAL_TEST_ONLY"}]',app_private.funding_engine_digest(jsonb_build_object('fixture_id',v_catalog)),
   'SYNTHETIC_LOCAL_TEST_ONLY');
 insert into public.mining_products(id,catalog_version_id,world_id,code,slug,category,name_ko,name_en,description_ko,display_order)
 values(v_product,v_catalog,(select id from public.asset_worlds order by id limit 1),'REF_NEUTRAL','ref-neutral','GOLD',
   '시험 원본','Reference fixture','운영 상품이 아닌 로컬 시험 원본',1);
 insert into public.product_rule_versions(id,product_id,version,effective_at,rule_payload,approved_by)
 values(v_rule,v_product,1,v_instant-interval '1 second','{}',p_admin);
 insert into public.product_availability(product_id,status,available_from)
 values(v_product,'AVAILABLE',v_instant-interval '1 second');
 if p_published then
   update public.product_catalog_versions set status='APPROVED',approved_by=p_admin,approved_at=v_instant-interval '1 second' where id=v_catalog;
   update public.product_catalog_versions set status='PUBLISHED',published_at=v_instant-interval '1 second' where id=v_catalog;
 end if;
 v_a.id:=gen_random_uuid(); v_a.user_id:=p_user; v_a.revision:=1; v_a.catalog_version_id:=v_catalog;
 v_a.products:=jsonb_build_array(jsonb_build_object('productId',v_product,'ruleVersionId',v_rule,'allocationBps','10000'));
 v_a.effects:='{}'; v_a.effective_at:=v_instant; v_a.audit_id:=gen_random_uuid(); v_a.source_event_id:=gen_random_uuid();
 v_a.recorded_at:=clock_timestamp(); v_snapshot:=app_private.funding_allocation_snapshot(v_a);
 v_a.input_digest:=app_private.funding_engine_digest(v_snapshot);
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata)
 values(v_a.audit_id,p_user,'FUNDING_ALLOCATION_CONFIRMED','FUNDING_ENGINE_V1',v_a.id::text,
   'SYNTHETIC postgres-only allocation original; no member producer exists',v_request,v_snapshot,
   jsonb_build_object('input_digest',v_a.input_digest,'fixture_provenance','POSTGRES_OWNER_ONLY_REFERENCE'));
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,
   correlation_id,request_id,idempotency_key,available_at,last_error_code)
 values(v_a.source_event_id,'FUNDING_ALLOCATION_CONFIRMED.v1',1,'funding_engine_v1',v_a.id,p_user,
   jsonb_build_object('user_id',p_user,'audit_id',v_a.audit_id,'input_digest',v_a.input_digest),gen_random_uuid(),v_request,
   'funding:'||v_a.id::text||':seal','infinity','SYNTHETIC_LOCAL_TEST_ONLY');
 insert into app_private.funding_allocation_originals select v_a.*;
 return v_a.id;
end;
$$;
revoke all on function pg_temp.plant_default_funding_allocation_original(uuid,uuid,boolean) from public,anon,authenticated,service_role;
