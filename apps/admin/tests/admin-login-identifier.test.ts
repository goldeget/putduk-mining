import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../lib/supabase/service", () => ({
  createAdminServiceClient: () => ({ rpc }),
}));
import { resolveAdminLoginEmail } from "../lib/auth/login-identifier";
beforeEach(() => vi.resetAllMocks());
describe("administrator login identifiers", () => {
  it("keeps email login independent of alias infrastructure", async () => {
    expect(await resolveAdminLoginEmail(" Operator@putduk.test ")).toEqual({
      email: "operator@putduk.test",
      serviceAvailable: true,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("resolves operator ID without inventing a member identity", async () => {
    rpc.mockResolvedValue({ data: "Operator@Putduk.test", error: null });
    expect(await resolveAdminLoginEmail(" PUTDUKADMIN ")).toEqual({
      email: "operator@putduk.test",
      serviceAvailable: true,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "resolve_operator_login_email",
      { p_login_id: "putdukadmin" },
    );
  });
  it("retains an existing member login ID when no operator alias exists", async () => {
    rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: "existing@putduk.test", error: null });
    expect((await resolveAdminLoginEmail("existingadmin")).email).toBe(
      "existing@putduk.test",
    );
    expect(rpc).toHaveBeenLastCalledWith("resolve_login_email", {
      p_login_id: "existingadmin",
    });
  });
  it("fails closed on duplicate alias or unavailable lookup without falling through", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "OPERATOR_ALIAS_AMBIGUOUS" },
    });
    expect(await resolveAdminLoginEmail("putdukadmin")).toEqual({
      email: null,
      serviceAvailable: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not convert malformed or missing identifiers into an Auth target", async () => {
    expect((await resolveAdminLoginEmail("bad id")).email).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await resolveAdminLoginEmail("missingadmin")).toEqual({
      email: null,
      serviceAvailable: true,
    });
  });
  it("rejects malformed service output", async () => {
    rpc.mockResolvedValue({ data: "not-an-email", error: null });
    expect(await resolveAdminLoginEmail("putdukadmin")).toEqual({
      email: null,
      serviceAvailable: false,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
