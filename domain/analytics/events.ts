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
    for (const key of keys) {
      if (!analyticsPropertyNames.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Analytics property name is not allowlisted.",
        });
      }
    }
    for (const [key, property] of Object.entries(value)) {
      if (
        typeof property === "string" &&
        isSensitiveAnalyticsString(property, key)
      ) {
        context.addIssue({
          code: "custom",
          message: "Analytics property value is not allowed.",
        });
      }
    }
  });

/**
 * 이메일, 전화, 주소, 토큰, 질의문자열은 거절한다.
 * 지식 버전과 릴리스 토큰의 숫자 묶음은 계정번호로 보지 않는다.
 */
export function isSensitiveAnalyticsString(value: string, key = ""): boolean {
  if (value.includes("@") || value.includes("?") || value.includes("#")) {
    return true;
  }
  if (
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(value)
  ) {
    return true;
  }
  if (/0x[a-fA-F0-9]{8,}/.test(value)) return true;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return true;
  }
  if (/bearer\s+/i.test(value)) return true;
  if (/sk_|sb_secret|service_role|BEGIN [A-Z ]+KEY/i.test(value)) return true;
  if (/^\+[1-9]\d{7,14}$/.test(value)) return true;
  if (/01[016789]-?\d{3,4}-?\d{4}/.test(value)) return true;
  if (
    key !== "knowledge_version" &&
    key !== "app_release" &&
    /\d{10,}/.test(value)
  ) {
    return true;
  }
  return false;
}

export const analyticsEventSchema = z.object({
  eventId: z.uuid(),
  eventName: z.enum(ANALYTICS_EVENT_NAMES),
  occurredAt: z.iso.datetime(),
  properties: propertiesSchema,
  sessionId: z.uuid(),
});

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
