import { aiMemberFeedbackSchema } from "@/domain/ai/member-feedback";
import { matchesAiPresentationOwner } from "@/domain/ai/presentation-owner";
import { apiError, apiSuccess } from "@/lib/api/http";
import {
  createSupabaseMemberConversationPort,
  recordOwnMemberFeedback,
} from "@/lib/ai/member-conversation";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_BODY_BYTES = 2_048;

function hasAllowedOrigin(request: Request, appUrl: string) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(appUrl).origin);
}

export async function POST(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }
  if (!matchesAiPresentationOwner(request.headers, identity.userId)) {
    return apiError({
      code: "AI_SESSION_CHANGED",
      message: "로그인 상태가 바뀌었어요. 다시 확인해 주세요.",
      status: 409,
    });
  }

  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch {
    return apiError({
      code: "AI_SERVICE_NOT_CONFIGURED",
      message: "지금은 의견을 남길 수 없어요.",
      status: 503,
    });
  }
  if (!hasAllowedOrigin(request, env.NEXT_PUBLIC_APP_URL)) {
    return apiError({
      code: "ORIGIN_REJECTED",
      message: "요청을 확인하지 못했어요. 앱에서 다시 시도해 주세요.",
      status: 403,
    });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return apiError({
      code: "PAYLOAD_TOO_LARGE",
      message: "의견을 확인하지 못했어요.",
      status: 413,
    });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError({
      code: "INVALID_JSON",
      message: "의견을 확인하지 못했어요.",
      status: 400,
    });
  }
  const parsed = aiMemberFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "INVALID_AI_FEEDBACK",
      message: "의견을 확인하지 못했어요.",
      status: 400,
    });
  }

  const saved = await recordOwnMemberFeedback(
    createSupabaseMemberConversationPort(createSupabaseAdminClient()),
    {
      conversationId: parsed.data.conversationId,
      messageId: parsed.data.messageId,
      rating: parsed.data.rating,
      reasonCode: parsed.data.reasonCode ?? null,
      userId: identity.userId,
    },
  );
  if (saved.ok) return apiSuccess({ received: true });
  if (saved.code === "NOT_OWN_MESSAGE") {
    return apiError({
      code: "AI_FEEDBACK_NOT_FOUND",
      message: "답변을 찾지 못했어요.",
      status: 404,
    });
  }
  if (saved.code === "FEEDBACK_EXISTS") {
    return apiError({
      code: "AI_FEEDBACK_EXISTS",
      message: "이미 남긴 의견이에요.",
      status: 409,
    });
  }
  return apiError({
    code: "AI_FEEDBACK_NOT_SAVED",
    message: "의견을 남기지 못했어요.",
    status: 503,
  });
}
