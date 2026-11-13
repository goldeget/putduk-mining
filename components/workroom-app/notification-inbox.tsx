"use client";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import {
  WorkroomAppInboxPageSchema,
  WorkroomAppNotificationResultSchema,
  type NotificationItem,
} from "../../lib/workroom-app/contract";
import {
  appCommand,
  appEndpoint,
  appRequest,
  dateLabel,
  inboxChanged,
  useVisibleResource,
} from "./client";
import styles from "./workroom-app.module.css";
import { mergeInboxPage } from "./pagination";
import { safeNotificationDeepLink } from "../../domain/notifications/safe-deep-link.mjs";
import { PutdukIcon } from "../icons/putduk-icon";

export function notificationRoute(route: string, admin: boolean) {
  if (route === "/notifications") return route;
  const uuid =
    "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  if (
    new RegExp(
      `^${admin ? "/support" : "/workroom/support"}\\?thread=${uuid}$`,
      "i",
    ).test(route)
  )
    return route;
  if (admin && new RegExp(`^/deposits/krw/${uuid}$`, "i").test(route))
    return route;
  if (
    !admin &&
    new RegExp(`^/workroom/history\\?round=${uuid}$`, "i").test(route)
  )
    return route;
  const member = [
    "/workroom",
    "/workroom/history",
    "/workroom/cash",
    "/workroom/records",
    "/menu/account",
    "/menu/notifications",
    "/events",
    "/notices",
  ];
  const operator = [
    "/support",
    "/workroom",
    "/members",
    "/deposits/krw",
    "/deposits/usdt",
    "/withdrawals/krw-bank",
    "/withdrawals/usdt",
  ];
  return admin
    ? operator.includes(route)
      ? route
      : null
    : (safeNotificationDeepLink(route) ??
        (member.includes(route) ? route : null));
}
export function NotificationInbox({ admin = false }: { admin?: boolean }) {
  const endpoint = appEndpoint(admin);
  const resource = useVisibleResource(
    `${endpoint}?operation=NOTIFICATIONS_READ&limit=30`,
    WorkroomAppInboxPageSchema,
    mergeInboxPage,
  );
  const [older, setOlder] = useState<NotificationItem[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [paging, setPaging] = useState(false);
  const retries = useState(() => new Map<string, string>())[0];
  const items = [...(resource.data?.items ?? []), ...older].filter(
    (item, index, all) =>
      all.findIndex((other) => other.id === item.id) === index,
  );
  const next = cursor === undefined ? resource.data?.nextCursor : cursor;
  async function markRead(item: NotificationItem) {
    setPending(item.id);
    setError("");
    const key = retries.get(item.id) ?? crypto.randomUUID();
    retries.set(item.id, key);
    try {
      const result = await appCommand(
        admin,
        "NOTIFICATION_READ",
        { id: item.id },
        key,
        WorkroomAppNotificationResultSchema,
      );
      setOlder((previous) =>
        previous.map((row) => (row.id === item.id ? result.item : row)),
      );
      retries.delete(item.id);
      resource.refresh();
      window.dispatchEvent(new Event(inboxChanged));
    } catch {
      setError("읽음 상태를 저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setPending(null);
    }
  }
  async function more() {
    if (!next || paging) return;
    setPaging(true);
    setError("");
    try {
      const result = await appRequest(
        `${endpoint}?operation=NOTIFICATIONS_READ&limit=30&cursor=${next}`,
        WorkroomAppInboxPageSchema,
      );
      setOlder((previous) => [...previous, ...result.items]);
      setCursor(result.nextCursor);
    } catch {
      setError("이전 알림을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      setPaging(false);
    }
  }
  if (resource.authorizationLost)
    return (
      <section className={`${styles.app} ${styles.authNotice}`} role="alert">
        <h1>로그인 상태를 확인해 주세요</h1>
        <p>보안을 위해 알림 내용을 닫았어요. 다시 로그인한 뒤 확인해 주세요.</p>
        <a
          href={
            admin
              ? "/login?returnTo=%2Fnotifications"
              : "/login?next=%2Fnotifications"
          }
        >
          로그인
        </a>
      </section>
    );
  return (
    <section className={styles.app} data-ui-ready="/notifications">
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>WORKROOM INBOX</span>
          <h1>알림함</h1>
          <p>
            {resource.data
              ? resource.data.unreadCount > 0
                ? `미확인 알림 ${resource.data.unreadCount.toLocaleString("ko-KR")}개가 있어요.`
                : "도착한 알림을 모두 확인했어요."
              : "워크룸과 문의 소식을 한곳에서 확인하세요."}
          </p>
        </div>
        <div className={styles.actions}>
          <button className={styles.secondary} onClick={resource.refresh}>
            새로고침
          </button>
          {!admin ? (
            <Link
              className={styles.secondary}
              href={"/menu/notifications" as Route}
            >
              알림 설정
            </Link>
          ) : null}
        </div>
      </header>
      {resource.error || error ? (
        <p className={styles.error} role="alert">
          {error || resource.error}
        </p>
      ) : null}
      {resource.loading && !resource.data ? (
        <p className={styles.empty} role="status">
          알림을 불러오는 중이에요.
        </p>
      ) : null}
      {!resource.loading && !resource.error && items.length === 0 ? (
        <div className={`${styles.panel} ${styles.empty}`}>
          <span className={styles.introIcon} aria-hidden="true">
            <PutdukIcon name="bell" size={25} />
          </span>
          <h2>아직 도착한 알림이 없어요</h2>
          <p>참여 종료와 문의 답변 등 필요한 소식이 이곳에 쌓여요.</p>
          <a href={admin ? "/support" : "/workroom/support"}>
            1:1 문의함 열기 →
          </a>
        </div>
      ) : null}
      <div className={styles.notificationList}>
        {items.map((item) => {
          const route = notificationRoute(item.route, admin);
          return (
            <article
              key={item.id}
              className={styles.notification}
              data-notification-id={item.id}
              data-read={Boolean(item.readAt)}
            >
              <div className={styles.notificationIcon} aria-hidden="true">
                {item.readAt ? (
                  <svg
                    viewBox="0 0 24 24"
                    width="21"
                    height="21"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="m5.5 12 4.5 4.5 8.5-9" />
                  </svg>
                ) : (
                  <PutdukIcon name="bell" size={21} />
                )}
              </div>
              <div className={styles.notificationBody}>
                <time dateTime={item.createdAt}>
                  {dateLabel(item.createdAt)}
                </time>
                <h2>{item.title}</h2>
                <p>{item.body}</p>
                <div
                  className={`${styles.actions} ${styles.notificationActions}`}
                >
                  {route ? <a href={route}>내용 확인 →</a> : null}
                  {item.readAt ? (
                    <span>읽음</span>
                  ) : (
                    <button
                      disabled={pending !== null}
                      onClick={() => void markRead(item)}
                      aria-label={`${item.title} 읽음 처리`}
                    >
                      {pending === item.id ? "저장 중…" : "읽음 처리"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {next ? (
        <button
          className={styles.more}
          disabled={paging}
          onClick={() => void more()}
        >
          {paging ? "불러오는 중…" : "이전 알림 더 보기"}
        </button>
      ) : null}
    </section>
  );
}
