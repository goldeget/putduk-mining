import "server-only";

import { randomUUID } from "node:crypto";

import { recordAdminSecurityEvent } from "@/lib/security/events";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 30;

type Bucket = { count: number; windowStartedAt: number };

const memoryBuckets = new Map<string, Bucket>();

/**
 * 프로세스 로컬 보조 한도. 권위 있는 한도는 SQL `ADMIN_AUTH` rate limit이며
 * `register_admin_session` 호출 시 적용됩니다. user_metadata는 사용하지 않습니다.
 */
export function enforceAdminAuthRateLimit(bucketKey: string):
  | {
      ok: true;
    }
  | {
      ok: false;
      code: "RATE_LIMITED";
    } {
  const now = Date.now();
  const current = memoryBuckets.get(bucketKey);
  if (!current || now - current.windowStartedAt > WINDOW_MS) {
    memoryBuckets.set(bucketKey, { count: 1, windowStartedAt: now });
    return { ok: true };
  }
  if (current.count >= MAX_ATTEMPTS) {
    return { ok: false, code: "RATE_LIMITED" };
  }
  current.count += 1;
  return { ok: true };
}

export async function recordAdminAuthRateLimitEvent(
  userId: string | null,
  limited: boolean,
): Promise<void> {
  await recordAdminSecurityEvent({
    eventType: limited ? "ADMIN_AUTH_RATE_LIMITED" : "ADMIN_AUTH_ATTEMPT",
    userId,
    userAgent: `rate-limit:${randomUUID()}`,
  });
}
