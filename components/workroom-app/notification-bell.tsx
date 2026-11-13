"use client";
import Link from "next/link";
import { WorkroomAppInboxPageSchema } from "../../lib/workroom-app/contract";
import { appEndpoint, useVisibleResource } from "./client";
import styles from "./workroom-app.module.css";

export function NotificationBell({ admin = false }: { admin?: boolean }) {
  const { data, error } = useVisibleResource(
    `${appEndpoint(admin)}?operation=NOTIFICATIONS_READ&limit=1`,
    WorkroomAppInboxPageSchema,
  );
  const count = data?.unreadCount;
  return (
    <span className={styles.bellWrap}>
      <Link
        className={styles.bell}
        href="/notifications"
        aria-label={
          typeof count === "number" ? `알림, 미확인 ${count}개` : "알림함 열기"
        }
        title={error ? "알림 수를 확인하지 못했어요" : "알림함"}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {typeof count === "number" && count > 0 ? (
          <span className={styles.count} aria-hidden="true">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
        {error ? (
          <span className={styles.bellError} aria-hidden="true">
            !
          </span>
        ) : null}
      </Link>
    </span>
  );
}
