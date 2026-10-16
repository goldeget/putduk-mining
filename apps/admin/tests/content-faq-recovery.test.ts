import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createContentCommandHandler,
  createContentStateHandler,
  type ContentDependencies,
} from "@/lib/content/handler";
import { ORIGINAL_FAQ_SOURCE_DIGEST } from "../../../domain/content/faq";

const id = "30000000-0000-4000-8000-000000000001";
const revision = "30000000-0000-4000-8000-000000000002";
const key = "30000000-0000-4000-8000-000000000003";
const payload = {
  slug: "member-faq",
  title: "회원 자주 묻는 질문",
  summary: "앱 이용에 필요한 안내를 확인해 주세요.",
  audience: "MEMBERS",
  segment: "ALL_MEMBERS",
  locale: "ko-KR",
  entries: [
    {
      stableEntryId: "mining-progress",
      question: "앱을 닫아도 계속되나요?",
      answer: "앱을 닫아도 채굴은 계속돼요.",
    },
  ],
  sourceDigest: ORIGINAL_FAQ_SOURCE_DIGEST,
  publishedAt: "2026-10-01T00:00:00Z",
  expiresAt: null,
};
const receipt = {
  contentKind: "FAQ",
  contentId: id,
  revisionId: revision,
  revision: 1,
  state: "DRAFT",
  digest: "a".repeat(64),
  snapshot: payload,
  auditId: id,
  outboxId: key,
};
const input = {
  operation: "CREATE_DRAFT",
  kind: "FAQ",
  contentId: null,
  expectedRevision: null,
  expectedDigest: null,
  payload,
  reason: "회원에게 필요한 질문과 답변을 검토합니다.",
  stepUpToken: "verified-step-up-token",
  confirmation: "CONFIRM_LIVEOPS_CONTENT",
};
const authorize = vi.fn(),
  rpc = vi.fn();
const deps: ContentDependencies = { authorize, rpc };
function request(body: unknown = input, headers: Record<string, string> = {}) {
  return new Request("https://admin.mining.putduk.com/api/content/command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({
    ok: true,
    principal: {
      userId: id,
      adminSessionId: revision,
      sessionId: key,
      aal: "aal2",
      role: "ADMIN",
    },
  });
  rpc.mockImplementation(async (name: string) => ({
    data: name === "manage_liveops_content" ? receipt : { items: [receipt] },
    error: null,
  }));
});

describe("FAQ reuses reviewed CMS command and readback", () => {
  it("forwards exact FAQ payload and existing AAL2/session/step-up/UUID command binding", async () => {
    const response = await createContentCommandHandler(deps)(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.confirmed).toBe(true);
    expect(rpc.mock.calls.map((row) => row[0])).toEqual([
      "manage_liveops_content",
      "read_liveops_content_review",
    ]);
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_kind: "FAQ",
      p_payload: payload,
      p_actor: id,
      p_admin_session_id: revision,
      p_auth_session_id: key,
      p_verified_aal: "aal2",
      p_step_up_token: input.stepUpToken,
      p_idempotency_key: key,
    });
  });
  it("reads only requested FAQ kind and bound UUID through existing state endpoint", async () => {
    const response = await createContentStateHandler(deps)(
      request({ kind: "FAQ", contentId: id }),
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_liveops_content_review", {
      p_actor: id,
      p_admin_session_id: revision,
      p_auth_session_id: key,
      p_verified_aal: "aal2",
      p_kind: "FAQ",
      p_content_id: id,
    });
  });
  it.each(["PREVIEW", "APPROVE", "PUBLISH", "ARCHIVE", "UPDATE_DRAFT"])(
    "keeps exact receipt/readback for %s",
    async (operation) => {
      const states: Record<string, string> = {
        PREVIEW: "PREVIEWED",
        APPROVE: "APPROVED",
        PUBLISH: "PUBLISHED",
        ARCHIVE: "ARCHIVED",
        UPDATE_DRAFT: "DRAFT",
      };
      const next = { ...receipt, state: states[operation] };
      rpc.mockImplementation(async (name: string) => ({
        data: name === "manage_liveops_content" ? next : { items: [next] },
        error: null,
      }));
      const response = await createContentCommandHandler(deps)(
        request({
          ...input,
          operation,
          contentId: id,
          expectedRevision: revision,
          expectedDigest: receipt.digest,
          payload: operation === "UPDATE_DRAFT" ? payload : null,
        }),
      );
      expect(response.status).toBe(200);
      expect(rpc.mock.calls[0]![1]).toMatchObject({
        p_expected_revision: revision,
        p_expected_digest: receipt.digest,
      });
    },
  );
  it.each([401, 403])(
    "requires authorization before any mutation (%s)",
    async (status) => {
      authorize.mockResolvedValue({ ok: false, code: "AUTH_REQUIRED", status });
      expect((await createContentCommandHandler(deps)(request())).status).toBe(
        status,
      );
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("rejects unbound MFA session even with correct source digest", async () => {
    authorize.mockResolvedValue({
      ok: true,
      principal: {
        userId: id,
        adminSessionId: revision,
        sessionId: key,
        aal: "aal1",
        role: "ADMIN",
      },
    });
    expect((await createContentCommandHandler(deps)(request())).status).toBe(
      403,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    {
      ...input,
      operation: "CANCEL",
      contentId: id,
      expectedRevision: revision,
      expectedDigest: receipt.digest,
      payload: null,
    },
    { ...input, stepUpToken: "short" },
    { ...input, confirmation: "AUTO_APPROVE" },
    { ...input, payload: { ...payload, audience: "PUBLIC" } },
    { ...input, payload: { ...payload, slug: "privacy" } },
    { ...input, payload: { ...payload, reward: 100 } },
  ])(
    "rejects lifecycle/scope/approval deviation before RPC %j",
    async (body) => {
      expect(
        (await createContentCommandHandler(deps)(request(body))).status,
      ).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid UUID request key and declared offline state before RPC", async () => {
    expect(
      (
        await createContentCommandHandler(deps)(
          request(input, { "Idempotency-Key": "bad" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await createContentCommandHandler(deps)(
          request(input, { "X-Putduk-Client-Online": "0" }),
        )
      ).status,
    ).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...receipt, contentKind: "NOTICE" },
    { ...receipt, contentId: "malformed" },
    { ...receipt, snapshot: { ...payload, sourceDigest: "b".repeat(64) } },
    {
      ...receipt,
      snapshot: {
        ...payload,
        entries: [{ ...payload.entries[0], answer: "다른 답변입니다." }],
      },
    },
  ])(
    "does not declare confirmation for mismatched native write receipt %j",
    async (bad) => {
      rpc.mockResolvedValue({ data: bad, error: null });
      expect((await createContentCommandHandler(deps)(request())).status).toBe(
        503,
      );
    },
  );
  it("keeps uncertain result recoverable and does not invent compensating second mutation", async () => {
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === "manage_liveops_content"
          ? receipt
          : { items: [{ ...receipt, digest: "b".repeat(64) }] },
      error: null,
    }));
    const response = await createContentCommandHandler(deps)(request());
    expect(response.status).toBe(503);
    expect(
      rpc.mock.calls.filter((row) => row[0] === "manage_liveops_content"),
    ).toHaveLength(1);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("preserves SQL-bound previous receipt recovery after a later revision", async () => {
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === "manage_liveops_content"
          ? receipt
          : { items: [{ ...receipt, revisionId: key, revision: 2 }] },
      error: null,
    }));
    expect((await createContentCommandHandler(deps)(request())).status).toBe(
      200,
    );
  });
});
