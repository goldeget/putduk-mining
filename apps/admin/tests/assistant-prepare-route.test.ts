import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminCommand: mocks.authorize,
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: mocks.service,
}));

import { POST } from "@/app/api/v1/admin/assistant/prepare/route";
import { ADMIN_ASSISTANT_OPERATIONS } from "@/lib/assistant/operations";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import {
  usdtDepositConfirmInput,
  usdtDepositDraftInput,
} from "@/lib/deposits/usdt-confirm-input";

const depositId = "0d460000-0000-4000-8000-000000000001";
const draft = {
  task: "usdt-deposit-draft",
  depositId,
  creditedKrw: "50000",
  reason: "운영자가 외부 이체 증빙을 확인합니다.",
};
const pending = { task: "usdt-deposit-pending" };

function request(value: unknown) {
  return new Request(
    "https://admin.mining.putduk.com/api/v1/admin/assistant/prepare",
    {
      method: "POST",
      headers: {
        origin: "https://admin.mining.putduk.com",
        "content-type": "application/json",
      },
      body: JSON.stringify(value),
    },
  );
}

function database(
  result: unknown = {
    data: [{ created_at: "2026-09-01T00:00:00Z" }],
    count: 3,
    error: null,
  },
) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
  };
  const db = {
    from: vi.fn(() => query),
    rpc: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  };
  mocks.service.mockReturnValue(db);
  return { db, query };
}

describe("operator assistant read and draft boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      ok: true,
      principal: { userId: "operator", role: "ADMIN" },
    });
  });

  it.each([
    "ORIGIN_DENIED",
    "ROLE_FORBIDDEN",
    "MFA_REQUIRED",
    "ADMIN_SESSION_REVOKED",
  ])("returns guard denial %s before database access", async (code) => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 403, code });
    const input = request(pending);
    const response = await POST(input);
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe(code);
    expect(input.bodyUsed).toBe(false);
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(
      input,
      HIGH_IMPACT_ROLES,
    );
  });

  it("returns a server-observed exact count and oldest timestamp from one limited read", async () => {
    const { db, query } = database();
    const response = await POST(request(pending));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload.data).toMatchObject({
      task: pending.task,
      count: 3,
      oldestAt: "2026-09-01T00:00:00Z",
      href: "/deposits/usdt",
    });
    expect(Date.parse(payload.data.observedAt)).toBeGreaterThan(0);
    expect(db.from).toHaveBeenCalledExactlyOnceWith("usdt_manual_deposits");
    expect(query.select).toHaveBeenCalledExactlyOnceWith("created_at", {
      count: "exact",
    });
    expect(query.eq).toHaveBeenCalledExactlyOnceWith("status", "SUBMITTED");
    expect(query.order).toHaveBeenCalledExactlyOnceWith("created_at", {
      ascending: true,
    });
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(1);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("reports zero only when the actual successful read has no pending row", async () => {
    database({ data: [], count: 0, error: null });
    const response = await POST(request(pending));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      count: 0,
      oldestAt: null,
    });
  });

  it.each([
    { data: [], count: null, error: null },
    { data: [], count: 0, error: { message: "private SQL failure" } },
    { data: [], count: -1, error: null },
    { data: [], count: 1.5, error: null },
    { data: [], count: 2, error: null },
    { data: [{ created_at: "bad" }], count: 2, error: null },
    { data: [{ created_at: "2999-01-01T00:00:00Z" }], count: 2, error: null },
    { data: [{ created_at: "2026-09-01T00:00:00Z" }], count: 0, error: null },
  ])(
    "never converts a failed or inconsistent count to a successful zero",
    async (result) => {
      database(result);
      const response = await POST(request(pending));
      expect(response.status).toBe(503);
      const payload = await response.json();
      expect(payload.error.code).toBe("READ_UNAVAILABLE");
      expect(payload.data).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain("private SQL failure");
    },
  );

  it("prepares a validated short-lived draft with no approval or mutation credential", async () => {
    const { db, query } = database({
      data: {
        id: depositId,
        status: "SUBMITTED",
        created_at: "2026-09-01T00:00:00Z",
      },
      error: null,
    });
    const response = await POST(
      request({
        ...draft,
        creditedKrw: " 50000 ",
        reason: ` ${draft.reason} `,
      }),
    );
    const payload = (await response.json()).data;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload).toEqual({
      task: draft.task,
      command: "confirm_usdt_manual_deposit",
      input: { depositId, creditedKrw: "50000", reason: draft.reason },
      targetCreatedAt: "2026-09-01T00:00:00Z",
      preparedAt: expect.any(String),
      expiresAt: expect.any(String),
      href: "/deposits/usdt",
      canExecute: false,
    });
    expect(Date.parse(payload.expiresAt) - Date.parse(payload.preparedAt)).toBe(
      300_000,
    );
    expect(usdtDepositDraftInput.safeParse(payload.input).success).toBe(true);
    expect(usdtDepositConfirmInput.safeParse(payload.input).success).toBe(
      false,
    );
    expect(query.select).toHaveBeenCalledExactlyOnceWith(
      "id,status,created_at",
    );
    expect(query.eq).toHaveBeenCalledExactlyOnceWith("id", depositId);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { id: depositId, status: "CONFIRMED" },
    { id: "another", status: "SUBMITTED" },
  ])(
    "rejects a stale or mismatched target before presenting a draft",
    async (data) => {
      database({ data, error: null });
      const response = await POST(request(draft));
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe("DEPOSIT_NOT_PENDING");
    },
  );

  it.each([
    { ...draft, creditedKrw: "0" },
    { ...draft, creditedKrw: "1.1" },
    { ...draft, creditedKrw: "9007199254740993" },
    { ...draft, reason: "짧음" },
    { ...draft, actor: "operator" },
    { ...draft, confirmation: "CONFIRM_USDT_DEPOSIT" },
    { ...draft, stepUpToken: "credential" },
    { ...draft, idempotencyKey: "approved-key" },
    { ...pending, table: "user_roles" },
    { task: "execute", command: "confirm_usdt_manual_deposit" },
    { task: "make-everyone-admin" },
  ])(
    "rejects unsupported operations, inputs and injected authority fields",
    async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(mocks.service).not.toHaveBeenCalled();
    },
  );

  it.each([null, "text/plain", "application/x-www-form-urlencoded"])(
    "rejects unsupported content type %s before reads",
    async (contentType) => {
      const input = request(pending);
      if (contentType === null) input.headers.delete("content-type");
      else input.headers.set("content-type", contentType);
      expect((await POST(input)).status).toBe(400);
      expect(mocks.service).not.toHaveBeenCalled();
    },
  );

  it("limits UTF-8 bytes even without a declared body length", async () => {
    const response = await POST(
      request({ ...draft, reason: "한".repeat(1_400) }),
    );
    expect(response.status).toBe(413);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it("rejects oversized declared bodies and malformed JSON before reads", async () => {
    const oversized = request(pending);
    oversized.headers.set("content-length", "10000");
    expect((await POST(oversized)).status).toBe(413);
    const invalid = new Request(oversized.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    expect((await POST(invalid)).status).toBe(400);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it("fails closed after transport loss without leaking the exception or fabricating a draft", async () => {
    mocks.service.mockImplementation(() => {
      throw new Error("private database URL");
    });
    const response = await POST(request(draft));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "READ_UNAVAILABLE",
        message: "요청 결과를 확인하지 못했습니다. 다시 확인해 주세요.",
      },
    });
  });

  it("registers only bounded reads and a draft of the existing public command", () => {
    expect(Object.keys(ADMIN_ASSISTANT_OPERATIONS)).toEqual([
      pending.task,
      draft.task,
    ]);
    expect(ADMIN_ASSISTANT_OPERATIONS["usdt-deposit-draft"].command).toBe(
      "confirm_usdt_manual_deposit",
    );
    expect(ADMIN_ASSISTANT_OPERATIONS["usdt-deposit-draft"].commandFamily).toBe(
      "DEPOSIT_CONFIRM",
    );
    for (const operation of Object.values(ADMIN_ASSISTANT_OPERATIONS)) {
      expect(operation).not.toHaveProperty("execute");
      expect(operation.allowedRoles).toBe(HIGH_IMPACT_ROLES);
    }
  });
});
