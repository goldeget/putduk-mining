import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  getAdminEnv: vi.fn(),
  getAdminIdentity: vi.fn(),
  assertAndTouchAdminAppSession: vi.fn(),
  consumeAdminStepUpGrant: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/env", () => ({ getAdminEnv: mocks.getAdminEnv }));
vi.mock("@/lib/auth/principal", () => ({
  getAdminIdentity: mocks.getAdminIdentity,
}));
vi.mock("@/lib/auth/session-registry", () => ({
  assertAndTouchAdminAppSession: mocks.assertAndTouchAdminAppSession,
}));
vi.mock("@/lib/auth/step-up", () => ({
  consumeAdminStepUpGrant: mocks.consumeAdminStepUpGrant,
}));

import { requireHighImpactPrincipal } from "@/app/(control)/_lib/command-gate";
import type { AdminIdentity } from "@/lib/auth/principal";

const ADMIN_ORIGIN = "https://admin.mining.putduk.com";
const identity: AdminIdentity = {
  userId: "0d450000-0000-4000-8000-000000000001",
  sessionId: "0d450000-0000-4000-8000-000000000002",
  adminSessionId: null,
  supabase: {} as SupabaseClient,
  role: "ADMIN",
  aal: "aal2",
  amr: [{ method: "totp", timestamp: 1_000 }],
};

function form() {
  const data = new FormData();
  data.set("stepUpToken", "confirmed-single-use-token");
  return data;
}

describe("high-impact Server Action boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockResolvedValue(
      new Headers({
        origin: ADMIN_ORIGIN,
        "user-agent": "PutdukAdminTest/1.0",
      }),
    );
    mocks.getAdminEnv.mockReturnValue({ ADMIN_APP_URL: ADMIN_ORIGIN });
    mocks.getAdminIdentity.mockResolvedValue(identity);
    mocks.assertAndTouchAdminAppSession.mockResolvedValue({
      ok: true,
      adminSessionId: "0d450000-0000-4000-8000-000000000003",
    });
    mocks.consumeAdminStepUpGrant.mockResolvedValue(true);
  });

  it.each([null, "null", "https://mining.putduk.com", `${ADMIN_ORIGIN}:444`])(
    "rejects origin %s without touching identity, session or a grant",
    async (origin) => {
      const requestHeaders = new Headers({
        host: "admin.mining.putduk.com",
        "x-forwarded-host": "admin.mining.putduk.com",
      });
      if (origin !== null) requestHeaders.set("origin", origin);
      mocks.headers.mockResolvedValue(requestHeaders);
      await expect(
        requireHighImpactPrincipal("DEPOSIT_CONFIRM", form()),
      ).resolves.toMatchObject({
        ok: false,
        result: { ok: false, code: "ORIGIN_DENIED" },
      });
      expect(mocks.getAdminIdentity).not.toHaveBeenCalled();
      expect(mocks.assertAndTouchAdminAppSession).not.toHaveBeenCalled();
      expect(mocks.consumeAdminStepUpGrant).not.toHaveBeenCalled();
    },
  );

  it("accepts only the configured local admin origin without a localhost bypass", async () => {
    mocks.getAdminEnv.mockReturnValue({
      ADMIN_APP_URL: "http://127.0.0.1:3301",
    });
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "http://127.0.0.1:3300" }),
    );
    await expect(
      requireHighImpactPrincipal("DEPOSIT_CONFIRM", form()),
    ).resolves.toMatchObject({
      ok: false,
      result: { code: "ORIGIN_DENIED" },
    });
    expect(mocks.consumeAdminStepUpGrant).not.toHaveBeenCalled();
    mocks.headers.mockResolvedValue(
      new Headers({ origin: "http://127.0.0.1:3301" }),
    );
    await expect(
      requireHighImpactPrincipal("DEPOSIT_CONFIRM", form()),
    ).resolves.toMatchObject({ ok: true });
    expect(mocks.consumeAdminStepUpGrant).toHaveBeenCalledTimes(1);
  });

  it.each([
    [null, "UNAUTHENTICATED"],
    [{ ...identity, role: null }, "ROLE_REQUIRED"],
    [{ ...identity, role: "SUPPORT_ADMIN" }, "ROLE_FORBIDDEN"],
    [{ ...identity, aal: "aal1" }, "MFA_REQUIRED"],
  ])(
    "rejects a denied identity without consuming a grant",
    async (principal, code) => {
      mocks.getAdminIdentity.mockResolvedValue(principal);
      await expect(
        requireHighImpactPrincipal("DEPOSIT_CONFIRM", form()),
      ).resolves.toMatchObject({
        ok: false,
        result: { code },
      });
      expect(mocks.assertAndTouchAdminAppSession).not.toHaveBeenCalled();
      expect(mocks.consumeAdminStepUpGrant).not.toHaveBeenCalled();
    },
  );

  it("rejects a revoked app session before consuming the family grant", async () => {
    mocks.assertAndTouchAdminAppSession.mockResolvedValue({
      ok: false,
      code: "ADMIN_SESSION_REVOKED",
    });
    await expect(
      requireHighImpactPrincipal("DEPOSIT_CONFIRM", form()),
    ).resolves.toMatchObject({
      ok: false,
      result: { code: "ADMIN_SESSION_REVOKED" },
    });
    expect(mocks.consumeAdminStepUpGrant).not.toHaveBeenCalled();
  });

  it("keeps the single-use grant bound to the authenticated operator and command family", async () => {
    const result = await requireHighImpactPrincipal("KYC_REVIEW", form());
    expect(result).toMatchObject({
      ok: true,
      principal: {
        ...identity,
        adminSessionId: "0d450000-0000-4000-8000-000000000003",
      },
    });
    expect(mocks.assertAndTouchAdminAppSession).toHaveBeenCalledWith({
      userId: identity.userId,
      authSessionId: identity.sessionId,
      userAgent: "PutdukAdminTest/1.0",
    });
    if (!result.ok) throw new Error("expected a valid command principal");
    expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.consumeAdminStepUpGrant).toHaveBeenCalledExactlyOnceWith({
      userId: identity.userId,
      adminSessionId: result.principal.adminSessionId,
      token: "confirmed-single-use-token",
      commandFamily: "KYC_REVIEW",
      requestId: result.requestId,
    });
  });

  it("fails closed when the grant is already used or belongs to another command family", async () => {
    mocks.consumeAdminStepUpGrant.mockResolvedValue(false);
    await expect(
      requireHighImpactPrincipal("DEPOSIT_CONFIRM", form()),
    ).resolves.toMatchObject({
      ok: false,
      result: { code: "STEP_UP_INVALID" },
    });
  });
});
