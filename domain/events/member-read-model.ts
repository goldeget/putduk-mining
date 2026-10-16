/**
 * 회원 Events/공지 읽기 모델.
 * 서버 시각·RLS가 권위다. 이 모듈은 표시용 분류와 매핑만 담당한다.
 *
 * 게시 생명주기 불일치(재설계하지 않음, 감사만):
 * - 카탈로그: DRAFT → APPROVED → PUBLISHED → RETIRED
 * - 프로모션: DRAFT/APPROVED/SCHEDULED/ACTIVE/PAUSED/ENDED/CANCELLED
 * - events.event_status: DRAFT/SCHEDULED/LIVE/ENDED/CANCELLED + published_at
 * - notices.content_status: DRAFT/PUBLISHED/ARCHIVED + published_at/expires_at
 */

import type { ProductStatusTone } from "@/components/product/product-status-pill";

export const MEMBER_VISIBLE_EVENT_STATUSES = [
  "LIVE",
  "SCHEDULED",
  "ENDED",
] as const;

export type MemberVisibleEventStatus =
  (typeof MEMBER_VISIBLE_EVENT_STATUSES)[number];

export type EventParticipantStatus =
  "JOINED" | "COMPLETED" | "REWARDED" | "DISQUALIFIED";

export type MemberEventRow = {
  ends_at: string;
  id: string;
  published_at: string | null;
  slug: string;
  starts_at: string;
  status: string;
  summary_ko: string;
  title_ko: string;
};

export type MemberNoticeRow = {
  expires_at: string | null;
  id: string;
  is_pinned: boolean;
  published_at: string | null;
  slug: string;
  status: string;
  summary_ko: string;
  title_ko: string;
};

export type MemberParticipantRow = {
  completed_at: string | null;
  event_id: string;
  joined_at: string;
  rewarded_at: string | null;
  status: string;
};

export const eventStatusCopy: Record<
  MemberVisibleEventStatus | "CANCELLED",
  { label: string; tone: ProductStatusTone }
> = {
  LIVE: { label: "진행 중", tone: "success" },
  SCHEDULED: { label: "예정", tone: "info" },
  ENDED: { label: "종료", tone: "neutral" },
  CANCELLED: { label: "취소", tone: "danger" },
};

export const participantCopy: Record<EventParticipantStatus, string> = {
  JOINED: "참여 중",
  COMPLETED: "조건 달성",
  REWARDED: "보상 반영 완료",
  DISQUALIFIED: "참여 조건 확인 필요",
};

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});

export function formatEventWindow(startsAt: string, endsAt: string): string {
  return `${dateFormatter.format(new Date(startsAt))} – ${dateFormatter.format(
    new Date(endsAt),
  )}`;
}

export function formatNoticePublishedAt(publishedAt: string): string {
  return dateFormatter.format(new Date(publishedAt));
}

/** RLS와 동일한 회원 가시성 규칙을 순수 함수로 재현한다(테스트·방어적 필터). */
export function isMemberVisibleEvent(
  event: Pick<MemberEventRow, "published_at" | "status">,
  nowIso: string,
): boolean {
  if (!event.published_at) {
    return false;
  }
  const now = Date.parse(nowIso);
  const published = Date.parse(event.published_at);
  if (!Number.isFinite(now) || !Number.isFinite(published) || published > now) {
    return false;
  }
  return (MEMBER_VISIBLE_EVENT_STATUSES as readonly string[]).includes(
    event.status,
  );
}

export function isMemberVisibleNotice(
  notice: Pick<MemberNoticeRow, "expires_at" | "published_at" | "status">,
  nowIso: string,
): boolean {
  if (notice.status !== "PUBLISHED" || !notice.published_at) {
    return false;
  }
  const now = Date.parse(nowIso);
  const published = Date.parse(notice.published_at);
  if (!Number.isFinite(now) || !Number.isFinite(published) || published > now) {
    return false;
  }
  if (notice.expires_at !== null) {
    const expires = Date.parse(notice.expires_at);
    if (!Number.isFinite(expires) || expires <= now) return false;
  }
  return true;
}

export function filterMemberVisibleEvents(
  events: readonly MemberEventRow[],
  nowIso: string,
): MemberEventRow[] {
  return events.filter((event) => isMemberVisibleEvent(event, nowIso));
}

export function filterMemberVisibleNotices(
  notices: readonly MemberNoticeRow[],
  nowIso: string,
): MemberNoticeRow[] {
  return notices.filter((notice) => isMemberVisibleNotice(notice, nowIso));
}

export function sortMemberNotices(
  notices: readonly MemberNoticeRow[],
): MemberNoticeRow[] {
  return [...notices].sort((left, right) => {
    if (left.is_pinned !== right.is_pinned) {
      return left.is_pinned ? -1 : 1;
    }
    const leftPublished = left.published_at ?? "";
    const rightPublished = right.published_at ?? "";
    return (Date.parse(rightPublished) || 0) - (Date.parse(leftPublished) || 0);
  });
}

export function selectFeaturedEvent(
  events: readonly MemberEventRow[],
): MemberEventRow | undefined {
  return (
    events.find((event) => event.status === "LIVE") ??
    events.find((event) => event.status === "SCHEDULED") ??
    events[0]
  );
}

export function mapOwnParticipantsByEvent(
  participants: readonly MemberParticipantRow[],
  viewerUserId: string,
  participantUserIdByRow?: ReadonlyMap<string, string>,
): Map<string, MemberParticipantRow> {
  const map = new Map<string, MemberParticipantRow>();
  for (const participant of participants) {
    if (participantUserIdByRow) {
      const owner = participantUserIdByRow.get(participant.event_id);
      if (owner && owner !== viewerUserId) {
        continue;
      }
    }
    map.set(participant.event_id, participant);
  }
  return map;
}

export function participantStatusLabel(
  status: string | undefined,
): string | null {
  if (!status) {
    return null;
  }
  return participantCopy[status as EventParticipantStatus] ?? null;
}

export function eventStatusPresentation(status: string): {
  label: string;
  tone: ProductStatusTone;
} {
  return (
    eventStatusCopy[status as MemberVisibleEventStatus | "CANCELLED"] ?? {
      label: "상태 확인 중",
      tone: "neutral",
    }
  );
}

/**
 * 승인된 운영 이벤트 콘텐츠가 없을 때 화면은 빈 상태를 유지한다.
 * 보상·일정·카피를 추측해 채우지 않는다.
 */
export const EVENTS_CONTENT_HUMAN_DECISION =
  "HUMAN_DECISION_REQUIRED: approved production event/notice content absent; do not invent rewards, dates, or copy.";
