"use client";

import { useSyncExternalStore, type ReactNode } from "react";

import styles from "./admin-auth-entry.module.css";

function watchConnection(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function AdminAuthConnectionBoundary({
  children,
}: {
  children?: ReactNode;
}) {
  const connected = useSyncExternalStore(
    watchConnection,
    () => navigator.onLine,
    () => true,
  );
  return (
    <div
      className={styles.interaction}
      onSubmitCapture={(event) => {
        // Read at submission too, so an offline event cannot race the last render.
        if (navigator.onLine === false) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {!connected ? (
        <p className={styles.connectionNotice} role="status">
          인터넷 연결이 끊겼어요. 연결을 확인한 뒤 다시 시도해 주세요.
        </p>
      ) : null}
      <fieldset disabled={!connected} className={styles.controls}>
        <legend className={styles.srOnly}>계정 및 접속 확인</legend>
        {children}
      </fieldset>
    </div>
  );
}
