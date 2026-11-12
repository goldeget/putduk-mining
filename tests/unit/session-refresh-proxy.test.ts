import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({ getClaims: vi.fn(), getUser: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth }) }));
vi.mock("@/lib/env/public", () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_session_fixture",
  }),
}));
import { updateSupabaseSession } from "@/lib/supabase/proxy";
beforeEach(() => {
  auth.getClaims.mockReset();
  auth.getUser.mockReset();
  auth.getClaims.mockResolvedValue({
    data: null,
    error: { message: "JWKS temporarily unavailable" },
  });
  auth.getUser.mockResolvedValue({
    data: { user: { id: "verified-user" } },
    error: null,
  });
});
describe("member session renewal boundary", () => {
  it("retains a server-verified login when claims lookup temporarily fails", async () => {
    const r = await updateSupabaseSession(
      new NextRequest("https://workroom.putduk.com/workroom/cash/withdraw"),
    );
    expect(r.headers.get("location")).toBeNull();
    expect(auth.getUser).toHaveBeenCalledOnce();
  });
  it("still rejects a session when neither verification succeeds", async () => {
    auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "not authenticated" },
    });
    const r = await updateSupabaseSession(
      new NextRequest("https://workroom.putduk.com/workroom"),
    );
    expect(r.headers.get("location")).toContain("/login?next=%2Fworkroom");
  });
  it("uses valid claims directly without an additional network lookup", async () => {
    auth.getClaims.mockResolvedValue({
      data: { claims: { sub: "verified-user" } },
      error: null,
    });
    await updateSupabaseSession(
      new NextRequest("https://workroom.putduk.com/workroom"),
    );
    expect(auth.getUser).not.toHaveBeenCalled();
  });
});
