import type { NextConfig } from "next";

import { channelTalkCsp } from "./lib/support/csp";

const scriptSource =
  process.env.NODE_ENV === "development"
    ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${channelTalkCsp.script}`
    : `script-src 'self' 'unsafe-inline' ${channelTalkCsp.script}`;

// 로컬 Auth/API(E2E·개발)는 http://127.0.0.1 — 브라우저 MFA/세션 호출이 CSP에 막히지 않게 한다.
const localSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocalRuntime =
  process.env.APP_ENV === "test" ||
  process.env.NODE_ENV === "development" ||
  localSupabaseUrl.startsWith("http://127.0.0.1") ||
  localSupabaseUrl.startsWith("http://localhost");

let localConnectOrigins =
  "http://127.0.0.1:58421 http://localhost:58421 ws://127.0.0.1:58421 ws://localhost:58421";
try {
  if (localSupabaseUrl.startsWith("http://")) {
    const parsed = new URL(localSupabaseUrl);
    const origin = `${parsed.protocol}//${parsed.host}`;
    const wsOrigin = origin.replace(/^http/, "ws");
    localConnectOrigins = `${origin} ${origin.replace("127.0.0.1", "localhost")} ${wsOrigin} ${wsOrigin.replace("127.0.0.1", "localhost")}`;
  }
} catch {
  // keep default local Auth port from config.toml
}

const connectSrc = isLocalRuntime
  ? `connect-src 'self' ${localConnectOrigins} https://*.supabase.co wss://*.supabase.co ${channelTalkCsp.connect}`
  : `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${channelTalkCsp.connect}`;

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      connectSrc,
      `font-src 'self' data: ${channelTalkCsp.font}`,
      "form-action 'self'",
      "frame-ancestors 'none'",
      channelTalkCsp.frame,
      `img-src 'self' data: blob: https://*.supabase.co ${channelTalkCsp.img}`,
      channelTalkCsp.media,
      "manifest-src 'self'",
      "object-src 'none'",
      scriptSource,
      "style-src 'self' 'unsafe-inline'",
      "worker-src 'self' blob:",
      ...(isLocalRuntime ? [] : ["upgrade-insecure-requests"]),
    ].join("; "),
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
