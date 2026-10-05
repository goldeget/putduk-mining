import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { analyticsEventSchema } from "@/domain/analytics/events";
import { allowedAnalyticsOrigins } from "@/domain/analytics/observability";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_BODY_BYTES = 8_192;
const MAX_PAST_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch {
    return errorResponse(
      "ANALYTICS_NOT_CONFIGURED",
      "분석 수집 구성이 아직 완료되지 않았습니다.",
      503,
    );
  }

  const origin = request.headers.get("origin");
  const allowedOrigins = new Set(
    allowedAnalyticsOrigins(env.NEXT_PUBLIC_APP_URL, process.env.ADMIN_APP_URL),
  );
  if (!origin || !allowedOrigins.has(origin)) {
    return errorResponse(
      "ORIGIN_REJECTED",
      "허용되지 않은 요청 출처입니다.",
      403,
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse("PAYLOAD_TOO_LARGE", "요청 크기가 너무 큽니다.", 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return errorResponse("PAYLOAD_TOO_LARGE", "요청 크기가 너무 큽니다.", 413);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawBody);
  } catch {
    return errorResponse("INVALID_JSON", "요청 형식이 올바르지 않습니다.", 400);
  }

  const parsed = analyticsEventSchema.safeParse(decoded);
  if (!parsed.success) {
    return errorResponse(
      "INVALID_EVENT",
      "분석 이벤트 형식이 올바르지 않습니다.",
      400,
    );
  }

  const occurredAt = new Date(parsed.data.occurredAt);
  const age = Date.now() - occurredAt.getTime();
  if (age > MAX_PAST_AGE_MS || age < -MAX_FUTURE_SKEW_MS) {
    return errorResponse(
      "INVALID_EVENT_TIME",
      "분석 이벤트 시간이 허용 범위를 벗어났습니다.",
      400,
    );
  }

  const identity = await getVerifiedIdentity();
  const productionCookieName = "__Host-putduk-aid";
  const developmentCookieName = "putduk_aid";
  const cookieName =
    env.APP_ENV === "production" ? productionCookieName : developmentCookieName;
  const storedAnonymousId =
    request.cookies.get(productionCookieName)?.value ??
    request.cookies.get(developmentCookieName)?.value;
  const anonymousId =
    storedAnonymousId && /^[0-9a-f-]{36}$/i.test(storedAnonymousId)
      ? storedAnonymousId
      : randomUUID();

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("analytics_events").insert({
    anonymous_id: identity ? null : anonymousId,
    event_name: parsed.data.eventName,
    occurred_at: parsed.data.occurredAt,
    properties: parsed.data.properties,
    request_id: parsed.data.eventId,
    session_id: parsed.data.sessionId,
    user_id: identity?.userId ?? null,
  });

  if (error && error.code !== "23505") {
    return errorResponse(
      "ANALYTICS_UNAVAILABLE",
      "분석 이벤트를 저장하지 못했습니다.",
      503,
    );
  }

  const response = NextResponse.json(
    { data: { accepted: true } },
    {
      status: 202,
      headers: { "Cache-Control": "private, no-store" },
    },
  );

  if (!identity && !storedAnonymousId) {
    response.cookies.set(cookieName, anonymousId, {
      httpOnly: true,
      maxAge: 365 * 24 * 60 * 60,
      path: "/",
      sameSite: "lax",
      secure: env.APP_ENV === "production",
    });
  }

  return response;
}
