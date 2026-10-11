import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readBoundedJsonBody } from "@/lib/api/request-body";
import {
  hasPushSubscriptionOrigin,
  pushSubscriptionSchema,
} from "@/domain/notifications/push-subscription";

const removalSchema = z.strictObject({
  endpoint: z.url().startsWith("https://").max(2048),
});
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
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }

  const body = pushSubscriptionSchema.safeParse(await input(request));
  if (!body.success) {
    return apiError({
      code: "INVALID_PUSH_SUBSCRIPTION",
      message: "알림 구독 정보를 확인해 주세요.",
      status: 400,
    });
  }

  const admin = createSupabaseAdminClient();
  const expiresAt = body.data.expirationTime
    ? new Date(body.data.expirationTime).toISOString()
    : null;

  const { error } = await admin.rpc("upsert_push_subscription", {
    p_auth_secret: body.data.keys.auth,
    p_endpoint: body.data.endpoint,
    p_expires_at: expiresAt,
    p_p256dh: body.data.keys.p256dh,
    p_user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? "",
    p_user_id: identity.userId,
  });
  if (error) {
    const conflict = error.message.includes(
      "PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT",
    );
    return apiError({
      code: conflict
        ? "PUSH_SUBSCRIPTION_CONFLICT"
        : "PUSH_SUBSCRIPTION_UNAVAILABLE",
      message: conflict
        ? "이 알림 구독은 다른 계정에 연결되어 있습니다."
        : "알림 구독을 저장하지 못했습니다.",
      status: conflict ? 409 : 503,
    });
  }

  return apiSuccess({ subscribed: true }, 201);
}

export async function DELETE(request: Request) {
  if (!hasPushSubscriptionOrigin(request)) return originDenied();
  const identity = await getVerifiedIdentity();
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

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("revoke_push_subscription", {
    p_endpoint: body.data.endpoint,
    p_user_id: identity.userId,
  });

  if (error) {
    return apiError({
      code: "PUSH_SUBSCRIPTION_UNAVAILABLE",
      message: "알림 구독을 해제하지 못했습니다.",
      status: 503,
    });
  }

  return apiSuccess({ subscribed: false });
}
