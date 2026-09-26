import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { encryptSensitiveData } from "@/lib/security/encrypt-sensitive-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const baseSchema = {
  amountAtomic: z.string().regex(/^[1-9][0-9]{0,23}$/),
  policyId: z.uuid(),
  walletAccountId: z.uuid(),
};

const requestSchema = z.discriminatedUnion("currency", [
  z.object({
    ...baseSchema,
    currency: z.literal("KRW"),
    destination: z.object({
      accountHolder: z.string().trim().min(2).max(60),
      accountNumber: z.string().regex(/^[0-9-]{6,32}$/),
      bankCode: z.string().regex(/^[A-Z0-9_]{2,20}$/),
    }),
  }),
  z.object({
    ...baseSchema,
    currency: z.literal("USDT"),
    destination: z.object({
      address: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9]{20,128}$/),
      network: z.string().regex(/^[A-Z0-9_]{2,20}$/),
    }),
  }),
]);

const krwPolicyConfigSchema = z.object({
  allowed_bank_codes: z.array(z.string()).min(1).max(100),
});

const usdtPolicyConfigSchema = z.object({
  allowed_networks: z.array(z.string()).min(1).max(20),
});

function maskAccountNumber(value: string) {
  const digits = value.replace(/-/g, "");
  return `${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function maskCryptoAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    return apiError({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "요청 식별자를 확인해 주세요.",
      status: 400,
    });
  }

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError({
      code: "INVALID_WITHDRAWAL_REQUEST",
      message: "출금 요청 정보를 확인해 주세요.",
      status: 400,
    });
  }

  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch {
    return apiError({
      code: "WITHDRAWAL_SECURITY_NOT_CONFIGURED",
      message: "출금 보안 구성이 아직 완료되지 않았습니다.",
      status: 503,
    });
  }
  if (!env.WITHDRAWAL_DATA_KEY) {
    return apiError({
      code: "WITHDRAWAL_SECURITY_NOT_CONFIGURED",
      message: "출금 보안 구성이 아직 완료되지 않았습니다.",
      status: 503,
    });
  }

  const admin = createSupabaseAdminClient();
  const destinationType =
    parsed.data.currency === "KRW" ? "BANK_ACCOUNT" : "USDT_ADDRESS";
  const { data: policy, error: policyError } = await admin
    .from("withdrawal_policies")
    .select("id, currency, destination_type, destination_config")
    .eq("id", parsed.data.policyId)
    .eq("currency", parsed.data.currency)
    .eq("destination_type", destinationType)
    .eq("is_enabled", true)
    .lte("effective_at", new Date().toISOString())
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .maybeSingle();

  if (policyError || !policy) {
    return apiError({
      code: "WITHDRAWAL_POLICY_UNAVAILABLE",
      message: "현재 사용할 수 있는 출금 정책이 없습니다.",
      status: 409,
    });
  }

  let sensitiveValue: Record<string, string>;
  let display: Record<string, string>;
  if (parsed.data.currency === "KRW") {
    const config = krwPolicyConfigSchema.safeParse(policy.destination_config);
    if (
      !config.success ||
      !config.data.allowed_bank_codes.includes(parsed.data.destination.bankCode)
    ) {
      return apiError({
        code: "WITHDRAWAL_DESTINATION_UNAVAILABLE",
        message: "선택한 은행은 현재 출금 정책에서 지원되지 않습니다.",
        status: 409,
      });
    }

    sensitiveValue = parsed.data.destination;
    display = {
      accountHolder: parsed.data.destination.accountHolder,
      accountNumber: maskAccountNumber(parsed.data.destination.accountNumber),
      bankCode: parsed.data.destination.bankCode,
    };
  } else {
    const config = usdtPolicyConfigSchema.safeParse(policy.destination_config);
    if (
      !config.success ||
      !config.data.allowed_networks.includes(parsed.data.destination.network)
    ) {
      return apiError({
        code: "WITHDRAWAL_DESTINATION_UNAVAILABLE",
        message: "선택한 네트워크는 현재 출금 정책에서 지원되지 않습니다.",
        status: 409,
      });
    }

    sensitiveValue = parsed.data.destination;
    display = {
      address: maskCryptoAddress(parsed.data.destination.address),
      network: parsed.data.destination.network,
    };
  }

  const encrypted = encryptSensitiveData({
    additionalData: `${identity.userId}:${parsed.data.currency}:${policy.id}`,
    keyBase64: env.WITHDRAWAL_DATA_KEY,
    value: sensitiveValue,
  });

  const { data, error } = await admin.rpc("create_withdrawal_request", {
    p_amount_atomic: parsed.data.amountAtomic,
    p_destination_snapshot: { display, encrypted },
    p_destination_type: destinationType,
    p_idempotency_key: idempotencyKey,
    p_user_id: identity.userId,
    p_wallet_account_id: parsed.data.walletAccountId,
    p_withdrawal_policy_id: policy.id,
  });

  if (error) {
    const insufficient = error.message.includes(
      "INSUFFICIENT_AVAILABLE_BALANCE",
    );
    const belowMinimum = error.message.includes("WITHDRAWAL_BELOW_MINIMUM");
    const unavailable = error.message.includes("WITHDRAWAL_POLICY_UNAVAILABLE");
    return apiError({
      code: insufficient
        ? "INSUFFICIENT_AVAILABLE_BALANCE"
        : belowMinimum
          ? "WITHDRAWAL_BELOW_MINIMUM"
          : unavailable
            ? "WITHDRAWAL_POLICY_UNAVAILABLE"
            : "WITHDRAWAL_REQUEST_FAILED",
      message: insufficient
        ? "사용 가능한 잔액이 부족합니다."
        : belowMinimum
          ? "최소 출금 금액을 확인해 주세요."
          : unavailable
            ? "현재 사용할 수 있는 출금 정책이 없습니다."
            : "출금 요청을 생성하지 못했습니다.",
      status: insufficient || belowMinimum || unavailable ? 409 : 503,
    });
  }

  return apiSuccess({ requestId: data }, 201);
}
