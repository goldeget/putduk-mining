import { describe, expect, it } from "vitest";
import {
  contentCommandSchema,
  isSafeContentCopy,
  noticeContentSchema,
} from "@/domain/content/contract";

const notice = noticeContentSchema.parse({
  slug: "launch-policy-change",
  title: "운영 정책 변경 안내",
  summary: "변경된 이용 조건을 확인해 주세요.",
  body: "현재 적용되는 서비스 조건을 안내합니다.",
  ctaLabel: "이용 안내 보기",
  ctaRoute: "/about",
  audience: "MEMBERS",
  segment: "ALL_MEMBERS",
  publishedAt: null,
  expiresAt: null,
  isPinned: false,
});

describe("member copy versus technical content identity", () => {
  it("accepts an internal slug without weakening the visible-copy gate", () => {
    expect(isSafeContentCopy(notice)).toBe(true);
    expect(
      contentCommandSchema.safeParse({
        operation: "CREATE_DRAFT",
        kind: "NOTICE",
        contentId: null,
        expectedRevision: null,
        expectedDigest: null,
        payload: notice,
        reason: "검토한 안내 원고를 로컬 초안으로 등록합니다.",
        stepUpToken: "a-fresh-command-family-proof",
        confirmation: "CONFIRM_LIVEOPS_CONTENT",
      }).success,
    ).toBe(true);
  });

  it.each(["title", "summary", "body", "ctaLabel"] as const)(
    "still rejects an internal hostname in visible %s",
    (field) => {
      expect(
        isSafeContentCopy({
          ...notice,
          [field]: "admin.mining.putduk.com",
        }),
      ).toBe(false);
    },
  );

  it("keeps unsafe CTA routing outside the copy gate", () => {
    expect(
      noticeContentSchema.safeParse({ ...notice, ctaRoute: "/admin" }).success,
    ).toBe(false);
  });
});
