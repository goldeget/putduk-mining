import { describe, expect, it } from "vitest";
import {
  ADMIN_MENU_ITEMS,
  adminLocation,
  isCurrentAdminItem,
} from "@/components/admin-menu";
import { retiredAdminWorkroomDestination } from "@/lib/workroom/retirement";

describe("active administrator menu routing", () => {
  it("exposes real destinations without the retired content editor", () => {
    const destinations = ADMIN_MENU_ITEMS.map((item) => item.href);
    expect(destinations).toHaveLength(15);
    expect(new Set(destinations).size).toBe(ADMIN_MENU_ITEMS.length);
    expect(destinations).toEqual(
      expect.arrayContaining(["/support", "/notifications"]),
    );
    expect(adminLocation("/support", null)).toEqual({
      group: "운영 지원",
      label: "1:1 문의함",
    });
    expect(adminLocation("/notifications", null)).toEqual({
      group: "운영 지원",
      label: "알림함",
    });
    for (const item of ADMIN_MENU_ITEMS) {
      expect(
        retiredAdminWorkroomDestination(item.href.split("?")[0]!),
        item.href,
      ).toBeNull();
    }
    expect(retiredAdminWorkroomDestination("/content")).toBe("/workroom");
  });
  it("selects one Workroom tab and matches the actual default for invalid tabs", () => {
    for (const tab of [
      "config",
      "invites",
      "users",
      "audit",
      null,
      "unknown",
    ]) {
      const active = ADMIN_MENU_ITEMS.filter((item) =>
        isCurrentAdminItem(item.href, "/workroom", tab),
      );
      expect(active).toHaveLength(1);
      expect(active[0]?.href).toBe(
        `/workroom?tab=${tab && tab !== "unknown" ? tab : "config"}`,
      );
    }
  });
  it("keeps the parent menu selected on a real detail page without prefix collisions", () => {
    expect(adminLocation("/deposits/krw/request-id", null)).toEqual({
      group: "입출금 관리",
      label: "원화 입금 관리",
    });
    expect(isCurrentAdminItem("/members", "/members-unrelated", null)).toBe(
      false,
    );
    expect(adminLocation("/", null).label).toBe("운영 대시보드");
  });
});
