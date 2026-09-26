import { z } from "zod";

export const ANALYTICS_EVENT_NAMES = [
  "screen_view",
  "signup_complete",
  "trial_start",
  "trial_first_reward",
  "trial_progress",
  "trial_complete",
  "mining_world_view",
  "mining_start",
  "mining_stop",
  "mining_settlement_view",
  "deposit_start",
  "deposit_complete",
  "withdrawal_start",
  "withdrawal_complete",
  "event_view",
  "event_join",
  "notice_view",
  "rank_up_view",
  "ai_open",
  "ai_question",
  "push_open",
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
