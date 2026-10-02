import { describe, expect, it } from "vitest";

import {
  activeMemberNotificationExpiryOr,
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
    expect(isActiveMemberNotification(rows[1]!, now)).toBe(true);
    expect(
      isActiveMemberNotification(
        { expires_at: "2026-09-29T06:00:00.000Z" },
        now,
      ),
    ).toBe(false);
  });

  it("builds an expiry predicate that must run before limit", () => {
    expect(activeMemberNotificationExpiryOr(now)).toBe(
      "expires_at.is.null,expires_at.gt.2026-09-29T06:00:00.000Z",
    );

    const newestFirst = [
      {
        id: "expired-newer-1",
        expires_at: "2026-09-29T05:50:00.000Z",
      },
      {
        id: "expired-newer-2",
        expires_at: "2026-09-29T05:40:00.000Z",
      },
      {
        id: "expired-event",
        expires_at: "2026-09-29T05:30:00.000Z",
      },
      { id: "older-active", expires_at: null },
    ];

    expect(
      filterActiveMemberNotifications(newestFirst, now)
        .slice(0, 3)
        .map((row) => row.id),
    ).toEqual(["older-active"]);
    expect(
      filterActiveMemberNotifications(newestFirst.slice(0, 3), now),
    ).toEqual([]);
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
