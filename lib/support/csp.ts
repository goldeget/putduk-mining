/**
 * 공개 앱 CSP에 넣는 Channel Talk 출처.
 *
 * 2026-09-28 한국어 공식 페이지와 레퍼런스에 적힌 connect/script/img만 넣는다.
 * https://developers.channel.io/ko/articles/Content-Security-Policy-0c068399
 * https://developers.channel.io/reference/content-security-policy-kr
 *
 * 같은 날 영어 페이지에는 wss://*.desk-ws.channel.io가 없다.
 * 한국어 공식 목록에는 있으므로 connect-src에 유지한다.
 *
 * font-src와 frame-src에는 channel 호스트를 넣지 않는다.
 * 공식 CSP 페이지에 그 directive가 없고, loader 2.0.2가 받는
 * ch-plugin-web.js와 ch-plugin-core-20260917193237.js에도
 * 교차 출처 iframe 이동이나 웹폰트 파일이 없다.
 * 메신저 iframe은 src 없는 같은 출처 문서다.
 *
 * media-src의 https://*.channel.io는 공식 directive 이름이 아니다.
 * SDK가 Audio.src를 https://cdn.channel.io/plugin/files/*.mp3로 넣으므로
 * media-src를 직접 지정한 공개 앱에서는 이 호스트가 필요하다.
 */

export const channelTalkConnectSources = [
  "https://*.channel.io",
  "https://*.channel.app",
  "https://*.sentry.io",
  "wss://*.channel.io",
  "wss://*.desk-ws.channel.io",
  "wss://*.front-ws.channel.io",
] as const;

export const channelTalkImageSources = [
  "https://*.channel.io",
  "https://*.cdninstagram.com",
] as const;

export const channelTalkMediaSources = ["https://*.channel.io"] as const;

export const channelTalkScriptSources = [
  "https://*.channel.io",
  "https://*.sentry-cdn.com",
] as const;

const allowedWildcardHosts = new Set([
  "cdninstagram.com",
  "channel.app",
  "channel.io",
  "desk-ws.channel.io",
  "front-ws.channel.io",
  "sentry-cdn.com",
  "sentry.io",
  "supabase.co",
]);

export function parseContentSecurityPolicy(
  policy: string,
): ReadonlyMap<string, readonly string[]> {
  const directives = new Map<string, readonly string[]>();
  for (const part of policy.split(";")) {
    const tokens = part
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    const name = tokens[0];
    if (!name) continue;
    directives.set(name, tokens.slice(1));
  }
  return directives;
}

/** `*` 단독, 스킴 전체, 허용 목록 밖의 호스트 와일드카드를 찾는다. */
export function findUnsupportedCspWildcard(
  sources: readonly string[],
): string | null {
  for (const source of sources) {
    if (!source.includes("*")) continue;
    const match = /^(?:https|wss):\/\/\*\.([a-z0-9.-]+)$/.exec(source);
    if (!match) return source;
    const host = match[1];
    if (!host || !allowedWildcardHosts.has(host)) return source;
  }
  return null;
}

type PublicCspInput = {
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

export function buildPublicContentSecurityPolicy(input: PublicCspInput) {
  const supabaseUrl = input.supabaseUrl ?? "";
  const isLocalRuntime =
    input.appEnv === "test" ||
    input.nodeEnv === "development" ||
    supabaseUrl.startsWith("http://127.0.0.1") ||
    supabaseUrl.startsWith("http://localhost");

  const connectSrc = isLocalRuntime
    ? `connect-src 'self' ${localConnectOrigins(input.supabaseUrl)} https://*.supabase.co wss://*.supabase.co ${channelTalkConnectSources.join(" ")}`
    : `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${channelTalkConnectSources.join(" ")}`;

  const scriptSource =
    input.nodeEnv === "development"
      ? `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${channelTalkScriptSources.join(" ")}`
      : `script-src 'self' 'unsafe-inline' ${channelTalkScriptSources.join(" ")}`;

  return [
    "default-src 'self'",
    "base-uri 'self'",
    connectSrc,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `img-src 'self' data: blob: https://*.supabase.co ${channelTalkImageSources.join(" ")}`,
    `media-src 'self' ${channelTalkMediaSources.join(" ")}`,
    "manifest-src 'self'",
    "object-src 'none'",
    scriptSource,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
    ...(isLocalRuntime ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
