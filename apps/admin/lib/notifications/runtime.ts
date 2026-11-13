import "server-only";
import { z } from "zod";
import { workroomDependencies } from "../workroom/server";
import { HIGH_IMPACT_ROLES } from "../auth/policy";
import type { AdminPrincipal } from "../auth/principal";
import { createAdminServiceClient } from "../supabase/service";
import {
  applyPushEndpoint,
  type PushEndpointInput,
} from "../../../../lib/notifications/push-endpoint-command.server";
import { pushSubscriptionSchema } from "../../../../domain/notifications/push-subscription";
import { readBoundedJsonBody } from "../../../../lib/api/request-body";
const headers = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
const endpoint = z.string().url().startsWith("https://").max(2048);
const epoch = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER - 1);
const schema = z.discriminatedUnion("operation", [
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
function failure(code: string, status = 503) {
  return Response.json(
    {
      error: {
        code,
        message: "알림 설정을 확인하지 못했습니다. 다시 시도해 주세요.",
      },
    },
    { status, headers },
  );
}
export async function adminPushConfig(request: Request) {
  const access = await workroomDependencies.authorizeRead(request);
  if (!access.ok) return failure(access.code, access.status);
  const value = process.env["NEXT_PUBLIC_VAPID_PUBLIC_KEY"]?.trim() ?? "";
  const bytes = /^[A-Za-z0-9_-]+$/.test(value)
    ? Buffer.from(value, "base64url")
    : null;
  const publicKey =
    bytes?.length === 65 &&
    bytes[0] === 4 &&
    bytes.toString("base64url") === value
      ? value
      : null;
  return Response.json(
    { data: { publicKey, configured: publicKey !== null } },
    { headers },
  );
}
export async function adminPushCommand(request: Request) {
  const access = await workroomDependencies.authorize(
    request,
    HIGH_IMPACT_ROLES,
  );
  if (!access.ok) return failure(access.code, access.status);
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return failure("INVALID_CONTENT_TYPE", 415);
  const json = await readBoundedJsonBody(request, 8192);
  if (!json.ok) return failure("INVALID_BODY", 400);
  const body =
    request.method === "DELETE"
      ? z
          .strictObject({ endpoint, intentId: z.uuid() })
          .transform((value) => ({ operation: "REVOKE" as const, ...value }))
          .safeParse(json.value)
      : schema.safeParse(json.value);
  if (!body.success) return failure("INVALID_PUSH_SUBSCRIPTION", 400);
  const principal = access.principal as AdminPrincipal;
  const value = body.data;
  const input: PushEndpointInput =
    value.operation === "ISSUE" || value.operation === "REGISTER"
      ? { ...value, userAgent: request.headers.get("user-agent") ?? "" }
      : value;
  const result = await applyPushEndpoint(
    {
      supabase: principal.supabase,
      userId: principal.userId,
      authSessionId: principal.sessionId,
    },
    input,
    createAdminServiceClient(),
  );
  if (!result.ok)
    return failure(
      result.code,
      result.code === "PUSH_INTENT_STALE"
        ? 409
        : result.code === "PUSH_SESSION_REQUIRED"
          ? 401
          : 503,
    );
  if (value.operation === "REGISTER") {
    const bound = await principal.supabase.rpc("workroom_app_admin", {
      p_operation: "PUSH_BIND_ADMIN",
      p_request_key: value.intentId,
      p_input: {
        subscriptionId:
          "subscriptionId" in result.receipt
            ? result.receipt.subscriptionId
            : null,
      },
      p_actor: principal.userId,
      p_admin_session_id: principal.adminSessionId,
      p_auth_session_id: principal.sessionId,
      p_verified_aal: principal.aal,
    });
    if (
      bound.error ||
      !z.strictObject({ bound: z.literal(true) }).safeParse(bound.data).success
    )
      return failure("PUSH_SCOPE_UNCONFIRMED");
  }
  return Response.json(
    { data: result.receipt },
    { status: value.operation === "REGISTER" ? 201 : 200, headers },
  );
}

/** Call only with the already-verified logout identity before revoking Auth.
 * An unknown receipt must not be presented as successful push revocation.
 */
export async function revokeAdminPushForLogout(
  userId: string,
  authSessionId: string,
  all = false,
) {
  const operation = all ? "LOGOUT_GLOBAL" : "LOGOUT_LOCAL";
  const result = await createAdminServiceClient().rpc(
    "apply_member_push_binding",
    {
      p_user_id: userId,
      p_auth_session_id: authSessionId,
      p_operation: operation,
      p_endpoint: null,
      p_p256dh: null,
      p_auth_secret: null,
      p_expires_at: null,
      p_user_agent: null,
    },
  );
  const value = z
    .strictObject({
      subscribed: z.literal(false),
      operation: z.literal(operation),
      scope: z.literal(all ? "GLOBAL" : "LOCAL"),
      authSessionId: z.literal(authSessionId),
      receiptId: z.uuid(),
      subscriptionId: z.null(),
    })
    .safeParse(result.data);
  return !result.error && value.success;
}
