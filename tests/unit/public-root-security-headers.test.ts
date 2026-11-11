import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("public root security headers", () => {
  it("applies the same security policy to root and nested pages through the deployed matcher", async () => {
    const matcherUrl = new URL(
      "../../node_modules/vinext/dist/config/config-matchers.js",
      import.meta.url,
    );
    const { matchHeaders } = await import(matcherUrl.href);
    const rules = await nextConfig.headers!();
    const headersAt = (path: string) =>
      new Map<string, string>(
        matchHeaders(path, rules).map(
          ({ key, value }: { key: string; value: string }) => [
            key.toLowerCase(),
            value,
          ],
        ),
      );
    const root = headersAt("/");
    const nested = headersAt("/signup");

    for (const name of [
      "content-security-policy",
      "cross-origin-opener-policy",
      "cross-origin-resource-policy",
      "x-content-type-options",
      "x-frame-options",
      "referrer-policy",
      "strict-transport-security",
      "permissions-policy",
    ]) {
      expect(root.get(name), name).toBeTruthy();
      expect(root.get(name), name).toBe(nested.get(name));
    }
    expect(root.get("content-security-policy")).toContain("object-src 'none'");
    expect(root.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(root.get("x-frame-options")).toBe("DENY");
  });
});
