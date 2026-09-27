import type { NextConfig } from "next";

const scriptSource =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

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
  // config.toml 기본 Auth 포트 유지
}

const connectSrc = isLocalRuntime
  ? `connect-src 'self' ${localConnectOrigins} https://*.supabase.co wss://*.supabase.co`
  : "connect-src 'self' https://*.supabase.co wss://*.supabase.co";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      connectSrc,
      "font-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "object-src 'none'",
      scriptSource,
      "style-src 'self' 'unsafe-inline'",
      ...(isLocalRuntime ? [] : ["upgrade-insecure-requests"]),
    ].join("; "),
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
