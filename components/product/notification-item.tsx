"use client";

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";
import { isSafeProtectedReturnPath } from "@/lib/auth/return-path";

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
  const safeRoute =
    notification.route && isSafeProtectedReturnPath(notification.route)
      ? (notification.route as Route)
      : null;

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
    >
      <span className="notification-center__icon">
        <PutdukIcon name="bell" size={18} />
      </span>
      <div>
        <div className="notification-center__meta">
          <span>{notification.category}</span>
          <time dateTime={notification.createdAt}>
            {new Intl.DateTimeFormat("ko-KR", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(notification.createdAt))}
          </time>
        </div>
        <h2>{notification.title}</h2>
        <p>{notification.body}</p>
        <div className="notification-center__actions">
          {safeRoute ? (
            <Link href={safeRoute}>
              내용 확인 <PutdukIcon name="arrow-right" size={15} />
            </Link>
          ) : null}
          {!notification.read ? (
            <button type="button" disabled={pending} onClick={markRead}>
              {pending ? "저장 중" : "읽음 처리"}
            </button>
          ) : (
            <span>읽음</span>
          )}
        </div>
        {message ? (
          <p className="notification-center__error" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </article>
  );
}
