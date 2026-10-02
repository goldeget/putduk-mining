import { randomUUID } from "node:crypto";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { encryptSensitiveData } from "@/lib/security/encrypt-sensitive-data";
import {
  getWithdrawalReauthIdentity,
  isWithdrawalReauthOriginAllowed,
  validateWithdrawalDestinationProof,
  WITHDRAWAL_REAUTH_HEADER,
} from "@/lib/security/withdrawal-destination-reauth.server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  withdrawalDestinationIdentity,
  withdrawalDestinationSchema,
} from "@/lib/wallet/withdrawal-destination.server";
import { withdrawalLogicalApiError } from "@/lib/wallet/withdrawal-logical-errors.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isWithdrawalReauthOriginAllowed(request))
    return apiError({
      code: "ORIGIN_DENIED",
      message: "요청을 다시 확인해 주세요.",
      status: 403,
    });
  const identity = await getVerifiedIdentity();
  if (!identity)
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  const key = readIdempotencyKey(request);
  if (request.headers.has("Idempotency-Key") && !key) {
    return apiError({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "요청 식별자를 확인해 주세요.",
      status: 400,
    });
  }
  const parsed = withdrawalDestinationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return apiError({
      code: "INVALID_DESTINATION",
      message: "출금 목적지 정보를 확인해 주세요.",
      status: 400,
    });
  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch {
    env = {} as ReturnType<typeof getServerEnv>;
  }
  if (!env.WITHDRAWAL_DATA_KEY) {
    return apiError({
      code: "WITHDRAWAL_SECURITY_NOT_CONFIGURED",
      message: "출금 목적지를 등록하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: 503,
    });
  }
  const destination = parsed.data;
  const { sensitive, fingerprint, displayHint } =
    withdrawalDestinationIdentity(destination);
  const admin = createSupabaseAdminClient();
  const proof = request.headers.get(WITHDRAWAL_REAUTH_HEADER) ?? "";
  if (proof) {
    // A committed binding replay is not another sensitive change. The binder
    // still verifies owner/method/fingerprint before returning its original ID.
    const { data: prior, error: priorError } = key
      ? await admin.rpc("resolve_withdrawal_logical_request", {
          p_user_id: identity.userId,
          p_action: "RECOVER",
          p_idempotency_key: key,
        })
      : { data: null, error: null };
    if (priorError) return withdrawalLogicalApiError(priorError);
    if (!prior?.destinationId) {
      const verified = await getWithdrawalReauthIdentity();
      if (
        !verified ||
        verified.userId !== identity.userId ||
        !(await validateWithdrawalDestinationProof({
          userId: identity.userId,
          sessionId: verified.sessionId,
          method: destination.method,
          fingerprint,
          token: proof,
        }))
      )
        return apiError({
          code: "WITHDRAWAL_REAUTH_REQUIRED",
          message: "비밀번호를 다시 확인해 주세요.",
          status: 403,
        });
    }
  }
  const envelope = encryptSensitiveData({
    additionalData: `${identity.userId}:${destination.method}`,
    keyBase64: env.WITHDRAWAL_DATA_KEY,
    value: sensitive,
  });
  const common = {
    p_user_id: identity.userId,
    p_encrypted_value: `\\x${Buffer.from(JSON.stringify(envelope), "utf8").toString("hex")}`,
    p_value_fingerprint: fingerprint,
    p_display_hint: displayHint,
    p_step_up_token: proof,
    p_request_id: randomUUID(),
  };

  if (key) {
    const { data, error } = await admin.rpc(
      "bind_withdrawal_logical_destination",
      {
        ...common,
        p_idempotency_key: key,
        p_method: destination.method,
        p_network:
          destination.method === "USDT_ADDRESS" ? destination.network : null,
        p_address:
          destination.method === "USDT_ADDRESS" ? destination.address : null,
      },
    );
    if (error) return destinationError(error);
    const protectionActive = await readProtectionActive(
      admin,
      identity.userId,
      data.destinationId,
    );
    if (protectionActive === null) return destinationError(null);
    return apiSuccess(
      {
        destinationId: data.destinationId,
        destinationIdentity: data.destinationIdentity,
        method: destination.method,
        record: data,
        protectionActive,
      },
      201,
    );
  }

  // Welcome / explicit destination management retains the frozen command contract.
  const { data, error } =
    destination.method === "KRW_BANK"
      ? await admin.rpc("register_krw_bank_destination", {
          ...common,
          p_protection_hours: 24,
        })
      : await admin.rpc("register_usdt_withdrawal_destination", {
          ...common,
          p_network: destination.network,
          p_address: destination.address,
          p_protection_hours: 24,
        });
  if (error) return destinationError(error);
  const protectionActive = await readProtectionActive(
    admin,
    identity.userId,
    data,
  );
  if (protectionActive === null) return destinationError(null);
  return apiSuccess(
    {
      destinationId: data,
      destinationIdentity: fingerprint,
      method: destination.method,
      protectionActive,
    },
    201,
  );
}

function destinationError(error: { message: string } | null) {
  if (error?.message === "WITHDRAWAL_REAUTH_REQUIRED")
    return apiError({
      code: "WITHDRAWAL_REAUTH_REQUIRED",
      message: "비밀번호를 다시 확인해 주세요.",
      status: 403,
    });
  if (error) return withdrawalLogicalApiError(error);
  return apiError({
    code: "DESTINATION_REGISTER_FAILED",
    message: "출금 목적지를 등록하지 못했어요. 잠시 후 다시 시도해 주세요.",
    status: 503,
  });
}

async function readProtectionActive(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  ownerId: string,
  id: string,
) {
  const { data, error } = await admin
    .from("withdrawal_destinations")
    .select("protection_until")
    .eq("id", id)
    .eq("user_id", ownerId)
    .single();
  return error || !data || !Number.isFinite(Date.parse(data.protection_until))
    ? null
    : Date.parse(data.protection_until) > Date.now();
}
