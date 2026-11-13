import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  claims: vi.fn(),
  env: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.create }));
vi.mock("@/lib/env", () => ({ getAdminEnv: mocks.env }));
import { updateAdminSession } from "../lib/supabase/proxy";
const origin = "https://admin.workroom.putduk.com";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.mockReturnValue({
    NEXT_PUBLIC_SUPABASE_URL: "https://awrubjiqkggaxcvtckbr.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-only-public-key",
  });
  mocks.create.mockReturnValue({ auth: { getClaims: mocks.claims } });
  mocks.claims.mockResolvedValue({ data: { claims: null }, error: null });
});
describe("anonymous admin PWA resources", () => {
  it.each(["/manifest.webmanifest", "/sw.js", "/offline.html"])(
    "serves exact public resource %s without an Auth lookup",
    async (path) => {
      for (const method of ["GET", "HEAD"]) {
        const response = await updateAdminSession(
          new NextRequest(origin + path, { method }),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("x-middleware-next")).toBe("1");
      }
      expect(mocks.claims).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.env).not.toHaveBeenCalled();
    },
  );
  it.each([
    "/notifications",
    "/support",
    "/manifest.webmanifest/private",
    "/sw.js.map",
    "/offline.html/private",
  ])(
    "keeps anonymous protected or non-exact path %s behind login",
    async (path) => {
      const response = await updateAdminSession(new NextRequest(origin + path));
      expect(response.status).toBe(307);
      const login = new URL(response.headers.get("location")!);
      expect(login.pathname).toBe("/login");
      expect(mocks.claims).toHaveBeenCalledOnce();
    },
  );
  it("does not treat a POST to the static path as a public resource request", async () => {
    const response = await updateAdminSession(
      new NextRequest(origin + "/sw.js", { method: "POST" }),
    );
    expect(response.status).toBe(307);
    expect(mocks.claims).toHaveBeenCalledOnce();
  });
});
