import { expect } from "@playwright/test";
import { assertBackend197BrowserCanonicalSources } from "../../../../scripts/backend-successor-197-browser-source.mjs";
import { assertBackend201BrowserCanonicalSources } from "../../../../scripts/backend-successor-201-browser-source.mjs";
import { resolveBackend201Context } from "../../../../scripts/backend-successor-201-http-context.mjs";
import { execLocalAdminSql } from "./local-db";

/** Compatibility export for the existing spec; requires the strict 197 source and DB set. */
export function requirePrincipalCanonical193Candidate() {
  const reviewed = resolveBackend201Context(
    process.env.PUTDUK_BACKEND_SOURCE_REVISION,
    assertBackend197BrowserCanonicalSources,
    () => {
      if (process.env.APP_ENV !== "test")
        throw new Error("BACKEND201_EXPLICIT_TEST_CONTEXT_REQUIRED");
      return assertBackend201BrowserCanonicalSources();
    },
  );
  const localApi = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (
    localApi.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(localApi.hostname) ||
    localApi.port !== String(reviewed.apiPort) ||
    process.env.LOCAL_SUPABASE_PROJECT_ID !== reviewed.projectId
  )
    throw new Error("PRINCIPAL_E2E_LOCAL_TARGET_REQUIRED");
  // Versions are validated 14-digit source identifiers in the reviewed map.
  // Compare the exact normal-migration history set, not a hand-edited count.
  const versions = reviewed.migrationVersions
    .map((version) => `'${version}'`)
    .join(",");
  const accepted =
    execLocalAdminSql(`select array_agg(version order by version)=array[${versions}]::text[]
    and to_regprocedure('public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)') is not null
    and not has_function_privilege('service_role','public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)','execute')
    and has_function_privilege('authenticated','public.prepare_withdrawal_logical_request(uuid,text,bigint,uuid,integer,text,uuid,jsonb)','execute')
    and to_regclass('app_private.withdrawal_principal_confirmation_originals') is not null
    and (select count(*) from supabase_migrations.schema_migrations where version in ('20261006131000','20261006132000','20261006132050','20261006133000','20261006133050','20261006133100','20261006133150','20261006133200','20261006133250','20261006133300','20261006133350','20261006133400','20261006134000','20261006134050','20261006134100','20261006134150','20261006135000','20261006135050','20261006135100','20261006135150','20261006136000','20261006136050','20261006136100','20261006136150','20261006139000','20261006139050','20261006139100','20261006139150','20261006139200','20261006139250','20261006139300','20261006139350'))=32
    from supabase_migrations.schema_migrations;`);
  expect(accepted).toBe("t");
}
