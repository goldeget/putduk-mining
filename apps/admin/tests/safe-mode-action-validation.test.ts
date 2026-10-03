import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/(control)/_lib/command-gate", () => ({
  requireHighImpactPrincipal: vi.fn(),
  mapRpcFailure: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: vi.fn(),
}));

import { setSafeModeAction } from "@/app/(control)/restrictions/actions";
import { requireHighImpactPrincipal } from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { createAdminServiceClient } from "@/lib/supabase/service";

function form() {
  const data = new FormData();
  data.set("component", "NOTIFICATION");
  data.set("pause", "true");
  data.set("reason", "알림 지연을 확인해 잠시 멈춥니다.");
  data.set("confirmation", "SAFE_MODE");
  data.set("stepUpToken", "one-time-confirmation-not-consumed");
  data.set("clientOnline", "1");
  return data;
}

describe("safe-mode invalid input preserves one-time confirmation", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["2000-01-01T00:00", "2099-02-30T12:00", "not-a-date"])(
    "rejects review time %s without consuming a grant or opening the DB",
    async (reviewAt) => {
      const data = form();
      data.set("reviewAt", reviewAt);
      expect(await setSafeModeAction(null, data)).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(requireHighImpactPrincipal).not.toHaveBeenCalled();
      expect(createAdminServiceClient).not.toHaveBeenCalled();
    },
  );

  it("rejects missing human confirmation before consuming the grant", async () => {
    const data = form();
    data.delete("confirmation");
    expect(await setSafeModeAction(null, data)).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(requireHighImpactPrincipal).not.toHaveBeenCalled();
    expect(createAdminServiceClient).not.toHaveBeenCalled();
  });

  it("blocks an explicitly disconnected submission without replay or authority checks", async () => {
    const data = form();
    data.set("clientOnline", "0");
    expect(await setSafeModeAction(null, data)).toMatchObject({
      ok: false,
      code: "OFFLINE_BLOCKED",
    });
    expect(requireHighImpactPrincipal).not.toHaveBeenCalled();
    expect(createAdminServiceClient).not.toHaveBeenCalled();
  });

  it("still requires current authority for valid input before any DB write", async () => {
    vi.mocked(requireHighImpactPrincipal).mockResolvedValue({
      ok: false,
      result: {
        ok: false,
        code: "ROLE_FORBIDDEN",
        message: "권한이 없습니다.",
      },
    });
    const data = form();
    expect(await setSafeModeAction(null, data)).toMatchObject({
      ok: false,
      code: "ROLE_FORBIDDEN",
    });
    expect(requireHighImpactPrincipal).toHaveBeenCalledWith(
      ADMIN_COMMAND_FAMILIES.SAFE_MODE,
      data,
      HIGH_IMPACT_ROLES,
    );
    expect(createAdminServiceClient).not.toHaveBeenCalled();
  });
});
