"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createSessionActivity } from "../../../lib/auth/session-activity";

export function AdminSessionRuntime() {
  const [unconfirmed, setUnconfirmed] = useState(false);
  useEffect(() => {
    let alive = true;
    const tracker = createSessionActivity({
      isVisible: () =>
        document.visibilityState === "visible" && navigator.onLine,
      send: async () => {
        try {
          const response = await fetch("/api/v1/admin/session/heartbeat", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
          });
          if (alive) setUnconfirmed(!response.ok);
        } catch {
          if (alive) setUnconfirmed(true);
        }
      },
    });
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((event) =>
      window.addEventListener(event, tracker.recordActivity, {
        passive: true,
        capture: true,
      }),
    );
    const timer = window.setInterval(() => void tracker.tick(), 30_000);
    return () => {
      alive = false;
      tracker.stop();
      window.clearInterval(timer);
      events.forEach((event) =>
        window.removeEventListener(event, tracker.recordActivity, true),
      );
    };
  }, []);
  if (!unconfirmed) return null;
  return (
    <p className="panel-note" role="status">
      접속 상태를 확인하지 못했습니다. 연결을 확인하고, 계속되면 작성 중인
      내용을 보관한 뒤 <Link href="/login">다시 접속</Link>해 주세요.
    </p>
  );
}
