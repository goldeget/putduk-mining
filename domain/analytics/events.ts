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
] as const;

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
    if (Object.keys(value).length > 20) {
      context.addIssue({
        code: "custom",
        message: "Analytics properties are limited to 20 keys.",
      });
    }
  });

export const analyticsEventSchema = z.object({
  eventId: z.uuid(),
  eventName: z.enum(ANALYTICS_EVENT_NAMES),
  occurredAt: z.iso.datetime(),
  properties: propertiesSchema,
  sessionId: z.uuid(),
});

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
