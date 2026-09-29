import { describe, expect, it } from "vitest";

import {
  canMutateSafeMode,
  decideSafeModeMutationAccess,
  parseSafeModeFormInput,
  SAFE_MODE_COMPONENTS,
  safeModeAuditAction,
  safeModeStateLabel,
  safeModeSuccessMessage,
} from "@/app/(control)/restrictions/safe-mode-policy";

describe("admin restrictions · safe mode policy", () => {
  it("allows only SUPER_ADMIN and ADMIN to mutate safe mode", () => {
    expect(canMutateSafeMode("SUPER_ADMIN")).toBe(true);
    expect(canMutateSafeMode("ADMIN")).toBe(true);
    expect(canMutateSafeMode("CONTENT_ADMIN")).toBe(false);
    expect(canMutateSafeMode("SUPPORT_ADMIN")).toBe(false);
    expect(canMutateSafeMode("VIEWER")).toBe(false);
    expect(canMutateSafeMode(null)).toBe(false);
  });

  it("never treats cleared safe mode or an enabled feature flag as authorization", () => {
    expect(
      decideSafeModeMutationAccess({
        authenticated: true,
        role: "VIEWER",
        aal: "aal2",
        safeModeCleared: true,
        featureFlagEnabled: true,
      }),
    ).toBe("ROLE_FORBIDDEN");

    expect(
      decideSafeModeMutationAccess({
        authenticated: true,
        role: "SUPPORT_ADMIN",
        aal: "aal2",
        safeModeCleared: true,
        featureFlagEnabled: true,
      }),
    ).toBe("ROLE_FORBIDDEN");

    expect(
      decideSafeModeMutationAccess({
        authenticated: true,
        role: "ADMIN",
        aal: "aal1",
        safeModeCleared: true,
        featureFlagEnabled: true,
      }),
    ).toBe("MFA_REQUIRED");

    expect(
      decideSafeModeMutationAccess({
        authenticated: true,
        role: "ADMIN",
        aal: "aal2",
        safeModeCleared: false,
        featureFlagEnabled: false,
      }),
    ).toBe("ALLOW");
  });

  it("requires an explicit reason, confirmation, and known component", () => {
    expect(
      parseSafeModeFormInput({
        component: "WITHDRAWAL",
        pause: "true",
        reason: "짧음",
        confirmation: "SAFE_MODE",
      }).ok,
    ).toBe(false);

    expect(
      parseSafeModeFormInput({
        component: "WITHDRAWAL",
        pause: "true",
        reason: "출금 이상을 확인해 잠시 멈춥니다.",
        confirmation: "WRONG",
      }).ok,
    ).toBe(false);

    expect(
      parseSafeModeFormInput({
        component: "UNKNOWN_COMPONENT",
        pause: "true",
        reason: "출금 이상을 확인해 잠시 멈춥니다.",
        confirmation: "SAFE_MODE",
      }).ok,
    ).toBe(false);

    const ok = parseSafeModeFormInput({
      component: "WITHDRAWAL",
      pause: "true",
      reason: "출금 이상을 확인해 잠시 멈춥니다.",
      confirmation: "SAFE_MODE",
    });
    expect(ok).toEqual({
      ok: true,
      data: {
        component: "WITHDRAWAL",
        pause: "true",
        reason: "출금 이상을 확인해 잠시 멈춥니다.",
        confirmation: "SAFE_MODE",
        reviewAt: null,
      },
    });
  });

  it("rejects a review time that is not after now", () => {
    const past = new Date(Date.now() - 60_000).toISOString().slice(0, 16);
    expect(
      parseSafeModeFormInput({
        component: "DEPOSIT",
        pause: "true",
        reason: "입금 확인이 밀려 잠시 멈춥니다.",
        confirmation: "SAFE_MODE",
        reviewAt: past,
      }).ok,
    ).toBe(false);
  });

  it("keeps the approved V1 component set without inventing new types", () => {
    expect(SAFE_MODE_COMPONENTS).toEqual([
      "GLOBAL",
      "SIGNUP",
      "TRIAL",
      "NEW_MINING",
      "SETTLEMENT",
      "DEPOSIT",
      "WITHDRAWAL",
      "REFERRAL_PAYOUT",
      "EVENT_PAYOUT",
      "NOTIFICATION",
      "AI",
    ]);
  });

  it("maps pause state to operator labels, audit actions, and success copy", () => {
    expect(safeModeStateLabel(true)).toBe("정지 중");
    expect(safeModeStateLabel(false)).toBe("정상");
    expect(safeModeAuditAction(true)).toBe("SAFE_MODE_ENABLED");
    expect(safeModeAuditAction(false)).toBe("SAFE_MODE_DISABLED");
    expect(safeModeSuccessMessage("TRIAL", true)).toBe(
      "퍼뜩 시작 기능을 잠시 멈췄습니다.",
    );
    expect(safeModeSuccessMessage("TRIAL", false)).toBe(
      "퍼뜩 시작 기능 제한을 해제했습니다.",
    );
  });
});
