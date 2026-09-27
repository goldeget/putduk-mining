import "server-only";

import { createHash, randomBytes } from "node:crypto";

export const ADMIN_IDLE_SECONDS = 30 * 60;
export const ADMIN_ABSOLUTE_SECONDS = 8 * 60 * 60;
export const ADMIN_STEP_UP_TTL_SECONDS = 10 * 60;

export function hashAdminToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueOpaqueAdminToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function buildAdminSessionFingerprint(input: {
  authSessionId: string;
  userAgent: string | null;
}): string {
  return hashAdminToken(
    `${input.authSessionId}:${input.userAgent ?? ""}:putduk-admin`,
  );
}
