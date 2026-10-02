import "server-only";

import { createHash } from "node:crypto";

import { normalizeSignupPhone } from "../../domain/identity/signup-phone";

/**
 * 버킷 키를 해시한다. 이 모듈은 횟수를 저장하지 않는다.
 * 운영자 비밀번호·인증코드 실패 횟수는 public.security_events 에 남긴다.
 */
export function hashRateLimitBucket(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function adminAuthFailureBucket(
  scope: "PASSWORD" | "TOTP",
  subject: string,
): string {
  return hashRateLimitBucket(`admin-auth-failure:${scope}:${subject}`);
}

export function adminAuthSessionProof(sessionId: string): string {
  return hashRateLimitBucket(`admin-auth-session:${sessionId}`);
}

export function phoneAvailabilityBucket(raw: string): string | null {
  const normalized = normalizeSignupPhone(raw);
  return normalized ? hashRateLimitBucket(normalized) : null;
}
