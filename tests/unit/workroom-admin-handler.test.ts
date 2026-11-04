import { describe, expect, it } from "vitest";
import {
  createWorkroomCommandHandler,
  createWorkroomStateHandler,
  type WorkroomDependencies,
} from "../../apps/admin/lib/workroom/handler";
import { reviewedSubmission } from "../../apps/admin/lib/workroom/submission";
const actor = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
function fixture(allowed = true) {
  const calls: Record<string, unknown>[] = [];
  const principal = {
    userId: actor,
    adminSessionId: key,
    sessionId: "33333333-3333-4333-8333-333333333333",
    aal: "aal2",
    role: "ADMIN",
  };
  const deps: WorkroomDependencies = {
    async authorize() {
      return allowed
        ? { ok: true, principal }
        : { ok: false, status: 403, code: "ORIGIN_DENIED" };
    },
    async authorizeRead() {
      return allowed
        ? { ok: true, principal }
        : { ok: false, status: 401, code: "UNAUTHENTICATED" };
    },
    async invoke(_principal, args) {
      calls.push(args);
      return { data: { accepted: true }, error: null };
    },
  };
  return { deps, calls };
}
function request(input: unknown, requestKey = key) {
  return new Request("https://admin.example/api", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": requestKey,
    },
    body: JSON.stringify(input),
  });
}
describe("workroom admin command boundary", () => {
  it("denies unauthorized input before any RPC", async () => {
    const { deps, calls } = fixture(false);
    const res = await createWorkroomCommandHandler(deps)(request({}));
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it("binds grant authority from verified principal and keeps the retry UUID", async () => {
    const { deps, calls } = fixture();
    const res = await createWorkroomCommandHandler(deps)(
      request({
        operation: "GRANT",
        input: { userId: actor, amount: 120, reason: "추가 무료 체험" },
      }),
    );
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual({
      p_operation: "GRANT",
      p_request_key: key,
      p_input: { userId: actor, amount: 120, reason: "추가 무료 체험" },
      p_actor: actor,
      p_admin_session_id: key,
      p_auth_session_id: "33333333-3333-4333-8333-333333333333",
      p_verified_aal: "aal2",
    });
  });
  it.each([
    { userId: actor, amount: 0, reason: "test" },
    { userId: actor, amount: 1000001, reason: "test" },
    { userId: actor, amount: 1, reason: " " },
    { userId: actor, amount: 1, reason: "test", p_actor: actor },
  ])("rejects invalid or authority-injecting grant %j", async (input) => {
    const { deps, calls } = fixture();
    const res = await createWorkroomCommandHandler(deps)(
      request({ operation: "GRANT", input }),
    );
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it("requires optimistic config version and rejects fractional duration", async () => {
    const { deps, calls } = fixture();
    for (const input of [
      {
        instrument: "nvda",
        pattern: "wave",
        roi: 5,
        duration: 120,
        amplitude: 2,
        reason: "조정",
      },
      {
        instrument: "nvda",
        pattern: "wave",
        roi: 5,
        duration: 120.5,
        amplitude: 2,
        expectedVersion: 1,
        reason: "조정",
      },
    ])
      expect(
        (
          await createWorkroomCommandHandler(deps)(
            request({ operation: "CONFIG_SAVE", input }),
          )
        ).status,
      ).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it("rejects missing UUID and oversized bodies", async () => {
    const { deps, calls } = fixture();
    expect(
      (await createWorkroomCommandHandler(deps)(request({}, "bad"))).status,
    ).toBe(400);
    expect(
      (
        await createWorkroomCommandHandler(deps)(
          request({ text: "x".repeat(17000) }),
        )
      ).status,
    ).toBe(413);
    expect(calls).toHaveLength(0);
  });
  it("maps version and changed-payload conflicts to 409 without leaking database details", async () => {
    const { deps } = fixture();
    deps.invoke = async () => ({
      data: null,
      error: { message: "WORKROOM_IDEMPOTENCY_PAYLOAD_MISMATCH secret" },
    });
    const res = await createWorkroomCommandHandler(deps)(
      request({
        operation: "GRANT",
        input: { userId: actor, amount: 1, reason: "체험" },
      }),
    );
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
  it("rejects untrusted low-assurance principal even if adapter incorrectly allows it", async () => {
    const { deps, calls } = fixture();
    deps.authorize = async () => ({
      ok: true,
      principal: {
        userId: actor,
        adminSessionId: key,
        sessionId: key,
        aal: "aal1",
        role: "ADMIN",
      },
    });
    expect(
      (
        await createWorkroomCommandHandler(deps)(
          request({
            operation: "GRANT",
            input: { userId: actor, amount: 1, reason: "체험" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(calls).toHaveLength(0);
  });
});
describe("workroom admin reads and review retry", () => {
  it("never reads for anonymous and limits pagination", async () => {
    const denied = fixture(false);
    expect(
      (
        await createWorkroomStateHandler(denied.deps)(
          new Request("https://admin.example/state"),
        )
      ).status,
    ).toBe(401);
    expect(denied.calls).toHaveLength(0);
    const { deps, calls } = fixture();
    expect(
      (
        await createWorkroomStateHandler(deps)(
          new Request("https://admin.example/state?pageSize=10000"),
        )
      ).status,
    ).toBe(400);
    expect(calls).toHaveLength(0);
  });
  it("passes bounded independent pages and search to authenticated RPC", async () => {
    const { deps, calls } = fixture();
    const res = await createWorkroomStateHandler(deps)(
      new Request(
        "https://admin.example/state?usersPage=2&invitesPage=3&auditPage=4&pageSize=20&search=kim",
      ),
    );
    expect(res.status).toBe(200);
    expect(calls[0]?.p_input).toEqual({
      usersPage: 2,
      invitesPage: 3,
      auditPage: 4,
      pageSize: 20,
      search: "kim",
    });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
  it("reuses a reviewed UUID on failed retry and blocks changed payload until resolved", () => {
    const first = reviewedSubmission(null, "GRANT", { amount: 10 }, () => key);
    expect(
      reviewedSubmission(first, "GRANT", { amount: 10 }, () => actor),
    ).toEqual(first);
    expect(() =>
      reviewedSubmission(first, "GRANT", { amount: 11 }, () => actor),
    ).toThrow("UNRESOLVED_SUBMISSION");
  });
});
