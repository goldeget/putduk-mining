import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { PUBLIC_SITE_ORIGIN, toPublicUrl } from "@/lib/trust/public-discovery";
import { buildIndexNowSubmission } from "@/lib/trust/indexnow";
import { safeAdminReturnPath } from "../../apps/admin/lib/auth/return-path";
import {
  canonicalWorkroomRedirect,
  isMemberSessionPath,
} from "@/lib/workroom/domains";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSupabaseSession: refresh }));
import { proxy } from "@/proxy";
beforeEach(() => {
  refresh.mockReset();
  refresh.mockReturnValue(NextResponse.next());
});

describe("WORKROOM canonical domains", () => {
  it("publishes the member WORKROOM host in discovery URLs", () => {
    expect(PUBLIC_SITE_ORIGIN).toBe("https://workroom.putduk.com");
    expect(toPublicUrl("/support")).toBe("https://workroom.putduk.com/support");
    expect(robots().host).toBe("https://workroom.putduk.com");
    expect(robots().sitemap).toBe("https://workroom.putduk.com/sitemap.xml");
    expect(buildIndexNowSubmission().host).toBe("workroom.putduk.com");
    for (const entry of sitemap())
      expect(new URL(entry.url).origin).toBe(PUBLIC_SITE_ORIGIN);
  });
  it("builds the existing Workers for separate new member and admin origins", () => {
    const member = readFileSync("cloudflare.config.ts", "utf8");
    const admin = readFileSync("apps/admin/cloudflare.config.ts", "utf8");
    const build = readFileSync(
      "scripts/ci-workroom-cloudflare-build.mjs",
      "utf8",
    );
    expect(member).toContain('name: "putduk-mining-web-staging"');
    expect(admin).toContain('name: "putduk-mining-admin-staging"');
    for (const source of [member, admin, build]) {
      expect(source).not.toContain("mining.putduk.com");
      expect(source).toContain("https://admin.workroom.putduk.com");
    }
    expect(member).toMatch(
      /NEXT_PUBLIC_APP_URL:\s*bindings\.text\(\s*"https:\/\/workroom\.putduk\.com"/,
    );
    expect(admin).toMatch(
      /NEXT_PUBLIC_APP_URL:\s*bindings\.text\(\s*"https:\/\/admin\.workroom\.putduk\.com"/,
    );
  });
  it("keeps admin return paths relative and rejects external redirects", () => {
    expect(safeAdminReturnPath("/members?q=test")).toBe("/members?q=test");
    for (const path of [
      "//admin.workroom.putduk.com/members",
      "https://workroom.putduk.com/members",
      "https://admin.mining.putduk.com/members",
      "/\\evil.example/members",
    ])
      expect(safeAdminReturnPath(path)).toBe("/");
  });
});

describe("legacy WORKROOM host redirects", () => {
  it.each(["GET", "HEAD"])(
    "redirects %s to fixed matching host with path and query intact",
    async (method) => {
      for (const [surface, oldHost, newHost] of [
        ["member", "mining.putduk.com", "workroom.putduk.com"],
        ["admin", "admin.mining.putduk.com", "admin.workroom.putduk.com"],
      ] as const) {
        expect(
          canonicalWorkroomRedirect(
            `https://${oldHost}/workroom/records?kind=deposit&next=%2Fworkroom`,
            method,
            surface,
          )?.href,
        ).toBe(
          `https://${newHost}/workroom/records?kind=deposit&next=%2Fworkroom`,
        );
      }
      const response = await proxy(
        new NextRequest("https://mining.putduk.com/login?next=%2Fworkroom", {
          method,
        }),
      );
      expect(response.status).toBe(308);
      expect(response.headers.get("location")).toBe(
        "https://workroom.putduk.com/login?next=%2Fworkroom",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(refresh).not.toHaveBeenCalled();
    },
  );
  it("does not redirect unsafe methods, other hosts, spoofed hosts, or nondefault ports", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
      expect(
        canonicalWorkroomRedirect(
          "https://mining.putduk.com/workroom",
          method,
          "member",
        ),
      ).toBeNull();
    for (const url of [
      "https://workroom.putduk.com/",
      "https://admin.mining.putduk.com/",
      "https://mining.putduk.com.evil.example/",
      "https://mining.putduk.com:444/",
      "https://user@mining.putduk.com/",
      "invalid",
    ])
      expect(canonicalWorkroomRedirect(url, "GET", "member")).toBeNull();
  });
  it("keeps canonical public routes free of auth refresh and preserves protected routing", async () => {
    for (const path of [
      "/",
      "/login",
      "/signup",
      "/auth/callback",
      "/faq",
      "/mining-rules",
      "/api/v1/public/facts",
    ])
      await proxy(new NextRequest(`https://workroom.putduk.com${path}`));
    expect(refresh).not.toHaveBeenCalled();
    for (const path of [
      "/workroom",
      "/workroom/cash",
      "/menu/account",
      "/api/v1/withdrawals/request",
      "/api/v1/analytics/collect",
    ]) {
      expect(isMemberSessionPath(path)).toBe(true);
      await proxy(new NextRequest(`https://workroom.putduk.com${path}`));
    }
    expect(refresh).toHaveBeenCalledTimes(5);
    expect(isMemberSessionPath("/ai")).toBe(true);
    expect(isMemberSessionPath("/wallet-other")).toBe(false);
    const oldPost = await proxy(
      new NextRequest("https://mining.putduk.com/api/v1/workroom/settle", {
        method: "POST",
      }),
    );
    expect(oldPost.headers.get("location")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(6);
  });
});
