import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminServerClient: vi.fn(),
  getAdminEnv: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminServerClient: mocks.createAdminServerClient,
}));
vi.mock("@/lib/env", () => ({ getAdminEnv: mocks.getAdminEnv }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  getAdminIdentity,
  requireAdminCommand,
  requireAdminIdentity,
} from "@/lib/auth/principal";

const USER_ID = "5bfd92eb-e463-4325-8da6-bb21fbc7e1cd";
const ADMIN_ORIGIN = "https://admin.mining.putduk.com";

function createAuthenticatedClient({
  amr = [{ method: "password", timestamp: 1_000 }],
  roles = [],
}: {
  amr?: Array<{ method: string; timestamp: number }>;
  roles?: string[];
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
            session_id: "session-01",
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
  });

  it("ignores user-editable metadata and derives no authority without a DB role", async () => {
    const { client } = createAuthenticatedClient();
    mocks.createAdminServerClient.mockResolvedValue(client);

    await expect(getAdminIdentity()).resolves.toMatchObject({
      role: null,
      userId: USER_ID,
    });
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
  });

  it("requires a fresh TOTP step-up even when the DB role is privileged", async () => {
    const { client } = createAuthenticatedClient({ roles: ["ADMIN"] });
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
      code: "STEP_UP_REQUIRED",
      ok: false,
      status: 403,
    });
  });
});
