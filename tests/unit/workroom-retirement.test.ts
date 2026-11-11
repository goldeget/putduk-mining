import { describe, expect, it } from "vitest";
import {
  isRetiredAdminWorkroomCommand,
  retiredAdminWorkroomDestination,
} from "@/apps/admin/lib/workroom/retirement";
import {
  legacyWorkroomDestination,
  isRetiredWorkroomMutation,
} from "@/lib/workroom/retirement";
import {
  isSafeProtectedReturnPath,
  safeProtectedReturnPath,
} from "@/lib/auth/return-path";
describe("WORKROOM replacement boundaries", () => {
  it("preserves old wallet and withdrawal bookmarks including failed-read retries", () => {
    expect(legacyWorkroomDestination("/wallet")).toBe("/workroom/cash");
    expect(legacyWorkroomDestination("/wallet/withdraw")).toBe(
      "/workroom/cash/withdraw",
    );
  });
  it("closes legacy operator publishing while preserving pending financial processing", () => {
    expect(
      isRetiredAdminWorkroomCommand("/api/v1/admin/economy/command", "POST"),
    ).toBe(true);
    expect(
      isRetiredAdminWorkroomCommand("/api/v1/admin/catalog/command", "POST"),
    ).toBe(true);
    expect(
      isRetiredAdminWorkroomCommand(
        "/api/v1/admin/withdrawals/command",
        "POST",
      ),
    ).toBe(false);
    expect(
      isRetiredAdminWorkroomCommand("/api/v1/admin/deposits/approve", "POST"),
    ).toBe(false);
    expect(retiredAdminWorkroomDestination("/economy")).toBe("/workroom");
    expect(retiredAdminWorkroomDestination("/withdrawals/krw-bank")).toBeNull();
  });
  it("replaces old mining entry links without matching unrelated paths", () => {
    for (const p of [
      "/home",
      "/start",
      "/mining",
      "/products",
      "/products/allocation",
    ])
      expect(legacyWorkroomDestination(p)).toBe("/workroom");
    expect(legacyWorkroomDestination("/wallet/deposit")).toBe(
      "/workroom/cash/deposit",
    );
    expect(legacyWorkroomDestination("/api/v1/workroom/state")).toBeNull();
  });
  it("retires new legacy mining effects while retaining historical financial reads", () => {
    expect(isRetiredWorkroomMutation("/api/v1/trial/start", "POST")).toBe(true);
    expect(
      isRetiredWorkroomMutation("/api/v1/products/allocation", "POST"),
    ).toBe(true);
    expect(isRetiredWorkroomMutation("/api/v1/wallet/summary", "GET")).toBe(
      false,
    );
    expect(
      isRetiredWorkroomMutation("/api/v1/withdrawals/intents", "POST"),
    ).toBe(false);
    expect(isRetiredWorkroomMutation("/api/v1/trial/convert", "POST")).toBe(
      true,
    );
  });
  it("allows separate cash deposits but retires old cash event enrollment", () => {
    for (const path of ["/api/v1/deposits", "/api/v1/deposits/usdt"])
      expect(isRetiredWorkroomMutation(path, "POST")).toBe(false);
    for (const path of ["/api/v1/events/participation", "/api/v1/ai/chat"]) {
      expect(isRetiredWorkroomMutation(path, "POST")).toBe(true);
      expect(isRetiredWorkroomMutation(path, "GET")).toBe(false);
    }
  });
  it("allows only owned same-site workroom return links", () => {
    expect(isSafeProtectedReturnPath("/workroom/history")).toBe(true);
    expect(isSafeProtectedReturnPath("//evil.example/workroom")).toBe(false);
    expect(safeProtectedReturnPath(null)).toBe("/workroom");
  });
});
