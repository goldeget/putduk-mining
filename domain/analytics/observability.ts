import {
  ANALYTICS_PROPERTY_NAMES,
  analyticsPropertyFitsEvent,
  analyticsPropertyValueAllowed,
  isSensitiveAnalyticsString,
  type AnalyticsEventName,
  type AnalyticsPropertyName,
} from "@/domain/analytics/events";

const propertyNames = new Set<string>(ANALYTICS_PROPERTY_NAMES);

const digestPattern = /^[A-Za-z0-9_-]{1,64}$/;
const errorNamePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** DOM·입력·네트워크 본문은 재생하지 않는다. 경로만 남긴다. */
export const SESSION_REPLAY_MODE = "structural_path_only" as const;

const replayForbiddenKey =
  /html|inner_text|input|password|secret|token|email|phone|balance|amount|address|destination|cookie|authorization|legal_name|birth/i;

export function browserAnalyticsEnabled(input: {
  nodeEnv: string | undefined;
  hostname: string | undefined;
  webdriver: boolean;
}): boolean {
  if (input.nodeEnv !== "production") return false;
  if (input.webdriver) return false;
  const host = (input.hostname ?? "").toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  ) {
    return false;
  }
  return true;
}

export function serverAnalyticsEnabled(appEnv: string | undefined): boolean {
  return appEnv === "production";
}

export function readAppRelease(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !analyticsPropertyValueAllowed("app_release", trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function sanitizeAnalyticsPath(value: string): string | undefined {
  const path = value.split("?")[0]?.split("#")[0] ?? "";
  if (!analyticsPropertyValueAllowed("path", path)) return undefined;
  return path;
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, boolean | null | number | string>,
  appRelease: string | undefined,
  eventName: AnalyticsEventName,
): Partial<Record<AnalyticsPropertyName, boolean | null | number | string>> {
  const next: Partial<
    Record<AnalyticsPropertyName, boolean | null | number | string>
  > = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!propertyNames.has(key)) continue;
    if (!analyticsPropertyFitsEvent(eventName, key)) continue;
    const name = key as AnalyticsPropertyName;
    const candidate =
      name === "path" && typeof value === "string"
        ? sanitizeAnalyticsPath(value)
        : value;
    if (candidate === undefined) continue;
    if (!analyticsPropertyValueAllowed(name, candidate)) continue;
    next[name] = candidate;
  }
  if (typeof next.currency === "string") {
    delete next.character_count;
    delete next.vital_value;
  }
  const release = readAppRelease(appRelease);
  if (release && next.app_release === undefined) next.app_release = release;
  return next;
}

export function allowedAnalyticsOrigins(
  appUrl: string,
  adminUrl?: string,
): string[] {
  let appOrigin: string;
  try {
    appOrigin = new URL(appUrl).origin;
  } catch {
    return [];
  }
  const origins = [appOrigin];
  if (!adminUrl) return origins;
  try {
    const admin = new URL(adminUrl);
    if (admin.protocol !== "https:" && admin.protocol !== "http:")
      return origins;
    if (admin.username || admin.password) return origins;
    if (!origins.includes(admin.origin)) origins.push(admin.origin);
  } catch {
    // 잘못된 운영자 주소는 회원 앱 출처만 남긴다.
  }
  return origins;
}

export function toStructuralReplayStep(input: {
  sessionId: string;
  path: string;
  properties?: Record<string, unknown>;
}): { sessionId: string; path: string } | null {
  if (!/^[0-9a-f-]{36}$/i.test(input.sessionId)) return null;
  if (input.properties) {
    for (const key of Object.keys(input.properties)) {
      if (replayForbiddenKey.test(key)) return null;
    }
  }
  const path = sanitizeAnalyticsPath(input.path);
  if (!path) return null;
  return { sessionId: input.sessionId, path };
}

export function buildClientErrorProperties(error: unknown): {
  error_name: string;
  error_digest?: string;
} {
  const rawName = error instanceof Error ? error.name : "Error";
  const errorName = errorNamePattern.test(rawName) ? rawName : "Error";
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined;
  if (
    digest &&
    digestPattern.test(digest) &&
    !isSensitiveAnalyticsString(digest, "error_digest")
  ) {
    return { error_digest: digest, error_name: errorName };
  }
  return { error_name: errorName };
}

export type WebVitalName = "LCP" | "INP" | "CLS";
export type WebVitalRating = "good" | "needs_improvement" | "poor";

export function rateWebVital(
  name: WebVitalName,
  raw: number,
): WebVitalRating | null {
  if (!Number.isFinite(raw) || raw < 0) return null;
  if (name === "LCP") {
    if (raw <= 2500) return "good";
    if (raw <= 4000) return "needs_improvement";
    return "poor";
  }
  if (name === "INP") {
    if (raw <= 200) return "good";
    if (raw <= 500) return "needs_improvement";
    return "poor";
  }
  if (raw <= 0.1) return "good";
  if (raw <= 0.25) return "needs_improvement";
  return "poor";
}

export function buildWebVitalProperties(input: {
  name: WebVitalName;
  raw: number;
  navigationType?: string;
}): {
  vital_name: WebVitalName;
  vital_rating: WebVitalRating;
  vital_unit: "ms" | "milli";
  vital_value: number;
  navigation_type?: string;
} | null {
  const rating = rateWebVital(input.name, input.raw);
  if (!rating) return null;
  const vitalValue =
    input.name === "CLS" ? Math.round(input.raw * 1000) : Math.round(input.raw);
  if (vitalValue > 1_000_000) return null;
  const properties: {
    vital_name: WebVitalName;
    vital_rating: WebVitalRating;
    vital_unit: "ms" | "milli";
    vital_value: number;
    navigation_type?: string;
  } = {
    vital_name: input.name,
    vital_rating: rating,
    vital_unit: input.name === "CLS" ? "milli" : "ms",
    vital_value: vitalValue,
  };
  if (input.navigationType && /^[a-z_]{1,32}$/.test(input.navigationType)) {
    properties.navigation_type = input.navigationType;
  }
  return properties;
}
