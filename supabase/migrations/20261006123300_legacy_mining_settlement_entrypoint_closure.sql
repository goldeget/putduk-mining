begin;

-- The original 20260926094853 migration explicitly granted this legacy
-- caller-amount RPC to service_role. The later privilege floor closed its
-- table-write dependencies, but never removed that function EXECUTE grant.
-- Close the unused public entrypoint explicitly. Do not change the historical
-- function body/owner fixture path or the guarded private earned producer.
revoke all on function public.record_mining_settlement(
  uuid, uuid, timestamptz, timestamptz, bigint, public.currency_code, jsonb, text
) from public, anon, authenticated, service_role;

comment on function public.record_mining_settlement(
  uuid, uuid, timestamptz, timestamptz, bigint, public.currency_code, jsonb, text
) is 'Closed legacy caller-amount settlement entrypoint; no application/worker EXECUTE. Owner-only historical fixtures do not constitute earned provenance or activation.';

commit;
