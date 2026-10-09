begin;

-- The deferred trigger runs after the canonical definer returns to service_role.
-- Its complete seal read needs owner authority, with no raw relation grants or
-- callable member/service EXECUTE surface. Original provenance checks remain.
create or replace function app_private.validate_product_catalog_publication_trigger()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.product_catalog_receipts%rowtype;
begin
 -- The effective user is postgres in this closed trigger definer. Retain the
 -- original application service boundary through the session's actual SQL role;
 -- checking current_user here would silently skip all service receipt proof.
 -- Owner-only synthetic SQL fixtures keep their existing seam.
 if current_setting('role',true)='service_role' and new.status in ('APPROVED','PUBLISHED') then
  if new.status='PUBLISHED' then perform app_private.assert_published_product_catalog(new.id);
  else
   select * into r from app_private.product_catalog_receipts where catalog_id=new.id and state='APPROVED';
   if r.id is null or new.approved_by is distinct from r.actor_user_id or new.approved_at is distinct from r.created_at then
    raise exception using errcode='55000',message='PRODUCT_CATALOG_APPROVAL_RECEIPT_REQUIRED'; end if;
   perform app_private.assert_product_catalog_receipt(r.id);
  end if;
 end if;
 return new;
end;
$$;
revoke all on function app_private.validate_product_catalog_publication_trigger()
 from public,anon,authenticated,service_role;

commit;
