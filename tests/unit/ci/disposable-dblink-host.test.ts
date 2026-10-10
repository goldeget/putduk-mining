import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const helper = readFileSync(
  new URL(
    "../../../supabase/snippets/resolve_disposable_dblink_host.sql",
    import.meta.url,
  ),
  "utf8",
);

const callers = [
  "supabase/tests-concurrent/krw_deposit_concurrent_approval.sql",
  "supabase/tests-concurrent/usdt_deposit_concurrent_approval.sql",
  "supabase/tests-concurrent/safe_mode_concurrent_command.sql",
  "supabase/tests/database/acknowledge_reconciliation_mismatch.sql",
].map((relative) => ({
  relative,
  source: readFileSync(
    new URL(`../../../${relative}`, import.meta.url),
    "utf8",
  ),
}));

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

  it("동시성 검사와 정산 확인이 같은 헬퍼를 포함한다", () => {
    for (const caller of callers) {
      expect(caller.source, caller.relative).toContain(
        "resolve_disposable_dblink_host.sql",
      );
      expect(caller.source, caller.relative).toContain(
        "pg_temp.putduk_disposable_dblink_host(",
      );
      expect(caller.source, caller.relative).not.toContain(
        "supabase_db_putduk-mining-clean",
      );
    }
  });
});
