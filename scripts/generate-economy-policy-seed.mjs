import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = "docs/product/economy-v1-approved-2026-10-03.json";
const approvalPath = "docs/product/ECONOMY-V1-USER-APPROVAL-2026-10-03.md";
const migrationPath =
  "supabase/migrations/20261003140000_economy_policy_v1.sql";
const start = "-- BEGIN GENERATED OWNER POLICY SEED";
const end = "-- END GENERATED OWNER POLICY SEED";
const options = process.argv.slice(2);
if (options.some((option) => option !== "--check") || options.length > 1)
  throw new Error("ECONOMY_SEED_OPTION_INVALID");
const source = await readFile(path.join(root, sourcePath));
const manifest = source.toString("utf8");
if (!Buffer.from(manifest, "utf8").equals(source))
  throw new Error("ECONOMY_SEED_UTF8_INVALID");
const approved = JSON.parse(manifest);
if (
  approved.schemaVersion !== 1 ||
  approved.policyVersion !== "PUTDUK-MINING-V1-2026-10-03" ||
  approved.approvalState !== "OWNER_APPROVED" ||
  approved.approvalEvidence !== approvalPath
)
  throw new Error("ECONOMY_SEED_OWNER_SOURCE_INVALID");
const digest = createHash("sha256").update(source).digest("hex");
const evidenceDigest = createHash("sha256")
  .update(await readFile(path.join(root, approvalPath)))
  .digest("hex");
const base64 = source.toString("base64");
const block = `${start}
-- Exact UTF-8 source: ${sourcePath}
-- manifest SHA256: ${digest}
-- approval evidence SHA256: ${evidenceDigest}
-- Base64 protects original bytes from checkout line-ending normalization.
do $owner_policy_seed$
declare
  v_manifest text := convert_from(decode('${base64}', 'base64'), 'UTF8');
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
  if v_manifest_digest <> '${digest}'
    or v_config->>'policyVersion' <> '${approved.policyVersion}' then
    raise exception 'ECONOMY_OWNER_SEED_DIGEST_MISMATCH';
  end if;
  insert into app_private.economy_policy_versions(id, policy_version, manifest_text,
    manifest_digest, config, config_digest, approval_evidence, approval_evidence_digest,
    is_reference, created_audit_id, created_at)
  values (v_policy, v_config->>'policyVersion', v_manifest, v_manifest_digest, v_config,
    v_config_digest, v_config->>'approvalEvidence', '${evidenceDigest}', true, v_first_audit, v_now);
  for v_revision in 1..4 loop
    v_state := (array['DRAFT', 'PREVIEWED', 'APPROVED', 'PUBLISHED'])[v_revision];
    v_audit := case when v_revision = 1 then v_first_audit else gen_random_uuid() end;
    v_receipt := gen_random_uuid();
    v_event := gen_random_uuid();
    v_request := gen_random_uuid();
    v_after := jsonb_build_object('policyId', v_policy, 'policyVersion', v_config->>'policyVersion',
      'revisionId', v_receipt, 'revision', v_revision, 'state', v_state,
      'configDigest', v_config_digest, 'manifestDigest', v_manifest_digest,
      'approvalEvidence', v_config->>'approvalEvidence', 'approvalEvidenceDigest', '${evidenceDigest}',
      'effectiveFrom', case when v_revision > 1 then v_now else null end,
      'publishedAt', case when v_revision = 4 then v_now else null end);
    insert into public.audit_logs(id, action, target_type, target_id, reason, request_id,
      after_state, metadata, created_at)
    values (v_audit, 'ECONOMY_POLICY_OWNER_BOOTSTRAP', 'ECONOMY_POLICY', v_config->>'policyVersion',
      'Owner-approved 2026-10-03 document; policy storage foundation only', v_request,
      v_after, jsonb_build_object('command_version', 1, 'approval_kind', 'OWNER_DOCUMENT',
        'manifest_digest', v_manifest_digest, 'approval_evidence_digest', '${evidenceDigest}'), v_now);
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
${end}`;
const migration = await readFile(path.join(root, migrationPath), "utf8");
const beginAt = migration.indexOf(start);
const endAt = migration.indexOf(end, beginAt);
if (
  beginAt < 0 ||
  endAt < 0 ||
  migration.indexOf(start, beginAt + start.length) !== -1 ||
  migration.indexOf(end, endAt + end.length) !== -1
)
  throw new Error("ECONOMY_SEED_MARKERS_INVALID");
const existing = migration.slice(beginAt, endAt + end.length);
if (options.includes("--check")) {
  if (existing.replaceAll("\r\n", "\n") !== block)
    throw new Error("ECONOMY_SEED_SOURCE_DRIFT");
} else {
  await writeFile(
    path.join(root, migrationPath),
    migration.slice(0, beginAt) + block + migration.slice(endAt + end.length),
    "utf8",
  );
}
process.stdout.write(
  `Economy owner seed ${options.includes("--check") ? "verified" : "generated"}: ${digest}\n`,
);
