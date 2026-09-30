import { randomUUID } from "node:crypto";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { encryptSensitiveData } from "@/lib/security/encrypt-sensitive-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  withdrawalDestinationIdentity,
  withdrawalDestinationSchema,
} from "@/lib/wallet/withdrawal-destination.server";
import { withdrawalLogicalApiError } from "@/lib/wallet/withdrawal-logical-errors.server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
    p_step_up_token: randomUUID(),
    p_request_id: randomUUID(),
  };
  const admin = createSupabaseAdminClient();

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
    if (error) return withdrawalLogicalApiError(error);
    return apiSuccess(
      {
        destinationId: data.destinationId,
        destinationIdentity: data.destinationIdentity,
        method: destination.method,
        record: data,
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
  if (error)
    return apiError({
      code: "DESTINATION_REGISTER_FAILED",
      message: "출금 목적지를 등록하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: 503,
    });
  return apiSuccess(
    {
      destinationId: data,
      destinationIdentity: fingerprint,
      method: destination.method,
    },
    201,
  );
}
