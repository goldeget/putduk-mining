"use client";

import { useState, type FormEvent } from "react";

type PreferenceKey =
  | "events_enabled"
  | "marketing_enabled"
  | "mining_enabled"
  | "service_enabled"
  | "wallet_enabled";

type Preferences = Record<PreferenceKey, boolean>;

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
}: {
  initial: Preferences;
}) {
  const [preferences, setPreferences] = useState(initial);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/v1/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      setMessage(
        response.ok
          ? "알림 설정을 저장했습니다."
          : "알림 설정을 저장하지 못했습니다.",
      );
    } catch {
      setMessage("네트워크 연결을 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="preference-form" onSubmit={submit}>
      <div>
        {options.map((option) => (
          <label key={option.key}>
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
            <input
              type="checkbox"
              checked={preferences[option.key]}
              onChange={(event) =>
                setPreferences((current) => ({
                  ...current,
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
          disabled={pending}
          type="submit"
        >
          {pending ? "저장 중" : "설정 저장"}
        </button>
        {message ? <p role="status">{message}</p> : null}
      </footer>
    </form>
  );
}
