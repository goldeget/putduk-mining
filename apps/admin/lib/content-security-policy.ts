type AdminCspInput = {
  appEnv: string | undefined;
  nodeEnv: string;
  supabaseUrl: string | undefined;
};

function localConnectOrigins(supabaseUrl: string | undefined) {
  let origins =
    "http://127.0.0.1:58421 http://localhost:58421 ws://127.0.0.1:58421 ws://localhost:58421";
  try {
    if (supabaseUrl?.startsWith("http://")) {
      const parsed = new URL(supabaseUrl);
      const origin = `${parsed.protocol}//${parsed.host}`;
      const wsOrigin = origin.replace(/^http/, "ws");
      origins = `${origin} ${origin.replace("127.0.0.1", "localhost")} ${wsOrigin} ${wsOrigin.replace("127.0.0.1", "localhost")}`;
    }
  } catch {
    // config.toml 기본 Auth 포트 유지
  }
  return origins;
}

/** 관리자 CSP. Channel Talk 출처를 넣지 않는다. */
export function buildAdminContentSecurityPolicy(input: AdminCspInput) {
  const supabaseUrl = input.supabaseUrl ?? "";
  const isLocalRuntime =
    input.appEnv === "test" ||
    input.nodeEnv === "development" ||
    supabaseUrl.startsWith("http://127.0.0.1") ||
    supabaseUrl.startsWith("http://localhost");
  const scriptSource =
    input.nodeEnv === "development"
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
  const connectSrc = isLocalRuntime
    ? `connect-src 'self' ${localConnectOrigins(input.supabaseUrl)} https://*.supabase.co wss://*.supabase.co`
    : "connect-src 'self' https://*.supabase.co wss://*.supabase.co";

  return [
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
  ].join("; ");
}
