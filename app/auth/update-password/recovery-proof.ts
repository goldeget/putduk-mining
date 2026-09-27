import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { getServerEnv } from "@/lib/env/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const RECOVERY_PROOF_COOKIE = "putduk-recovery-proof";
export const RECOVERY_PROOF_MAX_AGE_SECONDS = 10 * 60;

type RecoveryProofPayload = {
  exp: number;
  iat: number;
  sessionId: string;
  userId: string;
  version: 1;
};

function signPayload(encodedPayload: string) {
  return createHmac("sha256", getServerEnv().SUPABASE_SECRET_KEY)
    .update(`putduk-recovery-v1.${encodedPayload}`)
    .digest("base64url");
}

export function createRecoveryProof({
  sessionId,
  userId,
}: {
  sessionId: string;
  userId: string;
}) {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const payload: RecoveryProofPayload = {
    exp: issuedAt + RECOVERY_PROOF_MAX_AGE_SECONDS,
    iat: issuedAt,
    sessionId,
    userId,
    version: 1,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function parsePayload(value: string): RecoveryProofPayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<RecoveryProofPayload>;
    if (
      parsed.version !== 1 ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.userId !== "string"
    ) {
      return null;
    }
    return parsed as RecoveryProofPayload;
  } catch {
    return null;
  }
}

export function verifyRecoveryProof({
  proof,
  sessionId,
  userId,
}: {
  proof: string;
  sessionId: string;
  userId: string;
}) {
  const [encodedPayload, suppliedSignature, ...extra] = proof.split(".");
  if (!encodedPayload || !suppliedSignature || extra.length > 0) return false;

  const expectedSignature = signPayload(encodedPayload);
  const expected = Buffer.from(expectedSignature);
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length) return false;
  if (!timingSafeEqual(expected, supplied)) return false;

  const payload = parsePayload(encodedPayload);
  if (!payload) return false;

  const now = Math.floor(Date.now() / 1_000);
  return (
    payload.userId === userId &&
    payload.sessionId === sessionId &&
    payload.iat <= now + 30 &&
    payload.exp > now &&
    payload.exp - payload.iat === RECOVERY_PROOF_MAX_AGE_SECONDS
  );
}

export async function getVerifiedRecoveryAuthorization() {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as Record<string, unknown> | undefined;
    const userId = claims?.sub;
    const sessionId = claims?.session_id;
    const proof = (await cookies()).get(RECOVERY_PROOF_COOKIE)?.value;

    if (
      error ||
      typeof userId !== "string" ||
      typeof sessionId !== "string" ||
      !proof ||
      !verifyRecoveryProof({ proof, sessionId, userId })
    ) {
      return null;
    }

    return { sessionId, supabase, userId };
  } catch {
    return null;
  }
}
