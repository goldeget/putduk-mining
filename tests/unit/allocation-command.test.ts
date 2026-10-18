import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allocationCommandSchema } from "@/domain/products/allocation-command";
import {
  allocationBpsToPercent,
  allocationPercentToBps,
} from "@/domain/products/allocation-input";
import { createAllocationHandlers } from "@/lib/product/allocation-handler";
const uuid = (id: number) =>
  `ab125100-0000-4000-8000-${String(id).padStart(12, "0")}`;
const digest = "a".repeat(64);
const origin = "https://mining.putduk.com";
const input = {
  catalogId: uuid(1),
  catalogDigest: digest,
  expectedRevision: "0",
  products: [{ productId: uuid(2), allocationBps: "5000" }],
  confirmation: "CONFIRM_FUNDING_ALLOCATION",
};
const state = {
  schemaVersion: 1,
  revision: "1",
  allocationId: uuid(3),
  catalogId: uuid(1),
  catalogDigest: digest,
  effectiveAt: "2026-10-06T14:00:00.000123Z",
  products: input.products,
  availableProducts: [
    { productId: uuid(2), nameKo: "시험 상품", available: true },
  ],
  currentCatalog: { id: uuid(1), digest },
  runtimeReady: true,
};
const receipt = {
  schemaVersion: 1,
  allocationId: uuid(3),
  revision: "1",
  catalogId: uuid(1),
  catalogDigest: digest,
  effectiveAt: state.effectiveAt,
  inputDigest: digest,
  products: input.products,
  transitionId: uuid(4),
};
const rpc = vi.fn();
const identity = vi.fn();
const handlers = createAllocationHandlers({
  appOrigin: () => origin,
  identity,
});
function request(
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Request(`${origin}/api/v1/products/allocation`, {
    method: "POST",
    headers: {
      origin,
      "Content-Type": "application/json",
      "Idempotency-Key": "allocation_exact_key",
      ...headers,
    },
    body: JSON.stringify({ ...input, ...extra }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  identity.mockResolvedValue({
    userId: uuid(9),
    supabase: { rpc } as unknown as SupabaseClient,
  });
  rpc.mockImplementation(async (_name, args) => ({
    data: args.p_operation === "READ" ? state : receipt,
    error: null,
  }));
});
describe("member allocation authority and recovery", () => {
  it.each([undefined, "https://other.invalid"])(
    "rejects wrong or missing origin before authentication/body",
    async (value) => {
      const req = request();
      if (value === undefined) req.headers.delete("origin");
      else req.headers.set("origin", value);
      expect((await handlers.POST(req)).status).toBe(403);
      expect(req.bodyUsed).toBe(false);
      expect(identity).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("requires a verified member before parsing", async () => {
    identity.mockResolvedValue(null);
    const req = request();
    expect((await handlers.POST(req)).status).toBe(401);
    expect(req.bodyUsed).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ownerId: uuid(8) },
    { effectiveAt: state.effectiveAt },
    { amountKrw: "1000" },
    {
      products: [
        { productId: uuid(2), allocationBps: "5000", ruleVersionId: uuid(7) },
      ],
    },
    {
      products: [
        { productId: uuid(2), allocationBps: "5000", multiplierBps: 11000 },
      ],
    },
  ])("rejects caller financial/owner authority %j", async (extra) => {
    expect((await handlers.POST(request(extra))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("blocks explicit offline writes", async () => {
    expect(
      (await handlers.POST(request({}, { "x-putduk-client-online": "0" })))
        .status,
    ).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("bounds actual payload bytes", async () => {
    const req = request({ padding: "x".repeat(17000) });
    expect((await handlers.POST(req)).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("calls actual member client without an owner/rule/time argument", async () => {
    const response = await handlers.POST(request());
    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0]).toEqual([
      "confirm_funding_allocation",
      {
        p_operation: "CONFIRM",
        p_catalog_id: uuid(1),
        p_catalog_digest: digest,
        p_expected_revision: "0",
        p_products: input.products,
        p_idempotency_key: "allocation_exact_key",
      },
    ]);
    expect((await response.json()).data.confirmed).toBe(true);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("replays the same immutable payload/key without current-revision preflight", async () => {
    await handlers.POST(request());
    await handlers.POST(request());
    const confirms = rpc.mock.calls.filter(
      ([, args]) => args.p_operation === "CONFIRM",
    );
    expect(confirms).toHaveLength(2);
    expect(confirms[0]).toEqual(confirms[1]);
  });
  it("does not interpret a wrong owner receipt as success", async () => {
    rpc.mockResolvedValue({
      data: { ...receipt, allocationId: "bad-id" },
      error: null,
    });
    expect((await handlers.POST(request())).status).toBe(503);
  });
  it("requires actual state readback to include the returned revision", async () => {
    rpc.mockImplementation(async (_name, args) => ({
      data:
        args.p_operation === "READ"
          ? { ...state, revision: "0", allocationId: null }
          : receipt,
      error: null,
    }));
    expect((await handlers.POST(request())).status).toBe(503);
  });
  it("missing prospective runtime remains an explicit error", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "ALLOCATION_RUNTIME_ADAPTER_REQUIRED" },
    });
    const response = await handlers.POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("ALLOCATION_UNAVAILABLE");
  });
  it("READ is explicit and carries no mutation fields", async () => {
    expect((await handlers.GET()).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("confirm_funding_allocation", {
      p_operation: "READ",
      p_catalog_id: null,
      p_catalog_digest: null,
      p_expected_revision: null,
      p_products: null,
      p_idempotency_key: null,
    });
  });
  it("allows zero selection and partial aggregate allocation", () => {
    expect(
      allocationCommandSchema.safeParse({ ...input, products: [] }).success,
    ).toBe(true);
    expect(allocationCommandSchema.safeParse(input).success).toBe(true);
  });
  it("rejects duplicate products and aggregate overflow", () => {
    expect(
      allocationCommandSchema.safeParse({
        ...input,
        products: [...input.products, ...input.products],
      }).success,
    ).toBe(false);
    expect(
      allocationCommandSchema.safeParse({
        ...input,
        products: [
          { productId: uuid(2), allocationBps: "6000" },
          { productId: uuid(5), allocationBps: "6000" },
        ],
      }).success,
    ).toBe(false);
  });
  it.each(["1.001", "NaN", "1e2", "0", "100.01", "-1"])(
    "rejects nonexact percent %s",
    (value) => {
      expect(allocationPercentToBps(value)).toBeNull();
    },
  );
  it("round trips exact sub-percent weights without floats", () => {
    expect(allocationPercentToBps("0.01")).toBe("1");
    expect(allocationPercentToBps("33.33")).toBe("3333");
    expect(allocationBpsToPercent("3333")).toBe("33.33");
    expect(allocationBpsToPercent("10000")).toBe("100");
  });
});
