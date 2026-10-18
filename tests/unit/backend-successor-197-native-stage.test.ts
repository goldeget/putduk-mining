import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  adaptBackend197NativeInput3,
  adaptBackend197DefinerRoster,
  adaptBackend197ServiceRoleInsertFloor,
} from "../../scripts/backend-successor-197-native-stage.mjs";
import { bindBackend197Concurrency } from "../../scripts/backend-successor-197-concurrency.mjs";
import {
  buildPrincipal195Fixture,
  buildConcurrency195Fixture,
  USDT_195_FROZEN_SOURCES,
} from "../../scripts/usdt-manual-195-native-fixture-v3.mjs";
const read = (path: string) =>
  readFileSync(new URL("../../" + path, import.meta.url));
const hash = (source: Buffer | string) =>
  createHash("sha256").update(source).digest("hex");
const basis = read(USDT_195_FROZEN_SOURCES.principal.path),
  input = read(
    "supabase/tests/database/native_principal_finalize_input3_continuity.sql",
  );
describe("successor197 staging preserves native assertions and full-id owner scope", () => {
  it("retains exact original input3 with only three v3 operator-fixture spans", () => {
    const derivative = adaptBackend197NativeInput3(input, basis),
      spans = buildPrincipal195Fixture(basis, {
        fullPayoutConfirmed: true,
      }).changes;
    expect(derivative.changes).toHaveLength(3);
    expect(derivative.reverseExact).toBe(true);
    let reversed = derivative.sql;
    for (const span of [...spans].reverse())
      reversed = reversed.replace(span.after, () => span.before);
    expect(hash(reversed)).toBe(hash(input));
    expect(Buffer.from(reversed).equals(input)).toBe(true);
  });
  it("rejects altered input3 even if its financial text appears equivalent", () =>
    expect(() =>
      adaptBackend197NativeInput3(
        Buffer.concat([input, Buffer.from("\n")]),
        basis,
      ),
    ).toThrow("INPUT3_SOURCE_CHANGED"));
  it("rejects altered original basis", () =>
    expect(() =>
      adaptBackend197NativeInput3(
        input,
        Buffer.concat([basis, Buffer.from("\n")]),
      ),
    ).toThrow("FROZEN_USDT_195_SOURCE_MISMATCH"));
  it.each([
    ["rls.sql", 1],
    ["ws04_security_money_workers.sql", 2],
    ["ai_conversation_storage.sql", 1],
    ["ai_conversation_summaries.sql", 1],
    ["ai_tool_evidence.sql", 1],
  ] as const)(
    "appends only actual SAFE ACK to immutable roster %s",
    (name, count) => {
      const source = read(
          "tests/unit/fixtures/backend197-native-originals/" +
            name +
            ".source.txt",
        ),
        derivative = adaptBackend197DefinerRoster(name, source);
      expect(derivative.changes[0]?.matches).toBe(count);
      expect(derivative.changes).toHaveLength(2);
      expect(derivative.changes[1]).toMatchObject({
        name: "exact-SECDEF-count-77-to-78-for-safe-mode-ack",
        matches: 1,
      });
      expect(derivative.sql.split("select count(*) = 78")).toHaveLength(2);
      expect(derivative.sql).not.toContain("select count(*) = 77");
      expect(derivative.reverseExact).toBe(true);
      expect(
        derivative.sql
          .replace("select count(*) = 78", () => "select count(*) = 77")
          .replaceAll(
            "\n        'app_private.ack_safe_mode_outbox(uuid,text)'::regprocedure,",
            "",
          ),
      ).toBe(source.toString("utf8"));
      expect(() =>
        adaptBackend197DefinerRoster(
          name,
          Buffer.concat([source, Buffer.from("\n")]),
        ),
      ).toThrow("ACL_SOURCE_CHANGED");
    },
  );
  it("rejects a caller-selected unlisted ACL fixture", () =>
    expect(() =>
      adaptBackend197DefinerRoster("other.sql", "select 1;"),
    ).toThrow("ACL_SOURCE_CHANGED"));
  it("removes only the explicitly revoked delivery INSERT entry and reverses to original bytes", () => {
    const source = read(
        "tests/unit/fixtures/backend197-native-originals/service_role_image_default_floor.sql.source.txt",
      ),
      original = source.toString("utf8"),
      derivative = adaptBackend197ServiceRoleInsertFloor(source),
      before =
        "    'deposit_requests',\n    'event_consumer_deliveries',\n    'funding_principal_lots',",
      after = "    'deposit_requests',\n    'funding_principal_lots',";
    expect(derivative.changes).toHaveLength(1);
    expect(derivative.changes[0]).toMatchObject({
      name: "exact-revoked-event-delivery-INSERT-floor",
      matches: 1,
    });
    expect(derivative.reverseExact).toBe(true);
    expect(derivative.sql.split("'event_consumer_deliveries',")).toHaveLength(
      2,
    );
    expect(derivative.sql).toContain("select plan(27);");
    expect(derivative.sql.slice(derivative.sql.indexOf("'UPDATE')"))).toBe(
      original.slice(original.indexOf("'UPDATE')")),
    );
    const reversed = derivative.sql.replace(after, () => before);
    expect(hash(reversed)).toBe(hash(source));
    expect(Buffer.from(reversed).equals(source)).toBe(true);
  });
  it("rejects an altered privilege-floor original", () =>
    expect(() =>
      adaptBackend197ServiceRoleInsertFloor(
        Buffer.concat([
          read(
            "tests/unit/fixtures/backend197-native-originals/service_role_image_default_floor.sql.source.txt",
          ),
          Buffer.from("\n"),
        ]),
      ),
    ).toThrow("INSERT_FLOOR_SOURCE_CHANGED"));
  it("cannot drop the still-granted delivery SELECT entry via a caller-modified fixture", () => {
    const source = read(
      "tests/unit/fixtures/backend197-native-originals/service_role_image_default_floor.sql.source.txt",
    ).toString("utf8");
    expect(() =>
      adaptBackend197ServiceRoleInsertFloor(
        source.replace(
          "    'event_consumer_deliveries',\n    'event_participants',",
          "    'event_participants',",
        ),
      ),
    ).toThrow("INSERT_FLOOR_SOURCE_CHANGED");
  });
  it("binds canonical concurrency to full id without changing financial spans/ROOT/assertions", () => {
    const original = read(USDT_195_FROZEN_SOURCES.concurrency.path),
      derivative = buildConcurrency195Fixture(original, {
        fullPayoutConfirmed: true,
      }),
      bound = bindBackend197Concurrency(
        derivative,
        "CANONICAL_CI",
        null,
        "a".repeat(64),
      );
    expect(bound.scopedChanges).toHaveLength(1);
    expect(
      bound.sql.replace(
        'CONTAINER = "' + "a".repeat(64) + '"',
        'CONTAINER = "supabase_db_" + PROJECT',
      ),
    ).toBe(derivative.sql);
    expect(bound.changes).toEqual(derivative.changes);
  });
  it("rejects owner id or extra profile overrides", () => {
    const derivative = buildConcurrency195Fixture(
      read(USDT_195_FROZEN_SOURCES.concurrency.path),
      { fullPayoutConfirmed: true },
    );
    expect(() =>
      bindBackend197Concurrency(derivative, "CANONICAL_CI", null, "short"),
    ).toThrow("REVIEWED_INPUT_REQUIRED");
    expect(() =>
      bindBackend197Concurrency(derivative, "CANONICAL_CI", {}, "a".repeat(64)),
    ).toThrow("CANONICAL_PROFILE_REJECTED");
    expect(() =>
      bindBackend197Concurrency(derivative, "LOCAL_QA", {}, "a".repeat(64)),
    ).toThrow("EXACT_PROFILE_REQUIRED");
  });
  it.each([
    "rls.sql",
    "ws04_security_money_workers.sql",
    "ai_conversation_storage.sql",
    "ai_conversation_summaries.sql",
    "ai_tool_evidence.sql",
  ] as const)(
    "rejects current successor ACL bytes through frozen197 adapter %s",
    (name) => {
      expect(() =>
        adaptBackend197DefinerRoster(
          name,
          read("supabase/tests/database/" + name),
        ),
      ).toThrow("ACL_SOURCE_CHANGED");
    },
  );
  it("rejects current successor privilege floor through frozen197 adapter", () => {
    expect(() =>
      adaptBackend197ServiceRoleInsertFloor(
        read("supabase/tests/database/service_role_image_default_floor.sql"),
      ),
    ).toThrow("INSERT_FLOOR_SOURCE_CHANGED");
  });
});
