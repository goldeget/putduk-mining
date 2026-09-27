import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { encryptSensitiveData } from "@/lib/security/encrypt-sensitive-data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const bankSchema = z.object({
  method: z.literal("KRW_BANK"),
  accountHolder: z.string().trim().min(2).max(60),
  accountNumber: z.string().regex(/^[0-9-]{6,32}$/),
  bankCode: z.string().regex(/^[A-Z0-9_]{2,20}$/),
});

const usdtSchema = z.object({
  method: z.literal("USDT_ADDRESS"),
  address: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{20,128}$/),
  network: z.enum(["TRC20", "ERC20", "BEP20"]),
});

const requestSchema = z.discriminatedUnion("method", [bankSchema, usdtSchema]);

function maskAccountNumber(value: string) {
  const digits = value.replace(/-/g, "");
  return `${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function maskCryptoAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function fingerprint(payload: Record<string, string>) {
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

function encryptedByteaHex(envelope: {
  algorithm: string;
  ciphertext: string;
  iv: string;
  keyVersion: number;
  tag: string;
}) {
  return `\\x${Buffer.from(JSON.stringify(envelope), "utf8").toString("hex")}`;
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

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError({
      code: "INVALID_DESTINATION",
      message: "출금 목적지 정보를 확인해 주세요.",
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
  const requestId = randomUUID();
  const stepUpToken = randomUUID();

  if (parsed.data.method === "KRW_BANK") {
    const sensitive = {
      accountHolder: parsed.data.accountHolder,
      accountNumber: parsed.data.accountNumber,
      bankCode: parsed.data.bankCode,
    };
    const envelope = encryptSensitiveData({
      additionalData: `${identity.userId}:KRW_BANK`,
      keyBase64: env.WITHDRAWAL_DATA_KEY,
      value: sensitive,
    });
    const displayHint = `${parsed.data.bankCode} ${maskAccountNumber(parsed.data.accountNumber)}`;

    const { data, error } = await admin.rpc("register_krw_bank_destination", {
      p_user_id: identity.userId,
      p_encrypted_value: encryptedByteaHex(envelope),
      p_value_fingerprint: fingerprint(sensitive),
      p_display_hint: displayHint,
      p_step_up_token: stepUpToken,
      p_request_id: requestId,
      p_protection_hours: 24,
    });

    if (error) {
      return apiError({
        code: "DESTINATION_REGISTER_FAILED",
        message: "은행 계좌를 등록하지 못했어요. 잠시 후 다시 시도해 주세요.",
        status: 503,
      });
    }

    return apiSuccess({ destinationId: data, method: "KRW_BANK" }, 201);
  }

  const sensitive = {
    address: parsed.data.address,
    network: parsed.data.network,
  };
  const envelope = encryptSensitiveData({
    additionalData: `${identity.userId}:USDT_ADDRESS`,
    keyBase64: env.WITHDRAWAL_DATA_KEY,
    value: sensitive,
  });
  const displayHint = `${parsed.data.network} ${maskCryptoAddress(parsed.data.address)}`;

  const { data, error } = await admin.rpc(
    "register_usdt_withdrawal_destination",
    {
      p_user_id: identity.userId,
      p_network: parsed.data.network,
      p_address: parsed.data.address,
      p_encrypted_value: encryptedByteaHex(envelope),
      p_value_fingerprint: fingerprint(sensitive),
      p_display_hint: displayHint,
      p_step_up_token: stepUpToken,
      p_request_id: requestId,
      p_protection_hours: 24,
    },
  );

  if (error) {
    return apiError({
      code: "DESTINATION_REGISTER_FAILED",
      message: "USDT 주소를 등록하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: 503,
    });
  }

  return apiSuccess({ destinationId: data, method: "USDT_ADDRESS" }, 201);
}
