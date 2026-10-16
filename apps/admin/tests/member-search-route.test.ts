import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminCommand: mocks.authorize,
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: mocks.service,
}));
import { POST } from "@/app/api/v1/admin/members/search/route";
import { ADMIN_ROLES } from "@/lib/auth/policy";

const identity = {
  user_id: "0d460000-0000-4000-8000-000000000001",
  legal_name: "홍길동",
  login_id: "putduk_user",
  phone_e164: "+821012345678",
};
function request(query: unknown) {
  return new Request(
    "https://admin.mining.putduk.com/api/v1/admin/members/search",
    {
      method: "POST",
      headers: {
        Origin: "https://admin.mining.putduk.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
}
type Probe = {
  table: string;
  fields: string;
  filters: [string, string, unknown][];
  limit: number;
};
function database(
  options: {
    identities?: unknown[];
    profiles?: unknown[];
    auditError?: boolean;
    readError?: boolean;
  } = {},
) {
  const queries: Probe[] = [];
  const order: string[] = [];
  const insert = vi.fn(async (_row: unknown) => {
    void _row;
    order.push("audit");
    return {
      error: options.auditError ? { message: "private audit error" } : null,
    };
  });
  const from = vi.fn((table: string) => {
    if (table === "audit_logs") return { insert };
    const probe: Probe = { table, fields: "", filters: [], limit: 0 };
    queries.push(probe);
    const query = {
      select: vi.fn((fields: string) => {
        probe.fields = fields;
        return query;
      }),
      eq: vi.fn((field: string, value: unknown) => {
        probe.filters.push(["eq", field, value]);
        return query;
      }),
      ilike: vi.fn((field: string, value: unknown) => {
        probe.filters.push(["ilike", field, value]);
        return query;
      }),
      in: vi.fn((field: string, value: unknown) => {
        probe.filters.push(["in", field, value]);
        return query;
      }),
      order: vi.fn(() => query),
      limit: vi.fn(async (limit: number) => {
        probe.limit = limit;
        order.push("read");
        return {
          data: options.readError
            ? null
            : table === "user_profiles"
              ? (options.profiles ?? [])
              : (options.identities ?? [identity]),
          error: options.readError ? { message: "private SQL error" } : null,
        };
      }),
    };
    return query;
  });
  mocks.service.mockReturnValue({ from });
  return { queries, order, insert, from };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    principal: { userId: "operator", role: "SUPPORT_ADMIN" },
  });
});
describe("audited masked member lookup", () => {
  it.each([
    "UNAUTHENTICATED",
    "ROLE_REQUIRED",
    "MFA_REQUIRED",
    "ORIGIN_DENIED",
    "ADMIN_SESSION_REVOKED",
  ])(
    "denies %s before reading input or creating a service client",
    async (code) => {
      mocks.authorize.mockResolvedValue({
        ok: false,
        status: code === "UNAUTHENTICATED" ? 401 : 403,
        code,
      });
      const input = request("홍길동");
      const response = await POST(input);
      expect(response.status).toBe(code === "UNAUTHENTICATED" ? 401 : 403);
      expect(input.bodyUsed).toBe(false);
      expect(mocks.service).not.toHaveBeenCalled();
      expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(
        input,
        ADMIN_ROLES,
      );
    },
  );
  it("requires successful audit before any identity read and never records the raw query", async () => {
    const db = database();
    const response = await POST(request("홍길동"));
    expect(response.status).toBe(200);
    expect(db.order[0]).toBe("audit");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    const audit = db.insert.mock.calls[0]![0] as unknown;
    expect(JSON.stringify(audit)).not.toContain("홍길동");
    const payload = await response.json();
    expect(payload.data.members).toEqual([
      {
        userId: identity.user_id,
        name: "홍*동",
        loginId: "pu*******er",
        phone: "•••• 5678",
      },
    ]);
    for (const raw of [
      identity.legal_name,
      identity.login_id,
      identity.phone_e164,
    ])
      expect(JSON.stringify(payload)).not.toContain(raw);
    expect(db.queries.map((query) => query.table)).toContain("user_profiles");
    expect(
      db.queries.some((query) =>
        query.filters.some((filter) => filter[1] === "legal_name"),
      ),
    ).toBe(true);
    expect(db.queries.every((query) => query.limit <= 21)).toBe(true);
  });
  it("fails closed if audit insertion fails", async () => {
    const db = database({ auditError: true });
    const response = await POST(request(identity.phone_e164));
    expect(response.status).toBe(503);
    expect(db.queries).toHaveLength(0);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private audit error",
    );
  });
  it.each(["010-1234-5678", "01012345678", "+821012345678"])(
    "normalizes %s for exact phone lookup and retains login-ID search",
    async (query) => {
      const db = database();
      expect((await POST(request(query))).status).toBe(200);
      expect(
        db.queries.some((read) =>
          read.filters.some(
            (filter) =>
              filter[0] === "eq" &&
              filter[1] === "phone_e164" &&
              filter[2] === identity.phone_e164,
          ),
        ),
      ).toBe(true);
      expect(
        db.queries.some((read) =>
          read.filters.some((filter) => filter[1] === "login_id"),
        ),
      ).toBe(true);
    },
  );
  it("treats wildcard-looking input literally and does not insert a raw .or filter", async () => {
    const db = database();
    await POST(request("Mine_%"));
    expect(db.queries[0]!.filters).toContainEqual([
      "ilike",
      "legal_name",
      "%Mine\\_\\%%",
    ]);
    expect(db.queries[1]!.filters).toContainEqual([
      "ilike",
      "login_id",
      "mine\\_\\%%",
    ]);
    expect(db.queries.map((read) => read.table)).toEqual([
      "user_identity_profiles",
      "user_identity_profiles",
      "user_profiles",
    ]);
  });
  it("caps responses at 20 distinct members and signals remaining matches", async () => {
    const identities = Array.from({ length: 21 }, (_, index) => ({
      ...identity,
      user_id: `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000001`,
    }));
    database({ identities });
    const response = await POST(request("홍길동"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data.members).toHaveLength(20);
    expect(payload.data.hasMore).toBe(true);
  });
  it("uses exact UUID equality, with a profile fallback for legacy identities", async () => {
    const db = database({
      identities: [],
      profiles: [{ user_id: identity.user_id, display_name: "홍길동" }],
    });
    const response = await POST(request(identity.user_id));
    expect(db.queries[0]!.filters).toEqual([
      ["eq", "user_id", identity.user_id],
    ]);
    expect((await response.json()).data.members).toEqual([
      { userId: identity.user_id, name: "홍*동", loginId: null, phone: null },
    ]);
  });
  it("returns unavailable for read failures instead of a false empty result", async () => {
    database({ readError: true });
    const response = await POST(request("홍길동"));
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.data).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("private SQL error");
  });
  it("bounds oversized bodies before audit or reads", async () => {
    const response = await POST(request("x".repeat(513)));
    expect(response.status).toBe(413);
    expect(mocks.service).not.toHaveBeenCalled();
  });
});
