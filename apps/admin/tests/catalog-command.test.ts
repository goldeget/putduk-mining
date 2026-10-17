import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPrincipal } from "../lib/auth/principal";
import {
  createCatalogCommandHandler,
  createCatalogStateHandler,
  type CatalogDependencies,
} from "../lib/catalog/handler";
import { catalogSameInstant } from "../../../domain/products/catalog-command";
vi.mock("server-only", () => ({}));
const uuid = (id: number) =>
  `ab125000-0000-4000-8000-${String(id).padStart(12, "0")}`;
const digest = "a".repeat(64);
const future = "2026-10-07T14:00:00.123456Z";
const principal = {
  userId: uuid(1),
  adminSessionId: uuid(2),
  sessionId: "bound-auth-session",
  role: "ADMIN",
  aal: "aal2",
} as AdminPrincipal;
const input = {
  operation: "PREVIEW",
  catalogId: uuid(3),
  expectedRevision: null,
  expectedDigest: digest,
  publishAt: future,
  reason: "상품과 출처를 검토했습니다.",
  stepUpToken: "single-use-proof-1234567890",
  confirmation: "CONFIRM_PRODUCT_CATALOG",
};
const receipt = {
  catalogId: uuid(3),
  revisionId: uuid(4),
  revision: 1,
  state: "PREVIEWED",
  snapshotDigest: digest,
  publishAt: future,
};
const state = {
  schemaVersion: 1,
  serverNow: "2026-10-06T14:00:00Z",
  catalogs: [{ id: uuid(3), version: 2, status: "DRAFT" }],
  selected: {
    catalogId: uuid(3),
    version: 2,
    status: "DRAFT",
    snapshotDate: "2026-10-06",
    methodology: "운영 검토 대상",
    sources: [{ name: "검토 출처", url: "https://www.lbma.org.uk/" }],
    products: [
      {
        id: uuid(5),
        code: "XAU",
        nameKo: "시험 상품",
        nameEn: "Test",
        descriptionKo: "시험 설명",
        category: "GOLD",
        displayOrder: 1,
      },
    ],
    sourceDigest: digest,
    expectedDigest: digest,
    latestReceipt: receipt,
    supported: true,
  },
};
const authorize = vi.fn();
const rpc = vi.fn();
const deps = { authorize, rpc } as CatalogDependencies;
const handler = createCatalogCommandHandler(deps);
const read = createCatalogStateHandler(deps);
function request(
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Request(
    "https://admin.mining.putduk.com/api/v1/admin/catalog/command",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "catalog_exact_key",
        ...headers,
      },
      body: JSON.stringify({ ...input, ...extra }),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({ ok: true, principal });
  rpc.mockImplementation(async (name) => ({
    data: name === "manage_product_catalog" ? receipt : state,
    error: null,
  }));
});
describe("operator catalog command boundary", () => {
  it("requires the existing origin/live session authorizer before parsing", async () => {
    authorize.mockResolvedValue({
      ok: false,
      status: 403,
      code: "ORIGIN_DENIED",
    });
    const req = request();
    expect((await handler(req)).status).toBe(403);
    expect(req.bodyUsed).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["aal1", "unknown"])(
    "does not trust non-AAL2 principal %s",
    async (aal) => {
      authorize.mockResolvedValue({
        ok: true,
        principal: { ...principal, aal },
      });
      expect((await handler(request())).status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it.each([
    { actorId: uuid(9) },
    { rulePayload: { reward: 123 } },
    { contentDigest: digest },
    { approvedBy: uuid(9) },
  ])("rejects injected authority/rules %j", async (extra) => {
    expect((await handler(request(extra))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes trusted session and proof to only the atomic RPC", async () => {
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0]).toEqual([
      "manage_product_catalog",
      {
        p_actor: principal.userId,
        p_admin_session_id: principal.adminSessionId,
        p_auth_session_id: principal.sessionId,
        p_verified_aal: "aal2",
        p_operation: "PREVIEW",
        p_catalog_id: uuid(3),
        p_expected_revision: null,
        p_expected_digest: digest,
        p_publish_at: future,
        p_step_up_token: input.stepUpToken,
        p_reason: input.reason,
        p_idempotency_key: "catalog_exact_key",
      },
    ]);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "manage_product_catalog",
      "read_product_catalog_review_state",
    ]);
  });
  it("does not reject completed same-key replay after later publication", async () => {
    rpc.mockImplementation(async (name) => ({
      data:
        name === "manage_product_catalog"
          ? receipt
          : {
              ...state,
              selected: {
                ...state.selected,
                status: "PUBLISHED",
                latestReceipt: {
                  ...receipt,
                  revision: 3,
                  state: "PUBLISHED",
                  revisionId: uuid(8),
                },
              },
            },
      error: null,
    }));
    expect((await handler(request())).status).toBe(200);
  });
  it("rejects mismatched returned schedule microseconds", async () => {
    rpc.mockImplementation(async (name) => ({
      data:
        name === "manage_product_catalog"
          ? { ...receipt, publishAt: "2026-10-07T14:00:00.123457Z" }
          : state,
      error: null,
    }));
    expect((await handler(request())).status).toBe(503);
  });
  it("rejects wrong operation receipt", async () => {
    rpc.mockResolvedValue({
      data: { ...receipt, state: "APPROVED" },
      error: null,
    });
    expect((await handler(request())).status).toBe(503);
  });
  it("keeps unknown SQL error text out of responses", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "token-secret raw request url https://secret.invalid" },
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("token-secret");
  });
  it("maps stale digest to an explicit conflict", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "PRODUCT_CATALOG_PREVIEW_CHANGED" },
    });
    expect((await handler(request())).status).toBe(409);
  });
  it("blocks offline commands without SQL", async () => {
    expect(
      (await handler(request({}, { "x-putduk-client-online": "0" }))).status,
    ).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("bounds body bytes before SQL", async () => {
    expect(
      (await handler(request({ padding: "x".repeat(17000) }))).status,
    ).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reads exact selected catalog with trusted administrator proof", async () => {
    const response = await read(
      new Request(
        "https://admin.mining.putduk.com/api/v1/admin/catalog/state",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ catalogId: uuid(3) }),
        },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(rpc).toHaveBeenCalledWith("read_product_catalog_review_state", {
      p_actor: uuid(1),
      p_admin_session_id: uuid(2),
      p_auth_session_id: principal.sessionId,
      p_verified_aal: "aal2",
      p_catalog_id: uuid(3),
    });
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://user:password@example.invalid/",
  ])(
    "keeps unsafe source URL %s out of operator read responses",
    async (url) => {
      rpc.mockResolvedValue({
        data: {
          ...state,
          selected: {
            ...state.selected,
            sources: [{ name: "Untrusted source", url }],
          },
        },
        error: null,
      });
      const response = await read(
        new Request(
          "https://admin.mining.putduk.com/api/v1/admin/catalog/state",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ catalogId: uuid(3) }),
          },
        ),
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(url);
    },
  );
  it("preserves SQL microsecond identity and equivalent timezone", () => {
    expect(catalogSameInstant(future, "2026-10-07T23:00:00.123456+09:00")).toBe(
      true,
    );
    expect(catalogSameInstant(future, "2026-10-07T14:00:00.123457Z")).toBe(
      false,
    );
  });
});
