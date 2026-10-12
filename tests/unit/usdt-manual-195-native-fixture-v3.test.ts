import { readPredecessor195TestSource } from "../helpers/backend-predecessor-195.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPrincipal195Fixture,
  buildKrw195Fixture,
  buildConcurrency195Fixture,
  USDT_195_FROZEN_SOURCES,
  type Native195Derivative,
} from "../../scripts/usdt-manual-195-native-fixture-v3.mjs";

const explicit = { fullPayoutConfirmed: true as const };
const grant = "grant execute on function pg_temp.usdt_195_evidence(uuid,text) to service_role;";
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const cases = [
  ["principal", buildPrincipal195Fixture, 3],
  ["krw", buildKrw195Fixture, 8],
  ["concurrency", buildConcurrency195Fixture, 2],
] as const;
function read(kind: keyof typeof USDT_195_FROZEN_SOURCES) {
  return readFileSync(USDT_195_FROZEN_SOURCES[kind].path);
}
function reverse(result: Native195Derivative) {
  return [...result.changes].reverse().reduce((source, change) => {
    expect(source.split(change.after)).toHaveLength(2);
    expect(digest(change.before)).toBe(change.beforeSha256);
    expect(digest(change.after)).toBe(change.afterSha256);
    return source.replace(change.after, () => change.before);
  }, result.sql);
}

describe("v3 temporary proof function service EXECUTE; no native execution attestation", () => {
  it("pins v2 and proves only one temporary-function GRANT line was added", () => {
    const predecessor = readFileSync("scripts/usdt-manual-195-native-fixture-v2.mjs");
    expect(digest(predecessor)).toBe("7a50c15227c9dffe55d21530f0a0c7f4e12d760f6e35af8dec70cc0867dc4a97");
    const before = "end; $fixture$;\n";
    const after = before + grant + "\n";
    const old = predecessor.toString("utf8");
    expect(old.split(before)).toHaveLength(2);
    expect(readFileSync("scripts/usdt-manual-195-native-fixture-v3.mjs"))
      .toEqual(Buffer.from(old.replace(before, () => after), "utf8"));
    expect(readFileSync("scripts/usdt-manual-195-native-fixture-v3.d.mts"))
      .toEqual(readFileSync("scripts/usdt-manual-195-native-fixture-v2.d.mts"));
    expect(digest(readPredecessor195TestSource(process.cwd(), "scripts/usdt-manual-195-native-fixture.mjs")))
      .toBe("e01df318a08eba8aef8e90060f1c976a4b495b8dee413bc7922e908a2715ed49");
  });
  it("retains all three original frozen input paths and hashes", () => {
    expect(USDT_195_FROZEN_SOURCES).toEqual({
      principal: { path: "supabase/test-fixtures/principal_finalize_current_basis.sql", sha256: "a9869874465283af88759d86f7fc608c96e70abb296774b32f3e40002a96b8d2" },
      krw: { path: "supabase/tests/database/krw_deposit_journal_integrity.sql", sha256: "97e1dc22ac782ad341a16d6b1ab5401a5210c667e5cb698275d9725dd6305d93" },
      concurrency: { path: "tests/integration/external-send-concurrency.py", sha256: "ef224c4a352f5e0d20cb16381e3c6c41e96d2a4660807f3577cb3ea7b3058c0d" },
    });
  });
  it.each(cases)("retains exact original %s provenance, delta roster and reverse bytes", (kind, build, count) => {
    const original = read(kind);
    const result = build(original, explicit);
    expect(digest(original)).toBe(USDT_195_FROZEN_SOURCES[kind].sha256);
    expect(result.source).toEqual(USDT_195_FROZEN_SOURCES[kind]);
    expect(result.changes).toHaveLength(count);
    expect(result.changes.every(change => change.matches === 1)).toBe(true);
    expect(result.sha256).toBe(digest(result.sql));
    expect(Buffer.from(reverse(result), "utf8")).toEqual(original);
    expect(result.status).toBe("AUTHORED_NOT_TESTED");
    expect(() => build(Buffer.concat([original, Buffer.from("\n")]), explicit))
      .toThrow("FROZEN_USDT_195_SOURCE_MISMATCH");
    expect(() => build(original, { fullPayoutConfirmed: false } as unknown as typeof explicit))
      .toThrow("EXPLICIT_TEST_OPERATOR_FULL_PAYOUT_CONFIRMATION_REQUIRED");
    expect(() => build(original, { fullPayoutConfirmed: true, bypass: true } as unknown as typeof explicit))
      .toThrow("EXPLICIT_TEST_OPERATOR_FULL_PAYOUT_CONFIRMATION_REQUIRED");
  });
  it.each([
    ["principal", buildPrincipal195Fixture, "update finalize_usdt_ctx set send=public.record_usdt_external_send("],
    ["krw", buildKrw195Fixture, "set usdt_external_send_id = public.record_usdt_external_send("],
  ] as const)("adds only service execution to the invoker proof and preserves literal %s suffix", (kind, build, tail) => {
    const sql = build(read(kind), explicit).sql;
    expect(sql.split(grant)).toHaveLength(2);
    expect(sql.split(tail)).toHaveLength(2);
    const start = sql.indexOf("create function pg_temp.usdt_195_evidence(");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = sql.indexOf(grant, start) + grant.length;
    const helper = sql.slice(start, end);
    expect(helper).toContain("language plpgsql security invoker set search_path=pg_catalog");
    expect(helper).toContain("or p_actual !~ '^(0|[1-9][0-9]{0,31})([.][0-9]{0,5}[1-9])?$' or p_actual::numeric<=0");
    expect(helper).toContain("r.fee_atomic<>0");
    expect(helper).toContain("'basis','OPERATOR_MANUAL_FULL_PAYOUT'");
    expect(helper).not.toContain("security definer");
    expect(helper).not.toContain("to authenticated");
    expect(helper).not.toContain("to public");
    expect(helper).not.toContain("alter default privileges");
    expect(helper).not.toContain("alter owner");
  });
  it("does not introduce proof helper permissions into the concurrency derivative", () => {
    const sql = buildConcurrency195Fixture(read("concurrency"), explicit).sql;
    expect(sql).not.toContain(grant);
    expect(sql).not.toContain("pg_temp.usdt_195_evidence(");
    expect(sql).toContain('"actualUsdtAmount": "1.25"');
    expect(sql).toContain('"feeKrw": "0"');
  });
});