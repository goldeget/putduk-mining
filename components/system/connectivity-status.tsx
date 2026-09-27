"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { PutdukIcon } from "@/components/icons/putduk-icon";

type ConnectivityState = "online" | "offline" | "reconnected";

export function ConnectivityStatus() {
  const router = useRouter();
  const [state, setState] = useState<ConnectivityState>("online");
  const wasOffline = useRef(false);
  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    const handleOffline = () => {
      wasOffline.current = true;
      setState("offline");
    };
    const handleOnline = () => {
      if (!wasOffline.current) {
        return;
      }

      setState("reconnected");
      wasOffline.current = false;
      router.refresh();
      dismissTimer.current = window.setTimeout(() => setState("online"), 4_000);
    };

    const initialFrame = window.navigator.onLine
      ? null
      : window.requestAnimationFrame(handleOffline);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
      }
      if (initialFrame !== null) {
        window.cancelAnimationFrame(initialFrame);
      }
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [router]);

  if (state === "online") {
    return null;
  }

  return (
    <div
      className={`connectivity-status connectivity-status--${state}`}
      role="status"
      aria-live="polite"
    >
      <PutdukIcon name={state === "offline" ? "pulse" : "shield"} size={18} />
      <span>
        <strong>
          {state === "offline" ? "인터넷 연결이 끊겼어요" : "다시 연결됐어요"}
        </strong>
        {state === "offline"
          ? "표시된 금액과 상태는 연결 전 마지막 화면입니다. 새 요청은 보내지 않습니다."
          : "최신 채굴·지갑 상태를 다시 확인하고 있습니다."}
      </span>
    </div>
  );
}
