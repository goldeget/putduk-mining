import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminServerClient: vi.fn(),
  getAdminEnv: vi.fn(),
  assertAndTouchAdminAppSession: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminServerClient: mocks.createAdminServerClient,
}));
vi.mock("@/lib/env", () => ({ getAdminEnv: mocks.getAdminEnv }));
vi.mock("@/lib/auth/session-registry", () => ({
  assertAndTouchAdminAppSession: mocks.assertAndTouchAdminAppSession,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name.toLowerCase() === "user-agent" ? "PutdukAdminTest/1.0" : null,
  })),
}));

import {
  getAdminIdentity,
  getAdminIdentityForLoginPage,
  requireAdminCommand,
  requireAdminIdentity,
} from "@/lib/auth/principal";

const USER_ID = "5bfd92eb-e463-4325-8da6-bb21fbc7e1cd";
const ADMIN_ORIGIN = "https://admin.mining.putduk.com";
const ADMIN_SESSION_ID = "9c0f1a2b-3d4e-5f60-7182-93a4b5c6d7e8";

function createAuthenticatedClient({
  amr = [{ method: "password", timestamp: 1_000 }],
  roles = [],
  sessionId = "session-01",
}: {
  amr?: Array<{ method: string; timestamp: number }>;
  roles?: string[];
  sessionId?: string;
} = {}) {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const roleQuery = {
    is: vi.fn().mockResolvedValue({
      data: roles.map((role) => ({ role })),
      error: null,
    }),
  };
  const client = {
    auth: {
      getClaims: vi.fn().mockResolvedValue({
        data: {
          claims: {
            aal: "aal2",
            amr,
            session_id: sessionId,
            sub: USER_ID,
          },
        },
        error: null,
      }),
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
            user_metadata: { role: "SUPER_ADMIN" },
          },
        },
        error: null,
      }),
      signOut,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => roleQuery),
      })),
    })),
  };

  return { client, signOut };
}

describe("admin server principal boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminEnv.mockReturnValue({ ADMIN_APP_URL: ADMIN_ORIGIN });
    mocks.assertAndTouchAdminAppSession.mockResolvedValue({
      ok: true,
      adminSessionId: ADMIN_SESSION_ID,
    });
  });

  it("ignores user-editable metadata and derives no authority without a DB role", async () => {
    const { client } = createAuthenticatedClient();
    mocks.createAdminServerClient.mockResolvedValue(client);

    await expect(getAdminIdentity()).resolves.toMatchObject({
      role: null,
      userId: USER_ID,
    });
  });

  it("returns null on the login page when test identity lookup exceeds its budget", async () => {
    vi.useFakeTimers();
    vi.stubEnv("APP_ENV", "test");
    const { client } = createAuthenticatedClient();
    client.auth.getClaims.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    mocks.createAdminServerClient.mockResolvedValue(client);

    const pending = getAdminIdentityForLoginPage();
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("rejects a normal authenticated user from loading the admin control plane", async () => {
    const { client, signOut } = createAuthenticatedClient();
    mocks.createAdminServerClient.mockResolvedValue(client);

    await expect(requireAdminIdentity("/members")).rejects.toThrow(
      "REDIRECT:/login?denied=1",
    );
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("rejects a normal authenticated user at the real direct-command guard", async () => {
    const { client } = createAuthenticatedClient();
    mocks.createAdminServerClient.mockResolvedValue(client);

    await expect(
      requireAdminCommand(
        new Request(`${ADMIN_ORIGIN}/api/v1/admin/deposits/approve`, {
          headers: { origin: ADMIN_ORIGIN },
          method: "POST",
        }),
        ["SUPER_ADMIN", "ADMIN"],
      ),
    ).resolves.toEqual({
      code: "ROLE_REQUIRED",
      ok: false,
      status: 403,
    });
    expect(mocks.assertAndTouchAdminAppSession).not.toHaveBeenCalled();
  });

  it("rejects privileged operators without an app-owned admin session", async () => {
    const { client } = createAuthenticatedClient({ roles: ["ADMIN"] });
    mocks.createAdminServerClient.mockResolvedValue(client);
    mocks.assertAndTouchAdminAppSession.mockResolvedValue({
      ok: false,
      code: "ADMIN_SESSION_REQUIRED",
    });

    await expect(
      requireAdminCommand(
        new Request(`${ADMIN_ORIGIN}/api/v1/admin/deposits/approve`, {
          headers: {
            origin: ADMIN_ORIGIN,
            "user-agent": "PutdukAdminTest/1.0",
          },
          method: "POST",
        }),
        ["SUPER_ADMIN", "ADMIN"],
      ),
    ).resolves.toEqual({
      code: "ADMIN_SESSION_REQUIRED",
      ok: false,
      status: 403,
    });
  });

  it("binds a valid app-owned admin session for privileged commands", async () => {
    const { client } = createAuthenticatedClient({ roles: ["ADMIN"] });
    mocks.createAdminServerClient.mockResolvedValue(client);

    await expect(
      requireAdminCommand(
        new Request(`${ADMIN_ORIGIN}/api/v1/admin/deposits/approve`, {
          headers: {
            origin: ADMIN_ORIGIN,
            "user-agent": "PutdukAdminTest/1.0",
          },
          method: "POST",
        }),
        ["SUPER_ADMIN", "ADMIN"],
      ),
    ).resolves.toMatchObject({
      ok: true,
      principal: {
        adminSessionId: ADMIN_SESSION_ID,
        role: "ADMIN",
        userId: USER_ID,
      },
    });
  });
});
