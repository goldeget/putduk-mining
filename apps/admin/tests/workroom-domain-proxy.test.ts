import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/proxy", () => ({ updateAdminSession: refresh }));
vi.mock("@/lib/env", () => ({
  getAdminEnv: () => ({ ADMIN_APP_URL: "https://admin.workroom.putduk.com" }),
}));
import { proxy } from "../proxy";
import { hasAdminCommandOrigin } from "../lib/auth/request-origin";
beforeEach(() => {
  refresh.mockReset();
  refresh.mockReturnValue(NextResponse.next());
});
describe("administrator WORKROOM domain cutover", () => {
  it.each(["GET", "HEAD"])(
    "redirects old-host %s before auth with original path and query",
    async (method) => {
      const response = await proxy(
        new NextRequest(
          "https://admin.mining.putduk.com/login?returnTo=%2Fmembers",
          { method },
        ),
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        "https://admin.workroom.putduk.com/login?returnTo=%2Fmembers",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(refresh).not.toHaveBeenCalled();
    },
  );
  it("leaves new-host auth and old-host POST security on their existing paths", async () => {
    const current = await proxy(
      new NextRequest("https://admin.workroom.putduk.com/members"),
    );
    expect(current.headers.get("location")).toBeNull();
    const post = await proxy(
      new NextRequest(
        "https://admin.mining.putduk.com/api/v1/admin/members/search",
        { method: "POST" },
      ),
    );
    expect(post.headers.get("location")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("accepts only the configured new admin write origin despite spoofed host headers", () => {
    expect(
      hasAdminCommandOrigin(
        new Headers({ origin: "https://admin.workroom.putduk.com" }),
      ),
    ).toBe(true);
    for (const origin of [
      "https://admin.mining.putduk.com",
      "https://workroom.putduk.com",
      "https://evil.example",
      "null",
    ])
      expect(
        hasAdminCommandOrigin(
          new Headers({
            origin,
            host: "admin.workroom.putduk.com",
            "x-forwarded-host": "admin.workroom.putduk.com",
          }),
        ),
      ).toBe(false);
    expect(hasAdminCommandOrigin(new Headers())).toBe(false);
  });
});
