import type { NextConfig } from "next";

import { buildPublicContentSecurityPolicy } from "./lib/support/csp";
import { resolveNextDistDir } from "./scripts/resolve-next-dist-dir.mjs";

const contentSecurityPolicy = buildPublicContentSecurityPolicy({
  appEnv: process.env.APP_ENV,
  nodeEnv: process.env.NODE_ENV ?? "production",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  distDir: resolveNextDistDir(),
  allowedDevOrigins: ["127.0.0.1"],
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    optimizePackageImports: ["motion"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      ...[
        "/login",
        "/signup",
        "/find-id",
        "/recover",
        "/auth/update-password",
      ].map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
      ...[
        "/home",
        "/start",
        "/mining",
        "/products/:path*",
        "/wallet/:path*",
        "/events",
        "/notifications",
        "/ai",
        "/menu/:path*",
      ].map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
};

export default nextConfig;
