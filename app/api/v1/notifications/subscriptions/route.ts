import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import {
  getVerifiedPushIdentity,
  applyPushEndpoint,
} from "@/lib/notifications/push-binding.server";
import { readBoundedJsonBody } from "@/lib/api/request-body";
import {
  hasPushSubscriptionOrigin,
  pushSubscriptionSchema,
} from "@/domain/notifications/push-subscription";

const removalSchema = z.strictObject({
  endpoint: z.url().startsWith("https://").max(2048),
  intentId: z.uuid(),
});
const endpoint = z.url().startsWith("https://").max(2048);
const epoch = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
const commandSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("SNAPSHOT"), endpoint }),
  z.strictObject({
    operation: z.literal("ISSUE"),
    subscription: pushSubscriptionSchema,
    expectedEpoch: epoch,
    intentId: z.uuid(),
  }),
  z.strictObject({
    operation: z.literal("REGISTER"),
    subscription: pushSubscriptionSchema,
    expectedEpoch: epoch,
    intentId: z.uuid(),
    permitId: z.uuid(),
  }),
]);
async function input(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return null;
  const result = await readBoundedJsonBody(request, 8192);
  return result.ok ? result.value : null;
}
function originDenied() {
  return apiError({
    code: "ORIGIN_DENIED",
    message: "앱에서 직접 다시 시도해 주세요.",
    status: 403,
  });
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasPushSubscriptionOrigin(request)) return originDenied();
  const identity = await getVerifiedPushIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }

  const body = commandSchema.safeParse(await input(request));
  if (!body.success) {
    return apiError({
      code: "INVALID_PUSH_SUBSCRIPTION",
      message: "알림 구독 정보를 확인해 주세요.",
      status: 400,
    });
  }

  const value = body.data;
  const result = await applyPushEndpoint(
    identity,
    value.operation === "SNAPSHOT"
      ? value
      : { ...value, userAgent: request.headers.get("user-agent") ?? "" },
  );
  if (!result.ok)
    return apiError({
      code: result.code,
      message:
        result.code === "PUSH_INTENT_STALE"
          ? "알림 상태가 변경되었어요. 상태를 확인한 뒤 다시 선택해 주세요."
          : "알림 설정을 확인하지 못했습니다.",
      status:
        result.code === "PUSH_SESSION_REQUIRED"
          ? 401
          : ["PUSH_INTENT_STALE", "PUSH_SUBSCRIPTION_CONFLICT"].includes(
                result.code,
              )
            ? 409
            : 503,
    });

  return apiSuccess(result.receipt, value.operation === "REGISTER" ? 201 : 200);
}

export async function DELETE(request: Request) {
  if (!hasPushSubscriptionOrigin(request)) return originDenied();
  const identity = await getVerifiedPushIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }

  const body = removalSchema.safeParse(await input(request));
  if (!body.success) {
    return apiError({
      code: "INVALID_PUSH_SUBSCRIPTION",
      message: "알림 구독 정보를 확인해 주세요.",
      status: 400,
    });
  }

  const result = await applyPushEndpoint(identity, {
    operation: "REVOKE",
    ...body.data,
  });
  if (!result.ok)
    return apiError({
      code: result.code,
      message:
        result.code === "PUSH_REVOKE_SUPERSEDED"
          ? "이전 알림 해제는 처리되었지만 그 뒤 설정이 변경되었어요. 현재 상태를 다시 확인해 주세요."
          : "알림 해제를 확인하지 못했습니다.",
      status:
        result.code === "PUSH_SESSION_REQUIRED"
          ? 401
          : ["PUSH_INTENT_STALE", "PUSH_REVOKE_SUPERSEDED"].includes(
                result.code,
              )
            ? 409
            : 503,
    });

  return apiSuccess(result.receipt);
}
