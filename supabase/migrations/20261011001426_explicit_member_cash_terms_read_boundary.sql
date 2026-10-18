begin;

-- Make the reviewed member-only terms projection an explicit callable boundary.
-- The former owner view intentionally published these same eight fields. This
-- hardening grants no raw private-table access and installs no activation.
create function app_private.read_member_cash_event_terms()
returns table (
  event_id uuid,
  content_revision_id uuid,
  terms_version integer,
  terms_ko text,
  cash_terms_digest text,
  reward_krw text,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql stable security definer set search_path = pg_catalog
as $$
begin
  -- Direct calls must enforce the same boundary as the public view. Missing
  -- identity and disabled configuration retain the existing empty-read result.
  if current_user <> 'postgres'
    or current_setting('role', true) is distinct from 'authenticated'
    or auth.role() is distinct from 'authenticated'
    or auth.uid() is null
  then
    return;
  end if;

  return query
  select
    (p.snapshot->'reward'->>'event_id')::uuid,
    p.content_revision_id,
    p.terms_version,
    p.terms_ko,
    p.digest,
    p.snapshot->'reward'->>'amount_atomic',
    p.starts_at,
    p.ends_at
  from app_private.local_cash_policies as p
  join public.events as ce
    on ce.id = (p.snapshot->'reward'->>'event_id')::uuid
  where p.kind = 'EVENT'
    and ce.status in ('SCHEDULED', 'LIVE', 'ENDED')
    and ce.published_at <= statement_timestamp()
    and p.starts_at <= statement_timestamp()
    and p.ends_at > statement_timestamp()
    and exists (
      select 1
      from app_private.local_cash_configuration as configuration
      where configuration.singleton
        and configuration.enabled
        and configuration.project_identity = 'putduk-mining-review-r2-20261009-e-200642'
    );
end;
$$;

alter function app_private.read_member_cash_event_terms() owner to postgres;
revoke all on function app_private.read_member_cash_event_terms()
  from public, anon, authenticated, service_role;
grant execute on function app_private.read_member_cash_event_terms() to authenticated;

create or replace view public.member_cash_event_terms
with (security_invoker = true, security_barrier = true)
as select * from app_private.read_member_cash_event_terms();
alter view public.member_cash_event_terms owner to postgres;
revoke all on public.member_cash_event_terms from public, anon, authenticated, service_role;
grant select on public.member_cash_event_terms to authenticated;

commit;
