import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { getVerifiedIdentity } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env/public";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseServerFetch } from "@/lib/supabase/server-fetch";
import {
  withdrawalDestinationIdentity,
  withdrawalDestinationSchema,
} from "@/lib/wallet/withdrawal-destination.server";

export const WITHDRAWAL_REAUTH_HEADER = "Withdrawal-Reauth";
export const withdrawalReauthSchema = z
  .object({
    destination: withdrawalDestinationSchema,
    password: z.string().min(1).max(1024),
    totpCode: z
      .string()
      .regex(/^[0-9]{6}$/)
      .optional(),
  })
  .strict();

const uuid = z.uuid();
export function hashWithdrawalReauthToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWithdrawalReauthOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).origin;
  // Browser requests must have the configured origin. Same-origin non-browser
  // callers without Origin are allowed only with a non-simple JSON request.
  return (
    (origin === expected || origin === null) &&
    request.headers.get("content-type")?.split(";")[0]?.trim() ===
      "application/json" &&
    !["cross-site", "same-site"].includes(
      request.headers.get("sec-fetch-site") ?? "",
    )
  );
}

export async function getWithdrawalReauthIdentity() {
  const identity = await getVerifiedIdentity();
  if (!identity) return null;
  const [
    { data: user, error: userError },
    { data: claims, error: claimsError },
  ] = await Promise.all([
    identity.supabase.auth.getUser(),
    identity.supabase.auth.getClaims(),
  ]);
  const sessionId = claims?.claims?.session_id;
  if (
    userError ||
    claimsError ||
    user.user?.id !== identity.userId ||
    claims?.claims?.sub !== identity.userId ||
    !uuid.safeParse(sessionId).success
  )
    return null;
  return { ...identity, sessionId: sessionId as string, user: user.user };
}

type ReauthResult =
  | { ok: true; token: string; expiresAt: string }
  | {
      ok: false;
      code:
        | "WITHDRAWAL_REAUTH_FAILED"
        | "WITHDRAWAL_REAUTH_MFA_REQUIRED"
        | "WITHDRAWAL_REAUTH_RATE_LIMITED"
        | "WITHDRAWAL_REAUTH_UNAVAILABLE";
    };

/** Actual Auth verification; never replaces the caller's SSR/browser session. */
export async function verifyWithdrawalPassword(input: {
  auth: SupabaseClient;
  userId: string;
  email: string;
  password: string;
  totpCode?: string | undefined;
}): Promise<"VERIFIED" | "DENIED" | "MFA_REQUIRED"> {
  let result: "VERIFIED" | "DENIED" | "MFA_REQUIRED" = "DENIED";
  try {
    result = await (async () => {
      const { data, error } = await input.auth.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });
      if (error || data.user?.id !== input.userId || !data.session)
        return "DENIED";
      const { data: factors, error: factorError } =
        await input.auth.auth.mfa.listFactors();
      if (factorError) return "DENIED";
      const verified = factors.all.filter(
        (factor) => factor.status === "verified",
      );
      if (verified.length > 0) {
        const totp = verified.find((factor) => factor.factor_type === "totp");
        if (!totp || !input.totpCode) return "MFA_REQUIRED";
        const { error: mfaError } =
          await input.auth.auth.mfa.challengeAndVerify({
            factorId: totp.id,
            code: input.totpCode,
          });
        if (mfaError) return "DENIED";
        const { data: assurance, error: assuranceError } =
          await input.auth.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assuranceError || assurance.currentLevel !== "aal2")
          return "DENIED";
      }
      return "VERIFIED";
    })();
  } catch {
    result = "DENIED";
  }
  // local means ONLY the transient password-verification session. Cleanup must
  // also succeed before authorizing the change, including every denied path.
  try {
    const { error } = await input.auth.auth.signOut({ scope: "local" });
    if (error) return "DENIED";
  } catch {
    return "DENIED";
  }
  return result;
}

export async function issueWithdrawalDestinationProof(
  identity: NonNullable<
    Awaited<ReturnType<typeof getWithdrawalReauthIdentity>>
  >,
  input: z.infer<typeof withdrawalReauthSchema>,
): Promise<ReauthResult> {
  const service = createSupabaseAdminClient();
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const { fingerprint } = withdrawalDestinationIdentity(input.destination);
  const { data: attempt, error: admissionError } = await service
    .from("withdrawal_destination_step_ups")
    .insert({
      id,
      user_id: identity.userId,
      auth_session_id: identity.sessionId,
      token_hash: hashWithdrawalReauthToken(token),
      method: input.destination.method,
      destination_fingerprint: fingerprint,
    })
    .select("id,expires_at")
    .single();
  if (admissionError || !attempt)
    return {
      ok: false,
      code:
        admissionError?.message === "WITHDRAWAL_REAUTH_RATE_LIMITED"
          ? "WITHDRAWAL_REAUTH_RATE_LIMITED"
          : "WITHDRAWAL_REAUTH_UNAVAILABLE",
    };
  const env = getPublicEnv();
  const auth = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: supabaseServerFetch },
    },
  );
  const verdict = identity.user.email
    ? await verifyWithdrawalPassword({
        auth,
        userId: identity.userId,
        email: identity.user.email,
        password: input.password,
        totpCode: input.totpCode,
      })
    : "DENIED";
  const { data: updated, error: updateError } = await service
    .from("withdrawal_destination_step_ups")
    .update({ status: verdict === "VERIFIED" ? "VERIFIED" : "DENIED" })
    .eq("id", id)
    .eq("user_id", identity.userId)
    .eq("auth_session_id", identity.sessionId)
    .eq("status", "PENDING")
    .select("id")
    .maybeSingle();
  if (updateError || !updated)
    return { ok: false, code: "WITHDRAWAL_REAUTH_UNAVAILABLE" };
  if (verdict !== "VERIFIED")
    return {
      ok: false,
      code:
        verdict === "MFA_REQUIRED"
          ? "WITHDRAWAL_REAUTH_MFA_REQUIRED"
          : "WITHDRAWAL_REAUTH_FAILED",
    };
  return { ok: true, token, expiresAt: attempt.expires_at as string };
}

export async function validateWithdrawalDestinationProof(input: {
  userId: string;
  sessionId: string;
  method: string;
  fingerprint: string;
  token: string;
}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) return false;
  const { data, error } = await createSupabaseAdminClient()
    .from("withdrawal_destination_step_ups")
    .select("id,expires_at")
    .eq("token_hash", hashWithdrawalReauthToken(input.token))
    .eq("user_id", input.userId)
    .eq("auth_session_id", input.sessionId)
    .eq("method", input.method)
    .eq("destination_fingerprint", input.fingerprint)
    .eq("status", "VERIFIED")
    .maybeSingle();
  return (
    !error && Boolean(data?.id) && Date.parse(data!.expires_at) > Date.now()
  );
}
