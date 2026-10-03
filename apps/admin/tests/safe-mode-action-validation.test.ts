import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/(control)/_lib/command-gate", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireHighImpactPrincipal: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: vi.fn(),
}));

import { setSafeModeAction } from "@/app/(control)/restrictions/actions";
import { revalidatePath } from "next/cache";
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
  data.set("idempotencyKey", "safe-mode-validated-test-operation");
  data.set("expectedRequestId", "");
  return data;
}

const ACTOR = "0d460000-0000-4000-8000-0000000000a1";
const REQUEST = "0d460000-0000-4000-8000-0000000000b1";
const RECEIPT = {
  id: "0d460000-0000-4000-8000-0000000000c1",
  actor_user_id: ACTOR,
  action: "SAFE_MODE_ENABLED",
  target_id: "NOTIFICATION",
  reason: "알림 지연을 확인해 잠시 멈춥니다.",
  request_id: REQUEST,
  after_state: {
    id: "0d460000-0000-4000-8000-0000000000d1",
    component: "NOTIFICATION",
    is_paused: true,
    changed_by: ACTOR,
    request_id: REQUEST,
  },
  metadata: { request_hash: "a".repeat(64) },
};

function installWriter(
  receipt: unknown,
  insertError: { message: string } | null = null,
  readError: { message: string } | null = null,
) {
  vi.mocked(requireHighImpactPrincipal).mockResolvedValue({
    ok: true,
    requestId: REQUEST,
    principal: {
      userId: ACTOR,
      role: "ADMIN",
      aal: "aal2",
      sessionId: "auth-session",
      adminSessionId: "admin-session",
      amr: [],
      supabase: {} as never,
    },
  });
  const writes: Record<string, unknown>[] = [];
  const query = {
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: receipt, error: readError })),
  };
  vi.mocked(createAdminServiceClient).mockReturnValue({
    from(table: string) {
      if (table !== "audit_logs")
        throw new Error(`Split state write forbidden: ${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          writes.push(row);
          return { error: insertError };
        },
        select: () => query,
      };
    },
  } as never);
  return writes;
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

  it("writes only the atomic audit command and accepts its verified receipt", async () => {
    const writes = installWriter(RECEIPT);
    expect(await setSafeModeAction(null, form())).toMatchObject({ ok: true });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      actor_user_id: ACTOR,
      request_id: REQUEST,
      metadata: {
        command_version: 1,
        idempotency_key: "safe-mode-validated-test-operation",
        expected_request_id: null,
        component: "NOTIFICATION",
        is_paused: true,
        review_at: null,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/restrictions");
  });

  it.each([
    null,
    { ...RECEIPT, after_state: null },
    { ...RECEIPT, actor_user_id: "another-operator" },
    { ...RECEIPT, target_id: "GLOBAL" },
    { ...RECEIPT, metadata: { request_hash: "invalid" } },
    { ...RECEIPT, after_state: { ...RECEIPT.after_state, is_paused: false } },
    {
      ...RECEIPT,
      after_state: { ...RECEIPT.after_state, request_id: "another-request" },
    },
  ])(
    "never reports an absent or mismatched receipt as success (%#)",
    async (receipt) => {
      installWriter(receipt);
      expect(await setSafeModeAction(null, form())).toMatchObject({
        ok: false,
        code: "RECEIPT_UNVERIFIED",
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("distinguishes stale state and never follows it with another write", async () => {
    const writes = installWriter(null, { message: "SAFE_MODE_STATE_CHANGED" });
    expect(await setSafeModeAction(null, form())).toMatchObject({
      ok: false,
      code: "STATE_CHANGED",
    });
    expect(writes).toHaveLength(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not convert a failed receipt read into successful execution", async () => {
    installWriter(null, null, { message: "connection unavailable" });
    expect(await setSafeModeAction(null, form())).toMatchObject({
      ok: false,
      code: "RECEIPT_UNVERIFIED",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
