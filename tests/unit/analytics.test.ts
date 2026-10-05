import { describe, expect, it } from "vitest";

import { analyticsEventSchema } from "@/domain/analytics/events";

const validEvent = {
  eventId: "6d2caee8-166f-4d99-8507-0ebd774173e0",
  eventName: "screen_view",
  occurredAt: "2026-09-26T10:00:00.000Z",
  properties: { path: "/about", returning: false },
  sessionId: "a8098c1a-f86e-4f2a-af37-248e7e0f7a14",
};

describe("analytics event contract", () => {
  it("accepts an allowlisted event with bounded primitive properties", () => {
    expect(analyticsEventSchema.safeParse(validEvent).success).toBe(true);
  });

  it("rejects event names outside the canonical funnel", () => {
    expect(
      analyticsEventSchema.safeParse({ ...validEvent, eventName: "arbitrary" })
        .success,
    ).toBe(false);
  });

  it("rejects nested property payloads", () => {
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        properties: { user: { email: "private@example.com" } },
      }).success,
    ).toBe(false);
  });

  it("rejects property names and values outside the privacy allowlist", () => {
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        properties: { email: "private@example.com" },
      }).success,
    ).toBe(false);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        properties: { path: "/start?token=secret" },
      }).success,
    ).toBe(false);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        properties: { amount_atomic: 5000 },
      }).success,
    ).toBe(false);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        eventName: "landing_view",
        properties: { currency: "KRW", path: "/about", returning: false },
      }).success,
    ).toBe(true);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        eventName: "deposit_start",
        properties: { currency: "KRW" },
      }).success,
    ).toBe(true);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        eventName: "web_vital",
        properties: {
          navigation_type: "navigate",
          vital_name: "LCP",
          vital_rating: "good",
          vital_unit: "ms",
          vital_value: 1800,
        },
      }).success,
    ).toBe(true);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        eventName: "ai_question",
        properties: { character_count: 12, knowledge_version: "2026.09" },
      }).success,
    ).toBe(true);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        properties: { path: "/start%3Ftoken=secret" },
      }).success,
    ).toBe(false);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        properties: {
          path: "/auth/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signatureok",
        },
      }).success,
    ).toBe(false);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        properties: {
          path: "/wallet/TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC",
        },
      }).success,
    ).toBe(false);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        properties: { path: "/id/010-1234-5678" },
      }).success,
    ).toBe(false);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        eventName: "deposit_complete",
        properties: { currency: 5000 },
      }).success,
    ).toBe(false);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        eventName: "first_real_settlement",
        properties: { vital_value: 5000 },
      }).success,
    ).toBe(false);
    expect(
      analyticsEventSchema.safeParse({
        ...validEvent,
        eventName: "client_error",
        properties: { error_name: "TypeError" },
      }).success,
    ).toBe(true);
  });

  it("rejects more than twenty property keys", () => {
    const properties = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`property_${index}`, index]),
    );
    expect(
      analyticsEventSchema.safeParse({ ...validEvent, properties }).success,
    ).toBe(false);
  });
});
