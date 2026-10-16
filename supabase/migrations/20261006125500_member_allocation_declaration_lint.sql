begin;

-- Strict lint only: explicit jsonb initialization and two unused declarations.
-- Canonical body, grants, clock, ownership and economic behavior stay exact.
create or replace function public.confirm_funding_allocation(
 p_operation text,p_catalog_id uuid,p_catalog_digest text,p_expected_revision bigint,
 p_products jsonb,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare owner_id uuid; latest app_private.funding_allocation_originals%rowtype;
 original app_private.funding_allocation_originals%rowtype; idem app_private.idempotency_keys%rowtype;
 catalog public.product_catalog_versions%rowtype; publication app_private.product_catalog_receipts%rowtype;
 policy app_private.economy_policy_published%rowtype; policy_receipt app_private.economy_policy_receipts%rowtype;
 item jsonb; products jsonb:='[]'::jsonb; available jsonb; configuration jsonb; tier jsonb;
 rule_id uuid; v_product_id uuid; seen uuid[]:=array[]::uuid[]; bps integer; total integer:=0;
 eligible_micro numeric; source_coverage text; now_at timestamptz; request_id uuid:=gen_random_uuid();
 audit_id uuid:=gen_random_uuid(); event_id uuid:=gen_random_uuid();
 request_hash text; input_digest text; snapshot jsonb; receipt jsonb; transition_id uuid;
 policy_revision integer:=0; previous_policy_receipt uuid; bound_transition boolean; original_audit public.audit_logs%rowtype;
begin
 -- Supabase's JWT role/subject are authoritative. No caller owner, money,
 -- rule/effect or effective-time argument can impersonate another member.
 owner_id:=auth.uid();
 if auth.role() is distinct from 'authenticated' or owner_id is null then
   raise exception using errcode='42501',message='ALLOCATION_MEMBER_AUTH_REQUIRED'; end if;
 if p_operation is null or p_operation not in ('READ','CONFIRM') then
   raise exception using errcode='22023',message='INVALID_ALLOCATION_OPERATION'; end if;
 if p_operation='READ' then
   if p_catalog_id is not null or p_catalog_digest is not null or p_expected_revision is not null
      or p_products is not null or p_idempotency_key is not null then
     raise exception using errcode='22023',message='INVALID_ALLOCATION_READ'; end if;
   select * into latest from app_private.funding_allocation_originals where user_id=owner_id order by revision desc limit 1;
   if latest.id is not null then
     if latest.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_allocation_snapshot(latest)) then
       raise exception using errcode='55000',message='ALLOCATION_RECEIPT_MISMATCH'; end if;
     perform app_private.assert_funding_engine_seal(latest.id,'FUNDING_ALLOCATION_CONFIRMED',owner_id,
       latest.input_digest,latest.audit_id,latest.source_event_id,app_private.funding_allocation_snapshot(latest));
   end if;
   select * into catalog from public.product_catalog_versions where status='PUBLISHED' and published_at<=clock_timestamp() order by version desc limit 1;
   if catalog.id is not null then
     perform app_private.assert_published_product_catalog(catalog.id);
     select * into publication from app_private.product_catalog_receipts where catalog_id=catalog.id and state='PUBLISHED';
     select coalesce(jsonb_agg(jsonb_build_object('productId',p.id,'nameKo',p.name_ko,
       'available',a.status='AVAILABLE' and a.available_from<=clock_timestamp() and (a.available_to is null or a.available_to>clock_timestamp()) and a.segment_key is null)
       order by p.display_order,p.id),'[]') into available
     from public.mining_products p join public.product_availability a on a.product_id=p.id where p.catalog_version_id=catalog.id;
   end if;
   return jsonb_build_object('schemaVersion',1,'revision',coalesce(latest.revision,0)::text,
     'allocationId',latest.id,'catalogId',latest.catalog_version_id,'catalogDigest',
       (select snapshot_digest from app_private.product_catalog_receipts where catalog_id=latest.catalog_version_id and state='PUBLISHED'),
     'effectiveAt',app_private.product_catalog_utc_instant(latest.effective_at),'products',coalesce((select jsonb_agg(value-'ruleVersionId') from jsonb_array_elements(latest.products)),'[]'),
     'availableProducts',coalesce(available,'[]'),'currentCatalog',case when catalog.id is null then null else jsonb_build_object('id',catalog.id,'digest',publication.snapshot_digest) end,
     'runtimeReady',to_regprocedure('app_private.apply_funding_allocation_boundary(uuid)') is not null);
 end if;
 if p_catalog_id is null or p_catalog_digest is null or p_catalog_digest !~ '^[a-f0-9]{64}$'
    or p_expected_revision is null or p_expected_revision<0 or p_expected_revision=9223372036854775807
    or jsonb_typeof(p_products) is distinct from 'array' or jsonb_array_length(p_products)>128
    or char_length(coalesce(p_idempotency_key,'')) not between 8 and 200 then
   raise exception using errcode='22023',message='INVALID_ALLOCATION_CONFIRM'; end if;
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception using errcode='25000',message='ALLOCATION_FRESH_SNAPSHOT_REQUIRED'; end if;
 -- Canonical financial member lock precedes row/audit locks and the sole clock.
 perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:'||owner_id::text,0));
 now_at:=clock_timestamp();
 request_hash:=app_private.funding_engine_digest(jsonb_build_object('owner',owner_id,'catalog',p_catalog_id,
   'catalog_digest',p_catalog_digest,'expected_revision',p_expected_revision::text,'products',p_products));
 select * into idem from app_private.idempotency_keys where scope='funding.allocation' and actor_id=owner_id and idempotency_key=p_idempotency_key for update;
 if idem.id is not null then
   if idem.request_hash is distinct from request_hash then raise exception using errcode='22023',message='IDEMPOTENCY_PAYLOAD_MISMATCH'; end if;
   if idem.status<>'COMPLETED' then raise exception using errcode='40001',message='ALLOCATION_IN_PROGRESS'; end if;
   select * into original from app_private.funding_allocation_originals where id=(idem.response_payload->>'allocationId')::uuid and user_id=owner_id;
   if original.id is null then raise exception using errcode='55000',message='ALLOCATION_RECEIPT_MISMATCH'; end if;
   select * into original_audit from public.audit_logs where id=original.audit_id;
   select * into publication from app_private.product_catalog_receipts
     where id=(original_audit.metadata->>'catalog_publication_receipt_id')::uuid
       and catalog_id=original.catalog_version_id and state='PUBLISHED';
   if original.input_digest is distinct from app_private.funding_engine_digest(app_private.funding_allocation_snapshot(original))
      or original_audit.metadata->>'idempotency_key' is distinct from p_idempotency_key
      or original_audit.metadata->>'expected_revision' is distinct from p_expected_revision::text
      or original.revision is distinct from p_expected_revision+1
      or original.catalog_version_id is distinct from p_catalog_id or publication.id is null
      or publication.snapshot_digest is distinct from p_catalog_digest
      or idem.response_status is distinct from 200 or idem.completed_at is null then
     raise exception using errcode='55000',message='ALLOCATION_RECEIPT_MISMATCH'; end if;
   perform app_private.assert_funding_engine_seal(original.id,'FUNDING_ALLOCATION_CONFIRMED',owner_id,
     original.input_digest,original.audit_id,original.source_event_id,app_private.funding_allocation_snapshot(original));
   perform app_private.assert_product_catalog_receipt(publication.id);
   transition_id:=(idem.response_payload->>'transitionId')::uuid;
   if to_regclass('app_private.funding_condition_originals') is null or transition_id is null then
     raise exception using errcode='55000',message='ALLOCATION_RECEIPT_MISMATCH'; end if;
   execute 'select exists(select 1 from app_private.funding_condition_originals where id=$1 and allocation_original_id=$2 and user_id=$3 and effective_at=$4)'
      into bound_transition using transition_id,original.id,owner_id,original.effective_at;
   if not bound_transition then raise exception using errcode='55000',message='ALLOCATION_RECEIPT_MISMATCH'; end if;
   execute 'select app_private.assert_allocation_boundary_complete($1,$2)' using original.id,transition_id;
   select coalesce(jsonb_agg(item.value-'ruleVersionId' order by item.ordinality),'[]') into products
     from jsonb_array_elements(original.products) with ordinality item(value,ordinality);
   receipt:=jsonb_build_object('schemaVersion',1,'allocationId',original.id,'revision',original.revision::text,
     'catalogId',original.catalog_version_id,'catalogDigest',publication.snapshot_digest,
     'effectiveAt',app_private.product_catalog_utc_instant(original.effective_at),'inputDigest',original.input_digest,
     'products',products,'transitionId',transition_id);
   if receipt is distinct from idem.response_payload or products is distinct from p_products then
     raise exception using errcode='55000',message='ALLOCATION_RECEIPT_MISMATCH'; end if;
   return receipt;
 end if;
 if to_regprocedure('app_private.apply_funding_allocation_boundary(uuid)') is null then
   raise exception using errcode='55000',message='ALLOCATION_RUNTIME_ADAPTER_REQUIRED'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.product-catalog',0));
 perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.economy-policy',0));
 select * into latest from app_private.funding_allocation_originals where user_id=owner_id order by revision desc limit 1;
 if coalesce(latest.revision,0) is distinct from p_expected_revision then
   raise exception using errcode='40001',message='ALLOCATION_REVISION_CHANGED'; end if;
 perform app_private.assert_published_product_catalog(p_catalog_id);
 select * into catalog from public.product_catalog_versions where id=p_catalog_id;
 select * into publication from app_private.product_catalog_receipts where catalog_id=p_catalog_id and state='PUBLISHED';
 if publication.snapshot_digest is distinct from p_catalog_digest or catalog.published_at>now_at
    or p_catalog_id is distinct from (select id from public.product_catalog_versions where status='PUBLISHED' and published_at<=now_at order by version desc limit 1) then
   raise exception using errcode='40001',message='ALLOCATION_CATALOG_CHANGED'; end if;
 -- Definer authority does not impersonate service_role. Verify exact original
 -- policy receipts directly, without relaxing its service-only public reader.
 select * into policy from app_private.economy_policy_published where effective_from<=now_at and (effective_until is null or effective_until>now_at);
 if policy.policy_id is null then raise exception using errcode='55000',message='ALLOCATION_POLICY_REQUIRED'; end if;
 if policy.state is distinct from 'PUBLISHED' or not isfinite(policy.published_at) or not isfinite(policy.effective_from)
    or policy.published_at>policy.effective_from or policy.published_at>now_at then
   raise exception using errcode='55000',message='ALLOCATION_POLICY_RECEIPT_MISMATCH'; end if;
 perform app_private.validate_economy_policy_config(policy.config);
 for policy_receipt in select * from app_private.economy_policy_receipts where policy_id=policy.policy_id order by revision loop
   policy_revision:=policy_revision+1;
   if policy_receipt.revision is distinct from policy_revision or policy_revision>4
      or policy_receipt.previous_revision_id is distinct from previous_policy_receipt
      or policy_receipt.state is distinct from (array['DRAFT','PREVIEWED','APPROVED','PUBLISHED'])[policy_revision] then
     raise exception using errcode='55000',message='ALLOCATION_POLICY_RECEIPT_MISMATCH'; end if;
   perform app_private.assert_economy_policy_receipt(policy_receipt.id);
   previous_policy_receipt:=policy_receipt.id;
 end loop;
 if policy_revision<>4 or previous_policy_receipt is distinct from policy.revision_id then
   raise exception using errcode='55000',message='ALLOCATION_POLICY_RECEIPT_MISMATCH'; end if;
 configuration:=policy.config;
 select coverage into source_coverage from public.money_source_summaries where user_id=owner_id;
 eligible_micro:=app_private.funding_principal_mining_eligible_micro(owner_id,now_at);
 if source_coverage is distinct from 'COMPLETE' then raise exception using errcode='55000',message='ALLOCATION_SOURCE_COVERAGE_REQUIRED'; end if;
 select value into tier from jsonb_array_elements(configuration->'tiers') where
   (value->>'minimumPrincipalKrw')::numeric*1000000<=eligible_micro
   and (value->>'maximumPrincipalKrw' is null or (value->>'maximumPrincipalKrw')::numeric*1000000>=eligible_micro);
 if jsonb_array_length(p_products)>0 and (tier is null or jsonb_array_length(p_products)>(tier->>'slots')::integer) then
   raise exception using errcode='55000',message='ALLOCATION_SLOT_LIMIT_EXCEEDED'; end if;
 for item in select value from jsonb_array_elements(p_products) loop
   if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2
      or not item ?& array['productId','allocationBps'] or jsonb_typeof(item->'productId') is distinct from 'string'
      or jsonb_typeof(item->'allocationBps') is distinct from 'string'
      or coalesce(item->>'productId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(item->>'allocationBps','') !~ '^[1-9][0-9]{0,4}$' then
     raise exception using errcode='22023',message='INVALID_ALLOCATION_PRODUCTS'; end if;
   v_product_id:=(item->>'productId')::uuid;
   if v_product_id=any(seen) then raise exception using errcode='22023',message='ALLOCATION_DUPLICATE_PRODUCT'; end if;
   seen:=array_append(seen,v_product_id); bps:=(item->>'allocationBps')::integer;
   if bps>(configuration#>>'{allocation,maximumPerProductBps}')::integer then
     raise exception using errcode='22023',message='ALLOCATION_LIMIT_EXCEEDED'; end if;
   select r.id into rule_id from public.product_rule_versions r join public.mining_products p on p.id=r.product_id
     join public.product_availability a on a.product_id=p.id
     where p.id=v_product_id and p.catalog_version_id=p_catalog_id and r.rule_payload='{}' and r.approved_by is not null
       and r.effective_at<=now_at and r.retired_at is null and a.status='AVAILABLE' and a.segment_key is null
       and a.available_from<=now_at and (a.available_to is null or a.available_to>now_at);
   if rule_id is null then raise exception using errcode='55000',message='ALLOCATION_PRODUCT_UNAVAILABLE'; end if;
   products:=products||jsonb_build_array(jsonb_build_object('productId',v_product_id,'ruleVersionId',rule_id,'allocationBps',bps::text)); total:=total+bps;
 end loop;
 if total>(configuration#>>'{allocation,maximumTotalBps}')::integer then raise exception using errcode='22023',message='ALLOCATION_LIMIT_EXCEEDED'; end if;
 original.id:=gen_random_uuid(); original.user_id:=owner_id; original.revision:=p_expected_revision+1;
 original.catalog_version_id:=p_catalog_id; original.products:=products; original.effects:='{}'; original.effective_at:=now_at;
 original.audit_id:=audit_id; original.source_event_id:=event_id; original.recorded_at:=now_at;
 snapshot:=app_private.funding_allocation_snapshot(original); input_digest:=app_private.funding_engine_digest(snapshot); original.input_digest:=input_digest;
 insert into public.audit_logs(id,actor_user_id,action,target_type,target_id,reason,request_id,after_state,metadata,created_at)
 values(audit_id,owner_id,'FUNDING_ALLOCATION_CONFIRMED','FUNDING_ENGINE_V1',original.id::text,'회원 상품 배분 확인',request_id,snapshot,
   jsonb_build_object('input_digest',input_digest,'command_version',1,'idempotency_key',p_idempotency_key,
    'expected_revision',p_expected_revision::text,'catalog_publication_receipt_id',publication.id),now_at);
 insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,payload,correlation_id,request_id,idempotency_key,available_at,last_error_code,occurred_at,created_at)
 values(event_id,'FUNDING_ALLOCATION_CONFIRMED.v1',1,'funding_engine_v1',original.id,owner_id,
   jsonb_build_object('user_id',owner_id,'audit_id',audit_id,'input_digest',input_digest),request_id,request_id,
   'funding:'||original.id::text||':seal','infinity','ALLOCATION_RECEIPT_ONLY',now_at,now_at);
 insert into app_private.funding_allocation_originals(id,user_id,revision,catalog_version_id,products,effects,effective_at,audit_id,source_event_id,input_digest,recorded_at)
 values(original.id,owner_id,original.revision,p_catalog_id,products,'{}',now_at,audit_id,event_id,input_digest,now_at);
 perform app_private.assert_funding_engine_seal(original.id,'FUNDING_ALLOCATION_CONFIRMED',owner_id,input_digest,audit_id,event_id,snapshot);
 -- The reviewed runtime adapter receives only the sealed original ID. Missing
 -- adapter or unsupported financial/source history rolls the entire command back.
 execute 'select app_private.apply_funding_allocation_boundary($1)' into transition_id using original.id;
 if transition_id is null then raise exception using errcode='55000',message='ALLOCATION_TRANSITION_REQUIRED'; end if;
 receipt:=jsonb_build_object('schemaVersion',1,'allocationId',original.id,'revision',original.revision::text,
   'catalogId',p_catalog_id,'catalogDigest',p_catalog_digest,'effectiveAt',app_private.product_catalog_utc_instant(now_at),'inputDigest',input_digest,
   'products',p_products,'transitionId',transition_id);
 insert into app_private.idempotency_keys(scope,actor_id,idempotency_key,request_hash,status,response_status,response_payload,completed_at)
 values('funding.allocation',owner_id,p_idempotency_key,request_hash,'COMPLETED',200,receipt,clock_timestamp());
 return receipt;
end;
$$;
revoke all on function public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.confirm_funding_allocation(text,uuid,text,bigint,jsonb,text) to authenticated;

commit;
