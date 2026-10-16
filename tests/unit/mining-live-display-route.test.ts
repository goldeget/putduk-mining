import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/mining/display/route";
import { emptyMiningServerDisplay } from "@/lib/product/mining-server-display";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: mocks.identity }));
vi.mock("@/lib/product/read-mining-server-display", () => ({
  readOwnMiningServerDisplay: mocks.read,
}));
const identity = { userId: "verified-owner", supabase: {} };
const display = {
  ...emptyMiningServerDisplay,
  available: true,
  cycle_started_at: "2026-10-01T00:00:00.000000Z",
  cycle_end: "2026-11-01T00:00:00.000000Z",
  effective_capacity_micro_krw: "10000000",
  used_capacity_micro_krw: "1000000",
  remaining_capacity_micro_krw: "9000000",
  pending_micro_krw: "1000000",
  funded_runtime: {
    schema_version: 2,
    runtime_version: 2,
    state_revision: "1",
    condition_revision: "1",
    accepted_cursor_at: "2026-10-13T00:00:00.000000Z",
    evaluated_at: "2026-10-13T00:00:01.000000Z",
    allocation_bps: "10000",
    committed_reward_total_atomic: "12",
    reward_carry: { numerator: "0", denominator: "1", unit: "KRW" },
    conditional_maintenance: {
      numerator: "7",
      denominator: "1",
      unit: "KRW",
      qualification: "UNCONFIRMED",
    },
    status: "ACTIVE",
    stop_reason: null,
    speed: {
      product_multiplier_bps: "10000",
      user_multiplier_bps: "10000",
      common_multiplier: { numerator: "1", denominator: "1" },
      effective_global_multiplier: { numerator: "1", denominator: "1" },
    },
  },
};
const request = (
  path = "",
  owner = "verified-owner",
  extra: Record<string, string> = {},
) =>
  new Request(`http://localhost:3000/api/v1/mining/display${path}`, {
    headers: { "X-Putduk-Mining-Owner": owner, ...extra },
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue(identity);
  mocks.read.mockResolvedValue({ data: display, error: null });
});

describe("owned read-only mining display GET", () => {
  it("returns only the verified identity's minimal facts with private no-store headers", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.ownerId).toBe(identity.userId);
    expect(body.data.snapshot.scope).toBe("GLOBAL_CYCLE");
    expect(body.data.snapshot.committedKrw).toBe("12");
    expect(body.data.snapshot).not.toHaveProperty("speed");
    expect(body.data.snapshot).not.toHaveProperty("conditional_maintenance");
    expect(body.data.snapshot).not.toHaveProperty("allocation_bps");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(identity);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie, Authorization");
  });
  it.each([
    ["?user_id=other", "verified-owner", {}, 400],
    ["", "other", {}, 409],
    ["", "", {}, 409],
    ["", "verified-owner", { "sec-fetch-site": "cross-site" }, 400],
  ] as const)(
    "rejects client subject/context before privileged reading: %s %s",
    async (path, owner, extra, status) => {
      const response = await GET(request(path, owner, extra));
      expect(response.status).toBe(status);
      expect(mocks.read).not.toHaveBeenCalled();
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    },
  );
  it("does not read financial facts without verified authentication", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(["returned-error", "thrown-error", "legacy", "invalid"])(
    "returns unavailable instead of trusting %s facts",
    async (kind) => {
      if (kind === "returned-error")
        mocks.read.mockResolvedValue({
          data: display,
          error: { message: "secret fixture detail" },
        });
      if (kind === "thrown-error")
        mocks.read.mockRejectedValue(new Error("secret fixture detail"));
      if (kind === "legacy")
        mocks.read.mockResolvedValue({
          data: { ...emptyMiningServerDisplay, available: true },
          error: null,
        });
      if (kind === "invalid")
        mocks.read.mockResolvedValue({
          data: { ...display, used_capacity_micro_krw: "10000001" },
          error: null,
        });
      const response = await GET(request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("secret fixture detail");
    },
  );
  it("returns no fabricated amounts when the source confirms no funded display", async () => {
    mocks.read.mockResolvedValue({
      data: emptyMiningServerDisplay,
      error: null,
    });
    expect(await (await GET(request())).json()).toEqual({
      data: { ownerId: identity.userId, snapshot: null },
    });
  });
});
