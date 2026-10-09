import "server-only";
import { randomUUID } from "node:crypto";
import { apiError, apiSuccess } from "@/lib/api/http";
import { readBoundedJsonBody } from "@/lib/api/request-body";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env/public";
import {
  eventParticipationInputSchema,
  eventParticipationReceiptSchema,
  cashEventParticipationReceiptSchema,
  hasEventCommandOrigin,
} from "@/domain/events/participation";

/** New parent-approved contract extension. Authenticated RPC owns all qualification. */
async function participate(request: Request) {
  if (!hasEventCommandOrigin(request, getPublicEnv().NEXT_PUBLIC_APP_URL))
    return apiError({
      code: "ORIGIN_DENIED",
      message: "앱에서 직접 다시 시도해 주세요.",
      status: 403,
    });
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return apiError({
      code: "INVALID_INPUT",
      message: "참여할 이벤트를 확인해 주세요.",
      status: 400,
    });
  const body = await readBoundedJsonBody(request, 1024);
  const parsed = eventParticipationInputSchema.safeParse(
    body.ok ? body.value : null,
  );
  if (!parsed.success)
    return apiError({
      code: "INVALID_INPUT",
      message: "참여할 이벤트를 확인해 주세요.",
      status: 400,
    });
  const identity = await getVerifiedIdentity();
  if (!identity)
    return apiError({
      code: "UNAUTHENTICATED",
      message: "다시 로그인해 주세요.",
      status: 401,
    });
  const input = parsed.data;
  const { data, error } = await identity.supabase.rpc(
    "participate_published_event",
    {
      p_event_id: input.eventId,
      p_revision_id: input.revisionId,
      p_idempotency_key: input.idempotencyKey,
      p_request_id: randomUUID(),
      ...(input.cashTermsDigest === undefined
        ? {}
        : { p_cash_terms_digest: input.cashTermsDigest }),
    },
  );
  if (error) {
    if (
      error.message.includes("EVENT_AUTH_REQUIRED") ||
      error.message.includes("LOCAL_CASH_MEMBER_REQUIRED")
    )
      return apiError({
        code: "UNAUTHENTICATED",
        message: "다시 로그인해 주세요.",
        status: 401,
      });
    const unavailable = [
      "EVENT_NOT_AVAILABLE",
      "EVENT_REVISION_CHANGED",
      "EVENT_MEMBER_REQUIRED",
      "EVENT_MEMBER_RESTRICTED",
      "EVENT_RISK_DENIED",
      "EVENT_IDEMPOTENCY_CONFLICT",
      "LOCAL_CASH_DISABLED",
      "LOCAL_CASH_EXPLICIT_TERMS_MISMATCH",
      "LOCAL_CASH_CONSENT_REPLAY_CONFLICT",
    ].find((code) => error.message.includes(code));
    return apiError({
      code: unavailable ?? "EVENT_PARTICIPATION_UNCERTAIN",
      message: unavailable
        ? "참여 조건이나 이벤트 기간을 다시 확인해 주세요."
        : "참여 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.",
      status: unavailable ? 409 : 503,
    });
  }
  const receipt = (
    input.cashTermsDigest === undefined
      ? eventParticipationReceiptSchema
      : cashEventParticipationReceiptSchema
  ).safeParse(data);
  if (
    !receipt.success ||
    receipt.data.eventId !== input.eventId ||
    receipt.data.revisionId !== input.revisionId ||
    (input.cashTermsDigest !== undefined &&
      (!("cashTermsDigest" in receipt.data) ||
        receipt.data.cashTermsDigest !== input.cashTermsDigest))
  )
    return apiError({
      code: "EVENT_PARTICIPATION_UNCERTAIN",
      message:
        "참여 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.",
      status: 503,
    });
  const { data: own, error: readError } = await identity.supabase
    .from("event_participants")
    .select("id,event_id,user_id,status,joined_at,completed_at,rewarded_at")
    .eq("id", receipt.data.participantId)
    .eq("user_id", identity.userId)
    .maybeSingle();
  if (
    readError ||
    !own ||
    own.event_id !== input.eventId ||
    own.user_id !== identity.userId ||
    own.status !== receipt.data.status ||
    Date.parse(own.joined_at) !== Date.parse(receipt.data.joinedAt)
  )
    return apiError({
      code: "EVENT_PARTICIPATION_UNCERTAIN",
      message:
        "참여 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.",
      status: 503,
    });
  return apiSuccess(receipt.data);
}

export async function handleMemberEventParticipation(request: Request) {
  try {
    return await participate(request);
  } catch {
    return apiError({
      code: "EVENT_PARTICIPATION_UNCERTAIN",
      message:
        "참여 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.",
      status: 503,
    });
  }
}
