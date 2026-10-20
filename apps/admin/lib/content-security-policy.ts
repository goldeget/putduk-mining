type AdminCspInput = {
  appEnv: string | undefined;
  nodeEnv: string;
  supabaseUrl: string | undefined;
};

// Cloudflare가 현재 주입하는 beacon의 정확한 경로만 허용한다.
const cloudflareBeaconScriptSource =
  "https://static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d87301792088814092";

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
      ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${cloudflareBeaconScriptSource}`
      : `script-src 'self' 'unsafe-inline' ${cloudflareBeaconScriptSource}`;
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
