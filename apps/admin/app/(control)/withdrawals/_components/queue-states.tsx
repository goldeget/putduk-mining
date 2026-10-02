"use client";

import { useEffect, useState } from "react";

import styles from "./queue-states.module.css";

/** 가짜 금액 없이 대기열 카드 형태만 보여 주는 로딩 */
export function WithdrawalQueueLoading({ label }: { label: string }) {
  return (
    <section
      aria-busy="true"
      data-ui-state="loading"
      aria-label={label}
      className={styles.loading}
      role="status"
    >
      <article className={styles.loadingCard} aria-hidden="true">
        <span className={`${styles.loadingLine} ${styles.loadingLineShort}`} />
        <span className={`${styles.loadingLine} ${styles.loadingLineMid}`} />
        <span className={`${styles.loadingLine} ${styles.loadingLineWide}`} />
      </article>
      <article className={styles.loadingCard} aria-hidden="true">
        <span className={`${styles.loadingLine} ${styles.loadingLineShort}`} />
        <span className={`${styles.loadingLine} ${styles.loadingLineMid}`} />
        <span className={`${styles.loadingLine} ${styles.loadingLineWide}`} />
      </article>
    </section>
  );
}

export function WithdrawalQueueError({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <section className={styles.errorPanel} role="alert" data-ui-state="error">
      <h2>{title}</h2>
      <p>{description}</p>
      <div className={styles.errorActions}>
        <button
          className="ghost-button"
          onClick={() => {
            if (onRetry) {
              onRetry();
              return;
            }
            window.location.reload();
          }}
          type="button"
        >
          다시 불러오기
        </button>
      </div>
    </section>
  );
}

/** 오프라인에서는 출금 처리를 막는다. 재연결 후 새로고침을 안내한다. */
export function WithdrawalOfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (online) return null;

  return (
    <p className={styles.offlineBanner} role="status">
      연결이 끊겼습니다. 다시 연결된 뒤 화면을 새로고침하세요. 출금 처리는 연결
      중에만 할 수 있습니다.
    </p>
  );
}

export function EmptyQueueNextStep({ children }: { children: string }) {
  return <p className={styles.emptyHint}>{children}</p>;
}
