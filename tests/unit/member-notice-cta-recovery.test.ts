import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MemberNoticeCta } from "@/components/product/member-notice-cta";
import { CONTENT_CTA_ROUTES } from "@/domain/content/contract";
import {
  memberNoticeSchema,
  readMemberNoticeCta,
} from "@/domain/content/member-notice";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "notice-one",
  title_ko: "공지",
  summary_ko: "이용 안내",
  body_markdown: "본문",
  status: "PUBLISHED",
  published_at: "2026-10-09T09:00:00+09:00",
  expires_at: null,
  is_pinned: false,
};
const cta = {
  cta_label_ko: "알림 설정 보기",
  cta_route: "/menu/notifications",
  content_revision_id: "22222222-2222-4222-8222-222222222222",
};

describe("sealed member notice CTA", () => {
  it("keeps legacy text readable with absent or all-null CTA", () => {
    for (const legacy of [
      row,
      {
        ...row,
        cta_label_ko: null,
        cta_route: null,
        content_revision_id: null,
      },
    ]) {
      expect(memberNoticeSchema.safeParse(legacy).success).toBe(true);
      expect(readMemberNoticeCta(legacy)).toBeNull();
      expect(
        renderToStaticMarkup(
          createElement(MemberNoticeCta, { notice: legacy }),
        ),
      ).toBe("");
    }
  });
  it.each(CONTENT_CTA_ROUTES)(
    "uses the exact existing approved route %s",
    (route) => {
      const notice = { ...row, ...cta, cta_route: route };
      expect(memberNoticeSchema.safeParse(notice).success).toBe(true);
      expect(readMemberNoticeCta(notice)).toEqual({
        label: cta.cta_label_ko,
        route,
      });
      const html = renderToStaticMarkup(
        createElement(MemberNoticeCta, { notice }),
      );
      expect(html).toContain(`href="${route}"`);
      expect(html).toContain("알림 설정 보기");
    },
  );
  it.each([
    "https://evil.invalid",
    "//evil.invalid",
    "/wallet?token=secret",
    "/events#x",
    "/%77allet",
    "/admin",
    "/api/v1/wallet",
    "/menu\\account",
    "/events/../wallet",
  ])("fails closed on route %s", (route) => {
    const notice = { ...row, ...cta, cta_route: route };
    expect(memberNoticeSchema.safeParse(notice).success).toBe(false);
    expect(
      renderToStaticMarkup(createElement(MemberNoticeCta, { notice })),
    ).toBe("");
  });
  it("rejects each partial source binding and malformed labels/revisions", () => {
    for (const patch of [
      { cta_label_ko: null },
      { cta_route: null },
      { content_revision_id: null },
      { cta_label_ko: " " },
      { cta_label_ko: "가".repeat(81) },
      { content_revision_id: "not-a-uuid" },
    ]) {
      const notice = { ...row, ...cta, ...patch };
      expect(memberNoticeSchema.safeParse(notice).success).toBe(false);
      expect(readMemberNoticeCta(notice)).toBeNull();
    }
  });
  it("renders member labels as escaped text, never HTML", () => {
    const notice = { ...row, ...cta, cta_label_ko: "<img src=x>" };
    const html = renderToStaticMarkup(
      createElement(MemberNoticeCta, { notice }),
    );
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).not.toContain("<img");
  });
});
