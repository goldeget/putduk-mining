begin;

-- Applied125000 stays immutable. The canonical service invoker delegates only
-- this authorized review read; revoked raw catalog/visual SELECT stays closed.
create function app_private.execute_product_catalog_review_read(p_catalog_id uuid,p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.product_catalog_versions%rowtype; r app_private.product_catalog_receipts%rowtype;
 role public.app_role; source jsonb; selected jsonb; catalogs jsonb;
begin
 if current_user<>'postgres' or current_setting('role',true) is distinct from 'service_role'
    or auth.role() is distinct from 'service_role' then
   raise exception using errcode='42501',message='PRODUCT_CATALOG_SERVICE_ROLE_REQUIRED'; end if;
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

revoke all on function app_private.execute_product_catalog_review_read(uuid,uuid,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function app_private.execute_product_catalog_review_read(uuid,uuid,uuid,text,text) to service_role;

create or replace function public.read_product_catalog_review_state(
 p_catalog_id uuid,p_actor uuid,p_admin_session_id uuid,p_auth_session_id text,p_verified_aal text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
begin
 if current_user<>'service_role' or auth.role() is distinct from 'service_role' then
   raise exception using errcode='42501',message='PRODUCT_CATALOG_SERVICE_ROLE_REQUIRED'; end if;
 return app_private.execute_product_catalog_review_read(p_catalog_id,p_actor,p_admin_session_id,p_auth_session_id,p_verified_aal);
end;
$$;
revoke all on function public.read_product_catalog_review_state(uuid,uuid,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.read_product_catalog_review_state(uuid,uuid,uuid,text,text) to service_role;

commit;
