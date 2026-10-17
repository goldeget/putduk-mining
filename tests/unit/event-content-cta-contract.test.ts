import { describe, expect, it } from "vitest";

import { eventContentSchema } from "@/domain/content/contract";
import { memberEventContentSchema } from "@/domain/events/participation";
import { safeNotificationDeepLink } from "@/domain/notifications/safe-deep-link";
import { getTrustDocument } from "@/lib/trust/public-content";

const id = "11111111-1111-4111-8111-111111111111";
const memberContent = {
  event_id: id,
  revision_id: id,
  body_ko: "안내를 읽고 필요한 화면에서 확인하세요.",
  participation_ko: "안내를 확인하세요.",
  exclusion_ko: "본인 계정으로 이용하세요.",
  cta_label: "안내 보기",
  reward_mode: "NONE",
};
const publishedContent = {
  slug: "guide-content-cta",
  title: "이용 안내",
  cardTitle: "이용 전에 확인하세요",
  summary: "관련 도움말을 확인하세요.",
  body: memberContent.body_ko,
  participation: memberContent.participation_ko,
  exclusion: memberContent.exclusion_ko,
  ctaLabel: memberContent.cta_label,
  audience: "MEMBERS",
  segment: "ALL_MEMBERS",
  rewardMode: "NONE",
  startsAt: "2026-10-11T00:00:00Z",
  endsAt: "2026-10-12T00:00:00Z",
};

describe("event content CTA contract", () => {
  it.each(["/status", "/changelog", "/faq"])(
    "preserves approved %s content through the member projection",
    (route) => {
      expect(getTrustDocument(route)?.path).toBe(route);
      expect(
        eventContentSchema.safeParse({ ...publishedContent, ctaRoute: route })
          .success,
      ).toBe(true);
      const projection = memberEventContentSchema.safeParse({
        ...memberContent,
        cta_route: route,
      });
      expect(projection.success).toBe(true);
      if (projection.success) {
        expect(projection.data.body_ko).toBe(memberContent.body_ko);
        expect(projection.data.cta_route).toBe(route);
      }
    },
  );

  it.each(["/events", "/wallet", "/support"])(
    "retains existing %s content navigation",
    (route) => {
      expect(
        memberEventContentSchema.safeParse({
          ...memberContent,
          cta_route: route,
        }).success,
      ).toBe(true);
    },
  );

  it.each([
    "https://evil.invalid/faq",
    "https://admin.mining.putduk.com/",
    "//evil.invalid",
    "javascript:alert(1)",
    "/admin",
    "/api/v1/withdrawals/hold",
    "/faq?redirect=//evil.invalid",
    "/faq#private",
    "/%66aq",
    "/faq/../admin",
    "/faq\\admin",
    "/faq\n",
    " /faq",
    "/unknown",
    "/products/allocation",
    "/ai",
  ])("rejects unapproved or unsafe content CTA %s", (route) => {
    expect(
      memberEventContentSchema.safeParse({
        ...memberContent,
        cta_route: route,
      }).success,
    ).toBe(false);
    expect(
      eventContentSchema.safeParse({ ...publishedContent, ctaRoute: route })
        .success,
    ).toBe(false);
  });

  it.each(["/status", "/changelog", "/faq"])(
    "keeps %s outside notification delivery navigation",
    (route) => {
      expect(safeNotificationDeepLink(route)).toBeNull();
    },
  );

  it("preserves the independently approved notification routes", () => {
    expect(safeNotificationDeepLink("/support")).toBe("/support");
    expect(safeNotificationDeepLink("/products/allocation")).toBe(
      "/products/allocation",
    );
    expect(safeNotificationDeepLink("/ai")).toBe("/ai");
  });

  it("keeps legacy projections compatible without inventing a participation mode", () => {
    const result = memberEventContentSchema.parse({
      ...memberContent,
      cta_route: "/events",
    });
    expect(result.participation_mode).toBeUndefined();
  });

  it.each(["GUIDE", "JOIN"])(
    "preserves the server-projected %s participation mode",
    (mode) => {
      expect(
        memberEventContentSchema.parse({
          ...memberContent,
          cta_route: "/events",
          participation_mode: mode,
        }).participation_mode,
      ).toBe(mode);
    },
  );

  it.each(["CASH_REWARD", "guide", null])(
    "rejects invalid participation mode %s",
    (mode) => {
      expect(
        memberEventContentSchema.safeParse({
          ...memberContent,
          cta_route: "/events",
          participation_mode: mode,
        }).success,
      ).toBe(false);
    },
  );
});
