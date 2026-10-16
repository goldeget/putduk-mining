begin;

-- The authoritative latest reader must select the latest approved due version
-- BEFORE expiration filtering. Otherwise invoker RLS can hide the newest
-- expired version and accidentally revive an older unexpired answer.
-- Keep this one narrow callable in the existing public RPC schema. No private
-- schema USAGE grant, extra helper ACL or broad raw-table grant is needed.
create or replace function public.read_member_faq() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb;actor uuid;
begin
 if current_user<>'postgres' or current_setting('role',true)is distinct from 'authenticated'
  or auth.role()is distinct from 'authenticated' or auth.uid()is null then return null;end if;
 actor:=auth.uid();
 if not exists(select 1 from public.user_profiles where user_id=actor)
  or not exists(select 1 from auth.users where id=actor and deleted_at is null
   and(banned_until is null or banned_until<=statement_timestamp()))
  or exists(select 1 from public.block_rules where user_id=actor and scope='ACCOUNT'
   and starts_at<=statement_timestamp()and(ends_at is null or ends_at>statement_timestamp()))then return null;end if;
 with latest as(
 select d.id as document_id,v.id,v.version,v.payload from public.trust_versions v join public.trust_documents d on d.id=v.document_id
 where d.slug='member-faq' and d.document_kind='faq' and d.visibility='AUTHENTICATED' and d.status='PUBLISHED'
  and d.published_at<=statement_timestamp() and v.effective_at<=statement_timestamp()
 order by v.version desc limit 1)
 select jsonb_build_object('contentId',document_id,'revisionId',id,'revision',version,'title',payload->>'title',
  'summary',payload->>'summary','locale',payload->>'locale','audience',payload->>'audience','entries',payload->'entries',
  'publishedAt',payload->>'publishedAt','expiresAt',payload->>'expiresAt','sourceDigest',payload->>'sourceDigest')
 into result from latest where coalesce((payload->>'expiresAt')::timestamptz,'infinity')>statement_timestamp();
 return result;
end;$$;
alter function public.read_member_faq()owner to postgres;
revoke all on function public.read_member_faq()from public,anon,authenticated,service_role;
grant execute on function public.read_member_faq()to authenticated;

-- The native reader bypasses RLS only inside its gated, fixed, read-only body.
-- Raw trust tables contain operator metadata. Expose the member FAQ exclusively
-- through that DTO; keep existing PUBLIC trust policies unchanged. This also
-- avoids RLS recursion, arbitrary PUBLIC date casts and expired-version fallback.
drop policy member_faq_version_read on public.trust_versions;
drop policy member_faq_document_read on public.trust_documents;

commit;
