"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { RouteReloadButton } from "@/components/product/route-reload-button";
import { StatePanel } from "@/components/ui/states";
import {
  isNotificationPreferences,
  type NotificationPreferences,
  type PreferenceKey,
} from "@/lib/product/notification-preferences-read";

const options: readonly {
  description: string;
  key: PreferenceKey;
  label: string;
}[] = [
  {
    key: "mining_enabled",
    label: "채굴과 정산",
    description: "채굴 상태와 정산 결과의 중요한 변화를 알립니다.",
  },
  {
    key: "wallet_enabled",
    label: "자산과 입출금",
    description: "입금 확인, 출금 상태와 지갑 반영을 알립니다.",
  },
  {
    key: "events_enabled",
    label: "이벤트",
    description: "참여 중인 이벤트와 보상 상태를 알립니다.",
  },
  {
    key: "service_enabled",
    label: "중요 안내",
    description: "점검과 계정 보안 등 반드시 확인할 소식을 알립니다.",
  },
  {
    key: "marketing_enabled",
    label: "혜택과 소식",
    description: "선택한 경우에만 제품 소식과 혜택을 알립니다.",
  },
];

export function NotificationPreferencesForm({
  initial,
  readState = initial ? "loaded" : "error",
}: {
  initial: NotificationPreferences | null;
  readState?: "loaded" | "empty" | "error";
}) {
  const router = useRouter();
  const [preferences, setPreferences] = useState(initial);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const pendingRef = useRef(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !preferences ||
      readState !== "loaded" ||
      sessionExpired ||
      pendingRef.current ||
      !navigator.onLine
    )
      return;
    pendingRef.current = true;
    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/v1/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 401) {
        setSessionExpired(true);
        setMessage(
          "로그인 시간이 지났어요. 다시 로그인한 뒤 설정을 확인해 주세요.",
        );
      } else if (
        response.ok &&
        isNotificationPreferences(payload?.data?.preferences)
      ) {
        setPreferences(payload.data.preferences);
        setMessage("알림 설정을 저장했습니다.");
      } else {
        setMessage("저장 결과를 확인하지 못했어요. 다시 불러와 확인해 주세요.");
      }
    } catch {
      setMessage("연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setPending(false);
      pendingRef.current = false;
    }
  }

  if (readState !== "loaded" || !preferences) {
    return (
      <StatePanel
        tone={readState === "empty" ? "empty" : "error"}
        title={
          readState === "empty"
            ? "아직 알림 설정이 없어요"
            : "알림 설정을 확인하지 못했어요"
        }
        description={
          readState === "empty"
            ? "계정 설정이 준비되면 받는 알림을 선택할 수 있어요. 잠시 후 다시 확인해 주세요."
            : "현재 설정을 알 수 없어 저장할 수 없어요. 연결을 확인한 뒤 다시 불러와 주세요."
        }
        action={<RouteReloadButton className="button button--secondary" />}
      />
    );
  }

  return (
    <form
      className="preference-form"
      onSubmit={submit}
      aria-label="알림 종류 설정"
    >
      <div>
        {options.map((option) => (
          <label key={option.key} htmlFor={`pref-${option.key}`}>
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
            <input
              id={`pref-${option.key}`}
              type="checkbox"
              disabled={pending || !online || sessionExpired}
              checked={preferences[option.key]}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current!,
                  [option.key]: event.target.checked,
                }))
              }
            />
            <i aria-hidden="true" />
          </label>
        ))}
      </div>
      <footer>
        <button
          className="button button--primary"
          disabled={pending || !online || sessionExpired}
          type="submit"
        >
          {pending ? "저장 중" : "설정 저장"}
        </button>
        {!online ? (
          <p role="status">
            인터넷 연결을 확인해 주세요. 연결되면 설정을 저장할 수 있어요.
          </p>
        ) : null}
        {sessionExpired ? (
          <button
            className="button button--secondary"
            onClick={() => router.refresh()}
            type="button"
          >
            로그인 상태 확인
          </button>
        ) : null}
        {message ? (
          <p role="status" aria-live="polite">
            {message}
          </p>
        ) : null}
      </footer>
    </form>
  );
}
