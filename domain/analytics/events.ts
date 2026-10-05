import { z } from "zod";

export const ANALYTICS_EVENT_NAMES = [
  "screen_view",
  "signup_complete",
  "trial_start",
  "trial_first_reward",
  "trial_progress",
  "trial_complete",
  "trial_conversion_start",
  "trial_conversion_complete",
  "trial_conversion_blocked",
  "mining_world_view",
  "mining_start",
  "mining_stop",
  "mining_settlement_view",
  "deposit_start",
  "deposit_complete",
  "withdrawal_start",
  "withdrawal_complete",
  "welcome_withdrawal_start",
  "welcome_withdrawal_requested",
  "referral_invite_shared",
  "referral_stage_qualified",
  "referral_reward_paid",
  "funding_promotion_view",
  "funding_promotion_qualified",
  "funding_promotion_reward_paid",
  "event_view",
  "event_join",
  "notice_view",
  "rank_up_view",
  "ai_open",
  "ai_question",
  "push_open",
  "notification_delivered",
  "notification_dismissed",
  "landing_view",
  "trial_50_percent",
  "welcome_reward_qualified",
  "welcome_reward_auto_hold",
  "welcome_reward_converted",
  "welcome_withdrawal_complete",
  "withdrawal_complete_no_funding",
  "first_funding",
  "first_real_mining",
  "real_mining_start",
  "first_real_settlement",
  "return_visit",
  "active_7d",
  "active_30d",
  "long_term_active",
  "web_vital",
  "client_error",
] as const;

/** 문서에 적힌 속성만 받는다. 금액·계정·비밀 키는 여기 없다. */
export const ANALYTICS_PROPERTY_NAMES = [
  "app_release",
  "character_count",
  "continuity_mode",
  "currency",
  "error_digest",
  "error_name",
  "knowledge_version",
  "navigation_type",
  "path",
  "provider_configured",
  "returning",
  "vital_name",
  "vital_rating",
  "vital_unit",
  "vital_value",
] as const;

export type AnalyticsPropertyName = (typeof ANALYTICS_PROPERTY_NAMES)[number];

const analyticsPropertyNames = new Set<string>(ANALYTICS_PROPERTY_NAMES);

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

/** 화면 경로만 허용한다. 질의문자열과 퍼센트 인코딩은 넣지 않는다. */
export const ANALYTICS_PATH_PATTERN = /^\/[A-Za-z0-9._~/-]{0,180}$/;

/** 질문 길이 상한. 원장 금액이 아니다. */
const CHARACTER_COUNT_MAX = 2_000;
/** 웹 바이탈 상한. 원장 금액이 아니다. */
const VITAL_VALUE_MAX = 1_000_000;

const WEB_VITAL_KEYS = new Set([
  "navigation_type",
  "vital_name",
  "vital_rating",
  "vital_unit",
  "vital_value",
]);
const CLIENT_ERROR_KEYS = new Set(["error_digest", "error_name"]);

const ANALYTICS_STRING_SHAPES: Partial<Record<AnalyticsPropertyName, RegExp>> =
  {
    app_release: /^[A-Za-z0-9._-]{7,64}$/,
    continuity_mode: /^[A-Z][A-Z0-9_]{0,63}$/,
    currency: /^[A-Z]{3}$/,
    error_digest: /^[A-Za-z0-9_-]{1,64}$/,
    error_name: /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
    knowledge_version: /^[A-Za-z0-9._-]{1,64}$/,
    navigation_type: /^[a-z_]{1,32}$/,
    path: ANALYTICS_PATH_PATTERN,
    vital_name: /^(?:LCP|INP|CLS)$/,
    vital_rating: /^(?:good|needs_improvement|poor)$/,
    vital_unit: /^(?:ms|milli)$/,
  };

/**
 * 이메일, 전화, 주소, 토큰, 질의문자열은 거절한다.
 * 지식 버전과 릴리스 토큰의 숫자 묶음은 계정번호로 보지 않는다.
 */
export function isSensitiveAnalyticsString(value: string, key = ""): boolean {
  if (
    value.includes("@") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("=") ||
    value.includes("&")
  ) {
    return true;
  }
  if (/%[0-9a-f]{2}/i.test(value)) return true;
  if (
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(value)
  ) {
    return true;
  }
  if (/0x[a-fA-F0-9]{8,}/.test(value)) return true;
  if (/T[1-9A-HJ-NP-Za-km-z]{33}/.test(value)) return true;
  if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)) {
    return true;
  }
  if (/bearer\s+/i.test(value)) return true;
  if (/sk_|sb_secret|service_role|BEGIN [A-Z ]+KEY/i.test(value)) return true;
  if (/(?:\+|00)[1-9][\d\s().-]{7,16}\d/.test(value)) return true;
  if (/01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}/.test(value)) return true;
  if (/0\d{1,2}[\s.-]\d{3,4}[\s.-]\d{4}/.test(value)) return true;
  if (key === "path") {
    for (const segment of value.split("/")) {
      if (/^[A-Za-z0-9_]{20,}$/.test(segment)) return true;
    }
  }
  if (
    key !== "knowledge_version" &&
    key !== "app_release" &&
    /\d{10,}/.test(value)
  ) {
    return true;
  }
  return false;
}

/** 금액·계정 값은 허용 키의 모양에 맞지 않으면 버린다. */
export function analyticsPropertyValueAllowed(
  key: string,
  value: boolean | null | number | string,
): boolean {
  if (!analyticsPropertyNames.has(key)) return false;
  if (value === null) return true;
  if (typeof value === "boolean") {
    return key === "provider_configured" || key === "returning";
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) return false;
    if (key === "character_count") return value <= CHARACTER_COUNT_MAX;
    if (key === "vital_value") return value <= VITAL_VALUE_MAX;
    return false;
  }
  const shape = ANALYTICS_STRING_SHAPES[key as AnalyticsPropertyName];
  if (!shape || !shape.test(value)) return false;
  return !isSensitiveAnalyticsString(value, key);
}

/** 지표 숫자는 그 이벤트에만 둔다. 금액 이벤트에는 숫자를 싣지 않는다. */
export function analyticsPropertyFitsEvent(
  eventName: string,
  key: string,
): boolean {
  if (WEB_VITAL_KEYS.has(key)) return eventName === "web_vital";
  if (CLIENT_ERROR_KEYS.has(key)) return eventName === "client_error";
  if (key === "character_count") return eventName === "ai_question";
  return true;
}

const propertyValueSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const propertiesSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), propertyValueSchema)
  .superRefine((value, context) => {
    const keys = Object.keys(value);
    if (keys.length > 20) {
      context.addIssue({
        code: "custom",
        message: "Analytics properties are limited to 20 keys.",
      });
    }
    const hasNumber = Object.values(value).some(
      (property) => typeof property === "number",
    );
    if (hasNumber && Object.hasOwn(value, "currency")) {
      context.addIssue({
        code: "custom",
        message: "Analytics property value is not allowed.",
      });
    }
    for (const key of keys) {
      if (!analyticsPropertyNames.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Analytics property name is not allowlisted.",
        });
      }
    }
    for (const [key, property] of Object.entries(value)) {
      if (!analyticsPropertyValueAllowed(key, property)) {
        context.addIssue({
          code: "custom",
          message: "Analytics property value is not allowed.",
        });
      }
    }
  });

export const analyticsEventSchema = z
  .object({
    eventId: z.uuid(),
    eventName: z.enum(ANALYTICS_EVENT_NAMES),
    occurredAt: z.iso.datetime(),
    properties: propertiesSchema,
    sessionId: z.uuid(),
  })
  .superRefine((event, context) => {
    for (const key of Object.keys(event.properties)) {
      if (!analyticsPropertyFitsEvent(event.eventName, key)) {
        context.addIssue({
          code: "custom",
          message: "Analytics property value is not allowed.",
          path: ["properties", key],
        });
      }
    }
  });

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
