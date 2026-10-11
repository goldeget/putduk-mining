import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  withdrawalDestinationIdentity,
  withdrawalDestinationSchema,
} from "@/lib/wallet/withdrawal-destination.server";
import {
  validateWithdrawalLogicalRecord,
  sameWithdrawalLogicalOriginal,
  type WithdrawalLogicalRecord,
} from "@/lib/wallet/withdrawal-logical-record";
import { readPrincipalCryptoWithdrawal } from "@/lib/wallet/read-principal-crypto-withdrawal.server";
import { readPrincipalWithdrawal } from "@/lib/wallet/read-principal-withdrawal.server";
import { withdrawalLogicalApiError } from "@/lib/wallet/withdrawal-logical-errors.server";

const prepareSchema = z
  .object({
    method: z.enum(["KRW_BANK", "USDT_ADDRESS"]),
    amountKrw: z.string().regex(/^[1-9][0-9]{0,14}$/),
    policyId: z.string().uuid(),
    policyVersion: z.number().int().positive().refine(Number.isSafeInteger),
    destinationId: z.string().uuid().nullable(),
    destination: withdrawalDestinationSchema.nullable(),
    confirmation: z
      .strictObject({
        version: z.literal(1),
        source: z.literal("PRINCIPAL"),
        confirmed: z.literal(true),
      })
      .optional(),
  })
  .strict()
  .refine(
    (body) =>
      Boolean(body.destinationId) !== Boolean(body.destination) &&
      (!body.destination || body.method === body.destination.method) &&
      (!body.confirmation || Boolean(body.destinationId)),
  );
const resolveSchema = z.union([
  z.strictObject({
    action: z.enum(["CONFIRM", "CANCEL", "REJECT"]),
    withdrawalId: z.string().uuid().nullable().optional(),
  }),
  z.strictObject({
    action: z.enum(["CONFIRM", "CANCEL", "REJECT"]),
    withdrawalId: z.string().uuid().nullable().optional(),
    recordVersion: z.literal(3),
    confirmationId: z.string().uuid(),
  }),
]);

function invalidRecord() {
  return apiError({
    code: "WITHDRAWAL_RECONCILIATION_REQUIRED",
    message: "이전 요청을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
    status: 503,
  });
}
function checkedRecord(value: unknown, ownerId: string) {
  try {
    return validateWithdrawalLogicalRecord(value, ownerId);
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

function unauthenticated() {
  return apiError({
    code: "UNAUTHENTICATED",
    message: "로그인이 필요합니다.",
    status: 401,
  });
}

export async function GET(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity) return unauthenticated();
  const key = readIdempotencyKey(request);
  if (request.headers.has("Idempotency-Key") && !key) {
    return apiError({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "요청 식별자를 확인해 주세요.",
      status: 400,
    });
  }
  const service = createSupabaseAdminClient();
  const { data, error } = await service.rpc(
    "resolve_withdrawal_logical_request",
    {
      p_user_id: identity.userId,
      p_action: "RECOVER",
      p_idempotency_key: key,
    },
  );
  if (error) return withdrawalLogicalApiError(error);
  const record = data === null ? null : checkedRecord(data, identity.userId);
  if (data !== null && !record) return invalidRecord();
  if (key && (!record || record.key !== key)) return invalidRecord();
  let protectionActive = false;
  if (record?.destinationId && !record.withdrawalId) {
    const destination = await service
      .from("withdrawal_destinations")
      .select("protection_until")
      .eq("id", record.destinationId)
      .eq("user_id", identity.userId)
      .maybeSingle();
    if (
      destination.error ||
      !destination.data ||
      !Number.isFinite(Date.parse(destination.data.protection_until))
    )
      return apiError({
        code: "WITHDRAWAL_RECONCILIATION_REQUIRED",
        message: "이전 요청을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
        status: 503,
      });
    protectionActive =
      Date.parse(destination.data.protection_until) > Date.now();
  }
  // Presentation metadata only; the DB command still owns monetary eligibility.
  const principalRead = new URL(request.url).searchParams.get("principal");
  const wantsPrincipal = principalRead === "1";
  const wantsCryptoPrincipal = principalRead === "usdt";
  return apiSuccess({
    record,
    protectionActive,
    ...(wantsPrincipal
      ? { principal: await readPrincipalWithdrawal(identity) }
      : {}),
    ...(wantsCryptoPrincipal
      ? { principalCrypto: await readPrincipalCryptoWithdrawal(identity) }
      : {}),
  });
}

export async function POST(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity) return unauthenticated();
  const body = prepareSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return apiError({
      code: "INVALID_WITHDRAWAL_REQUEST",
      message: "출금 요청 정보를 확인해 주세요.",
      status: 400,
    });
  }
  // Member consent is signed by the real user JWT, never by the service key.
  // Existing seven-argument ordinary preparation retains its service contract.
  const client = body.data.confirmation
    ? await createSupabaseServerClient()
    : createSupabaseAdminClient();
  const { data, error } = await client.rpc(
    "prepare_withdrawal_logical_request",
    {
      p_user_id: identity.userId,
      p_method: body.data.method,
      p_amount_krw: body.data.amountKrw,
      p_policy_id: body.data.policyId,
      p_policy_version: body.data.policyVersion,
      p_destination_fingerprint: body.data.destination
        ? withdrawalDestinationIdentity(body.data.destination).fingerprint
        : null,
      p_destination_id: body.data.destinationId,
      ...(body.data.confirmation
        ? { p_confirmation: body.data.confirmation }
        : {}),
    },
  );
  if (error) return withdrawalLogicalApiError(error);
  const record = checkedRecord(data, identity.userId);
  if (
    !record ||
    record.v !== (body.data.confirmation ? 3 : 2) ||
    record.method !== body.data.method ||
    record.amountKrw !== body.data.amountKrw ||
    record.policyId !== body.data.policyId ||
    record.policyVersion !== body.data.policyVersion ||
    (body.data.destinationId !== null &&
      record.destinationId !== body.data.destinationId) ||
    (body.data.destination !== null &&
      record.destinationIdentity !==
        withdrawalDestinationIdentity(body.data.destination).fingerprint)
  )
    return invalidRecord();
  return apiSuccess({ record }, 201);
}

export async function PATCH(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity) return unauthenticated();
  const key = readIdempotencyKey(request);
  const body = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!body.success || !key) {
    return apiError({
      code: "INVALID_WITHDRAWAL_REQUEST",
      message: "출금 요청 정보를 확인해 주세요.",
      status: 400,
    });
  }
  const service = createSupabaseAdminClient();
  // Recover the exact owner/key original BEFORE a resolution can change its state.
  // RECOVER never posts finance; it may truthfully reveal an already committed hold.
  const recovery = await service.rpc("resolve_withdrawal_logical_request", {
    p_user_id: identity.userId,
    p_action: "RECOVER",
    p_idempotency_key: key,
  });
  if (recovery.error) return withdrawalLogicalApiError(recovery.error);
  const original = checkedRecord(recovery.data, identity.userId);
  if (!original || original.key !== key) return invalidRecord();
  const sourceBound = "recordVersion" in body.data;
  const confirmationId =
    "confirmationId" in body.data ? body.data.confirmationId : null;
  if (
    (original.v === 3 &&
      (!sourceBound || confirmationId !== original.source.confirmationId)) ||
    (original.v === 2 && sourceBound)
  ) {
    return apiError({
      code: "WITHDRAWAL_RECONCILIATION_REQUIRED",
      message:
        "이전 출금 요청을 먼저 확인해 주세요. 확인하기 전에는 새 요청을 보내지 않아요.",
      status: 409,
    });
  }
  const { data, error } = await service.rpc(
    "resolve_withdrawal_logical_request",
    {
      p_user_id: identity.userId,
      p_action: body.data.action,
      p_idempotency_key: key,
      p_withdrawal_id: body.data.withdrawalId ?? null,
    },
  );
  if (error) return withdrawalLogicalApiError(error);
  const resolved: WithdrawalLogicalRecord | null = checkedRecord(
    data,
    identity.userId,
  );
  if (
    !resolved ||
    !sameWithdrawalLogicalOriginal(original, resolved) ||
    (body.data.action === "CONFIRM" &&
      (resolved.state !== "CONFIRMED" ||
        resolved.withdrawalId !== body.data.withdrawalId))
  )
    return invalidRecord();
  return apiSuccess({ record: resolved });
}
