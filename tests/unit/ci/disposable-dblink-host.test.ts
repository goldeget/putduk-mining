import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  assertLocalDbContainerMetadata,
  resolveLocalDbTarget,
} from "../../../scripts/local-db-target.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const helperPath =
  "supabase/tests-concurrent/resolve_disposable_dblink_host.inc";
const helper = readFileSync(path.join(repoRoot, helperPath), "utf8");
const concurrent = [
  "krw_deposit_concurrent_approval.sql",
  "usdt_deposit_concurrent_approval.sql",
  "safe_mode_concurrent_command.sql",
  "withdrawal_member_lock_order.sql",
  "global_allocation_admission_concurrent.sql",
  "hold_cancel_admission_concurrent.sql",
  "principal_finalize_native_contention.sql",
].map((name) => ({
  relative: `supabase/tests-concurrent/${name}`,
  mountRoot: "supabase/tests-concurrent",
}));
const callers = [
  ...concurrent,
  {
    relative: "supabase/tests/database/acknowledge_reconciliation_mismatch.sql",
    mountRoot: "supabase/tests",
  },
];
const config =
  'project_id = "putduk-mining-backend-patch-test"\n[api]\nport = 65421\n[db]\nport = 65422\n';

describe("disposable database identity admission", () => {
  it("keeps all dblink dependencies inside pg_prove's mounted directory", () => {
    for (const caller of callers) {
      const source = readFileSync(path.join(repoRoot, caller.relative), "utf8");
      const include = source.match(/^\\ir\s+(\S+)\s*$/m)?.[1];
      expect(include, caller.relative).toBeTruthy();
      const resolved = path.resolve(
        repoRoot,
        path.dirname(caller.relative),
        include ?? "",
      );
      const relative = path.relative(
        path.join(repoRoot, caller.mountRoot),
        resolved,
      );
      expect(
        relative.startsWith("..") || path.isAbsolute(relative),
        caller.relative,
      ).toBe(false);
      expect(readFileSync(resolved, "utf8"), caller.relative).toBe(helper);
      expect(source, caller.relative).toContain(
        "pg_temp.putduk_disposable_dblink_connection(",
      );
      expect(source, caller.relative).not.toMatch(
        /supabase_db_putduk-mining|host=.*password=postgres/,
      );
    }
  });

  it("uses only the current TCP server and verifies its cluster before remote fixture writes", () => {
    expect(helper).toContain("pg_catalog.inet_server_addr()");
    expect(helper).toContain("server_address is null");
    expect(helper).toContain("server_address <<= '127.0.0.0/8'::inet");
    expect(helper).toContain("server_address = '::1'::inet");
    expect(helper).toContain("EXACT_LOCAL_DB_TCP_SERVER_REQUIRED");
    expect(helper).toContain("pg_catalog.host(server_address)");
    expect(helper).toContain("current_setting('port')");
    expect(helper).toContain("pg_control_system()");
    expect(helper).toContain("remote_cluster is distinct from local_cluster");
    expect(helper).toContain(
      "remote_database is distinct from current_database()",
    );
    expect(helper).not.toMatch(
      /putduk.qa_db_host|supabase_db_|dblink_connect_u|host=127\.0\.0\.1/,
    );
  });

  it("derives the container from configuration without a historical default", () => {
    expect(resolveLocalDbTarget(config)).toMatchObject({
      projectId: "putduk-mining-backend-patch-test",
      container: "supabase_db_putduk-mining-backend-patch-test",
      dbPort: "65422",
    });
    expect(() => resolveLocalDbTarget(config, "putduk-mining")).toThrow(
      "LOCAL_DB_PROJECT_SCOPE_REJECTED",
    );
    expect(() => resolveLocalDbTarget(config, "osrmyjgmpdspdcwqjwuv")).toThrow(
      "LOCAL_DB_PROJECT_SCOPE_REJECTED",
    );
    expect(() => resolveLocalDbTarget(config, "")).toThrow(
      "LOCAL_DB_PROJECT_SCOPE_REJECTED",
    );
  });

  it("rejects a mismatched container identity even when the name has the project prefix", () => {
    const target = resolveLocalDbTarget(config);
    expect(() =>
      assertLocalDbContainerMetadata(
        JSON.stringify({
          name: `/${target.container}`,
          project: target.projectId,
        }),
        target,
      ),
    ).not.toThrow();
    for (const metadata of [
      { name: "/supabase_db_putduk-mining", project: target.projectId },
      { name: `/${target.container}`, project: "putduk-mining" },
      { name: `/${target.container}`, project: null },
      null,
    ]) {
      expect(() =>
        assertLocalDbContainerMetadata(JSON.stringify(metadata), target),
      ).toThrow("LOCAL_DB_CONTAINER_METADATA_REJECTED");
    }
    expect(() => assertLocalDbContainerMetadata("not-json", target)).toThrow(
      "LOCAL_DB_CONTAINER_METADATA_REJECTED",
    );
  });
});
