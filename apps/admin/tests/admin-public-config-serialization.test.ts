import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ControlLayout from "@/app/(control)/layout";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminPage: async () => ({
    userId: "mock-user",
    adminSessionId: "mock-session",
    role: "VIEWER",
  }),
}));
vi.mock("@/components/admin-shell", () => ({ AdminShell: () => null }));
vi.mock("@/components/assistant/operator-draft-provider", () => ({
  OperatorDraftProvider: () => null,
}));

function legacyKey(role: string) {
  return `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.fixture`;
}
beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:58421");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_server_fixture_not_real");
  vi.stubEnv("ADMIN_APP_URL", "http://127.0.0.1:3100");
});
afterEach(() => vi.unstubAllEnvs());

describe("admin server/client credential boundary", () => {
  it.each([
    "sb_secret_fixture_must_stay_server_only",
    legacyKey("service_role"),
    legacyKey("authenticated"),
  ])(
    "rejects a non-public key before constructing client props",
    async (key) => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
      await expect(ControlLayout({ children: null })).rejects.toThrow(
        "SUPABASE_BROWSER_CONFIG_INVALID",
      );
    },
  );
  it("permits a validated publishable key across the client boundary", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_server_boundary_fixture",
    );
    await expect(ControlLayout({ children: null })).resolves.toBeDefined();
  });
});
