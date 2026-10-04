begin;

-- Private policy data only. No money command, public table grant, managed Auth
-- schema change, SECURITY DEFINER addition or existing migration replacement.
create table app_private.economy_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_version text not null unique,
  manifest_text text not null,
  manifest_digest text not null,
  config jsonb not null,
  config_digest text not null,
  approval_evidence text not null,
  approval_evidence_digest text not null check (approval_evidence_digest ~ '^[a-f0-9]{64}$'),
  is_reference boolean not null default false,
  created_audit_id uuid not null unique references public.audit_logs(id)
    deferrable initially deferred,
  created_at timestamptz not null default clock_timestamp(),
  constraint economy_policy_version_name check (policy_version ~ '^[A-Z][A-Z0-9._-]{2,99}$'),
  constraint economy_policy_manifest_length check (octet_length(manifest_text) between 2 and 131072),
  constraint economy_policy_manifest_digest check (manifest_digest =
    encode(extensions.digest(convert_to(manifest_text, 'UTF8'), 'sha256'), 'hex')),
  constraint economy_policy_manifest_semantics check (manifest_text::jsonb = config),
  constraint economy_policy_config_digest check (config_digest =
    encode(extensions.digest(convert_to(config::text, 'UTF8'), 'sha256'), 'hex')),
  constraint economy_policy_config_identity check (jsonb_typeof(config) = 'object'
    and config->>'policyVersion' = policy_version
    and config->>'approvalEvidence' = approval_evidence)
);
create unique index economy_policy_one_reference
  on app_private.economy_policy_versions(is_reference) where is_reference;

create table app_private.economy_policy_receipts (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references app_private.economy_policy_versions(id),
  revision integer not null check (revision between 1 and 4),
  state text not null check (state in ('DRAFT', 'PREVIEWED', 'APPROVED', 'PUBLISHED')),
  previous_revision_id uuid references app_private.economy_policy_receipts(id),
  effective_from timestamptz,
  predecessor_publication_id uuid,
  config_digest text not null check (config_digest ~ '^[a-f0-9]{64}$'),
  audit_id uuid not null unique references public.audit_logs(id) deferrable initially deferred,
  outbox_id uuid not null unique references public.outbox_events(id) deferrable initially deferred,
  actor_user_id uuid references auth.users(id),
  admin_session_id uuid references public.admin_sessions(id),
  step_up_grant_id uuid references public.admin_step_up_grants(id),
  approval_kind text not null check (approval_kind in ('OWNER_DOCUMENT', 'ADMIN_STEP_UP')),
  created_at timestamptz not null default clock_timestamp(),
  unique (policy_id, revision),
  unique (policy_id, state),
  constraint economy_policy_revision_state check (
    (revision = 1 and state = 'DRAFT' and previous_revision_id is null and effective_from is null
      and predecessor_publication_id is null)
    or (revision = 2 and state = 'PREVIEWED' and previous_revision_id is not null
      and effective_from is not null and isfinite(effective_from))
    or (revision = 3 and state = 'APPROVED' and previous_revision_id is not null
      and effective_from is not null and isfinite(effective_from))
    or (revision = 4 and state = 'PUBLISHED' and previous_revision_id is not null
      and effective_from is not null and isfinite(effective_from))),
  constraint economy_policy_approval_proof check (
    (approval_kind = 'OWNER_DOCUMENT' and actor_user_id is null
      and admin_session_id is null and step_up_grant_id is null)
    or (approval_kind = 'ADMIN_STEP_UP' and actor_user_id is not null
      and admin_session_id is not null and step_up_grant_id is not null))
);

create table app_private.economy_policy_publications (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null unique references app_private.economy_policy_versions(id),
  receipt_id uuid not null unique references app_private.economy_policy_receipts(id),
  effective_from timestamptz not null unique check (isfinite(effective_from)),
  published_at timestamptz not null default clock_timestamp(),
  check (effective_from >= published_at)
);
alter table app_private.economy_policy_receipts add constraint economy_policy_predecessor_fk
  foreign key (predecessor_publication_id) references app_private.economy_policy_publications(id);

alter table app_private.economy_policy_versions enable row level security;
alter table app_private.economy_policy_versions force row level security;
alter table app_private.economy_policy_receipts enable row level security;
alter table app_private.economy_policy_receipts force row level security;
alter table app_private.economy_policy_publications enable row level security;
alter table app_private.economy_policy_publications force row level security;
revoke all on app_private.economy_policy_versions, app_private.economy_policy_receipts,
  app_private.economy_policy_publications from public, anon, authenticated, service_role;
grant select, insert on app_private.economy_policy_versions, app_private.economy_policy_receipts,
  app_private.economy_policy_publications to service_role;

-- BEGIN GENERATED OWNER POLICY SEED
-- Exact UTF-8 source: docs/product/economy-v1-approved-2026-10-03.json
-- manifest SHA256: 158c81e91923ba31f57b457ae3a33bc4092455e4abe2a2c888d5b5d2bc33b9e0
-- approval evidence SHA256: 15ab269dbed2cb3c1da0ad9c8f0f89e787b5a19ecc48f28255d7f09e2b9c5901
-- Base64 protects original bytes from checkout line-ending normalization.
do $owner_policy_seed$
declare
  v_manifest text := convert_from(decode('ewogICJzY2hlbWFWZXJzaW9uIjogMSwKICAicG9saWN5VmVyc2lvbiI6ICJQVVREVUstTUlOSU5HLVYxLTIwMjYtMTAtMDMiLAogICJhcHByb3ZhbFN0YXRlIjogIk9XTkVSX0FQUFJPVkVEIiwKICAiYXBwcm92YWxFdmlkZW5jZSI6ICJkb2NzL3Byb2R1Y3QvRUNPTk9NWS1WMS1VU0VSLUFQUFJPVkFMLTIwMjYtMTAtMDMubWQiLAogICJtaW5pbXVtUHJpbmNpcGFsS3J3IjogIjEwMDAwMCIsCiAgImN5Y2xlRGF5cyI6IDMwLAogICJiYXNlQ3ljbGVSYXRlQnBzIjogMTUwMCwKICAibWljcm9LcndQZXJLcnciOiAiMTAwMDAwMCIsCiAgImNhcnJ5QWNyb3NzQ3ljbGVzIjogdHJ1ZSwKICAidGllcnMiOiBbCiAgICB7CiAgICAgICJjb2RlIjogIkwxIiwKICAgICAgIm5hbWUiOiAiU1RBUlRFUiIsCiAgICAgICJtaW5pbXVtUHJpbmNpcGFsS3J3IjogIjEwMDAwMCIsCiAgICAgICJtYXhpbXVtUHJpbmNpcGFsS3J3IjogIjQ5OTk5OSIsCiAgICAgICJyZXRlbnRpb25Cb251c0JwcyI6IDE1MDAsCiAgICAgICJzbG90cyI6IDEKICAgIH0sCiAgICB7CiAgICAgICJjb2RlIjogIkwyIiwKICAgICAgIm5hbWUiOiAiU1RBUlRFUisiLAogICAgICAibWluaW11bVByaW5jaXBhbEtydyI6ICI1MDAwMDAiLAogICAgICAibWF4aW11bVByaW5jaXBhbEtydyI6ICI5OTk5OTkiLAogICAgICAicmV0ZW50aW9uQm9udXNCcHMiOiAxNjAwLAogICAgICAic2xvdHMiOiAxCiAgICB9LAogICAgewogICAgICAiY29kZSI6ICJMMyIsCiAgICAgICJuYW1lIjogIkFDVElWRSIsCiAgICAgICJtaW5pbXVtUHJpbmNpcGFsS3J3IjogIjEwMDAwMDAiLAogICAgICAibWF4aW11bVByaW5jaXBhbEtydyI6ICIyOTk5OTk5IiwKICAgICAgInJldGVudGlvbkJvbnVzQnBzIjogMTcwMCwKICAgICAgInNsb3RzIjogMgogICAgfSwKICAgIHsKICAgICAgImNvZGUiOiAiTDQiLAogICAgICAibmFtZSI6ICJBRFZBTkNFRCIsCiAgICAgICJtaW5pbXVtUHJpbmNpcGFsS3J3IjogIjMwMDAwMDAiLAogICAgICAibWF4aW11bVByaW5jaXBhbEtydyI6ICI0OTk5OTk5IiwKICAgICAgInJldGVudGlvbkJvbnVzQnBzIjogMTgwMCwKICAgICAgInNsb3RzIjogMgogICAgfSwKICAgIHsKICAgICAgImNvZGUiOiAiTDUiLAogICAgICAibmFtZSI6ICJQUk8iLAogICAgICAibWluaW11bVByaW5jaXBhbEtydyI6ICI1MDAwMDAwIiwKICAgICAgIm1heGltdW1QcmluY2lwYWxLcnciOiAiOTk5OTk5OSIsCiAgICAgICJyZXRlbnRpb25Cb251c0JwcyI6IDE5MDAsCiAgICAgICJzbG90cyI6IDIKICAgIH0sCiAgICB7CiAgICAgICJjb2RlIjogIkw2IiwKICAgICAgIm5hbWUiOiAiUFJFTUlVTSIsCiAgICAgICJtaW5pbXVtUHJpbmNpcGFsS3J3IjogIjEwMDAwMDAwIiwKICAgICAgIm1heGltdW1QcmluY2lwYWxLcnciOiAiMjk5OTk5OTkiLAogICAgICAicmV0ZW50aW9uQm9udXNCcHMiOiAyMDAwLAogICAgICAic2xvdHMiOiAzCiAgICB9LAogICAgewogICAgICAiY29kZSI6ICJMNyIsCiAgICAgICJuYW1lIjogIlBSRU1JVU0rIiwKICAgICAgIm1pbmltdW1QcmluY2lwYWxLcnciOiAiMzAwMDAwMDAiLAogICAgICAibWF4aW11bVByaW5jaXBhbEtydyI6ICI0OTk5OTk5OSIsCiAgICAgICJyZXRlbnRpb25Cb251c0JwcyI6IDIxMDAsCiAgICAgICJzbG90cyI6IDMKICAgIH0sCiAgICB7CiAgICAgICJjb2RlIjogIkw4IiwKICAgICAgIm5hbWUiOiAiRUxJVEUiLAogICAgICAibWluaW11bVByaW5jaXBhbEtydyI6ICI1MDAwMDAwMCIsCiAgICAgICJtYXhpbXVtUHJpbmNpcGFsS3J3IjogIjk5OTk5OTk5IiwKICAgICAgInJldGVudGlvbkJvbnVzQnBzIjogMjIwMCwKICAgICAgInNsb3RzIjogMwogICAgfSwKICAgIHsKICAgICAgImNvZGUiOiAiTDkiLAogICAgICAibmFtZSI6ICJVTFRSQSIsCiAgICAgICJtaW5pbXVtUHJpbmNpcGFsS3J3IjogIjEwMDAwMDAwMCIsCiAgICAgICJtYXhpbXVtUHJpbmNpcGFsS3J3IjogIjI5OTk5OTk5OSIsCiAgICAgICJyZXRlbnRpb25Cb251c0JwcyI6IDIzMDAsCiAgICAgICJzbG90cyI6IDQKICAgIH0sCiAgICB7CiAgICAgICJjb2RlIjogIkwxMCIsCiAgICAgICJuYW1lIjogIlVMVFJBKyIsCiAgICAgICJtaW5pbXVtUHJpbmNpcGFsS3J3IjogIjMwMDAwMDAwMCIsCiAgICAgICJtYXhpbXVtUHJpbmNpcGFsS3J3IjogIjQ5OTk5OTk5OSIsCiAgICAgICJyZXRlbnRpb25Cb251c0JwcyI6IDI0MDAsCiAgICAgICJzbG90cyI6IDQKICAgIH0sCiAgICB7CiAgICAgICJjb2RlIjogIkwxMSIsCiAgICAgICJuYW1lIjogIlBSSVZBVEUiLAogICAgICAibWluaW11bVByaW5jaXBhbEtydyI6ICI1MDAwMDAwMDAiLAogICAgICAibWF4aW11bVByaW5jaXBhbEtydyI6ICI5OTk5OTk5OTkiLAogICAgICAicmV0ZW50aW9uQm9udXNCcHMiOiAyNTAwLAogICAgICAic2xvdHMiOiA1CiAgICB9LAogICAgewogICAgICAiY29kZSI6ICJMMTIiLAogICAgICAibmFtZSI6ICJQUklWQVRFKyIsCiAgICAgICJtaW5pbXVtUHJpbmNpcGFsS3J3IjogIjEwMDAwMDAwMDAiLAogICAgICAibWF4aW11bVByaW5jaXBhbEtydyI6ICIyOTk5OTk5OTk5IiwKICAgICAgInJldGVudGlvbkJvbnVzQnBzIjogMjUwMCwKICAgICAgInNsb3RzIjogNQogICAgfSwKICAgIHsKICAgICAgImNvZGUiOiAiTDEzIiwKICAgICAgIm5hbWUiOiAiUFJJVkFURSBFTElURSIsCiAgICAgICJtaW5pbXVtUHJpbmNpcGFsS3J3IjogIjMwMDAwMDAwMDAiLAogICAgICAibWF4aW11bVByaW5jaXBhbEtydyI6ICI0OTk5OTk5OTk5IiwKICAgICAgInJldGVudGlvbkJvbnVzQnBzIjogMjUwMCwKICAgICAgInNsb3RzIjogNQogICAgfSwKICAgIHsKICAgICAgImNvZGUiOiAiTDE0IiwKICAgICAgIm5hbWUiOiAiUFJJVkFURSBFTElURSsiLAogICAgICAibWluaW11bVByaW5jaXBhbEtydyI6ICI1MDAwMDAwMDAwIiwKICAgICAgIm1heGltdW1QcmluY2lwYWxLcnciOiBudWxsLAogICAgICAicmV0ZW50aW9uQm9udXNCcHMiOiAyNTAwLAogICAgICAic2xvdHMiOiA1CiAgICB9CiAgXSwKICAicHJvZHVjdE11bHRpcGxpZXIiOiB7CiAgICAiZGVmYXVsdEJwcyI6IDEwMDAwLAogICAgIm1pbmltdW1CcHMiOiA5MDAwLAogICAgIm1heGltdW1CcHMiOiAxMTAwMAogIH0sCiAgImFsbG9jYXRpb24iOiB7CiAgICAibWF4aW11bVRvdGFsQnBzIjogMTAwMDAsCiAgICAibWF4aW11bVBlclByb2R1Y3RCcHMiOiAxMDAwMCwKICAgICJjYXBhY2l0eVNjb3BlIjogIkdMT0JBTF9DWUNMRSIKICB9LAogICJjYW1wYWlnbiI6IHsKICAgICJkZWZhdWx0Q2FwYWNpdHlCb29zdEJwcyI6IDAsCiAgICAibWF4aW11bVNpbmdsZUNhcGFjaXR5Qm9vc3RCcHMiOiAxMDAwLAogICAgIm1heGltdW1Db21iaW5lZENhcGFjaXR5Qm9vc3RCcHMiOiAyMDAwLAogICAgImRlZmF1bHRTcGVlZE11bHRpcGxpZXJCcHMiOiAxMDAwMCwKICAgICJtYXhpbXVtU2luZ2xlU3BlZWRNdWx0aXBsaWVyQnBzIjogMTI1MDAsCiAgICAibWF4aW11bUNvbWJpbmVkU3BlZWRNdWx0aXBsaWVyQnBzIjogMTUwMDAKICB9LAogICJ1c2VyT3ZlcnJpZGUiOiB7CiAgICAiZGVmYXVsdE11bHRpcGxpZXJCcHMiOiAxMDAwMCwKICAgICJtaW5pbXVtTXVsdGlwbGllckJwcyI6IDgwMDAsCiAgICAibWF4aW11bU11bHRpcGxpZXJCcHMiOiAxMjAwMCwKICAgICJyZXF1aXJlc0F1ZGl0UmVhc29uU3RlcFVwIjogdHJ1ZQogIH0sCiAgIndpdGhkcmF3YWxTb3VyY2VzIjogewogICAgIm1pbmluZ1Jld2FyZCI6ICJNSU5JTkdfUkVXQVJEIiwKICAgICJwcmluY2lwYWxSZWNvdmVyeSI6ICJQUklOQ0lQQUwiLAogICAgImF1dG9tYXRpY1NvdXJjZUZhbGxiYWNrIjogZmFsc2UsCiAgICAibWl4ZWRTb3VyY2VzIjogZmFsc2UsCiAgICAibWluaW5nUmV3YXJkTXVzdEJlVmVyaWZpZWQiOiB0cnVlLAogICAgImJvbnVzIjogIlNFUEFSQVRFX0JPTlVTX1BPTElDWSIKICB9LAogICJwbGF0Zm9ybUZlZXNLcnciOiB7CiAgICAia3J3RGVwb3NpdCI6ICIwIiwKICAgICJ1c2R0RGVwb3NpdENvbnZlcnNpb24iOiAiMCIsCiAgICAibWluaW5nIjogIjAiLAogICAgImtyd01pbmluZ1Jld2FyZFdpdGhkcmF3YWwiOiAiMCIsCiAgICAicHJpbmNpcGFsUmVjb3ZlcnkiOiAiMCIKICB9LAogICJmdXR1cmVGZWVTb3VyY2UiOiAiU0FNRV9XSVRIRFJBV0FMX1NPVVJDRV9PTkxZIiwKICAidXNkdCI6IHsKICAgICJuZXR3b3JrIjogIlRSQzIwIiwKICAgICJjcmVkaXRDdXJyZW5jeSI6ICJLUlciLAogICAgInVzZXJVc2R0V2FsbGV0IjogZmFsc2UsCiAgICAibWluaW5nUmV3YXJkQ3VycmVuY3kiOiAiS1JXIiwKICAgICJuZXR3b3JrRmVlSW5jbHVkZWRJblByaW5jaXBhbCI6IGZhbHNlLAogICAgImFjdHVhbFJlY2VpcHRSZXF1aXJlZCI6IHRydWUKICB9Cn0K', 'base64'), 'UTF8');
  v_config jsonb := v_manifest::jsonb;
  v_manifest_digest text := encode(extensions.digest(convert_to(v_manifest, 'UTF8'), 'sha256'), 'hex');
  v_config_digest text := encode(extensions.digest(convert_to(v_config::text, 'UTF8'), 'sha256'), 'hex');
  v_now timestamptz := clock_timestamp();
  v_policy uuid := gen_random_uuid();
  v_first_audit uuid := gen_random_uuid();
  v_audit uuid;
  v_receipt uuid;
  v_previous uuid;
  v_event uuid;
  v_request uuid;
  v_state text;
  v_after jsonb;
  v_revision integer;
begin
  if v_manifest_digest <> '158c81e91923ba31f57b457ae3a33bc4092455e4abe2a2c888d5b5d2bc33b9e0'
    or v_config->>'policyVersion' <> 'PUTDUK-MINING-V1-2026-10-03' then
    raise exception 'ECONOMY_OWNER_SEED_DIGEST_MISMATCH';
  end if;
  insert into app_private.economy_policy_versions(id, policy_version, manifest_text,
    manifest_digest, config, config_digest, approval_evidence, approval_evidence_digest,
    is_reference, created_audit_id, created_at)
  values (v_policy, v_config->>'policyVersion', v_manifest, v_manifest_digest, v_config,
    v_config_digest, v_config->>'approvalEvidence', '15ab269dbed2cb3c1da0ad9c8f0f89e787b5a19ecc48f28255d7f09e2b9c5901', true, v_first_audit, v_now);
  for v_revision in 1..4 loop
    v_state := (array['DRAFT', 'PREVIEWED', 'APPROVED', 'PUBLISHED'])[v_revision];
    v_audit := case when v_revision = 1 then v_first_audit else gen_random_uuid() end;
    v_receipt := gen_random_uuid();
    v_event := gen_random_uuid();
    v_request := gen_random_uuid();
    v_after := jsonb_build_object('policyId', v_policy, 'policyVersion', v_config->>'policyVersion',
      'revisionId', v_receipt, 'revision', v_revision, 'state', v_state,
      'configDigest', v_config_digest, 'manifestDigest', v_manifest_digest,
      'approvalEvidence', v_config->>'approvalEvidence', 'approvalEvidenceDigest', '15ab269dbed2cb3c1da0ad9c8f0f89e787b5a19ecc48f28255d7f09e2b9c5901',
      'effectiveFrom', case when v_revision > 1 then v_now else null end,
      'publishedAt', case when v_revision = 4 then v_now else null end);
    insert into public.audit_logs(id, action, target_type, target_id, reason, request_id,
      after_state, metadata, created_at)
    values (v_audit, 'ECONOMY_POLICY_OWNER_BOOTSTRAP', 'ECONOMY_POLICY', v_config->>'policyVersion',
      'Owner-approved 2026-10-03 document; policy storage foundation only', v_request,
      v_after, jsonb_build_object('command_version', 1, 'approval_kind', 'OWNER_DOCUMENT',
        'manifest_digest', v_manifest_digest, 'approval_evidence_digest', '15ab269dbed2cb3c1da0ad9c8f0f89e787b5a19ecc48f28255d7f09e2b9c5901'), v_now);
    insert into public.outbox_events(id, event_type, schema_version, aggregate_type, aggregate_id,
      payload, correlation_id, request_id, idempotency_key, occurred_at, created_at,
      available_at, last_error_code)
    values (v_event, 'ECONOMY_POLICY_VERSION_CHANGED.v1', 1, 'economy_policy_version', v_policy,
      jsonb_build_object('audit_id', v_audit, 'revision_id', v_receipt, 'state', v_state,
        'config_digest', v_config_digest, 'manifest_digest', v_manifest_digest),
      v_request, v_request, 'economy-policy:owner-seed:' || (v_config->>'policyVersion') || ':' || v_state,
      v_now, v_now, 'infinity'::timestamptz, 'POLICY_CONSUMER_NOT_ENABLED');
    insert into app_private.economy_policy_receipts(id, policy_id, revision, state,
      previous_revision_id, effective_from, config_digest, audit_id, outbox_id, approval_kind, created_at)
    values (v_receipt, v_policy, v_revision, v_state, v_previous,
      case when v_revision > 1 then v_now else null end,
      v_config_digest, v_audit, v_event, 'OWNER_DOCUMENT', v_now);
    v_previous := v_receipt;
  end loop;
  insert into app_private.economy_policy_publications(policy_id, receipt_id, effective_from, published_at)
  values (v_policy, v_receipt, v_now, v_now);
end;
$owner_policy_seed$;
-- END GENERATED OWNER POLICY SEED

create view app_private.economy_policy_published with (security_invoker = true) as
select version.id as policy_id, version.policy_version, version.config,
  version.config::text as config_text, version.config_digest,
  version.manifest_text, version.manifest_digest, version.approval_evidence, version.approval_evidence_digest,
  receipt.id as revision_id, receipt.state, publication.id as publication_id,
  publication.published_at, publication.effective_from,
  lead(publication.effective_from) over (order by publication.effective_from) as effective_until
from app_private.economy_policy_publications as publication
join app_private.economy_policy_versions as version on version.id = publication.policy_id
join app_private.economy_policy_receipts as receipt on receipt.id = publication.receipt_id;
revoke all on app_private.economy_policy_published from public, anon, authenticated, service_role;
grant select on app_private.economy_policy_published to service_role;

-- The owner reference supplies schema and accounting invariants, not permanent
-- economic ceilings. Audited future versions can change rates, fees and limits.
-- Bounds below are integer transport/storage units, not economic policy.
create function app_private.validate_economy_policy_config(p_config jsonb)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_reference jsonb;
  v_tier jsonb;
  v_previous_max numeric;
  v_min numeric;
  v_max numeric;
  v_key text;
  v_group text;
  v_value numeric;
begin
  select version.config into v_reference from app_private.economy_policy_versions as version
  where version.is_reference;
  if v_reference is null then
    raise exception using errcode = '55000', message = 'ECONOMY_POLICY_REFERENCE_REQUIRED';
  end if;
  -- Recursively require identical keys, JSON types and array lengths. No
  -- additional unreviewed policy knob can silently enter the V1 pipeline.
  if exists (
    with recursive shape(expected, actual) as (
      select v_reference, p_config
      union all
      select child.expected, child.actual from shape as parent
      cross join lateral (
        select object.value as expected, parent.actual->object.key as actual
        from jsonb_each(case when jsonb_typeof(parent.expected) = 'object'
          then parent.expected else '{}'::jsonb end) as object
        union all
        select item.value, parent.actual->(item.ordinality::integer - 1)
        from jsonb_array_elements(case when jsonb_typeof(parent.expected) = 'array'
          then parent.expected else '[]'::jsonb end) with ordinality as item(value, ordinality)
      ) as child
    ) select 1 from shape where jsonb_typeof(actual) is distinct from jsonb_typeof(expected)
      or (jsonb_typeof(expected) = 'object' and
        (select array_agg(key order by key) from jsonb_object_keys(expected) as key)
        is distinct from (select array_agg(key order by key)
          from jsonb_object_keys(case when jsonb_typeof(actual) = 'object'
            then actual else '{}'::jsonb end) as key))
      or (jsonb_typeof(expected) = 'array' and jsonb_array_length(expected) <>
        jsonb_array_length(case when jsonb_typeof(actual) = 'array' then actual else '[]'::jsonb end))
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_SHAPE';
  end if;
  foreach v_key in array array['schemaVersion', 'approvalState', 'approvalEvidence',
    'microKrwPerKrw', 'carryAcrossCycles', 'withdrawalSources', 'futureFeeSource', 'usdt'] loop
    if p_config->v_key is distinct from v_reference->v_key then
      raise exception using errcode = '22023', message = 'ECONOMY_POLICY_PROTOCOL_CHANGE_REQUIRES_APPROVAL';
    end if;
  end loop;
  if p_config->'allocation'->'capacityScope' is distinct from v_reference->'allocation'->'capacityScope'
    or p_config->'userOverride'->'requiresAuditReasonStepUp'
      is distinct from v_reference->'userOverride'->'requiresAuditReasonStepUp' then
    raise exception using errcode = '22023', message = 'ECONOMY_POLICY_PROTOCOL_CHANGE_REQUIRES_APPROVAL';
  end if;
  if coalesce(p_config->>'minimumPrincipalKrw', '') !~ '^[1-9][0-9]*$'
    or (p_config->>'minimumPrincipalKrw')::numeric > 9223372036854775807::numeric
    or coalesce(p_config->>'cycleDays', '') !~ '^[1-9][0-9]*$'
    or (p_config->>'cycleDays')::numeric > 9007199254740991::numeric
    or coalesce(p_config->>'baseCycleRateBps', '') !~ '^(0|[1-9][0-9]*)$'
    or (p_config->>'baseCycleRateBps')::numeric > 9007199254740991::numeric then
    raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_INTEGER';
  end if;
  for v_key in select key from jsonb_object_keys(p_config->'platformFeesKrw') as key loop
    if p_config->'platformFeesKrw'->>v_key !~ '^(0|[1-9][0-9]*)$'
      or (p_config->'platformFeesKrw'->>v_key)::numeric > 9223372036854775807::numeric then
      raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_FEE';
    end if;
  end loop;
  for v_key in select key from jsonb_object_keys(p_config->'allocation') as key where key <> 'capacityScope' loop
    if p_config->'allocation'->>v_key !~ '^[1-9][0-9]*$'
      or (p_config->'allocation'->>v_key)::numeric > 10000 then
      -- 10,000 bps is one allocation unit (100%), not a future reward ceiling.
      raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_ALLOCATION';
    end if;
  end loop;
  if (p_config->'allocation'->>'maximumPerProductBps')::numeric >
    (p_config->'allocation'->>'maximumTotalBps')::numeric then
    raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_ALLOCATION';
  end if;
  for v_index in 0..jsonb_array_length(v_reference->'tiers') - 1 loop
    v_tier := p_config->'tiers'->v_index;
    if v_tier->'code' is distinct from v_reference->'tiers'->v_index->'code'
      or v_tier->'name' is distinct from v_reference->'tiers'->v_index->'name'
      or coalesce(v_tier->>'minimumPrincipalKrw', '') !~ '^[1-9][0-9]*$'
      or (v_tier->>'maximumPrincipalKrw' is not null and
        v_tier->>'maximumPrincipalKrw' !~ '^[1-9][0-9]*$')
      or coalesce(v_tier->>'retentionBonusBps', '') !~ '^(0|[1-9][0-9]*)$'
      or coalesce(v_tier->>'slots', '') !~ '^[1-9][0-9]*$' then
      raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_TIERS';
    end if;
    v_min := (v_tier->>'minimumPrincipalKrw')::numeric;
    v_max := (v_tier->>'maximumPrincipalKrw')::numeric;
    if v_min > 9223372036854775807::numeric
      or v_max > 9223372036854775807::numeric or v_max < v_min
      or (v_index = 0 and v_min <> (p_config->>'minimumPrincipalKrw')::numeric)
      or (v_index > 0 and v_min <> v_previous_max + 1)
      or (v_index < jsonb_array_length(v_reference->'tiers') - 1 and v_max is null)
      or (v_index = jsonb_array_length(v_reference->'tiers') - 1 and v_max is not null)
      or (v_tier->>'retentionBonusBps')::numeric > 9007199254740991::numeric
      or (v_tier->>'slots')::numeric > 9007199254740991::numeric then
      raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_TIERS';
    end if;
    v_previous_max := v_max;
  end loop;
  foreach v_group in array array['productMultiplier', 'userOverride'] loop
    for v_key in select key from jsonb_object_keys(p_config->v_group) as key where key <> 'requiresAuditReasonStepUp' loop
      if p_config->v_group->>v_key !~ '^[1-9][0-9]*$'
        or (p_config->v_group->>v_key)::numeric > 9007199254740991::numeric then
        raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_MULTIPLIER';
      end if;
    end loop;
    v_min := (p_config->v_group->>case when v_group = 'productMultiplier' then 'minimumBps' else 'minimumMultiplierBps' end)::numeric;
    v_max := (p_config->v_group->>case when v_group = 'productMultiplier' then 'maximumBps' else 'maximumMultiplierBps' end)::numeric;
    v_value := (p_config->v_group->>case when v_group = 'productMultiplier' then 'defaultBps' else 'defaultMultiplierBps' end)::numeric;
    if v_min > v_max or v_value < v_min or v_value > v_max then
      raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_MULTIPLIER';
    end if;
  end loop;
  for v_key in select key from jsonb_object_keys(p_config->'campaign') as key loop
    if p_config->'campaign'->>v_key !~ '^(0|[1-9][0-9]*)$'
      or (p_config->'campaign'->>v_key)::numeric > 9007199254740991::numeric
      or (v_key like '%SpeedMultiplierBps' and (p_config->'campaign'->>v_key)::numeric = 0) then
      raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_CAMPAIGN';
    end if;
  end loop;
  if (p_config->'campaign'->>'defaultCapacityBoostBps')::numeric >
      (p_config->'campaign'->>'maximumSingleCapacityBoostBps')::numeric
    or (p_config->'campaign'->>'maximumSingleCapacityBoostBps')::numeric >
      (p_config->'campaign'->>'maximumCombinedCapacityBoostBps')::numeric
    or (p_config->'campaign'->>'defaultSpeedMultiplierBps')::numeric >
      (p_config->'campaign'->>'maximumSingleSpeedMultiplierBps')::numeric
    or (p_config->'campaign'->>'maximumSingleSpeedMultiplierBps')::numeric >
      (p_config->'campaign'->>'maximumCombinedSpeedMultiplierBps')::numeric then
    raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_CAMPAIGN';
  end if;
end;
$$;

create function app_private.guard_economy_policy_insert()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if pg_trigger_depth() <> 2
    or (tg_table_name = 'economy_policy_versions' and (to_jsonb(new)->>'is_reference')::boolean)
    or (tg_table_name = 'economy_policy_receipts' and to_jsonb(new)->>'approval_kind' <> 'ADMIN_STEP_UP') then
    raise exception using errcode = '42501', message = 'ECONOMY_POLICY_COMMAND_REQUIRED';
  end if;
  return new;
end;
$$;

create function app_private.assert_economy_policy_receipt(p_id uuid)
returns void language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_receipt app_private.economy_policy_receipts%rowtype;
  v_previous app_private.economy_policy_receipts%rowtype;
  v_version app_private.economy_policy_versions%rowtype;
  v_audit public.audit_logs%rowtype;
  v_event public.outbox_events%rowtype;
begin
  select receipt.* into v_receipt from app_private.economy_policy_receipts as receipt where receipt.id = p_id;
  select version.* into v_version from app_private.economy_policy_versions as version where version.id = v_receipt.policy_id;
  select audit.* into v_audit from public.audit_logs as audit where audit.id = v_receipt.audit_id;
  select event.* into v_event from public.outbox_events as event where event.id = v_receipt.outbox_id;
  if v_receipt.id is null or v_version.id is null or v_audit.id is null or v_event.id is null
    or v_receipt.config_digest is distinct from v_version.config_digest
    or (v_receipt.revision = 1 and v_version.created_audit_id is distinct from v_audit.id)
    or v_audit.target_type is distinct from 'ECONOMY_POLICY'
    or v_audit.target_id is distinct from v_version.policy_version
    or v_audit.actor_user_id is distinct from v_receipt.actor_user_id
    or v_audit.after_state->>'policyId' is distinct from v_version.id::text
    or v_audit.after_state->>'revisionId' is distinct from v_receipt.id::text
    or v_audit.after_state->>'state' is distinct from v_receipt.state
    or v_audit.after_state->>'configDigest' is distinct from v_version.config_digest
    or v_audit.after_state->>'manifestDigest' is distinct from v_version.manifest_digest
    or v_audit.after_state->>'approvalEvidenceDigest' is distinct from v_version.approval_evidence_digest
    or (v_audit.after_state->>'effectiveFrom')::timestamptz is distinct from v_receipt.effective_from
    or v_event.event_type is distinct from 'ECONOMY_POLICY_VERSION_CHANGED.v1'
    or v_event.schema_version is distinct from 1
    or v_event.aggregate_type is distinct from 'economy_policy_version'
    or v_event.aggregate_id is distinct from v_version.id
    or v_event.actor_user_id is distinct from v_receipt.actor_user_id
    or v_event.request_id is distinct from v_audit.request_id
    or v_event.correlation_id is distinct from v_audit.request_id
    or v_event.payload->>'audit_id' is distinct from v_audit.id::text
    or v_event.payload->>'revision_id' is distinct from v_receipt.id::text
    or v_event.payload->>'state' is distinct from v_receipt.state
    or v_event.payload->>'config_digest' is distinct from v_version.config_digest then
    raise exception using errcode = '55000', message = 'ECONOMY_POLICY_RECEIPT_MISMATCH';
  end if;
  if v_receipt.revision > 1 then
    select receipt.* into v_previous from app_private.economy_policy_receipts as receipt
    where receipt.id = v_receipt.previous_revision_id;
    if v_previous.policy_id is distinct from v_receipt.policy_id
      or v_previous.revision is distinct from v_receipt.revision - 1
      or (v_receipt.revision > 2 and (v_previous.effective_from is distinct from v_receipt.effective_from
        or v_previous.predecessor_publication_id is distinct from v_receipt.predecessor_publication_id)) then
      raise exception using errcode = '55000', message = 'ECONOMY_POLICY_RECEIPT_MISMATCH';
    end if;
  end if;
  if v_receipt.approval_kind = 'OWNER_DOCUMENT' then
    if not v_version.is_reference then
      raise exception using errcode = '55000', message = 'ECONOMY_POLICY_RECEIPT_MISMATCH';
    end if;
  elsif not exists (select 1 from public.admin_step_up_grants as proof
    where proof.id = v_receipt.step_up_grant_id and proof.user_id = v_receipt.actor_user_id
      and proof.admin_session_id = v_receipt.admin_session_id and proof.command_family = 'ECONOMY_POLICY'
      and proof.consumed_at is not null and proof.consume_request_id = v_audit.request_id) then
    raise exception using errcode = '55000', message = 'ECONOMY_POLICY_RECEIPT_MISMATCH';
  end if;
  if v_receipt.state = 'PUBLISHED' and not exists (
    select 1 from app_private.economy_policy_publications as publication
    where publication.policy_id = v_version.id and publication.receipt_id = v_receipt.id
      and publication.effective_from = v_receipt.effective_from) then
    raise exception using errcode = '55000', message = 'ECONOMY_POLICY_RECEIPT_MISMATCH';
  end if;
end;
$$;

-- Trigger depth blocks ordinary direct writes, but is not authorization by
-- itself (a caller may own a temporary trigger). Deferred reconciliation also
-- requires the unique immutable audit receipt produced by the real command.
create function app_private.validate_economy_policy_storage_trigger()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_receipt app_private.economy_policy_receipts%rowtype;
  v_predecessor uuid;
begin
  if tg_table_name = 'economy_policy_versions' then
    select receipt.* into v_receipt from app_private.economy_policy_receipts as receipt
    where receipt.policy_id = new.id and receipt.revision = 1 and receipt.audit_id = new.created_audit_id;
    if v_receipt.id is null then
      raise exception using errcode = '55000', message = 'ECONOMY_POLICY_RECEIPT_MISMATCH';
    end if;
    perform app_private.validate_economy_policy_config(new.config);
  else
    select receipt.* into v_receipt from app_private.economy_policy_receipts as receipt
    where receipt.id = new.receipt_id;
    select publication.id into v_predecessor from app_private.economy_policy_publications as publication
    where publication.effective_from < new.effective_from order by publication.effective_from desc limit 1;
    if v_receipt.policy_id is distinct from new.policy_id or v_receipt.state is distinct from 'PUBLISHED'
      or v_receipt.effective_from is distinct from new.effective_from
      or v_receipt.created_at is distinct from new.published_at
      or v_receipt.predecessor_publication_id is distinct from v_predecessor then
      raise exception using errcode = '55000', message = 'ECONOMY_POLICY_RECEIPT_MISMATCH';
    end if;
  end if;
  perform app_private.assert_economy_policy_receipt(v_receipt.id);
  return null;
end;
$$;

create function app_private.validate_economy_policy_receipt_trigger()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  perform app_private.assert_economy_policy_receipt(new.id);
  return null;
end;
$$;

create function app_private.assert_economy_policy_admin_context(
  p_actor uuid, p_admin_session_id uuid, p_auth_session_id text, p_verified_aal text
) returns public.app_role language plpgsql security invoker set search_path = pg_catalog as $$
declare v_role public.app_role; v_session public.admin_sessions%rowtype; v_now timestamptz;
begin
  if p_verified_aal is distinct from 'aal2' then
    raise exception using errcode = '42501', message = 'MFA_REQUIRED';
  end if;
  select role.role into v_role from public.user_roles as role
  where role.user_id = p_actor and role.revoked_at is null
  order by role.granted_at desc, role.id desc limit 1 for share;
  if v_role is null or v_role not in ('ADMIN', 'SUPER_ADMIN') or
    (select count(distinct role.role) from public.user_roles as role
      where role.user_id = p_actor and role.revoked_at is null
        and role.granted_at = (select max(latest.granted_at) from public.user_roles as latest
          where latest.user_id = p_actor and latest.revoked_at is null)) <> 1 then
    raise exception using errcode = '42501', message = 'OPERATOR_ROLE_REQUIRED';
  end if;
  select session.* into v_session from public.admin_sessions as session
  where session.id = p_admin_session_id and session.user_id = p_actor
    and session.auth_session_id = p_auth_session_id for share;
  v_now := clock_timestamp();
  if v_session.id is null or v_session.revoked_at is not null
    or v_session.idle_expires_at <= v_now or v_session.absolute_expires_at <= v_now then
    raise exception using errcode = '42501', message = 'ADMIN_SESSION_EXPIRED';
  end if;
  return v_role;
end;
$$;

create function app_private.apply_economy_policy_audit_command()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_operation text;
  v_policy_version text;
  v_manifest text;
  v_config jsonb;
  v_expected_revision uuid;
  v_expected_digest text;
  v_effective timestamptz;
  v_admin_session uuid;
  v_auth_session text;
  v_token text;
  v_key text;
  v_hash text;
  v_role public.app_role;
  v_session public.admin_sessions%rowtype;
  v_grant public.admin_step_up_grants%rowtype;
  v_version app_private.economy_policy_versions%rowtype;
  v_previous app_private.economy_policy_receipts%rowtype;
  v_receipt app_private.economy_policy_receipts%rowtype;
  v_latest app_private.economy_policy_publications%rowtype;
  v_idem app_private.idempotency_keys%rowtype;
  v_idem_id uuid;
  v_proof uuid;
  v_state text;
  v_now timestamptz;
  v_outbox uuid := gen_random_uuid();
  v_after jsonb;
begin
  if new.target_type <> 'ECONOMY_POLICY' then return new; end if;
  if new.actor_user_id is null or char_length(btrim(coalesce(new.reason, ''))) not between 1 and 1000
    or new.metadata->'command_version' is distinct from '1'::jsonb
    or (select array_agg(key order by key) from jsonb_object_keys(new.metadata) as key) is distinct from
      array['admin_session_id', 'auth_session_id', 'command_version', 'effective_from',
        'expected_digest', 'expected_revision', 'idempotency_key', 'manifest_text',
        'operation', 'policy_version', 'step_up_token', 'verified_aal']::text[] then
    raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_COMMAND';
  end if;
  v_operation := new.metadata->>'operation';
  v_policy_version := new.metadata->>'policy_version';
  v_manifest := new.metadata->>'manifest_text';
  v_expected_revision := (new.metadata->>'expected_revision')::uuid;
  v_expected_digest := new.metadata->>'expected_digest';
  v_effective := (new.metadata->>'effective_from')::timestamptz;
  v_admin_session := (new.metadata->>'admin_session_id')::uuid;
  v_auth_session := new.metadata->>'auth_session_id';
  v_token := new.metadata->>'step_up_token';
  v_key := new.metadata->>'idempotency_key';
  if v_operation not in ('CREATE', 'PREVIEW', 'APPROVE', 'PUBLISH')
    or v_operation is null or v_policy_version is null
    or v_policy_version !~ '^[A-Z][A-Z0-9._-]{2,99}$'
    or new.action is distinct from 'ECONOMY_POLICY_' || v_operation
    or new.target_id is distinct from v_policy_version
    or char_length(btrim(coalesce(v_key, ''))) not between 8 and 200 then
    raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_COMMAND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('putduk-mining.economy-policy', 0));
  v_role := app_private.assert_economy_policy_admin_context(new.actor_user_id,
    v_admin_session, v_auth_session, new.metadata->>'verified_aal');
  select session.* into v_session from public.admin_sessions as session
  where session.id = v_admin_session and session.user_id = new.actor_user_id
    and session.auth_session_id = v_auth_session for update;
  v_now := clock_timestamp();
  if v_session.id is null or v_session.revoked_at is not null
    or v_session.idle_expires_at <= v_now or v_session.absolute_expires_at <= v_now then
    raise exception using errcode = '42501', message = 'ADMIN_SESSION_EXPIRED';
  end if;
  v_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'operation', v_operation, 'policy_version', v_policy_version, 'manifest_text', v_manifest,
    'expected_revision', v_expected_revision, 'expected_digest', v_expected_digest,
    'effective_from_epoch', extract(epoch from v_effective), 'actor', new.actor_user_id,
    'admin_session', v_admin_session, 'auth_session', v_auth_session, 'aal', 'aal2',
    'reason', btrim(new.reason))::text, 'UTF8'), 'sha256'), 'hex');
  insert into app_private.idempotency_keys(scope, actor_id, idempotency_key, request_hash, status)
  values ('economy.policy', null, v_key, v_hash, 'PROCESSING')
  on conflict (scope, actor_id, idempotency_key) do nothing returning id into v_idem_id;
  if v_idem_id is null then
    select receipt.* into v_idem from app_private.idempotency_keys as receipt
    where receipt.scope = 'economy.policy' and receipt.actor_id is null
      and receipt.idempotency_key = v_key for update;
    if v_idem.request_hash is distinct from v_hash then
      raise exception using errcode = '22023', message = 'IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    if v_idem.status <> 'COMPLETED' or v_idem.response_status is distinct from 200 then
      raise exception using errcode = '40001', message = 'ECONOMY_POLICY_COMMAND_IN_PROGRESS';
    end if;
    select receipt.* into v_receipt from app_private.economy_policy_receipts as receipt
    where receipt.id::text = v_idem.response_payload->>'revisionId';
    perform app_private.assert_economy_policy_receipt(v_receipt.id);
    if not exists (select 1 from public.admin_step_up_grants as proof
      where proof.id = v_receipt.step_up_grant_id and proof.user_id = new.actor_user_id
        and proof.admin_session_id = v_admin_session and proof.command_family = 'ECONOMY_POLICY'
        and proof.token_hash = encode(extensions.digest(coalesce(v_token, ''), 'sha256'), 'hex')) then
      raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
    end if;
    return null;
  end if;
  select proof.* into v_grant from public.admin_step_up_grants as proof
  where proof.user_id = new.actor_user_id and proof.admin_session_id = v_admin_session
    and proof.command_family = 'ECONOMY_POLICY'
    and proof.token_hash = encode(extensions.digest(coalesce(v_token, ''), 'sha256'), 'hex') for update;
  if v_grant.id is null or v_grant.consumed_at is not null or v_grant.expires_at <= clock_timestamp() then
    raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
  end if;
  v_proof := app_private.consume_admin_step_up_token(new.actor_user_id, v_token,
    'ECONOMY_POLICY', new.request_id, v_admin_session);
  select publication.* into v_latest from app_private.economy_policy_publications as publication
  order by publication.effective_from desc limit 1;
  select version.* into v_version from app_private.economy_policy_versions as version
  where version.policy_version = v_policy_version;
  if v_operation = 'CREATE' then
    if v_version.id is not null then
      raise exception using errcode = '22023', message = 'ECONOMY_POLICY_VERSION_EXISTS';
    end if;
    if v_manifest is null or octet_length(v_manifest) not between 2 and 131072
      or v_expected_revision is not null or v_expected_digest is not null or v_effective is not null then
      raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_COMMAND';
    end if;
    begin v_config := v_manifest::jsonb;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_MANIFEST';
    end;
    perform app_private.validate_economy_policy_config(v_config);
    if v_config->>'policyVersion' is distinct from v_policy_version then
      raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_MANIFEST';
    end if;
    insert into app_private.economy_policy_versions(policy_version, manifest_text, manifest_digest,
      config, config_digest, approval_evidence, approval_evidence_digest, created_audit_id)
    values (v_policy_version, v_manifest,
      encode(extensions.digest(convert_to(v_manifest, 'UTF8'), 'sha256'), 'hex'), v_config,
      encode(extensions.digest(convert_to(v_config::text, 'UTF8'), 'sha256'), 'hex'),
      v_config->>'approvalEvidence',
      (select reference.approval_evidence_digest from app_private.economy_policy_versions as reference
        where reference.is_reference), new.id) returning * into v_version;
    v_state := 'DRAFT';
  else
    select receipt.* into v_previous from app_private.economy_policy_receipts as receipt
    where receipt.policy_id = v_version.id order by receipt.revision desc limit 1;
    if v_manifest is not null or v_version.id is null
      or v_expected_revision is distinct from v_previous.id
      or v_expected_digest is distinct from v_version.config_digest
      or v_previous.state is distinct from (case v_operation
        when 'PREVIEW' then 'DRAFT' when 'APPROVE' then 'PREVIEWED' when 'PUBLISH' then 'APPROVED' end) then
      raise exception using errcode = '40001', message = 'ECONOMY_POLICY_REVISION_CHANGED';
    end if;
    if v_effective is null or not isfinite(v_effective) or v_effective <= clock_timestamp()
      or (v_latest.id is not null and v_effective <= v_latest.effective_from) then
      raise exception using errcode = '22023', message = 'INVALID_ECONOMY_POLICY_EFFECTIVE_TIME';
    end if;
    if v_operation <> 'PREVIEW' and
      (v_effective is distinct from v_previous.effective_from
        or v_latest.id is distinct from v_previous.predecessor_publication_id) then
      raise exception using errcode = '40001', message = 'ECONOMY_POLICY_PREVIEW_CHANGED';
    end if;
    v_state := case v_operation when 'PREVIEW' then 'PREVIEWED' when 'APPROVE' then 'APPROVED' else 'PUBLISHED' end;
  end if;
  v_now := clock_timestamp();
  if v_session.idle_expires_at <= v_now or v_session.absolute_expires_at <= v_now
    or v_grant.expires_at <= v_now then
    raise exception using errcode = '42501', message = 'STEP_UP_REQUIRED';
  end if;
  insert into app_private.economy_policy_receipts(policy_id, revision, state, previous_revision_id,
    effective_from, predecessor_publication_id, config_digest, audit_id, outbox_id,
    actor_user_id, admin_session_id, step_up_grant_id, approval_kind, created_at)
  values (v_version.id, coalesce(v_previous.revision, 0) + 1, v_state, v_previous.id,
    v_effective, case when v_operation = 'CREATE' then null else v_latest.id end,
    v_version.config_digest, new.id, v_outbox, new.actor_user_id, v_admin_session,
    v_proof, 'ADMIN_STEP_UP', v_now) returning * into v_receipt;
  if v_state = 'PUBLISHED' then
    insert into app_private.economy_policy_publications(policy_id, receipt_id, effective_from, published_at)
    values (v_version.id, v_receipt.id, v_effective, v_now);
  end if;
  v_after := jsonb_build_object('policyId', v_version.id, 'policyVersion', v_version.policy_version,
    'revisionId', v_receipt.id, 'revision', v_receipt.revision, 'state', v_state,
    'configDigest', v_version.config_digest, 'manifestDigest', v_version.manifest_digest,
    'approvalEvidence', v_version.approval_evidence,
    'approvalEvidenceDigest', v_version.approval_evidence_digest, 'effectiveFrom', v_effective,
    'publishedAt', case when v_state = 'PUBLISHED' then v_now else null end);
  new.actor_role := v_role;
  new.reason := btrim(new.reason);
  new.before_state := case when v_previous.id is null then null else to_jsonb(v_previous) end;
  new.after_state := v_after;
  new.metadata := (new.metadata - 'step_up_token' - 'manifest_text') ||
    jsonb_build_object('step_up_grant_id', v_proof, 'request_hash', v_hash);
  insert into public.outbox_events(id, event_type, schema_version, aggregate_type, aggregate_id,
    actor_user_id, payload, correlation_id, request_id, idempotency_key, available_at, last_error_code)
  values (v_outbox, 'ECONOMY_POLICY_VERSION_CHANGED.v1', 1, 'economy_policy_version', v_version.id,
    new.actor_user_id, jsonb_build_object('audit_id', new.id, 'revision_id', v_receipt.id,
      'state', v_state, 'config_digest', v_version.config_digest, 'manifest_digest', v_version.manifest_digest),
    new.request_id, new.request_id, 'economy-policy:' || v_key,
    'infinity'::timestamptz, 'POLICY_CONSUMER_NOT_ENABLED');
  update app_private.idempotency_keys set status = 'COMPLETED', response_status = 200,
    response_payload = v_after, completed_at = clock_timestamp(), locked_until = null where id = v_idem_id;
  return new;
end;
$$;

-- Workers may change delivery state, never the policy event's semantic receipt.
create function app_private.guard_economy_policy_outbox()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if tg_op = 'INSERT' then
    if new.event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1' and pg_trigger_depth() <> 2 then
      raise exception using errcode = '42501', message = 'ECONOMY_POLICY_COMMAND_REQUIRED';
    end if;
  elsif old.event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'
    or new.event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1' then
    if (to_jsonb(old) - array['status', 'available_at', 'attempt_count', 'max_attempts',
      'lease_owner', 'lease_expires_at', 'processed_at', 'last_error_code', 'updated_at'])
      is distinct from (to_jsonb(new) - array['status', 'available_at', 'attempt_count', 'max_attempts',
        'lease_owner', 'lease_expires_at', 'processed_at', 'last_error_code', 'updated_at']) then
      raise exception using errcode = '55000', message = 'ECONOMY_POLICY_EVENT_IS_IMMUTABLE';
    end if;
  end if;
  return new;
end;
$$;

create function public.manage_economy_policy_version(
  p_operation text, p_policy_version text, p_manifest_text text,
  p_expected_revision uuid, p_expected_digest text, p_effective_from timestamptz,
  p_actor uuid, p_admin_session_id uuid, p_auth_session_id text, p_verified_aal text,
  p_step_up_token text, p_reason text, p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare v_result jsonb;
begin
  insert into public.audit_logs(actor_user_id, action, target_type, target_id, reason, request_id, metadata)
  values (p_actor, 'ECONOMY_POLICY_' || p_operation, 'ECONOMY_POLICY', p_policy_version,
    p_reason, gen_random_uuid(), jsonb_build_object('command_version', 1, 'operation', p_operation,
      'policy_version', p_policy_version, 'manifest_text', p_manifest_text,
      'expected_revision', p_expected_revision, 'expected_digest', p_expected_digest,
      'effective_from', p_effective_from, 'admin_session_id', p_admin_session_id,
      'auth_session_id', p_auth_session_id, 'verified_aal', p_verified_aal,
      'step_up_token', p_step_up_token, 'idempotency_key', p_idempotency_key))
  returning after_state into v_result;
  if v_result is null then
    select receipt.response_payload into v_result from app_private.idempotency_keys as receipt
    where receipt.scope = 'economy.policy' and receipt.actor_id is null
      and receipt.idempotency_key = p_idempotency_key and receipt.status = 'COMPLETED';
  end if;
  return v_result;
end;
$$;

create function app_private.economy_policy_version_document(p_policy_id uuid)
returns jsonb language sql security invoker set search_path = pg_catalog as $$
  select jsonb_build_object('policyId', version.id, 'policyVersion', version.policy_version,
    'configuration', version.config, 'configText', version.config::text,
    'manifestText', version.manifest_text, 'configDigest', version.config_digest,
    'manifestDigest', version.manifest_digest, 'approvalEvidence', version.approval_evidence,
    'approvalEvidenceDigest', version.approval_evidence_digest, 'createdAt', version.created_at,
    'latestRevision', (select jsonb_build_object('revisionId', receipt.id,
      'revision', receipt.revision, 'state', receipt.state, 'effectiveFrom', receipt.effective_from,
      'predecessorPublicationId', receipt.predecessor_publication_id,
      'publishedAt', publication.published_at)
      from app_private.economy_policy_receipts as receipt
      left join app_private.economy_policy_publications as publication on publication.receipt_id = receipt.id
      where receipt.policy_id = version.id order by receipt.revision desc limit 1),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('revisionId', receipt.id,
      'revision', receipt.revision, 'state', receipt.state, 'effectiveFrom', receipt.effective_from,
      'predecessorPublicationId', receipt.predecessor_publication_id,
      'publishedAt', publication.published_at, 'createdAt', receipt.created_at,
      'actorUserId', receipt.actor_user_id, 'approvalKind', receipt.approval_kind)
      order by receipt.revision), '[]'::jsonb)
      from app_private.economy_policy_receipts as receipt
      left join app_private.economy_policy_publications as publication on publication.receipt_id = receipt.id
      where receipt.policy_id = version.id))
  from app_private.economy_policy_versions as version where version.id = p_policy_id;
$$;

-- Administrative reader only. It does not expose app_private via PostgREST
-- and is not an engine/worker publication authority or money command.
create function public.read_economy_policy_version_state(
  p_actor uuid, p_admin_session_id uuid, p_auth_session_id text, p_verified_aal text,
  p_policy_version text default null
) returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_role public.app_role;
  v_now timestamptz;
  v_selected uuid;
  v_reference uuid;
  v_versions jsonb;
  v_timeline jsonb;
  v_latest jsonb;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('putduk-mining.economy-policy', 0));
  v_role := app_private.assert_economy_policy_admin_context(p_actor,
    p_admin_session_id, p_auth_session_id, p_verified_aal);
  v_now := clock_timestamp();
  select version.id into v_reference from app_private.economy_policy_versions as version where version.is_reference;
  if p_policy_version is null then
    select policy.policy_id into v_selected from app_private.economy_policy_published as policy
    where policy.effective_from <= v_now and (policy.effective_until is null or policy.effective_until > v_now);
    v_selected := coalesce(v_selected, v_reference);
  else
    select version.id into v_selected from app_private.economy_policy_versions as version
    where version.policy_version = p_policy_version;
    if v_selected is null then
      raise exception using errcode = '22023', message = 'ECONOMY_POLICY_VERSION_NOT_FOUND';
    end if;
  end if;
  select coalesce(jsonb_agg(summary.document order by summary.created_at desc, summary.policy_version), '[]'::jsonb)
  into v_versions from (
    select version.created_at, version.policy_version,
      jsonb_build_object('policyId', version.id, 'policyVersion', version.policy_version,
        'configDigest', version.config_digest, 'manifestDigest', version.manifest_digest,
        'approvalEvidence', version.approval_evidence, 'approvalEvidenceDigest', version.approval_evidence_digest,
        'state', receipt.state, 'revisionId', receipt.id, 'revision', receipt.revision,
        'createdAt', version.created_at, 'effectiveFrom', receipt.effective_from,
        'predecessorPublicationId', receipt.predecessor_publication_id,
        'publishedAt', publication.published_at) as document
    from app_private.economy_policy_versions as version
    cross join lateral (select receipt.* from app_private.economy_policy_receipts as receipt
      where receipt.policy_id = version.id order by receipt.revision desc limit 1) as receipt
    left join app_private.economy_policy_publications as publication on publication.receipt_id = receipt.id
    order by version.created_at desc, version.policy_version limit 100
  ) as summary;
  select coalesce(jsonb_agg(jsonb_build_object('policyId', policy.policy_id,
    'policyVersion', policy.policy_version, 'publicationId', policy.publication_id,
    'revisionId', policy.revision_id, 'state', policy.state, 'publishedAt', policy.published_at,
    'effectiveFrom', policy.effective_from, 'effectiveUntil', policy.effective_until,
    'configDigest', policy.config_digest, 'manifestDigest', policy.manifest_digest,
    'approvalEvidence', policy.approval_evidence, 'approvalEvidenceDigest', policy.approval_evidence_digest)
    order by policy.effective_from), '[]'::jsonb) into v_timeline
  from app_private.economy_policy_published as policy;
  v_latest := case when jsonb_array_length(v_timeline) > 0 then v_timeline -> (-1) else null end;
  return jsonb_build_object('schemaVersion', 1, 'serverNow', v_now, 'actorRole', v_role,
    'selectedVersion', app_private.economy_policy_version_document(v_selected),
    'referencePolicy', app_private.economy_policy_version_document(v_reference),
    'versions', v_versions, 'publishedTimeline', v_timeline, 'latestPublication', v_latest);
end;
$$;

revoke all on function app_private.validate_economy_policy_config(jsonb),
  app_private.guard_economy_policy_insert(), app_private.assert_economy_policy_receipt(uuid),
  app_private.validate_economy_policy_receipt_trigger(), app_private.apply_economy_policy_audit_command(),
  app_private.guard_economy_policy_outbox(), app_private.validate_economy_policy_storage_trigger(),
  app_private.assert_economy_policy_admin_context(uuid, uuid, text, text),
  app_private.economy_policy_version_document(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app_private.validate_economy_policy_config(jsonb),
  app_private.guard_economy_policy_insert(), app_private.assert_economy_policy_receipt(uuid),
  app_private.validate_economy_policy_receipt_trigger(), app_private.apply_economy_policy_audit_command(),
  app_private.guard_economy_policy_outbox(), app_private.validate_economy_policy_storage_trigger(),
  app_private.assert_economy_policy_admin_context(uuid, uuid, text, text),
  app_private.economy_policy_version_document(uuid)
  to service_role;
revoke all on function public.manage_economy_policy_version(text, text, text, uuid, text,
  timestamptz, uuid, uuid, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.manage_economy_policy_version(text, text, text, uuid, text,
  timestamptz, uuid, uuid, text, text, text, text, text) to service_role;
revoke all on function public.read_economy_policy_version_state(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.read_economy_policy_version_state(uuid, uuid, text, text, text) to service_role;

create trigger audit_logs_apply_economy_policy_command before insert on public.audit_logs
for each row execute function app_private.apply_economy_policy_audit_command();
create trigger outbox_events_economy_policy_receipt before insert or update on public.outbox_events
for each row execute function app_private.guard_economy_policy_outbox();
create trigger economy_policy_versions_command_only before insert on app_private.economy_policy_versions
for each row execute function app_private.guard_economy_policy_insert();
create trigger economy_policy_receipts_command_only before insert on app_private.economy_policy_receipts
for each row execute function app_private.guard_economy_policy_insert();
create trigger economy_policy_publications_command_only before insert on app_private.economy_policy_publications
for each row execute function app_private.guard_economy_policy_insert();
create trigger economy_policy_versions_append_only before update or delete on app_private.economy_policy_versions
for each row execute function app_private.prevent_row_mutation();
create trigger economy_policy_receipts_append_only before update or delete on app_private.economy_policy_receipts
for each row execute function app_private.prevent_row_mutation();
create trigger economy_policy_publications_append_only before update or delete on app_private.economy_policy_publications
for each row execute function app_private.prevent_row_mutation();
create constraint trigger economy_policy_receipts_integrity after insert on app_private.economy_policy_receipts
deferrable initially deferred for each row execute function app_private.validate_economy_policy_receipt_trigger();
create constraint trigger economy_policy_versions_integrity after insert on app_private.economy_policy_versions
deferrable initially deferred for each row execute function app_private.validate_economy_policy_storage_trigger();
create constraint trigger economy_policy_publications_integrity after insert on app_private.economy_policy_publications
deferrable initially deferred for each row execute function app_private.validate_economy_policy_storage_trigger();

comment on table app_private.economy_policy_versions is
  'Immutable server-only versioned policy source; publication alone never activates mining or proves principal coverage.';
comment on view app_private.economy_policy_published is
  'Forward-only publication points derive non-overlapping half-open effective intervals; historical policy data is immutable.';
comment on function public.manage_economy_policy_version(text, text, text, uuid, text,
  timestamptz, uuid, uuid, text, text, text, text, text) is
  'Canonical service-only CREATE/PREVIEW/APPROVE/PUBLISH policy command; AAL2 server proof, latest role, bound session, step-up, audit and outbox commit together.';
comment on function public.read_economy_policy_version_state(uuid, uuid, text, text, text) is
  'Canonical service-only administrator policy read with current role, server AAL2 and bound session; not an unattended engine authority.';
commit;
