"use client";

import type { AnalyticsEventName } from "@/domain/analytics/events";
import {
  browserAnalyticsEnabled,
  readAppRelease,
  sanitizeAnalyticsProperties,
  toStructuralReplayStep,
} from "@/domain/analytics/observability";

const SESSION_KEY = "putduk.analytics.session";

function getSessionId() {
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
    return existing;
  }

  const created = crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

function browserExcluded() {
  const webdriver =
    typeof navigator !== "undefined" && navigator.webdriver === true;
  const hostname =
    typeof window !== "undefined" ? window.location.hostname : undefined;
  return !browserAnalyticsEnabled({
    hostname,
    nodeEnv: process.env.NODE_ENV,
    webdriver,
  });
}

/**
 * 허용된 이벤트만 같은 출처로 보낸다.
 * 수집 실패, 테스트 브라우저, 루프백은 화면 흐름을 막지 않는다.
 */
export async function trackAnalyticsEvent(
  eventName: AnalyticsEventName,
  properties: Record<string, boolean | null | number | string> = {},
) {
  try {
    if (browserExcluded()) return;
    const sessionId = getSessionId();
    const safeProperties = sanitizeAnalyticsProperties(
      properties,
      readAppRelease(process.env.NEXT_PUBLIC_APP_RELEASE),
    );
    if (eventName === "screen_view" || eventName === "landing_view") {
      const path =
        typeof safeProperties.path === "string" ? safeProperties.path : "";
      const replay = toStructuralReplayStep({
        path,
        properties: safeProperties,
        sessionId,
      });
      if (!replay) return;
      safeProperties.path = replay.path;
    }

    const response = await fetch("/api/v1/analytics", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        eventId: crypto.randomUUID(),
        eventName,
        occurredAt: new Date().toISOString(),
        properties: safeProperties,
        sessionId,
      }),
    });

    if (!response.ok) return;
  } catch {
    // 분석 실패가 인증, 채굴, 지갑, 정산을 막으면 안 된다.
  }
}
