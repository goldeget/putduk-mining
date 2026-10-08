import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { executeAiTool } from "@/lib/ai/tool-executor";
import { ownedPrincipalCancellationFacts } from "@/lib/ai/owned-state-tools";
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
    member.port.auth.getClaims = vi
      .fn()
      .mockImplementation(async () => ({
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
  it("uses approved tier/principal and clearly refuses to convert allocation to entitlement", async () => {
    const member = client({});
    harness.display = {
      available: true,
      eligible_principal_micro_krw: "100000000",
      tier_code: "TIER_1",
      tier_activated: false,
      cycle_started_at: null,
      cycle_end: null,
      effective_capacity_micro_krw: null,
      remaining_capacity_micro_krw: null,
      used_capacity_micro_krw: null,
      speed_multiplier_bps: null,
      pending_micro_krw: null,
      retention_unconfirmed_micro_krw: null,
    };
    harness.binding = {
      state: "ready",
      products: [{ nameKo: "공식 선택 상품" }],
    };
    const result = await executeAiTool(member.port, "mining.status", {
      verifiedIdentity: { supabase: member.port, userId: owner },
    });
    expect(result.ok).toBe(true);
    expect(result.answer).toContain("100원");
    expect(result.answer).toContain("TIER_1");
    expect(result.answer).toContain("적용 전");
    expect(result.answer).toContain(
      "이용 자격이나 현재 채굴 실행을 확정할 수는 없어요",
    );
    expect(result.answer).not.toMatch(
      /allocation_bps|speed_multiplier|reward_carry|product_multiplier/,
    );
  });
  it("proves principal cancelled status only with matching immutable allocation and release", async () => {
    const hold = "00000000-0000-4000-8000-000000000003",
      release = "00000000-0000-4000-8000-000000000004";
    const member = client({
      withdrawal_requests: [
        {
          user_id: owner,
          status: "CANCELLED",
          hold_ledger_transaction_id: hold,
          release_ledger_transaction_id: release,
          hold_released_at: timestamp,
        },
      ],
    });
    const admin = client({
      funding_principal_recovery_allocations: [
        {
          user_id: owner,
          hold_ledger_transaction_id: hold,
          effective_at: timestamp,
        },
      ],
      funding_principal_recovery_releases: [
        {
          user_id: owner,
          hold_ledger_transaction_id: hold,
          release_ledger_transaction_id: release,
          effective_at: timestamp,
        },
      ],
    });
    harness.admin = admin.port;
    const answer = await ownedPrincipalCancellationFacts({
      supabase: member.port,
      userId: owner,
    });
    expect(answer).toContain("일치하는 요청은 1개");
    expect(answer).not.toContain(hold);
    expect(answer).not.toContain(release);
    expect(
      admin.traces.every((t) =>
        t.filters.some(([k, v]) => k === "user_id" && v === owner),
      ),
    ).toBe(true);
    harness.admin = client({
      funding_principal_recovery_allocations: [
        {
          user_id: other,
          hold_ledger_transaction_id: hold,
          effective_at: timestamp,
        },
      ],
    }).port;
    expect(
      await ownedPrincipalCancellationFacts({
        supabase: member.port,
        userId: owner,
      }),
    ).toContain("일치하는 요청은 0개");
  });
  it.each([
    "내 AI 이용 횟수와 다음 이용 가능 시간을 확인해 주세요.",
    "내 AI 대화에서 취소된 답변 기록을 확인해 주세요.",
  ])("uses internal authenticated tool for %s", (question) =>
    expect(routeAiQuestion(question).kind).toBe("tool"),
  );
});
