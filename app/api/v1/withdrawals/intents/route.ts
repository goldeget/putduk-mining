import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  withdrawalDestinationIdentity,
  withdrawalDestinationSchema,
} from "@/lib/wallet/withdrawal-destination.server";
import { withdrawalLogicalApiError } from "@/lib/wallet/withdrawal-logical-errors.server";

const prepareSchema = z
  .object({
    method: z.enum(["KRW_BANK", "USDT_ADDRESS"]),
    amountKrw: z.string().regex(/^[1-9][0-9]{0,14}$/),
    policyId: z.string().uuid(),
    policyVersion: z.number().int().positive(),
    destinationId: z.string().uuid().nullable(),
    destination: withdrawalDestinationSchema.nullable(),
  })
  .strict()
  .refine(
    (body) =>
      Boolean(body.destinationId) !== Boolean(body.destination) &&
      (!body.destination || body.method === body.destination.method),
  );
const resolveSchema = z
  .object({
    action: z.enum(["CONFIRM", "CANCEL", "REJECT"]),
    withdrawalId: z.string().uuid().nullable().optional(),
  })
  .strict();

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
  const { data, error } = await createSupabaseAdminClient().rpc(
    "resolve_withdrawal_logical_request",
    {
      p_user_id: identity.userId,
      p_action: "RECOVER",
      p_idempotency_key: key,
    },
  );
  if (error) return withdrawalLogicalApiError(error);
  return apiSuccess({ record: data });
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
  const { data, error } = await createSupabaseAdminClient().rpc(
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
    },
  );
  if (error) return withdrawalLogicalApiError(error);
  return apiSuccess({ record: data }, 201);
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
  const { data, error } = await createSupabaseAdminClient().rpc(
    "resolve_withdrawal_logical_request",
    {
      p_user_id: identity.userId,
      p_action: body.data.action,
      p_idempotency_key: key,
      p_withdrawal_id: body.data.withdrawalId ?? null,
    },
  );
  if (error) return withdrawalLogicalApiError(error);
  return apiSuccess({ record: data });
}
