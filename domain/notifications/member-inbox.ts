import { safeNotificationDeepLink } from "./safe-deep-link";

/** 멤버 알림 센터에 노출하는 읽기 전용 행. */
export type MemberNotificationRow = {
  body_ko: string;
  category: string;
  created_at: string;
  expires_at: string | null;
  id: string;
  read_at: string | null;
  route: string | null;
  title_ko: string;
};

const CATEGORY_LABELS_KO: Readonly<Record<string, string>> = {
  events: "이벤트",
  marketing: "혜택과 소식",
  mining: "채굴",
  service: "중요 안내",
  wallet: "자산",
};

/**
 * 서버 시각 기준으로 아직 유효한 인앱 알림만 남긴다.
 * 만료된 행은 멤버 UI 진실에서 제외한다.
 */
export function isActiveMemberNotification(
  notification: Pick<MemberNotificationRow, "expires_at">,
  now: Date,
): boolean {
  if (!notification.expires_at) {
    return true;
  }
  const expiresAt = Date.parse(notification.expires_at);
  if (!Number.isFinite(expiresAt)) {
    return false;
  }
  return expiresAt > now.getTime();
}

export function filterActiveMemberNotifications<
  T extends Pick<MemberNotificationRow, "expires_at">,
>(notifications: readonly T[], now: Date): T[] {
  return notifications.filter((notification) =>
    isActiveMemberNotification(notification, now),
  );
}

/**
 * 목록 limit 앞에 붙이는 PostgREST or 조건.
 * 기준은 서버 시각 now 이다. expires_at 이 없거나 now 보다 이후인 행만 남긴다.
 * 만료 행을 먼저 걸러야 최신 만료 행이 limit 슬롯을 차지하지 않는다.
 */
export function activeMemberNotificationExpiryOr(now: Date): string {
  return `expires_at.is.null,expires_at.gt.${now.toISOString()}`;
}

export function notificationCategoryLabelKo(category: string): string {
  return CATEGORY_LABELS_KO[category] ?? "알림";
}

/**
 * 저장된 route가 allowlist 밖이면 링크를 숨긴다.
 * Web Push/토스트가 아닌 인앱 알림 행의 안전 딥링크만 반환한다.
 */
export function resolveSafeNotificationRoute(
  route: string | null | undefined,
): string | null {
  if (!route) {
    return null;
  }
  return safeNotificationDeepLink(route);
}

export function countUnreadMemberNotifications(
  notifications: readonly Pick<MemberNotificationRow, "read_at">[],
): number {
  return notifications.reduce(
    (total, notification) => total + (notification.read_at ? 0 : 1),
    0,
  );
}
