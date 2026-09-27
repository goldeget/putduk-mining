import { describe, expect, it } from "vitest";

import {
  decideAdminAccess,
  hasRecentTotpStepUp,
  STEP_UP_MAX_AGE_SECONDS,
} from "@/lib/auth/policy";
import { safeAdminReturnPath } from "@/lib/auth/return-path";
import { ADMIN_AUTH_COOKIE } from "@/lib/supabase/cookie";

describe("admin authorization policy", () => {
  it("denies a normal authenticated user without a server-managed role", () => {
    expect(
      decideAdminAccess({ authenticated: true, role: null, aal: "aal2" }),
    ).toBe("ROLE_REQUIRED");
  });

  it("requires AAL2 even for a privileged role", () => {
    expect(
      decideAdminAccess({
        authenticated: true,
        role: "SUPER_ADMIN",
        aal: "aal1",
      }),
    ).toBe("MFA_REQUIRED");
  });

  it("enforces command capability and recent TOTP step-up", () => {
    expect(
      decideAdminAccess({
        authenticated: true,
        role: "VIEWER",
        aal: "aal2",
        allowedRoles: ["SUPER_ADMIN", "ADMIN"],
        recentTotp: true,
      }),
    ).toBe("ROLE_FORBIDDEN");
    expect(
      decideAdminAccess({
        authenticated: true,
        role: "ADMIN",
        aal: "aal2",
        allowedRoles: ["SUPER_ADMIN", "ADMIN"],
        recentTotp: false,
      }),
    ).toBe("STEP_UP_REQUIRED");
    expect(
      decideAdminAccess({
        authenticated: true,
        role: "ADMIN",
        aal: "aal2",
        allowedRoles: ["SUPER_ADMIN", "ADMIN"],
        recentTotp: true,
      }),
    ).toBe("ALLOW");
  });

  it("accepts only a fresh TOTP method", () => {
    const now = 2_000_000;
    expect(
      hasRecentTotpStepUp(
        [{ method: "totp", timestamp: now - STEP_UP_MAX_AGE_SECONDS }],
        now,
      ),
    ).toBe(true);
    expect(
      hasRecentTotpStepUp(
        [{ method: "totp", timestamp: now - STEP_UP_MAX_AGE_SECONDS - 1 }],
        now,
      ),
    ).toBe(false);
    expect(
      hasRecentTotpStepUp([{ method: "password", timestamp: now }], now),
    ).toBe(false);
  });

  it("allows only known admin return paths", () => {
    expect(safeAdminReturnPath("/members?id=one")).toBe("/members?id=one");
    expect(safeAdminReturnPath("/deposits/usdt")).toBe("/deposits/usdt");
    expect(safeAdminReturnPath("/withdrawals/krw-bank")).toBe(
      "/withdrawals/krw-bank",
    );
    expect(safeAdminReturnPath("/withdrawals/usdt")).toBe("/withdrawals/usdt");
    expect(safeAdminReturnPath("//attacker.invalid")).toBe("/");
    expect(safeAdminReturnPath("/api/v1/admin/deposits/approve")).toBe("/");
  });

  it("uses a dedicated admin cookie storage key", () => {
    expect(ADMIN_AUTH_COOKIE).toBe("putduk-admin-auth");
    expect(ADMIN_AUTH_COOKIE).not.toBe("sb-auth-token");
  });
});
