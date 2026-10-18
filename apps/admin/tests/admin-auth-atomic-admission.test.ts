import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  signIn: vi.fn(),
  verify: vi.fn(),
  createAuth: vi.fn(),
  proof: vi.fn(),
  writeProof: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminServerClient: mocks.createAuth,
}));
vi.mock("@/lib/security/events", () => ({
  recordAdminSecurityEvent: async () => true,
}));
vi.mock("@/lib/env", () => ({
  getAdminEnv: () => ({ ADMIN_APP_URL: "https://admin.mining.putduk.com" }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/failure-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/failure-limit")>()),
  hasAdminAuthServerProof: mocks.proof,
  writeAdminAuthServerProof: mocks.writeProof,
}));
vi.mock("@/lib/auth/principal", () => ({
  getAdminIdentity: async () => ({
    role: "ADMIN",
    userId: "operator",
    sessionId: "auth-session",
    supabase: {
      auth: {
        mfa: {
          listFactors: async () => ({
            data: { totp: [{ id: "factor", status: "verified" }] },
            error: null,
          }),
          challengeAndVerify: mocks.verify,
        },
      },
    },
  }),
  requireAdminCommand: vi.fn(),
}));

import { loginAction } from "@/app/actions";
import { POST as verifyTotp } from "@/app/api/v1/admin/session/totp-verify/route";
import {
  admitAdminAuthAttempt,
  createSecurityEventFailureStore,
  finishAdminAuthAttempt,
} from "@/lib/auth/failure-limit";

const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee6106";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createAuth.mockResolvedValue({
    auth: { signInWithPassword: mocks.signIn },
  });
  mocks.signIn.mockResolvedValue({
    data: { user: null },
    error: { message: "invalid" },
  });
  mocks.verify.mockResolvedValue({ error: { message: "invalid" } });
  mocks.proof.mockResolvedValue(true);
});

function reservedLastSlot() {
  let failures = 4;
  let pending = 0;
  mocks.rpc.mockImplementation(
    async (name: string, args: Record<string, unknown>) => {
      if (name === "admit_admin_auth_attempt") {
        if (failures + pending >= 5)
          return { data: null, error: { message: "ADMIN_AUTH_RATE_LIMITED" } };
        pending += 1;
        return { data: ATTEMPT, error: null };
      }
      pending -= 1;
      if (!args.p_succeeded) failures += 1;
      return { data: null, error: null };
    },
  );
  return () => ({ failures, pending });
}

describe("live admin auth uses atomic reservations", () => {
  it("concurrent password failures contact Auth only for the remaining slot", async () => {
    const state = reservedLastSlot();
    await Promise.all(
      Array.from({ length: 20 }, () => {
        const form = new FormData();
        form.set("email", "operator@example.com");
        form.set("password", "fixture-password");
        return loginAction(null, form);
      }),
    );
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(state()).toEqual({ failures: 5, pending: 0 });
    const admissions = mocks.rpc.mock.calls.filter(
      ([name]) => name === "admit_admin_auth_attempt",
    );
    expect(admissions).toHaveLength(20);
    expect(JSON.stringify(admissions)).not.toContain("operator@example.com");
    expect(JSON.stringify(admissions)).not.toContain("fixture-password");
  });

  it("concurrent TOTP failures contact Auth only for the remaining slot", async () => {
    const state = reservedLastSlot();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        verifyTotp(
          new Request(
            "https://admin.mining.putduk.com/api/v1/admin/session/totp-verify",
            {
              method: "POST",
              headers: { origin: "https://admin.mining.putduk.com" },
              body: JSON.stringify({ purpose: "SESSION", code: "123456" }),
            },
          ),
        ),
      ),
    );
    expect(mocks.verify).toHaveBeenCalledOnce();
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(19);
    expect(state()).toEqual({ failures: 5, pending: 0 });
    expect(mocks.writeProof).not.toHaveBeenCalled();
  });

  it.each(["PASSWORD", "TOTP"] as const)(
    "unavailable %s admission fails closed before provider calls",
    async (scope) => {
      mocks.rpc.mockRejectedValue(new Error("store unavailable"));
      await expect(admitAdminAuthAttempt(scope, "operator")).resolves.toEqual({
        allowed: false,
        code: "UNAVAILABLE",
      });
      expect(mocks.signIn).not.toHaveBeenCalled();
      expect(mocks.verify).not.toHaveBeenCalled();
    },
  );

  it("does not release a reservation when outcome storage is unavailable", async () => {
    mocks.rpc.mockRejectedValue(new Error("store unavailable"));
    await expect(finishAdminAuthAttempt(ATTEMPT, true)).resolves.toBe(false);
  });

  it("denies password entry and clears Auth when completion storage fails", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    mocks.createAuth.mockResolvedValue({
      auth: { signInWithPassword: mocks.signIn, signOut },
      from: () => ({
        select: () => ({
          eq: () => ({
            is: async () => ({ data: [{ role: "ADMIN" }], error: null }),
          }),
        }),
      }),
    });
    mocks.signIn.mockResolvedValue({
      data: { user: { id: "operator" } },
      error: null,
    });
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "admit_admin_auth_attempt"
        ? { data: ATTEMPT, error: null }
        : { data: null, error: { message: "completion unavailable" } },
    );
    const form = new FormData();
    form.set("email", "operator@example.com");
    form.set("password", "fixture-password");
    await expect(loginAction(null, form)).resolves.toEqual({
      message: "지금은 접속을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.writeProof).not.toHaveBeenCalled();
  });

  it("does not issue a TOTP proof when completion storage fails", async () => {
    mocks.verify.mockResolvedValue({ error: null });
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "admit_admin_auth_attempt"
        ? { data: ATTEMPT, error: null }
        : { data: null, error: { message: "completion unavailable" } },
    );
    const response = await verifyTotp(
      new Request(
        "https://admin.mining.putduk.com/api/v1/admin/session/totp-verify",
        {
          method: "POST",
          headers: { origin: "https://admin.mining.putduk.com" },
          body: JSON.stringify({ purpose: "SESSION", code: "123456" }),
        },
      ),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("AUTH_UNAVAILABLE");
    expect(mocks.writeProof).not.toHaveBeenCalled();
  });

  it("rejects a malformed admission receipt", async () => {
    const store = createSecurityEventFailureStore({
      rpc: async () => ({ data: "not-an-attempt-id", error: null }),
      from: () => {
        throw new Error("Unexpected direct event query during admission");
      },
    });
    await expect(
      admitAdminAuthAttempt("TOTP", "operator", store),
    ).resolves.toEqual({ allowed: false, code: "UNAVAILABLE" });
  });
});
