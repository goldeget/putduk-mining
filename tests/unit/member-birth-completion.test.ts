import { beforeEach, describe, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ identity: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: io.identity }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: io.rpc }),
}));
vi.mock("@/lib/env/public", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: "https://workroom.putduk.com" }),
}));
import { POST } from "@/app/api/v1/me/birth-digit/route";
function req(body: unknown, origin = "https://workroom.putduk.com") {
  return new Request("https://workroom.putduk.com/api/v1/me/birth-digit", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  io.identity.mockReset().mockResolvedValue({ userId: "verified-member" });
  io.rpc
    .mockReset()
    .mockResolvedValue({ data: { digit: "2", completed: true }, error: null });
});
describe("member missing birth digit completion", () => {
  it("binds the update to the verified user and accepts only the single digit", async () => {
    expect((await POST(req({ digit: "2" }))).status).toBe(200);
    expect(io.rpc).toHaveBeenCalledWith(
      "complete_workroom_birth_digit",
      expect.objectContaining({ p_user_id: "verified-member", p_digit: "2" }),
    );
  });
  it.each([
    { digit: "2123456" },
    { digit: "9" },
    { digit: "2", userId: "different-user" },
    {},
  ])(
    "rejects full ID fragments and client-selected identities",
    async (body) => {
      expect((await POST(req(body))).status).toBe(400);
      expect(io.rpc).not.toHaveBeenCalled();
    },
  );
  it("rejects an untrusted origin before any lookup or update", async () => {
    expect(
      (await POST(req({ digit: "2" }, "https://evil.invalid"))).status,
    ).toBe(403);
    expect(io.identity).not.toHaveBeenCalled();
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated updates", async () => {
    io.identity.mockResolvedValue(null);
    expect((await POST(req({ digit: "2" }))).status).toBe(401);
    expect(io.rpc).not.toHaveBeenCalled();
  });
  it("does not overwrite a previously supplied digit", async () => {
    io.rpc.mockResolvedValue({
      data: null,
      error: { message: "BIRTH_DIGIT_ALREADY_RECORDED" },
    });
    expect((await POST(req({ digit: "1" }))).status).toBe(409);
  });
});
