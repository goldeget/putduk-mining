import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createContentCommandHandler,
  createContentStateHandler,
  type ContentDependencies,
} from "@/lib/content/handler";
import {
  contentCommandSchema,
  type ContentReceipt,
} from "../../../domain/content/contract";
const id = "10000000-0000-4000-8000-000000000001",
  revision = "10000000-0000-4000-8000-000000000002",
  key = "10000000-0000-4000-8000-000000000003";
const digest = "a".repeat(64);
const payload = {
  slug: "member-day",
  title: "회원 안내",
  cardTitle: "새로운 안내",
  summary: "꼭 필요한 안내를 확인해 주세요.",
  body: "참여 방법과 기간을 앱에서 확인해 주세요.",
  ctaLabel: "이벤트 보기",
  ctaRoute: "/events",
  audience: "MEMBERS",
  segment: "ALL_MEMBERS",
  rewardMode: "NONE",
  participation: "앱에서 기간과 조건을 확인합니다.",
  exclusion: "취소한 안내에는 참여할 수 없습니다.",
  startsAt: "2026-10-09T00:00:00Z",
  endsAt: "2026-10-10T00:00:00Z",
};
const receipt: ContentReceipt = {
  contentKind: "EVENT",
  contentId: id,
  revisionId: revision,
  revision: 1,
  state: "DRAFT",
  digest,
  snapshot: payload,
  auditId: id,
  outboxId: key,
};
const input = {
  operation: "CREATE_DRAFT",
  kind: "EVENT",
  contentId: null,
  expectedRevision: null,
  expectedDigest: null,
  payload,
  reason: "회원에게 필요한 안내를 작성합니다.",
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
      role: "SUPER_ADMIN",
    },
  });
  rpc.mockImplementation(async (name: string) => ({
    data: name === "manage_liveops_content" ? receipt : { items: [receipt] },
    error: null,
  }));
});
describe("reviewed CMS command recovery", () => {
  it("forwards bound AAL2 session and exact UUID idempotency, confirming audit/outbox receipt against readback", async () => {
    const response = await createContentCommandHandler(deps)(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data.confirmed).toBe(true);
    expect(rpc.mock.calls.map((row) => row[0])).toEqual([
      "manage_liveops_content",
      "read_liveops_content_review",
    ]);
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_actor: id,
      p_admin_session_id: revision,
      p_auth_session_id: key,
      p_verified_aal: "aal2",
      p_idempotency_key: key,
      p_operation: "CREATE_DRAFT",
      p_payload: payload,
      p_step_up_token: input.stepUpToken,
    });
  });
  it("fails closed if write receipt differs from current readback and allows exact replay after later revision", async () => {
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === "manage_liveops_content"
          ? receipt
          : { items: [{ ...receipt, digest: "b".repeat(64) }] },
      error: null,
    }));
    expect((await createContentCommandHandler(deps)(request())).status).toBe(
      503,
    );
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === "manage_liveops_content"
          ? receipt
          : { items: [{ ...receipt, revision: 2, revisionId: key }] },
      error: null,
    }));
    expect((await createContentCommandHandler(deps)(request())).status).toBe(
      200,
    );
  });
  it("requires authorization and step-up/revision proof before DB mutation", async () => {
    authorize.mockResolvedValue({
      ok: false,
      status: 403,
      code: "MFA_REQUIRED",
    });
    expect((await createContentCommandHandler(deps)(request())).status).toBe(
      403,
    );
    expect(rpc).not.toHaveBeenCalled();
    authorize.mockResolvedValue({
      ok: true,
      principal: {
        userId: id,
        adminSessionId: revision,
        sessionId: key,
        aal: "aal1",
        role: "SUPER_ADMIN",
      },
    });
    expect((await createContentCommandHandler(deps)(request())).status).toBe(
      403,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not publish edited payload under a reviewed digest, accept external CTA, or infer unapproved money rewards", () => {
    expect(
      contentCommandSchema.safeParse({
        ...input,
        operation: "PUBLISH",
        contentId: id,
        expectedRevision: revision,
        expectedDigest: digest,
      }).success,
    ).toBe(false);
    expect(
      contentCommandSchema.safeParse({
        ...input,
        payload: { ...payload, ctaRoute: "https://evil.test" },
      }).success,
    ).toBe(false);
    expect(
      contentCommandSchema.safeParse({
        ...input,
        payload: { ...payload, rewardMode: "KRW", rewardAmount: 10000 },
      }).success,
    ).toBe(false);
  });
  it("does not report success when audit/outbox proof is missing", async () => {
    rpc.mockResolvedValue({ data: { ...receipt, auditId: null }, error: null });
    expect((await createContentCommandHandler(deps)(request())).status).toBe(
      503,
    );
  });
  it("returns conflict for a stale reviewed revision and keeps SQL details private", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "LIVEOPS_REVISION_MISMATCH private table secret" },
    });
    const response = await createContentCommandHandler(deps)(request());
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private table",
    );
  });
  it("rejects malformed keys/oversized bodies/offline requests without DB calls", async () => {
    expect(
      (
        await createContentCommandHandler(deps)(
          request(input, { "Idempotency-Key": "bad-key" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await createContentCommandHandler(deps)(
          request({ ...input, reason: "x".repeat(100000) }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await createContentCommandHandler(deps)(
          request(input, { "x-putduk-client-online": "0" }),
        )
      ).status,
    ).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects a mixed-kind state read instead of showing unconfirmed records", async () => {
    const response = await createContentStateHandler(deps)(
      request({ kind: "NOTICE", contentId: null }),
    );
    expect(response.status).toBe(503);
  });
});
