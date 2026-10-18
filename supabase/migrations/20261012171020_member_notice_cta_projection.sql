-- DRAFT ONLY. Create a real migration with the pinned CLI after KYC validation
-- and schema-owner handoff. Never apply this evidence file to a remote project.
begin;

alter table public.notices
  add column cta_label_ko text,
  add column cta_route text,
  add column content_revision_id uuid references app_private.liveops_content_receipts(id);

alter table public.notices add constraint notices_cta_projection_shape check (
  (cta_label_ko is null and cta_route is null and content_revision_id is null)
  or (cta_label_ko is not null and cta_route is not null and content_revision_id is not null
    and char_length(btrim(cta_label_ko)) between 1 and 80
    and cta_route in ('/home','/start','/mining','/wallet','/wallet/deposit',
      '/wallet/withdraw','/products','/events','/notifications','/menu',
      '/menu/account','/menu/notifications','/support','/login','/about',
      '/faq','/status','/changelog','/'))
);

create function app_private.assert_notice_content_projection(
  p_notice public.notices, p_revision uuid
) returns void language plpgsql security invoker set search_path=pg_catalog as $$
declare r app_private.liveops_content_receipts%rowtype;
  previous app_private.liveops_content_receipts%rowtype;
begin
  select * into r from app_private.liveops_content_receipts where id=p_revision;
  select * into previous from app_private.liveops_content_receipts where id=r.previous_revision_id;
  if r.id is null or r.content_id is distinct from p_notice.id
    or r.kind is distinct from 'NOTICE' or r.state is distinct from 'PUBLISHED'
    or previous.kind is distinct from 'NOTICE' or previous.state is distinct from 'APPROVED'
    or previous.content_id is distinct from r.content_id or previous.digest is distinct from r.digest
    or row(p_notice.slug,p_notice.title_ko,p_notice.summary_ko,p_notice.body_markdown,
      p_notice.is_pinned,p_notice.published_at,p_notice.expires_at)
      is distinct from row(r.snapshot->>'slug',r.snapshot->>'title',r.snapshot->>'summary',
        r.snapshot->>'body',(r.snapshot->>'isPinned')::boolean,
        (r.snapshot->>'publishedAt')::timestamptz,(r.snapshot->>'expiresAt')::timestamptz)
    or row(p_notice.cta_label_ko,p_notice.cta_route,p_notice.content_revision_id)
      is distinct from row(r.snapshot->>'ctaLabel',r.snapshot->>'ctaRoute',r.id)
  then raise exception using errcode='55000',message='NOTICE_CONTENT_SOURCE_INVALID';end if;
  perform app_private.assert_liveops_receipt(r.id);
  perform app_private.assert_liveops_receipt(previous.id);
end;$$;

create function app_private.bind_notice_content_projection() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.liveops_content_receipts%rowtype;
begin
  -- Existing unsealed notices keep text-only behavior. No arbitrary CTA or
  -- private receipt is projected when there is no canonical CMS source.
  select * into r from app_private.liveops_content_receipts
    where content_id=new.id and kind='NOTICE' order by revision desc limit 1;
  if r.id is null then
    if new.cta_label_ko is not null or new.cta_route is not null or new.content_revision_id is not null then
      raise exception using errcode='55000',message='NOTICE_CONTENT_SOURCE_REQUIRED';
    end if;
    return new;
  end if;
  if new.status is distinct from 'PUBLISHED'::public.content_status
    or r.state is distinct from 'PUBLISHED'
    or (new.cta_label_ko is not null and new.cta_label_ko is distinct from r.snapshot->>'ctaLabel')
    or (new.cta_route is not null and new.cta_route is distinct from r.snapshot->>'ctaRoute')
    or (new.content_revision_id is not null and new.content_revision_id is distinct from r.id)
  then raise exception using errcode='55000',message='NOTICE_CONTENT_SOURCE_INVALID';end if;
  new.cta_label_ko:=r.snapshot->>'ctaLabel';
  new.cta_route:=r.snapshot->>'ctaRoute';
  new.content_revision_id:=r.id;
  perform app_private.assert_notice_content_projection(new,r.id);
  return new;
end;$$;

-- Backfill only exact source-linked currently published rows. Ambiguous or
-- inconsistent linked originals fail the migration transaction, not silently
-- publish a different CTA. Rows without a PUBLISHED CMS original stay null.
do $$
declare n public.notices%rowtype;r app_private.liveops_content_receipts%rowtype;
begin
  for n in select * from public.notices where status='PUBLISHED' loop
    select * into r from app_private.liveops_content_receipts
      where content_id=n.id and kind='NOTICE' order by revision desc limit 1;
    if r.id is null then continue;end if;
    if r.state is distinct from 'PUBLISHED' then
      raise exception using errcode='55000',message='NOTICE_CONTENT_SOURCE_INVALID';
    end if;
    n.cta_label_ko:=r.snapshot->>'ctaLabel';n.cta_route:=r.snapshot->>'ctaRoute';n.content_revision_id:=r.id;
    perform app_private.assert_notice_content_projection(n,r.id);
    update public.notices set cta_label_ko=n.cta_label_ko,cta_route=n.cta_route,
      content_revision_id=n.content_revision_id where id=n.id;
  end loop;
end;$$;

create function app_private.guard_notice_content_projection() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare r app_private.liveops_content_receipts%rowtype;
begin
  if old.content_revision_id is null then
    -- Legacy text may retain its old lifecycle, but cannot acquire arbitrary
    -- CTA/revision through an UPDATE that skips source projection.
    if tg_op='UPDATE' and (new.cta_label_ko is not null or new.cta_route is not null
      or new.content_revision_id is not null) then
      raise exception using errcode='55000',message='NOTICE_CONTENT_SOURCE_REQUIRED';
    end if;
    if tg_op='DELETE' then return old;end if;return new;
  end if;
  if tg_op='DELETE' then
    raise exception using errcode='55000',message='NOTICE_CONTENT_IMMUTABLE';
  end if;
  if to_jsonb(new)-array['status','updated_at','updated_by']
    is distinct from to_jsonb(old)-array['status','updated_at','updated_by'] then
    raise exception using errcode='55000',message='NOTICE_CONTENT_IMMUTABLE';
  end if;
  perform app_private.assert_notice_content_projection(new,old.content_revision_id);
  if new.status is distinct from old.status then
    select * into r from app_private.liveops_content_receipts
      where content_id=old.id and kind='NOTICE' order by revision desc limit 1;
    if old.status is distinct from 'PUBLISHED'::public.content_status
      or new.status is distinct from 'ARCHIVED'::public.content_status
      or r.state is distinct from 'ARCHIVED' or r.previous_revision_id is distinct from old.content_revision_id
      or r.digest is distinct from (select digest from app_private.liveops_content_receipts where id=old.content_revision_id)
      or new.updated_by is distinct from r.actor_id
    then raise exception using errcode='55000',message='NOTICE_CONTENT_LIFECYCLE_INVALID';end if;
    perform app_private.assert_liveops_receipt(r.id);
  end if;
  return new;
end;$$;

create trigger notice_content_source_bind before insert on public.notices
  for each row execute function app_private.bind_notice_content_projection();
create trigger notice_content_source_guard before update or delete on public.notices
  for each row execute function app_private.guard_notice_content_projection();

revoke all on function app_private.assert_notice_content_projection(public.notices,uuid),
  app_private.bind_notice_content_projection(),app_private.guard_notice_content_projection()
  from public,anon,authenticated,service_role;

-- Keep existing notices RLS/grants and CMS commands unchanged. Member readers
-- receive only the approved CTA and opaque revision UUID, never private receipts.
comment on column public.notices.content_revision_id is
  'Sealed NOTICE publication source; null retains legacy text-only notice behavior.';
commit;
