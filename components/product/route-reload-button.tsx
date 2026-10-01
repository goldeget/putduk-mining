"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { PutdukIcon } from "@/components/icons/putduk-icon";

const readRecoveryLimitMs = 15_000;

function subscribeConnectivity(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

function readOnline() {
  return navigator.onLine;
}

/** 서버 스냅샷을 다시 읽어 오는 복구 버튼. 금액·자격을 계산하지 않는다. */
export function RouteReloadButton({
  className = "button button--primary",
  label = "다시 확인",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [waiting, setWaiting] = useState({ pending: false, expired: false });
  const online = useSyncExternalStore(
    subscribeConnectivity,
    readOnline,
    () => true,
  );
  const statusId = useId();

  if (waiting.pending !== pending) {
    setWaiting({ pending, expired: false });
  }

  useEffect(() => {
    if (!pending) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setWaiting({ pending: true, expired: true });
    }, readRecoveryLimitMs);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pending]);

  const showRecovery = pending && (waiting.expired || !online);

  return (
    <>
      <button
        className={className}
        type="button"
        disabled={pending}
        aria-busy={pending}
        aria-describedby={showRecovery ? statusId : undefined}
        onClick={() => {
          startTransition(() => {
            router.refresh();
          });
        }}
      >
        {pending ? "확인 중" : label}
        <PutdukIcon name="arrow-right" size={18} />
      </button>
      {showRecovery ? (
        <div className="route-reload-recovery">
          <p id={statusId} className="muted" role="status" aria-live="polite">
            {online
              ? "조회가 지연되고 있습니다. 페이지를 새로고침해 다시 확인해 주세요."
              : "오프라인 상태입니다. 연결을 확인한 뒤 페이지를 새로고침해 주세요."}
          </p>
          <button
            className="button button--secondary"
            type="button"
            aria-describedby={statusId}
            onClick={() => window.location.reload()}
          >
            페이지 새로고침
          </button>
        </div>
      ) : null}
    </>
  );
}
