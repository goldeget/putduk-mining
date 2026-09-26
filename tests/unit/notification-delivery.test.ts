import { describe, expect, it } from "vitest";

import {
  decideNotificationDelivery,
  planPublishedNotificationFanout,
} from "@/domain/notifications/delivery-policy";

const base = {
  allowedDeepLinkPrefixes: ["/wallet", "/events"],
  dailyNonCriticalCap: 5,
  deepLink: "/wallet/withdraw?receipt=one",
  deliveredToday: 0,
  enabledChannels: { IN_APP: true, PUSH: true },
  nonCriticalCooldownMinutes: 30,
  now: new Date("2026-09-27T04:00:00.000Z"),
  priority: "NORMAL" as const,
  timezoneOffsetMinutes: 540,
};

describe("decideNotificationDelivery", () => {
  it("fans out to enabled channels for an allowed deep link", () => {
    expect(decideNotificationDelivery(base)).toMatchObject({
      channels: ["IN_APP", "PUSH"],
      reason: "DELIVER",
    });
  });

  it("enforces the non-critical daily cap", () => {
    expect(
      decideNotificationDelivery({ ...base, deliveredToday: 5 }),
    ).toMatchObject({ channels: [], reason: "DAILY_CAP" });
  });

  it("lets a critical financial notification bypass fatigue controls", () => {
    expect(
      decideNotificationDelivery({
        ...base,
        deliveredToday: 99,
        lastNonCriticalDeliveryAt: new Date("2026-09-27T03:59:00.000Z"),
        priority: "CRITICAL",
        quietHours: { endHour: 8, startHour: 22 },
      }),
    ).toMatchObject({
      channels: ["IN_APP", "PUSH"],
      reason: "DELIVER",
    });
  });

  it("rejects an external deep link", () => {
    expect(() =>
      decideNotificationDelivery({
        ...base,
        deepLink: "https://attacker.invalid/wallet",
      }),
    ).toThrow(/allowlist/i);
  });

  it("fans out a published notice once and respects category preferences", () => {
    const plans = planPublishedNotificationFanout({
      allowedDeepLinkPrefixes: ["/events"],
      deepLink: "/events/autumn",
      deliveredDeduplicationKeys: new Set([
        "notification:notice-1:already-sent",
      ]),
      members: [
        {
          categoryEnabled: true,
          dailyNonCriticalCap: 5,
          deliveredToday: 0,
          enabledChannels: { IN_APP: true, PUSH: true },
          userId: "eligible",
        },
        {
          categoryEnabled: false,
          dailyNonCriticalCap: 5,
          deliveredToday: 0,
          enabledChannels: { IN_APP: true, PUSH: true },
          userId: "opted-out",
        },
        {
          categoryEnabled: true,
          dailyNonCriticalCap: 5,
          deliveredToday: 0,
          enabledChannels: { IN_APP: true, PUSH: true },
          userId: "already-sent",
        },
      ],
      nonCriticalCooldownMinutes: 30,
      notificationId: "notice-1",
      now: new Date("2026-09-27T04:00:00.000Z"),
      priority: "NORMAL",
      timezoneOffsetMinutes: 540,
    });

    expect(plans).toEqual([
      {
        channels: ["IN_APP", "PUSH"],
        deduplicationKey: "notification:notice-1:eligible",
        deliverAt: new Date("2026-09-27T04:00:00.000Z"),
        userId: "eligible",
      },
    ]);
  });
});
