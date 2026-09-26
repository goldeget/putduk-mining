"use client";

import type { AnalyticsEventName } from "@/domain/analytics/events";

const SESSION_KEY = "putduk.analytics.session";

function getSessionId() {
  const existing = window.sessionStorage.getItem(SESSION_KEY);
  if (existing) {
    return existing;
  }

  const created = crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_KEY, created);
  return created;
}

export async function trackAnalyticsEvent(
  eventName: AnalyticsEventName,
  properties: Record<string, boolean | null | number | string> = {},
) {
  const response = await fetch("/api/v1/analytics", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      eventId: crypto.randomUUID(),
      eventName,
      occurredAt: new Date().toISOString(),
      properties,
      sessionId: getSessionId(),
    }),
  });

  if (!response.ok) {
    throw new Error("ANALYTICS_EVENT_REJECTED");
  }
}
