import { describe, expect, it } from "vitest";

import {
  countUnreadMemberNotifications,
  filterActiveMemberNotifications,
  isActiveMemberNotification,
  notificationCategoryLabelKo,
  resolveSafeNotificationRoute,
} from "@/domain/notifications/member-inbox";

const now = new Date("2026-09-29T06:00:00.000Z");

describe("member notification inbox", () => {
  it("keeps non-expired notifications and drops expired ones", () => {
    const rows = [
      { expires_at: null },
      { expires_at: "2026-09-29T07:00:00.000Z" },
      { expires_at: "2026-09-29T05:00:00.000Z" },
      { expires_at: "not-a-date" },
    ];

    expect(filterActiveMemberNotifications(rows, now)).toEqual([
      { expires_at: null },
      { expires_at: "2026-09-29T07:00:00.000Z" },
    ]);
    expect(isActiveMemberNotification(rows[2]!, now)).toBe(false);
  });

  it("counts unread rows only", () => {
    expect(
      countUnreadMemberNotifications([
        { read_at: null },
        { read_at: "2026-09-29T05:00:00.000Z" },
        { read_at: null },
      ]),
    ).toBe(2);
  });

  it("maps known categories to Korean labels", () => {
    expect(notificationCategoryLabelKo("mining")).toBe("채굴");
    expect(notificationCategoryLabelKo("wallet")).toBe("자산");
    expect(notificationCategoryLabelKo("unknown_bucket")).toBe("알림");
  });

  it("exposes only allowlisted internal deep links", () => {
    expect(resolveSafeNotificationRoute("/wallet/deposit")).toBe(
      "/wallet/deposit",
    );
    expect(resolveSafeNotificationRoute("/notifications")).toBe(
      "/notifications",
    );
    expect(resolveSafeNotificationRoute("https://evil.example/home")).toBe(
      null,
    );
    expect(resolveSafeNotificationRoute("//evil.example")).toBe(null);
    expect(resolveSafeNotificationRoute("/login")).toBe(null);
    expect(resolveSafeNotificationRoute(null)).toBe(null);
  });
});
