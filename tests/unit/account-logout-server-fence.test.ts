import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  apply: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn(),
  order: [] as string[],
}));
vi.mock("@/lib/notifications/push-binding.server", () => ({
  getVerifiedPushIdentity: mocks.identity,
  applyPushBinding: mocks.apply,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signOut: mocks.signOut },
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import {
  logoutAction,
  logoutAllAction,
} from "@/app/(product)/menu/account/actions";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.identity.mockResolvedValue({
    userId: "owner",
    authSessionId: "session",
  });
  mocks.apply.mockImplementation(async () => {
    mocks.order.push("fence");
    return { ok: true };
  });
  mocks.signOut.mockImplementation(async () => {
    mocks.order.push("auth");
    return { error: null };
  });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error("REDIRECT:" + path);
  });
});
describe("native account logout server fence", () => {
  it.each([
    ["local", "LOGOUT_LOCAL", logoutAction],
    ["global", "LOGOUT_GLOBAL", logoutAllAction],
  ] as const)(
    "%s logout commits its exact scoped fence before Auth signOut",
    async (scope, operation, action) => {
      await expect(action()).rejects.toThrow("REDIRECT:/login?logout=" + scope);
      expect(mocks.order).toEqual(["fence", "auth"]);
      expect(mocks.apply).toHaveBeenCalledWith(
        expect.objectContaining({ authSessionId: "session" }),
        { operation },
      );
      expect(mocks.signOut).toHaveBeenCalledWith({ scope });
    },
  );
  it("still signs out when fence errors and reports cleanup uncertainty", async () => {
    mocks.apply.mockRejectedValue(new Error("no private error in UI"));
    await expect(logoutAction()).rejects.toThrow(
      "REDIRECT:/login?logout=local&push=unconfirmed",
    );
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
  it("keeps auth failure distinct from confirmed Push cleanup", async () => {
    mocks.signOut.mockResolvedValue({ error: { message: "fixture" } });
    await expect(logoutAction()).rejects.toThrow(
      "REDIRECT:/menu/account?logout=failed",
    );
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });
});
