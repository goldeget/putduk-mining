import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const helper = readFileSync(
  new URL(
    "../../../supabase/snippets/resolve_disposable_dblink_host.sql",
    import.meta.url,
  ),
  "utf8",
);

const mountedCopies = [
  "supabase/tests/snippets/resolve_disposable_dblink_host.inc",
  "supabase/tests-concurrent/resolve_disposable_dblink_host.inc",
];

const callers = [
  {
    relative: "supabase/tests-concurrent/krw_deposit_concurrent_approval.sql",
    mountRoot: "supabase/tests-concurrent",
  },
  {
    relative: "supabase/tests-concurrent/usdt_deposit_concurrent_approval.sql",
    mountRoot: "supabase/tests-concurrent",
  },
  {
    relative: "supabase/tests-concurrent/safe_mode_concurrent_command.sql",
    mountRoot: "supabase/tests-concurrent",
  },
  {
    relative: "supabase/tests/database/acknowledge_reconciliation_mismatch.sql",
    mountRoot: "supabase/tests",
  },
].map((caller) => ({
  ...caller,
  source: readFileSync(
    new URL(`../../../${caller.relative}`, import.meta.url),
    "utf8",
  ),
}));

function includedPath(sqlRelative: string, includeRelative: string) {
  return path.resolve(repoRoot, path.dirname(sqlRelative), includeRelative);
}

describe("일회용 dblink 호스트", () => {
  it("이 세션의 서버 주소만 쓰고 과거 컨테이너 이름을 probe 하지 않는다", () => {
    expect(helper).toContain("pg_catalog.inet_server_addr()");
    expect(helper).toContain("putduk.qa_db_host");
    expect(helper).toContain("^supabase_db_putduk-mining[-a-z0-9]*$");
    expect(helper).toContain("EXACT_LOCAL_DB_HOST_REQUIRED");
    expect(helper).not.toContain("supabase_db_putduk-mining-clean");
    expect(helper).not.toContain("host=127.0.0.1");
    expect(helper).not.toContain("host=localhost");
  });

  it("동시성 검사와 정산 확인이 pg_prove 마운트 안의 같은 헬퍼를 포함한다", () => {
    for (const copy of mountedCopies) {
      expect(
        readFileSync(new URL(`../../../${copy}`, import.meta.url), "utf8"),
      ).toBe(helper);
    }

    for (const caller of callers) {
      const include = caller.source.match(/^\\ir\s+(\S+)\s*$/m)?.[1];
      expect(include, caller.relative).toBeTruthy();
      const resolved = includedPath(caller.relative, include ?? "");
      const mount = path.resolve(repoRoot, caller.mountRoot);
      const fromMount = path.relative(mount, resolved);
      expect(
        fromMount.startsWith("..") || path.isAbsolute(fromMount),
        caller.relative,
      ).toBe(false);
      expect(readFileSync(resolved, "utf8"), caller.relative).toBe(helper);
      expect(caller.source, caller.relative).toContain(
        "pg_temp.putduk_disposable_dblink_host(",
      );
      expect(caller.source, caller.relative).not.toContain(
        "supabase_db_putduk-mining-clean",
      );
    }
  });
});
