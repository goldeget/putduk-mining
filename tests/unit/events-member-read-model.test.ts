import { describe, expect, it } from "vitest";

import {
  EVENTS_CONTENT_HUMAN_DECISION,
  eventStatusPresentation,
  filterMemberVisibleEvents,
  filterMemberVisibleNotices,
  formatEventWindow,
  isMemberVisibleEvent,
  isMemberVisibleNotice,
  mapOwnParticipantsByEvent,
  participantStatusLabel,
  selectFeaturedEvent,
  sortMemberNotices,
} from "@/domain/events/member-read-model";

const nowIso = "2026-09-29T06:00:00.000Z";

const baseEvent = {
  ends_at: "2026-10-10T00:00:00.000Z",
  id: "11111111-1111-4111-8111-111111111111",
  published_at: "2026-09-01T00:00:00.000Z",
  slug: "live-sample",
  starts_at: "2026-09-20T00:00:00.000Z",
  status: "LIVE",
  summary_ko: "요약",
  title_ko: "진행 이벤트",
};

describe("events member read model", () => {
  it("excludes draft, cancelled, future-published, and unpublished events", () => {
    expect(
      isMemberVisibleEvent(
        { ...baseEvent, status: "DRAFT", published_at: null },
        nowIso,
      ),
    ).toBe(false);
    expect(
      isMemberVisibleEvent({ ...baseEvent, status: "CANCELLED" }, nowIso),
    ).toBe(false);
    expect(
      isMemberVisibleEvent(
        {
          ...baseEvent,
          published_at: "2026-09-30T00:00:00.000Z",
        },
        nowIso,
      ),
    ).toBe(false);

    const visible = filterMemberVisibleEvents(
      [
        baseEvent,
        {
          ...baseEvent,
          id: "22222222-2222-4222-8222-222222222222",
          slug: "scheduled-sample",
          status: "SCHEDULED",
          title_ko: "예정 이벤트",
        },
        {
          ...baseEvent,
          id: "33333333-3333-4333-8333-333333333333",
          slug: "ended-sample",
          status: "ENDED",
          title_ko: "종료 이벤트",
        },
        {
          ...baseEvent,
          id: "44444444-4444-4444-8444-444444444444",
          published_at: null,
          slug: "draft-sample",
          status: "DRAFT",
          title_ko: "초안",
        },
      ],
      nowIso,
    );
    expect(visible.map((event) => event.status)).toEqual([
      "LIVE",
      "SCHEDULED",
      "ENDED",
    ]);
  });

  it("excludes archived, draft, and expired notices while keeping pinned order", () => {
    expect(
      isMemberVisibleNotice(
        {
          expires_at: null,
          published_at: null,
          status: "DRAFT",
        },
        nowIso,
      ),
    ).toBe(false);
    expect(
      isMemberVisibleNotice(
        {
          expires_at: "2026-09-28T00:00:00.000Z",
          published_at: "2026-09-01T00:00:00.000Z",
          status: "PUBLISHED",
        },
        nowIso,
      ),
    ).toBe(false);

    const notices = filterMemberVisibleNotices(
      [
        {
          expires_at: null,
          id: "n1",
          is_pinned: false,
          published_at: "2026-09-20T00:00:00.000Z",
          slug: "normal",
          status: "PUBLISHED",
          summary_ko: "일반",
          title_ko: "일반 공지",
        },
        {
          expires_at: null,
          id: "n2",
          is_pinned: true,
          published_at: "2026-09-10T00:00:00.000Z",
          slug: "pinned",
          status: "PUBLISHED",
          summary_ko: "중요",
          title_ko: "중요 공지",
        },
        {
          expires_at: "2026-09-01T00:00:00.000Z",
          id: "n3",
          is_pinned: true,
          published_at: "2026-08-01T00:00:00.000Z",
          slug: "expired",
          status: "PUBLISHED",
          summary_ko: "만료",
          title_ko: "만료 공지",
        },
        {
          expires_at: null,
          id: "n4",
          is_pinned: false,
          published_at: "2026-09-01T00:00:00.000Z",
          slug: "archived",
          status: "ARCHIVED",
          summary_ko: "보관",
          title_ko: "보관 공지",
        },
      ],
      nowIso,
    );
    expect(sortMemberNotices(notices).map((notice) => notice.slug)).toEqual([
      "pinned",
      "normal",
    ]);
  });

  it("prefers LIVE then SCHEDULED for the featured slot", () => {
    const featured = selectFeaturedEvent([
      {
        ...baseEvent,
        id: "ended",
        status: "ENDED",
        title_ko: "종료",
      },
      {
        ...baseEvent,
        id: "scheduled",
        status: "SCHEDULED",
        title_ko: "예정",
      },
      {
        ...baseEvent,
        id: "live",
        status: "LIVE",
        title_ko: "진행",
      },
    ]);
    expect(featured?.id).toBe("live");
  });

  it("keeps only the viewer participant rows when ownership metadata is supplied", () => {
    const map = mapOwnParticipantsByEvent(
      [
        {
          completed_at: null,
          event_id: "e1",
          joined_at: nowIso,
          rewarded_at: null,
          status: "JOINED",
        },
        {
          completed_at: null,
          event_id: "e2",
          joined_at: nowIso,
          rewarded_at: null,
          status: "REWARDED",
        },
      ],
      "viewer",
      new Map([
        ["e1", "viewer"],
        ["e2", "other"],
      ]),
    );
    expect(map.has("e1")).toBe(true);
    expect(map.has("e2")).toBe(false);
    expect(participantStatusLabel("JOINED")).toBe("참여 중");
    expect(participantStatusLabel("UNKNOWN")).toBeNull();
  });

  it("formats Korean windows and presents status labels without inventing content", () => {
    expect(formatEventWindow(baseEvent.starts_at, baseEvent.ends_at)).toMatch(
      /\d/,
    );
    expect(eventStatusPresentation("LIVE")).toEqual({
      label: "진행 중",
      tone: "success",
    });
    expect(EVENTS_CONTENT_HUMAN_DECISION).toContain("HUMAN_DECISION_REQUIRED");
  });
});
