import { describe, expect, it } from "vitest";
import {
  memberNoticeSchema,
  noticeTextBlocks,
} from "@/domain/content/member-notice";
import {
  isMemberVisibleEvent,
  isMemberVisibleNotice,
  sortMemberNotices,
} from "@/domain/events/member-read-model";

describe("member notice recovery", () => {
  it("keeps HTML and links as inert text while preserving Korean paragraphs", () => {
    const blocks = noticeTextBlocks(
      "## 이용 안내\r\n\r\n첫 문단\r\n다음 줄\r\n\r\n- 알림 설정\r\n- 참여 조건\r\n\r\n<script>alert(1)</script> [외부](https://evil.invalid)",
    );
    expect(blocks).toEqual([
      { kind: "heading", lines: ["이용 안내"] },
      { kind: "paragraph", lines: ["첫 문단", "다음 줄"] },
      { kind: "list", lines: ["알림 설정", "참여 조건"] },
      {
        kind: "paragraph",
        lines: ["<script>alert(1)</script> [외부](https://evil.invalid)"],
      },
    ]);
  });
  it("rejects oversized body, private states and malformed safe slugs", () => {
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
    expect(memberNoticeSchema.safeParse(row).success).toBe(true);
    for (const patch of [
      { body_markdown: "가".repeat(20001) },
      { status: "DRAFT" },
      { slug: "../private" },
      { published_at: "invalid" },
    ]) {
      expect(memberNoticeSchema.safeParse({ ...row, ...patch }).success).toBe(
        false,
      );
    }
  });
  it("compares timestamps by instant across offsets and rejects invalid clocks", () => {
    const now = "2026-10-09T00:00:00Z";
    const notice = {
      status: "PUBLISHED",
      published_at: "2026-10-09T08:59:59+09:00",
      expires_at: "2026-10-09T09:00:01+09:00",
    };
    expect(isMemberVisibleNotice(notice, now)).toBe(true);
    expect(
      isMemberVisibleNotice(
        { ...notice, expires_at: "2026-10-09T09:00:00+09:00" },
        now,
      ),
    ).toBe(false);
    expect(
      isMemberVisibleNotice({ ...notice, expires_at: "broken" }, now),
    ).toBe(false);
    expect(
      isMemberVisibleEvent(
        { status: "LIVE", published_at: notice.published_at },
        now,
      ),
    ).toBe(true);
    expect(
      isMemberVisibleEvent({ status: "LIVE", published_at: "broken" }, now),
    ).toBe(false);
    expect(isMemberVisibleNotice(notice, "broken")).toBe(false);
  });
  it("sorts equal pin priority by real time rather than timestamp spelling", () => {
    const common = {
      id: "one",
      slug: "one",
      title_ko: "공지",
      summary_ko: "안내",
      status: "PUBLISHED",
      is_pinned: false,
      expires_at: null,
    };
    const first = { ...common, published_at: "2026-10-09T01:00:00+09:00" };
    const second = {
      ...common,
      id: "two",
      published_at: "2026-10-08T20:00:00Z",
    };
    expect(sortMemberNotices([first, second]).map((item) => item.id)).toEqual([
      "two",
      "one",
    ]);
  });
});
