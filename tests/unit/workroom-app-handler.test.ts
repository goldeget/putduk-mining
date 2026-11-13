import { describe, expect, it, vi } from "vitest";
import {
  handleAppRead,
  handleAppWrite,
  type AppDependencies,
} from "../../lib/workroom-app/handler";

const key = "11111111-1111-4111-8111-111111111111";
const thread = "22222222-2222-4222-8222-222222222222";
function dependencies(): AppDependencies {
  return {
    origin: "https://workroom.test",
    authorize: vi
      .fn()
      .mockResolvedValue({ ok: true, identity: { userId: key } }),
    invoke: vi
      .fn()
      .mockResolvedValue({
        data: { items: [], unreadCount: 96, nextCursor: null },
        error: null,
      }),
  };
}
function post(
  input: unknown,
  origin = "https://workroom.test",
  requestKey = key,
) {
  return new Request("https://workroom.test/api/v1/workroom-app", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "idempotency-key": requestKey,
    },
    body: JSON.stringify(input),
  });
}
describe("WORKROOM app authenticated commands", () => {
  it("rejects cross origin before invoking the database", async () => {
    const deps = dependencies();
    expect(
      (
        await handleAppWrite(
          post(
            { operation: "SUPPORT_SEND", input: { body: "문의합니다" } },
            "https://other.test",
          ),
          deps,
          "member",
        )
      ).status,
    ).toBe(403);
    expect(deps.invoke).not.toHaveBeenCalled();
  });
  it("requires a verified member and never accepts a recipient", async () => {
    const deps = dependencies();
    deps.authorize = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, code: "UNAUTHENTICATED" });
    expect(
      (
        await handleAppWrite(
          post({ operation: "SUPPORT_SEND", input: { body: "문의합니다" } }),
          deps,
          "member",
        )
      ).status,
    ).toBe(401);
    const authorized = dependencies();
    expect(
      (
        await handleAppWrite(
          post({
            operation: "SUPPORT_SEND",
            input: { body: "문의합니다", memberId: key },
          }),
          authorized,
          "member",
        )
      ).status,
    ).toBe(400);
    expect(authorized.invoke).not.toHaveBeenCalled();
  });
  it("forwards the original retry key and returns only server-confirmed data", async () => {
    const deps = dependencies();
    const response = await handleAppWrite(
      post({
        operation: "SUPPORT_SEND",
        input: { threadId: thread, body: "문의합니다" },
      }),
      deps,
      "member",
    );
    expect(response.status).toBe(200);
    expect(deps.invoke).toHaveBeenCalledWith(
      { userId: key },
      "SUPPORT_SEND",
      key,
      { threadId: thread, body: "문의합니다" },
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("does not permit a member to call admin or financial operations", async () => {
    for (const operation of [
      "SUPPORT_REPLY",
      "SUPPORT_ASSIGN",
      "SUPPORT_RESOLVE",
      "START",
      "POINT_ADJUST",
    ]) {
      const deps = dependencies();
      expect(
        (
          await handleAppWrite(
            post({ operation, input: { threadId: thread, body: "답변" } }),
            deps,
            "member",
          )
        ).status,
      ).toBe(400);
      expect(deps.invoke).not.toHaveBeenCalled();
    }
  });
  it("preserves server whole-inbox unread count and rejects foreign thread query fields", async () => {
    const deps = dependencies();
    const response = await handleAppRead(
      new Request(
        "https://workroom.test/api/v1/workroom-app?operation=NOTIFICATIONS_READ",
      ),
      deps,
      "member",
    );
    expect((await response.json()).data.unreadCount).toBe(96);
    expect(
      (
        await handleAppRead(
          new Request(
            `https://workroom.test/api/v1/workroom-app?operation=SUPPORT_READ&memberId=${key}`,
          ),
          deps,
          "member",
        )
      ).status,
    ).toBe(400);
  });
  it("honors denied MFA/session access for admin reads and writes", async () => {
    const deps = dependencies();
    deps.authorize = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, code: "MFA_REQUIRED" });
    expect(
      (
        await handleAppRead(
          new Request(
            "https://workroom.test/api/v1/admin/workroom-app?operation=SUPPORT_READ",
          ),
          deps,
          "admin",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleAppWrite(
          post({
            operation: "SUPPORT_REPLY",
            input: { threadId: thread, body: "답변합니다" },
          }),
          deps,
          "admin",
        )
      ).status,
    ).toBe(403);
    expect(deps.invoke).not.toHaveBeenCalled();
  });
  it("rejects oversized bodies and maps ownership denial without leaking DB errors", async () => {
    const deps = dependencies();
    expect(
      (
        await handleAppWrite(
          post({
            operation: "SUPPORT_SEND",
            input: { body: "가".repeat(6000) },
          }),
          deps,
          "member",
        )
      ).status,
    ).toBe(413);
    deps.invoke = vi
      .fn()
      .mockResolvedValue({
        data: null,
        error: { message: "SUPPORT_FORBIDDEN secret" },
      });
    const denied = await handleAppWrite(
      post({
        operation: "SUPPORT_SEND",
        input: { threadId: thread, body: "문의합니다" },
      }),
      deps,
      "member",
    );
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("secret");
  });
});
