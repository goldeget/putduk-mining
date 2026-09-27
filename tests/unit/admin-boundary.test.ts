import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("public/admin physical boundary", () => {
  it.each([
    "app/admin/(protected)/page.tsx",
    "app/admin/login/page.tsx",
    "app/api/v1/admin/deposits/approve/route.ts",
    "components/admin/admin-shell.tsx",
  ])("does not ship the former public admin path: %s", (relativePath) => {
    expect(existsSync(resolve(root, relativePath))).toBe(false);
  });

  it("does not expose admin routes through the public proxy", () => {
    const proxy = readFileSync(resolve(root, "proxy.ts"), "utf8");
    expect(proxy).not.toContain("/admin");
    expect(proxy).not.toContain("/administrator");
    expect(proxy).not.toContain("/manage");
    expect(proxy).not.toContain("/backoffice");
  });

  it("keeps the public environment free of an admin navigation URL", () => {
    const publicEnv = readFileSync(resolve(root, "lib/env/public.ts"), "utf8");
    expect(publicEnv).not.toContain("NEXT_PUBLIC_ADMIN_URL");
  });

  it("does not ship the former control-plane styles or origin in public code", () => {
    const styles = readFileSync(resolve(root, "app/globals.css"), "utf8");
    const analytics = readFileSync(
      resolve(root, "app/api/v1/analytics/route.ts"),
      "utf8",
    );
    expect(styles).not.toContain(".admin-");
    expect(analytics).not.toContain("ADMIN_APP_URL");
  });
});
