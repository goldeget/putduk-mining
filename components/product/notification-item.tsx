"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import {
  notificationCategoryLabelKo,
  resolveSafeNotificationRoute,
} from "@/domain/notifications/member-inbox";

export function NotificationItem({
  notification,
}: {
  notification: {
    body: string;
    category: string;
    createdAt: string;
    id: string;
    read: boolean;
    route: string | null;
    title: string;
  };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const safeRoute = resolveSafeNotificationRoute(notification.route);
  const categoryLabel = notificationCategoryLabelKo(notification.category);

  async function markRead() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/v1/notifications/${notification.id}/read`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      if (response.status === 404 || response.status === 410) {
        setMessage("이 알림은 더 이상 확인할 수 없어요.");
        return;
      }
      if (!response.ok) {
        setMessage("읽음 상태를 저장하지 못했어요.");
        return;
      }
      router.refresh();
    } catch {
      setMessage("연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <article
      className={`notification-center__item${notification.read ? "" : "is-unread"}`}
      data-notification-id={notification.id}
      data-read={notification.read ? "true" : "false"}
      aria-labelledby={`notification-title-${notification.id}`}
    >
      <span className="notification-center__icon" aria-hidden="true">
        <PutdukIcon name="bell" size={18} />
      </span>
      <div>
        <div className="notification-center__meta">
          <span>{categoryLabel}</span>
          <time dateTime={notification.createdAt}>
            {new Intl.DateTimeFormat("ko-KR", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(notification.createdAt))}
          </time>
        </div>
        <h2 id={`notification-title-${notification.id}`}>
          {notification.title}
        </h2>
        <p>{notification.body}</p>
        <div className="notification-center__actions">
          {safeRoute ? (
            <Link href={safeRoute as Route}>
              내용 확인 <PutdukIcon name="arrow-right" size={15} />
            </Link>
          ) : null}
          {!notification.read ? (
            <button
              type="button"
              disabled={pending}
              onClick={markRead}
              aria-label={`${notification.title} 읽음 처리`}
            >
              {pending ? "저장 중" : "읽음 처리"}
            </button>
          ) : (
            <span>읽음</span>
          )}
        </div>
        {message ? (
          <p
            className="notification-center__error"
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}
      </div>
    </article>
  );
}
