import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import {
  projectOperationRecord,
  readOperationsSnapshot,
} from "@/lib/operations/read";
import {
  canReadOperation,
  isOperationSection,
  operationStatus,
} from "@/lib/operations/registry";

const id = "00000000-0000-4000-8000-000000000001";
const at = "2026-10-07T01:00:00Z";
function database(result: unknown) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  for (const method of [
    "select",
    "order",
    "limit",
    "gte",
    "lte",
    "abortSignal",
  ])
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  const from = vi.fn(() => builder);
  return { db: { from } as unknown as SupabaseClient, from, calls };
}

describe("read-only operations", () => {
  it("denies financial/security views to content and support roles", () => {
    expect(canReadOperation("ledger", "CONTENT_ADMIN")).toBe(false);
    expect(canReadOperation("audit", "SUPPORT_ADMIN")).toBe(false);
    expect(canReadOperation("notices", "CONTENT_ADMIN")).toBe(true);
    expect(canReadOperation("support", "SUPPORT_ADMIN")).toBe(true);
    expect(isOperationSection("__proto__")).toBe(false);
    expect(operationStatus("PRIVATE_INTERNAL_ERROR")).toBe("상태 확인 필요");
  });
  it("strips sensitive payloads and raw job enum from rendered projections", () => {
    const projected = projectOperationRecord("jobs", {
      id,
      status: "FAILED",
      job_type: "PRIVATE_JOB",
      updated_at: at,
      attempts: 3,
      payload: { token: "secret" },
      last_error_code: "private-address",
    });
    expect(projected).toMatchObject({
      title: "운영 기록",
      status: "실패 확인 필요",
      detail: "처리 시도 3회",
    });
    expect(JSON.stringify(projected)).not.toMatch(
      /secret|private-address|PRIVATE_JOB/,
    );
  });
  it("rejects malformed IDs and preserves unknown states", () => {
    expect(projectOperationRecord("events", { id: "not-a-uuid" })).toBeNull();
    expect(
      projectOperationRecord("mining", {
        id,
        status: "NEW_STATUS",
        last_settled_at: "invalid",
      }),
    ).toMatchObject({
      status: "상태 확인 필요",
      detail: "마지막 정산 시각 확인 필요",
    });
  });
  it("returns empty only for a successful exact zero", async () => {
    const { db, calls } = database({ data: [], count: 0, error: null });
    const result = await readOperationsSnapshot(db, "notices", new Date(at));
    expect(result.panels[0]).toMatchObject({
      state: "ready",
      count: 0,
      rows: [],
    });
    expect(calls.some((call) => call.method === "abortSignal")).toBe(true);
    expect(calls.find((call) => call.method === "limit")?.args).toEqual([20]);
  });
  it.each([
    { data: [], count: null, error: null },
    { data: [], count: 0, error: { message: "permission denied" } },
    { data: [{ id: "invalid" }], count: 1, error: null },
    { data: [], count: 3, error: null },
    { data: [{ id }], count: 0, error: null },
  ])(
    "does not turn missing, denied or inconsistent reads into empty: %j",
    async (response) => {
      const { db } = database(response);
      expect(
        (await readOperationsSnapshot(db, "events", new Date(at))).panels[0],
      ).toMatchObject({ state: "unavailable", count: null, rows: [] });
    },
  );
  it("bounds analytics to the requested trailing day, without properties or actor data", async () => {
    const { db, calls } = database({ data: [], count: 0, error: null });
    await readOperationsSnapshot(db, "analytics", new Date(at));
    expect(
      calls.filter((call) => call.method === "gte").map((call) => call.args[1]),
    ).toEqual(["2026-10-06T01:00:00.000Z", "2026-10-06T01:00:00.000Z"]);
    expect(
      calls
        .filter((call) => call.method === "select")
        .some((call) => String(call.args[0]).includes("properties")),
    ).toBe(false);
  });
  it("support drafts have no ticket lookup or write operation", async () => {
    const { db, from } = database({ data: [], count: 0, error: null });
    expect(
      (await readOperationsSnapshot(db, "support", new Date(at))).panels,
    ).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});
