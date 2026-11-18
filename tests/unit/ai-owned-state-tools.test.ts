import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { executeAiTool } from "@/lib/ai/tool-executor";
import { routeAiQuestion } from "@/lib/ai/router";
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const harness = vi.hoisted(() => ({
  admin: null as unknown,
  display: null as unknown,
  binding: { state: "empty" } as unknown,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => harness.admin,
}));
vi.mock("@/lib/product/read-mining-server-display", () => ({
  readOwnMiningServerDisplay: async () => ({
    data: harness.display,
    error: null,
  }),
}));
vi.mock("@/lib/product/read-member-scene-binding.server", () => ({
  readMemberSceneBinding: async () => harness.binding,
}));
vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({
    AI_MAX_REQUESTS_PER_DAY: 100,
    AI_MAX_REQUESTS_PER_MINUTE: 5,
  }),
}));
type Row = Record<string, unknown>;
function client(tables: Record<string, Row[]>, actor = owner) {
  const traces: {
    table: string;
    select: string;
    filters: [string, unknown][];
  }[] = [];
  const port = {
    auth: {
      getClaims: async () => ({
        data: { claims: { sub: actor } },
        error: null,
      }),
    },
    from: (table: string) => {
      const trace = { table, select: "", filters: [] as [string, unknown][] };
      traces.push(trace);
      let single = false,
        head = false;
      let maximum = 100;
      const query: Record<string, unknown> = {
        select: (columns: string, options?: { head?: boolean }) => {
          trace.select = columns;
          head = !!options?.head;
          return query;
        },
        eq: (column: string, value: unknown) => {
          trace.filters.push([column, value]);
          return query;
        },
        order: () => query,
        limit: (limit: number) => {
          maximum = limit;
          return query;
        },
        gte: () => query,
        lte: () => query,
        range: () => query,
        maybeSingle: () => {
          single = true;
          return query;
        },
        then: (resolve: (v: unknown) => unknown) => {
          const rows = (tables[table] ?? []).filter((row) =>
            trace.filters.every(([key, value]) => row[key] === value),
          );
          return Promise.resolve({
            data: head
              ? null
              : single
                ? (rows[0] ?? null)
                : rows.slice(0, maximum),
            count: rows.length,
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { port, traces };
}
const timestamp = "2026-10-09T00:00:00.000000+00:00";
describe("verified own AI tools safe facts", () => {
  it("binds JWT owner and client before any account read", async () => {
    const member = client({}, other),
      independent = client({});
    harness.admin = client({}).port;
    for (const identity of [
      { supabase: member.port, userId: owner },
      { supabase: independent.port, userId: owner },
    ]) {
      const result = await executeAiTool(member.port, "ai.cancelled_history", {
        verifiedIdentity: identity,
      });
      expect(result.ok).toBe(false);
      expect(member.traces).toEqual([]);
    }
  });
  it("uses KRW owner balance only and keeps incomplete principal unknown", async () => {
    const member = client({
      wallet_balance_snapshots: [
        {
          user_id: owner,
          currency: "KRW",
          balance_atomic: "7300",
          available_balance_atomic: "5000",
        },
        {
          user_id: other,
          currency: "KRW",
          balance_atomic: "999999",
          available_balance_atomic: "999999",
        },
        {
          user_id: owner,
          currency: "USDT",
          balance_atomic: "99999",
          available_balance_atomic: "99999",
        },
      ],
    });
    harness.admin = client({
      money_source_summaries: [
        {
          user_id: owner,
          schema_version: 2,
          coverage: "UNRESOLVED",
          eligible_principal_atomic: "12345",
          held_principal_atomic: null,
          recovered_principal_atomic: null,
        },
      ],
    }).port;
    const result = await executeAiTool(member.port, "wallet.summary", {
      verifiedIdentity: { supabase: member.port, userId: owner },
    });
    expect(result.ok).toBe(true);
    expect(result.answer).toContain("5,000");
    expect(result.answer).toContain("2,300");
    expect(result.answer).toContain("모두 확인하지 못했어요");
    expect(result.answer).not.toMatch(/USDT|999|12,345/);
    expect(member.traces[0]?.filters).toContainEqual(["user_id", owner]);
  });
  it("drops the result if the authenticated owner changes during the read", async () => {
    const member = client({
      ai_requests: [{ user_id: owner, status: "CANCELLED" }],
    });
    let claims = 0;
    member.port.auth.getClaims = vi.fn().mockImplementation(async () => ({
      data: { claims: { sub: ++claims === 1 ? owner : other } },
      error: null,
    }));
    const result = await executeAiTool(member.port, "ai.cancelled_history", {
      verifiedIdentity: { supabase: member.port, userId: owner },
    });
    expect(result.ok).toBe(false);
    expect(result.answer).not.toMatch(/\d/);
  });
  it("does not replace an unavailable cancellation count with zero", async () => {
    const member = client({});
    member.port.from = vi.fn().mockImplementation(() => {
      const query = {
        select: () => query,
        eq: () => query,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            count: null,
            data: null,
            error: { code: "UNAVAILABLE" },
          }).then(resolve),
      };
      return query;
    });
    const result = await executeAiTool(member.port, "ai.cancelled_history", {
      verifiedIdentity: { supabase: member.port, userId: owner },
    });
    expect(result.ok).toBe(false);
    expect(result.answer).not.toMatch(/\d/);
  });
  it("reads own quota counts with exact owner filters and no billing or text", async () => {
    const member = client({
      ai_requests: [
        { user_id: owner, status: "CANCELLED" },
        { user_id: owner, status: "COMPLETED" },
        { user_id: other, status: "CANCELLED" },
      ],
    });
    const result = await executeAiTool(member.port, "ai.usage", {
      verifiedIdentity: { supabase: member.port, userId: owner },
      now: new Date(timestamp),
    });
    expect(result.ok).toBe(true);
    expect(result.answer).toContain("2회 / 100회");
    expect(result.answer).toContain("2회 / 5회");
    expect(
      member.traces.every(
        (t) =>
          t.select === "id" &&
          t.filters.some(([k, v]) => k === "user_id" && v === owner),
      ),
    ).toBe(true);
  });
  it("counts cancelled own requests only, without raw transcript or private attempts", async () => {
    const member = client({
      ai_requests: [
        { user_id: owner, status: "CANCELLED" },
        { user_id: owner, status: "FAILED" },
        { user_id: other, status: "CANCELLED" },
      ],
    });
    const result = await executeAiTool(member.port, "ai.cancelled_history", {
      verifiedIdentity: { supabase: member.port, userId: owner },
    });
    expect(result.ok).toBe(true);
    expect(result.answer).toContain("1개");
    expect(member.traces.map((t) => t.table)).toEqual(["ai_requests"]);
  });
  it.each([
    "내 AI 이용 횟수와 다음 이용 가능 시간을 확인해 주세요.",
    "내 AI 대화에서 취소된 답변 기록을 확인해 주세요.",
  ])("uses internal authenticated tool for %s", (question) =>
    expect(routeAiQuestion(question).kind).toBe("tool"),
  );
});
