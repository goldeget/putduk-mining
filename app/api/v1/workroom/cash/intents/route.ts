import { z } from "zod";
import {
  GET as recover,
  PATCH as resolve,
} from "@/app/api/v1/withdrawals/intents/route";
import { apiError, apiSuccess } from "@/lib/api/http";
import { readBoundedJsonBody } from "@/lib/api/request-body";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  withdrawalDestinationIdentity,
  withdrawalDestinationSchema,
} from "@/lib/wallet/withdrawal-destination.server";
import { validateWithdrawalLogicalRecord } from "@/lib/wallet/withdrawal-logical-record";
import { workroomCashApiError } from "@/lib/wallet/workroom-cash-errors.server";

const input = z
  .strictObject({
    method: z.enum(["KRW_BANK", "USDT_ADDRESS"]),
    amountKrw: z.string().regex(/^[1-9][0-9]{0,14}$/),
    policyId: z.uuid(),
    policyVersion: z.number().int().positive().refine(Number.isSafeInteger),
    destinationId: z.uuid().nullable(),
    destination: withdrawalDestinationSchema.nullable(),
  })
  .refine(
    (v) =>
      Boolean(v.destinationId) !== Boolean(v.destination) &&
      (!v.destination || v.method === v.destination.method),
  );
export const dynamic = "force-dynamic";
export const GET = recover;
export const PATCH = resolve;
export async function POST(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity)
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  const bodyRead = await readBoundedJsonBody(request, 4096);
  const parsed = input.safeParse(bodyRead.ok ? bodyRead.value : null);
  if (!parsed.success)
    return apiError({
      code: "INVALID_WITHDRAWAL_REQUEST",
      message: "출금 요청 정보를 확인해 주세요.",
      status: 400,
    });
  const body = parsed.data;
  try {
    const { data, error } = await createSupabaseAdminClient().rpc(
      "prepare_workroom_cash_withdrawal",
      {
        p_user_id: identity.userId,
        p_method: body.method,
        p_amount_krw: body.amountKrw,
        p_policy_id: body.policyId,
        p_policy_version: body.policyVersion,
        p_destination_fingerprint: body.destination
          ? withdrawalDestinationIdentity(body.destination).fingerprint
          : null,
        p_destination_id: body.destinationId,
      },
    );
    if (error) return workroomCashApiError(error);
    const record = validateWithdrawalLogicalRecord(data, identity.userId);
    if (
      record.v !== 2 ||
      record.method !== body.method ||
      record.amountKrw !== body.amountKrw ||
      record.policyId !== body.policyId ||
      record.policyVersion !== body.policyVersion ||
      (body.destinationId !== null &&
        record.destinationId !== body.destinationId) ||
      (body.destination !== null &&
        record.destinationIdentity !==
          withdrawalDestinationIdentity(body.destination).fingerprint)
    )
      throw Error("UNCONFIRMED");
    return apiSuccess({ record }, 201);
  } catch {
    return apiError({
      code: "WITHDRAWAL_RECONCILIATION_REQUIRED",
      message: "이전 요청을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
      status: 503,
    });
  }
}
