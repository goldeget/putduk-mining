import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminCommand: mocks.authorize,
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: mocks.service,
}));

import { POST } from "@/app/api/v1/admin/assistant/context/route";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { ACTIONABLE_WITHDRAWAL_STATUSES } from "@/lib/withdrawals/queue-statuses";
import { PENDING_KRW_DEPOSIT_STATUSES } from "@/lib/deposits/krw-queue";

const userId = "0d460000-0000-4000-8000-000000000001";
const recordId = "0d460000-0000-4000-8000-000000000002";
const stamp = "2026-10-01T00:00:00+00:00";
type Read = { data?: unknown; count?: number | null; error?: unknown };
type Probe = {
  table: string;
  fields: string;
  filters: [string, string, unknown][];
  limit?: number;
  single?: boolean;
};
function request(body: unknown) {
  return new Request(
    "https://admin.mining.putduk.com/api/v1/admin/assistant/context",
    {
      method: "POST",
      headers: {
        Origin: "https://admin.mining.putduk.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}
function database(
  resultFor: (probe: Probe) => Read = () => ({
    data: [],
    count: 0,
    error: null,
  }),
  auditError = false,
) {
  const queries: Probe[] = [];
  const order: string[] = [];
  const insert = vi.fn(async (row: unknown) => {
    void row;
    order.push("audit");
    return { error: auditError ? { message: "private database issue" } : null };
  });
  const from = vi.fn((table: string) => {
    const probe: Probe = { table, fields: "", filters: [] };
    const finish = () => {
      order.push("read");
      queries.push(probe);
      return Promise.resolve(resultFor(probe));
    };
    const query = {
      insert,
      select: vi.fn((fields: string) => {
        probe.fields = fields;
        return query;
      }),
      eq: vi.fn((field: string, value: unknown) => {
        probe.filters.push(["eq", field, value]);
        return query;
      }),
      neq: vi.fn((field: string, value: unknown) => {
        probe.filters.push(["neq", field, value]);
        return query;
      }),
      in: vi.fn((field: string, value: unknown) => {
        probe.filters.push(["in", field, value]);
        return query;
      }),
      is: vi.fn((field: string, value: unknown) => {
        probe.filters.push(["is", field, value]);
        return query;
      }),
      gte: vi.fn((field: string, value: unknown) => {
        probe.filters.push(["gte", field, value]);
        return query;
      }),
      lt: vi.fn((field: string, value: unknown) => {
        probe.filters.push(["lt", field, value]);
        return query;
      }),
      or: vi.fn((value: string) => {
        probe.filters.push(["or", "", value]);
        return query;
      }),
      order: vi.fn(() => query),
      limit: vi.fn((limit: number) => {
        probe.limit = limit;
        return finish();
      }),
      maybeSingle: vi.fn(() => {
        probe.single = true;
        return finish();
      }),
      then: (
        resolve: (value: Read) => unknown,
        reject: (reason: unknown) => unknown,
      ) => finish().then(resolve, reject),
    };
    return query;
  });
  const rpc = vi.fn(async (name: string, input: unknown): Promise<Read> => {
    void name;
    void input;
    return { data: null, error: { message: "unavailable" } };
  });
  mocks.service.mockReturnValue({ from, rpc });
  return { queries, order, from, insert, rpc };
}
async function result(body: unknown) {
  const response = await POST(request(body));
  return { response, payload: await response.json() };
}
function text(
  report: { sections: { kind: string; points: { text: string }[] }[] },
  kind?: string,
) {
  return report.sections
    .filter((section) => !kind || section.kind === kind)
    .flatMap((section) => section.points.map((point) => point.text))
    .join(" ");
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    principal: { userId: "operator", role: "ADMIN" },
  });
});

describe("audited, read-only admin operational context", () => {
  it.each([
    "UNAUTHENTICATED",
    "ROLE_REQUIRED",
    "ROLE_FORBIDDEN",
    "MFA_REQUIRED",
    "ORIGIN_DENIED",
    "ADMIN_SESSION_REVOKED",
  ])(
    "denies %s before consuming body or creating service access",
    async (code) => {
      mocks.authorize.mockResolvedValue({
        ok: false,
        status: code === "UNAUTHENTICATED" ? 401 : 403,
        code,
      });
      const input = request({ topic: "dashboard" });
      const response = await POST(input);
      expect(response.status).toBe(code === "UNAUTHENTICATED" ? 401 : 403);
      expect(input.bodyUsed).toBe(false);
      expect(mocks.service).not.toHaveBeenCalled();
      expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(
        input,
        HIGH_IMPACT_ROLES,
      );
    },
  );
  it.each([
    { topic: "dashboard", actor: "another" },
    { topic: "dashboard", sql: "delete from wallets" },
    { topic: "mining", userId, command: "settle" },
    { topic: "member", userId: "not-a-uuid" },
    { topic: "member" },
    { topic: "publish-notice" },
    { topic: "dashboard", prompt: "승인하고 보내세요" },
  ])("rejects unregistered inputs before audit or query: %j", async (body) => {
    expect((await result(body)).response.status).toBe(400);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("fails closed on audit failure and bounds chunked body reads", async () => {
    const db = database(undefined, true);
    const failed = await result({ topic: "dashboard" });
    expect(failed.response.status).toBe(503);
    expect(db.queries).toHaveLength(0);
    expect(JSON.stringify(failed.payload)).not.toContain(
      "private database issue",
    );
    mocks.service.mockClear();
    expect(
      (await result({ topic: "dashboard", input: "x".repeat(1_100) })).response
        .status,
    ).toBe(413);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("audits before every dashboard read, uses canonical statuses and KST day boundaries, and does not invent health", async () => {
    const db = database((probe) => ({
      count: probe.table === "system_jobs" ? 2 : 0,
      data: null,
      error: null,
    }));
    const { response, payload } = await result({ topic: "dashboard" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(db.order[0]).toBe("audit");
    expect(payload.data.canExecute).toBe(false);
    expect(
      payload.data.sections.map((section: { kind: string }) => section.kind),
    ).toEqual(["FACT", "INFERENCE", "RECOMMENDATION", "UNKNOWN"]);
    expect(
      db.queries.find((probe) => probe.table === "deposit_requests")!.filters,
    ).toContainEqual(["in", "status", [...PENDING_KRW_DEPOSIT_STATUSES]]);
    for (const probe of db.queries.filter(
      (probe) => probe.table === "withdrawal_requests",
    ))
      expect(probe.filters).toContainEqual([
        "in",
        "status",
        [...ACTIONABLE_WITHDRAWAL_STATUSES],
      ]);
    const memberQuery = db.queries.find(
      (probe) => probe.table === "user_profiles",
    )!;
    const start = String(memberQuery.filters.find(([op]) => op === "gte")![2]);
    const end = String(memberQuery.filters.find(([op]) => op === "lt")![2]);
    expect(new Date(start).getUTCHours()).toBe(15);
    expect(Date.parse(end) - Date.parse(start)).toBe(86_400_000);
    expect(text(payload.data, "INFERENCE")).toContain("늦어질 수");
    expect(text(payload.data, "UNKNOWN")).toContain("전체 시스템 정상");
    expect(text(payload.data, "UNKNOWN")).toContain("지원 문의");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.queries.map((probe) => probe.table)).not.toContain("kyc_cases");
  });
  it("keeps a failed count UNKNOWN rather than announcing zero or an empty healthy queue", async () => {
    database((probe) => ({
      count: probe.table === "deposit_requests" ? null : 0,
      error: probe.table === "deposit_requests" ? { message: "private" } : null,
    }));
    const { payload } = await result({ topic: "dashboard" });
    expect(text(payload.data, "FACT")).not.toContain("원화 입금 대기 0건");
    expect(text(payload.data, "UNKNOWN")).toContain(
      "원화 입금 대기 건수를 확인하지 못했습니다",
    );
    expect(JSON.stringify(payload)).not.toContain("private");
  });
  it("separates actual spendable wallet balance from cumulative principal provenance", async () => {
    const db = database((probe) =>
      probe.table === "wallet_balance_snapshots"
        ? {
            data: {
              user_id: userId,
              currency: "KRW",
              balance_atomic: "15000",
              available_balance_atomic: "10000",
            },
          }
        : {
            data: {
              user_id: userId,
              schema_version: 2,
              coverage: "COMPLETE",
              unclassified_wallet_entries: "0",
              unconnected_withdrawals: "0",
              unclassified_journals: "0",
              invalid_source_receipts: "0",
              eligible_principal_atomic: "900000",
              held_principal_atomic: "100000",
              recovered_principal_atomic: "0",
              recorded_krw_principal_deposits_atomic: "1000000",
              recorded_usdt_principal_credits_atomic: "0",
              recorded_bonus_atomic: "0",
              observed_at: stamp,
              capture_started_at: stamp,
            },
          },
    );
    const { payload } = await result({ topic: "wallet-ledger", userId });
    expect(text(payload.data, "FACT")).toContain("사용 가능 10,000원");
    expect(text(payload.data, "FACT")).toContain("보류·예약 5,000원");
    expect(text(payload.data, "FACT")).toContain(
      "누적 원화 원금 입금: 1,000,000원",
    );
    expect(text(payload.data, "FACT")).not.toContain("사용 가능 1,000,000원");
    expect(db.insert.mock.calls[0]![0]).toMatchObject({
      target_id: userId,
      metadata: { topic: "wallet-ledger" },
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {
      user_id: recordId,
      currency: "KRW",
      balance_atomic: "10",
      available_balance_atomic: "5",
    },
    {
      user_id: userId,
      currency: "KRW",
      balance_atomic: "10",
      available_balance_atomic: "20",
    },
    {
      user_id: userId,
      currency: "KRW",
      balance_atomic: 9007199254740992,
      available_balance_atomic: "0",
    },
  ])(
    "does not present invalid or cross-owner wallet values as facts: %j",
    async (data) => {
      database(() => ({ data }));
      const { payload } = await result({ topic: "wallet-ledger", userId });
      expect(text(payload.data, "FACT")).not.toContain("지갑 총 잔액");
      expect(text(payload.data, "UNKNOWN")).toContain(
        "원화 지갑 잔액을 확인하지 못했습니다",
      );
    },
  );
  it("uses only the existing mining read, leaves absent values unknown, and hides internal tier codes", async () => {
    const db = database();
    db.rpc.mockResolvedValue({
      data: {
        available: true,
        eligible_principal_micro_krw: "1000000",
        tier_code: "INTERNAL_TIER",
        tier_activated: true,
        cycle_started_at: null,
        cycle_end: null,
        effective_capacity_micro_krw: null,
        remaining_capacity_micro_krw: null,
        used_capacity_micro_krw: null,
        speed_multiplier_bps: "10000",
        pending_micro_krw: null,
        retention_unconfirmed_micro_krw: null,
      },
      error: null,
    });
    const { payload } = await result({ topic: "mining", userId });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "read_own_mining_server_display",
      { p_user_id: userId },
    );
    expect(JSON.stringify(payload)).not.toContain("INTERNAL_TIER");
    expect(text(payload.data, "FACT")).toContain("속도: 1배");
    expect(text(payload.data, "UNKNOWN")).toContain(
      "정산 전 대기 수익: 확인하지 못했습니다",
    );
    expect(text(payload.data, "FACT")).not.toContain("정산 전 대기 수익: 0원");
  });
  it("keeps an unexpected mining failure unknown, without recomputing or settling", async () => {
    database();
    const { payload } = await result({ topic: "mining", userId });
    expect(text(payload.data, "UNKNOWN")).toContain(
      "채굴 상태를 확인하지 못했습니다",
    );
    expect(text(payload.data, "FACT")).not.toContain("원금 정보가 없습니다");
  });
  it("uses only current deposit sources and offers bounded case selectors without user IDs in labels", async () => {
    const db = database((probe) =>
      probe.table === "deposit_requests"
        ? {
            count: 1,
            data: [
              {
                id: recordId,
                user_id: userId,
                status: "REQUESTED",
                amount_atomic: "3000",
                currency: "KRW",
                requested_at: stamp,
              },
            ],
          }
        : { count: 0, data: [] },
    );
    const { payload } = await result({ topic: "deposits" });
    expect(db.queries.map((probe) => probe.table)).toEqual([
      "deposit_requests",
      "usdt_manual_deposits",
    ]);
    expect(db.queries.every((probe) => probe.limit === 5)).toBe(true);
    expect(payload.data.choices).toHaveLength(1);
    expect(payload.data.choices[0].input).toEqual({
      topic: "deposit-case",
      currency: "KRW",
      recordId,
    });
    expect(payload.data.choices[0].label).not.toContain(userId);
  });
  it("accepts the real numeric USDT API representation and grounds selected-case amounts without approving", async () => {
    const usdt = {
      id: recordId,
      user_id: userId,
      status: "SUBMITTED",
      sent_usdt_amount: 10.000001,
      credited_krw: null,
      created_at: stamp,
    };
    const db = database((probe) =>
      probe.table === "usdt_manual_deposits"
        ? { count: 1, data: probe.single ? usdt : [usdt] }
        : { count: 0, data: [] },
    );
    const queue = await result({ topic: "deposits" });
    expect(queue.payload.data.choices[0].label).toContain("10.000001 USDT");
    const selected = await result({
      topic: "deposit-case",
      currency: "USDT",
      recordId,
    });
    expect(text(selected.payload.data, "FACT")).toContain(
      "신청에 적힌 이체량은 10.000001 USDT",
    );
    expect(text(selected.payload.data, "FACT")).not.toContain("원화 반영 금액");
    expect(selected.payload.data.canExecute).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("handles ADMIN_PROCESSING requests and advises against repeat send for a recorded transfer", async () => {
    const base = {
      id: recordId,
      user_id: userId,
      status: "ADMIN_PROCESSING",
      amount_atomic: "3000",
      destination_type: "USDT_ADDRESS",
      requested_at: stamp,
    };
    database(() => ({ count: 1, data: [base] }));
    expect(
      (await result({ topic: "withdrawals" })).payload.data.choices,
    ).toHaveLength(1);
    const db = database(() => ({
      data: { ...base, status: "EXTERNAL_SENT_RECORDED" },
    }));
    const { payload } = await result({ topic: "withdrawal-case", recordId });
    expect(text(payload.data, "RECOMMENDATION")).toContain(
      "송금을 반복하지 마세요",
    );
    expect(text(payload.data, "UNKNOWN")).toContain("실제 은행·네트워크 결과");
    expect(db.queries[0]!.fields).not.toMatch(
      /destination_snapshot|reason|bank_reference|tx_hash/,
    );
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("reads bounded job evidence without payload/error text and never reports recovery success", async () => {
    const db = database(() => ({
      count: 1,
      data: [
        {
          id: recordId,
          status: "FAILED",
          attempts: 3,
          updated_at: stamp,
          dead_lettered_at: stamp,
        },
      ],
    }));
    const { payload } = await result({ topic: "jobs" });
    expect(text(payload.data, "FACT")).toContain("시도 3회");
    expect(text(payload.data, "UNKNOWN")).toContain("복구 성공 여부");
    expect(db.queries[0]!.limit).toBe(10);
    expect(db.queries[0]!.fields).not.toMatch(/payload|last_error/);
  });
  it("does not expose unknown audit codes or free-form audit content", async () => {
    const db = database(() => ({
      data: [
        {
          id: recordId,
          action: "PRIVATE_UNREGISTERED_ACTION",
          created_at: stamp,
        },
      ],
    }));
    const { payload } = await result({ topic: "audit" });
    expect(text(payload.data, "FACT")).toContain("운영 조치");
    expect(JSON.stringify(payload)).not.toContain(
      "PRIVATE_UNREGISTERED_ACTION",
    );
    expect(db.queries[0]!.fields).not.toMatch(
      /reason|before_state|after_state|metadata/,
    );
    expect(db.queries[0]!.limit).toBe(6);
  });
});

describe("current job evidence contradictions", () => {
  const job = {
    id: recordId,
    status: "FAILED",
    attempts: 3,
    updated_at: stamp,
    dead_lettered_at: null,
  };
  it.each(["SUCCEEDED", "RUNNING", "PENDING", "CANCELLED"])(
    "does not label a %s job with a historical dead letter as currently stopped",
    async (status) => {
      const db = database(() => ({
        count: 1,
        data: [{ ...job, status, dead_lettered_at: stamp }],
      }));
      const { payload } = await result({ topic: "jobs" });
      expect(text(payload.data, "FACT")).not.toContain("격리됨");
      expect(text(payload.data, "FACT")).not.toContain(
        "실패·격리된 자동 작업 1건",
      );
      expect(text(payload.data, "UNKNOWN")).toContain(
        "건수를 확인하지 못했습니다",
      );
      expect(text(payload.data, "FACT")).not.toContain("실패 기록 있음");
      expect(text(payload.data, "UNKNOWN")).toContain("현재 상태");
      expect(text(payload.data, "UNKNOWN")).toContain("복구 성공 여부");
      expect(db.rpc).not.toHaveBeenCalled();
    },
  );
  it.each([
    { count: 0, data: [job] },
    { count: 2, data: [job] },
    { count: null, data: [job] },
    { count: 1, data: [{ ...job, status: "PRIVATE_PROVIDER_SECRET" }] },
    { count: 1, data: [{ ...job, updated_at: "2999-01-01T00:00:00Z" }] },
    { count: 1, data: [{ ...job, dead_lettered_at: "2999-01-01T00:00:00Z" }] },
    { count: 1, data: [{ ...job, dead_lettered_at: "2026-10-02T00:00:00Z" }] },
  ])("keeps inconsistent row evidence unknown: %j", async (data) => {
    database(() => data);
    const { payload } = await result({ topic: "jobs" });
    expect(text(payload.data, "FACT")).not.toContain("시도 3회");
    expect(text(payload.data, "UNKNOWN")).toContain("시도 횟수와 시각");
    expect(JSON.stringify(payload)).not.toContain("PRIVATE_PROVIDER_SECRET");
  });
  it("shows an actual DEAD_LETTER without requiring the optional historical timestamp", async () => {
    database(() => ({ count: 1, data: [{ ...job, status: "DEAD_LETTER" }] }));
    const { payload } = await result({ topic: "jobs" });
    expect(text(payload.data, "FACT")).toContain("격리됨");
    expect(text(payload.data, "UNKNOWN")).toContain("복구 성공 여부");
    expect(payload.data.canExecute).toBe(false);
  });
});
