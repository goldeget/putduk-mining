import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const appliedJournal =
  "supabase/migrations/20261002230000_krw_deposit_journal_integrity.sql";

function source(path: string) {
  return readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
}

function migrationFiles() {
  return readdirSync(join(root, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => `supabase/migrations/${name}`);
}

function extractFunction(sql: string, name: string) {
  const markers = [
    `create or replace function public.${name}(`,
    `create function public.${name}(`,
  ];
  const start = Math.max(...markers.map((marker) => sql.lastIndexOf(marker)));
  if (start < 0) return null;
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) throw new Error(`FUNCTION_END_MISSING:${name}`);
  return sql.slice(start, end + "\n$$;".length);
}

function latestFunction(name: string) {
  let body: string | null = null;
  for (const file of migrationFiles()) {
    const found = extractFunction(source(file), name);
    if (found) body = found;
  }
  if (!body) throw new Error(`FUNCTION_MISSING:${name}`);
  return body;
}

function latestFileDefining(name: string) {
  let filePath: string | null = null;
  for (const file of migrationFiles()) {
    if (extractFunction(source(file), name)) filePath = file;
  }
  if (!filePath) throw new Error(`FUNCTION_FILE_MISSING:${name}`);
  return filePath;
}

// 입금 승인 wallet_ledger 거절과 같은 형태만 인정한다.
// reference가 다르거나 행이 없으면 IDEMPOTENCY_KEY_REUSED다.
const reusedGuard =
  /if v_existing_reference is distinct from (v_[a-z0-9_]+\.id)\s+or (v_[a-z0-9_]+) is null\s+then\s+raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED';\s+end if;/g;

function requiredGroup(match: RegExpMatchArray, index: number) {
  const value = match[index];
  if (value === undefined) {
    throw new Error(`IDEMPOTENCY_GUARD_CAPTURE_MISSING:${index}`);
  }
  return value;
}

function guards(body: string) {
  return [...body.matchAll(reusedGuard)].map((match) => {
    const row = requiredGroup(match, 1);
    const id = requiredGroup(match, 2);
    return match[0].replace(/\s+/g, " ").replace(row, "ROW").replace(id, "ID");
  });
}

const canonicalGuard = guards(
  extractFunction(source(appliedJournal), "approve_deposit_request") ?? "",
)[0];

describe("withdrawal idempotency key reuse", () => {
  it("keeps the applied deposit migration's withdrawal functions unchecked", () => {
    const applied = source(appliedJournal);
    expect(
      guards(extractFunction(applied, "release_withdrawal_hold") ?? ""),
    ).toEqual([]);
    expect(
      guards(extractFunction(applied, "finalize_withdrawal_ledger") ?? ""),
    ).toEqual([]);
    expect(canonicalGuard).toBe(
      "if v_existing_reference is distinct from ROW or ID is null then raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REUSED'; end if;",
    );
  });

  it("rejects a foreign or missing journal before release or finalize changes status", () => {
    const release = latestFunction("release_withdrawal_hold");
    const finalize = latestFunction("finalize_withdrawal_ledger");
    expect(guards(release)).toEqual([canonicalGuard]);
    expect(guards(finalize)).toEqual([canonicalGuard, canonicalGuard]);

    for (const body of [release, finalize]) {
      const conflictAt = body.indexOf(
        "on conflict (idempotency_key) do nothing",
      );
      const guardAt = body.indexOf("IDEMPOTENCY_KEY_REUSED");
      const statusAt = body.indexOf("update public.withdrawal_requests");
      expect(conflictAt).toBeGreaterThan(0);
      expect(guardAt).toBeGreaterThan(conflictAt);
      expect(guardAt).toBeLessThan(statusAt);
    }
  });

  it("does not reopen general withdrawal creation or an accrual producer", () => {
    const file =
      "supabase/migrations/20261005143000_withdrawal_idempotency_key_reuse.sql";
    const text = source(file);
    expect(file).not.toBe(appliedJournal);
    expect(text.match(/create or replace function /g)).toHaveLength(2);
    expect(text).not.toContain("request_withdrawal_with_hold");
    expect(text).not.toContain(
      "WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE",
    );
    expect(text).not.toMatch(/\b(?:grant|revoke)\b/i);
    expect(latestFunction("release_withdrawal_hold")).not.toContain(
      "request_withdrawal_with_hold",
    );
    expect(latestFunction("finalize_withdrawal_ledger")).not.toContain(
      "money_source_movements",
    );
  });

  it("limits the admitted principal clock extension to its three existing functions", () => {
    const file = latestFileDefining("release_withdrawal_hold");
    expect(file).toBe(
      "supabase/migrations/20261006130100_principal_hold_cancel_clock_connections.sql",
    );
    const text = source(file);
    expect(
      [
        ...text.matchAll(/create or replace function ([a-z_]+\.[a-z_]+)\(/g),
      ].map((match) => match[1]),
    ).toEqual([
      "app_private.finish_principal_recovery_hold",
      "app_private.record_principal_recovery_release",
      "public.release_withdrawal_hold",
    ]);
    expect(text).not.toContain("request_withdrawal_with_hold");
    expect(text).not.toContain(
      "WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE",
    );
    expect(text).not.toMatch(/\bgrant\s+execute\s+on\s+function\s+public\./i);
    expect(latestFunction("release_withdrawal_hold")).toContain(
      "app_private.capture_funding_withdrawal_clock_admission",
    );
    expect(guards(latestFunction("release_withdrawal_hold"))).toEqual([
      canonicalGuard,
    ]);
  });
});
