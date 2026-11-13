import { beforeEach, describe, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({
  authorize: vi.fn(),
  authorizeRead: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../lib/workroom/server", () => ({ workroomDependencies: fixtures }));
vi.mock("../lib/env", () => ({
  getAdminEnv: () => ({ ADMIN_APP_URL: "https://admin.workroom.test" }),
}));
vi.mock("server-only", () => ({}));
import { adminAppDependencies } from "../lib/workroom-app/server";
import { HIGH_IMPACT_ROLES } from "../lib/auth/policy";
import { safeAdminReturnPath } from "../lib/auth/return-path";
beforeEach(() => vi.clearAllMocks());
describe("inquiry API retains administrator authority", () => {
  it("uses the existing write origin/MFA/live-session guard and read guard", async () => {
    fixtures.authorize.mockResolvedValue({
      ok: false,
      status: 403,
      code: "MFA_REQUIRED",
    });
    fixtures.authorizeRead.mockResolvedValue({
      ok: false,
      status: 403,
      code: "ADMIN_SESSION_EXPIRED",
    });
    const request = new Request(
      "https://admin.workroom.test/api/v1/admin/workroom-app",
    );
    const deps = adminAppDependencies();
    expect(await deps.authorize(request, true)).toEqual({
      ok: false,
      status: 403,
      code: "MFA_REQUIRED",
    });
    expect(fixtures.authorize).toHaveBeenCalledWith(request, HIGH_IMPACT_ROLES);
    expect(await deps.authorize(request, false)).toEqual({
      ok: false,
      status: 403,
      code: "ADMIN_SESSION_EXPIRED",
    });
    expect(fixtures.authorizeRead).toHaveBeenCalledWith(request);
  });
  it("binds SQL authority to the verified principal, never to a browser actor", async () => {
    const principal = {
      userId: "actor",
      adminSessionId: "registry",
      sessionId: "auth-session",
      aal: "aal2",
      supabase: { rpc: fixtures.rpc },
    };
    fixtures.rpc.mockResolvedValue({ data: { items: [] }, error: null });
    await adminAppDependencies().invoke(principal, "SUPPORT_READ", null, {
      threadId: "thread",
    });
    expect(fixtures.rpc).toHaveBeenCalledWith("workroom_app_admin", {
      p_operation: "SUPPORT_READ",
      p_request_key: null,
      p_input: { threadId: "thread" },
      p_actor: "actor",
      p_admin_session_id: "registry",
      p_auth_session_id: "auth-session",
      p_verified_aal: "aal2",
    });
  });
  it("preserves inquiry and inbox destinations through login without an external redirect", () => {
    expect(
      safeAdminReturnPath(
        "/support?thread=11111111-1111-4111-8111-111111111111",
      ),
    ).toContain("/support?thread=");
    expect(safeAdminReturnPath("/notifications")).toBe("/notifications");
    expect(safeAdminReturnPath("https://other.test/support")).toBe("/");
    expect(safeAdminReturnPath("//other.test/support")).toBe("/");
  });
});
