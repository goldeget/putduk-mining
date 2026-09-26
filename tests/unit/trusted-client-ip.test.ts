import { describe, expect, it } from "vitest";

import { resolveTrustedClientIp } from "@/lib/security/trusted-client-ip";

describe("resolveTrustedClientIp", () => {
  it("accepts Cloudflare's client header only after a verified edge", () => {
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.10" });
    expect(
      resolveTrustedClientIp({
        cloudflareEdgeVerified: true,
        headers,
        mode: "CLOUDFLARE",
      }),
    ).toEqual({
      address: "203.0.113.10",
      source: "CLOUDFLARE_VERIFIED",
    });
  });

  it("ignores spoofable forwarding headers without a trusted edge", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.8",
    });
    expect(
      resolveTrustedClientIp({
        cloudflareEdgeVerified: false,
        headers,
        mode: "CLOUDFLARE",
      }),
    ).toEqual({ address: null, source: "NONE" });
  });
});
