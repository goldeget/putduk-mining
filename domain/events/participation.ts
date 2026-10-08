import { z } from "zod";
import { safeNotificationDeepLink } from "@/domain/notifications/safe-deep-link";

export const eventParticipationInputSchema = z.strictObject({
  eventId: z.uuid(),
  revisionId: z.uuid(),
  idempotencyKey: z.uuid(),
});
const date = z.iso.datetime({ offset: true });
export const memberEventAwardSchema = z.strictObject({
  id: z.uuid(),
  event_id: z.uuid(),
  reward_kind: z.enum(["BADGE", "PROFILE_TITLE"]),
  title_ko: z.string().trim().min(1).max(80),
  created_at: date,
});
export const eventParticipationReceiptSchema = z.strictObject({
  eventId: z.uuid(),
  revisionId: z.uuid(),
  participantId: z.uuid(),
  status: z.enum(["JOINED", "COMPLETED", "REWARDED", "DISQUALIFIED"]),
  joinedAt: date,
  completedAt: date.nullable(),
  rewardedAt: date.nullable(),
  outboxId: z.uuid(),
  replayed: z.boolean(),
});
export const memberEventContentSchema = z.object({
  event_id: z.uuid(),
  revision_id: z.uuid(),
  body_ko: z.string().min(1).max(20000),
  participation_ko: z.string().min(1).max(2000),
  exclusion_ko: z.string().min(1).max(2000),
  cta_label: z.string().min(1).max(80),
  cta_route: z
    .string()
    .refine((value) => safeNotificationDeepLink(value) !== null),
  reward_mode: z.literal("NONE"),
});
export function hasEventCommandOrigin(
  request: Request,
  configuredAppUrl: string = request.url,
) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  try {
    // Server callers provide the configured public URL. A reverse proxy's
    // reconstructed request host and client-supplied forwarding headers do not
    // establish a trusted browser origin.
    return request.headers.get("origin") === new URL(configuredAppUrl).origin;
  } catch {
    return false;
  }
}

export function canJoinMemberEvent(
  status: string,
  startsAt: string,
  endsAt: string,
  now: string,
) {
  const start = Date.parse(startsAt),
    end = Date.parse(endsAt),
    current = Date.parse(now);
  return (
    [start, end, current].every(Number.isFinite) &&
    end > start &&
    ["SCHEDULED", "LIVE"].includes(status) &&
    current >= start &&
    current < end
  );
}
