import { describe, expect, it } from "vitest";

import { MENU_ITEMS } from "@/app/(product)/menu/menu-items";
import {
  maskEmail,
  maskPhone,
} from "@/app/(product)/menu/account/account-mask";
import {
  buildLoginPath,
  isSafeProtectedReturnPath,
} from "@/lib/auth/return-path";

describe("menu hub navigation", () => {
  it("exposes account, notification center, and settings routes", () => {
    const hrefs = MENU_ITEMS.map((item) => item.href);
    expect(hrefs).toContain("/menu/account");
    expect(hrefs).toContain("/notifications");
    expect(hrefs).toContain("/menu/notifications");
    expect(hrefs).toContain("/ai");
    expect(hrefs).toContain("/support");
    expect(hrefs).toContain("/events");
  });

  it("keeps Korean labels free of developer jargon", () => {
    for (const item of MENU_ITEMS) {
      expect(item.label).not.toMatch(/API|RPC|RLS|JWT|schema/i);
      expect(item.description).not.toMatch(/API|RPC|RLS|JWT|schema/i);
      expect(item.description.length).toBeLessThan(40);
    }
  });
});

describe("account masking", () => {
  it("masks email local-part while keeping the domain", () => {
    expect(maskEmail("putduk.member@example.com")).toBe("pu••••••@example.com");
    expect(maskEmail("ab@example.com")).toBe("ab••@example.com");
    expect(maskEmail("not-an-email")).toBe("등록됨");
  });

  it("shows only the last four phone digits", () => {
    expect(maskPhone("+821012345678")).toBe("••• •••• 5678");
    expect(maskPhone("12")).toBe("등록됨");
  });
});

describe("menu protected return paths", () => {
  it.each(["/menu", "/menu/account", "/menu/notifications", "/menu/ai"])(
    "preserves menu return path: %s",
    (path) => {
      expect(isSafeProtectedReturnPath(path)).toBe(true);
      expect(buildLoginPath(path)).toBe(
        `/login?next=${encodeURIComponent(path)}`,
      );
    },
  );
});
