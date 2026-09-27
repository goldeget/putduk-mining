import "server-only";

import { createHash } from "node:crypto";

import { normalizeSignupPhone } from "@/domain/identity/signup-phone";

export function hashRateLimitBucket(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function phoneAvailabilityBucket(raw: string): string | null {
  const normalized = normalizeSignupPhone(raw);
  return normalized ? hashRateLimitBucket(normalized) : null;
}
