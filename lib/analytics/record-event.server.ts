import "server-only";

import { randomUUID } from "node:crypto";

import {
  analyticsEventSchema,
  type AnalyticsEventName,
} from "@/domain/analytics/events";
import {
  readAppRelease,
  sanitizeAnalyticsProperties,
  serverAnalyticsEnabled,
} from "@/domain/analytics/observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 프로덕션에서만 서버 사실을 남긴다.
 * 저장 실패는 삼키며 가입·채굴·지갑·정산을 막지 않는다.
 */
export async function recordProductionAnalyticsEvent(input: {
  eventName: AnalyticsEventName;
  userId: string;
  properties?: Record<string, boolean | null | number | string>;
}): Promise<void> {
  try {
    if (!serverAnalyticsEnabled(process.env.APP_ENV)) return;
    if (!/^[0-9a-f-]{36}$/i.test(input.userId)) return;
    const properties = sanitizeAnalyticsProperties(
      input.properties ?? {},
      readAppRelease(process.env.NEXT_PUBLIC_APP_RELEASE),
      input.eventName,
    );
    const parsed = analyticsEventSchema.safeParse({
      eventId: randomUUID(),
      eventName: input.eventName,
      occurredAt: new Date().toISOString(),
      properties,
      sessionId: randomUUID(),
    });
    if (!parsed.success) return;
    const admin = createSupabaseAdminClient();
    await admin.from("analytics_events").insert({
      anonymous_id: null,
      event_name: parsed.data.eventName,
      occurred_at: parsed.data.occurredAt,
      properties: parsed.data.properties,
      request_id: parsed.data.eventId,
      session_id: parsed.data.sessionId,
      user_id: input.userId,
    });
  } catch {
    // 분석 저장 실패는 도메인 명령을 롤백하지 않는다.
  }
}
