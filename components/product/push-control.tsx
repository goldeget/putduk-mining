"use client";

import { useEffect, useState } from "react";

function decodeVapidKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

export function PushControl() {
  const [supported, setSupported] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    const available =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    let mounted = true;

    if (available) {
      void navigator.serviceWorker
        .getRegistration("/")
        .then((registration) => registration?.pushManager.getSubscription())
        .then((subscription) => {
          if (mounted) {
            setSupported(true);
            setSubscribed(Boolean(subscription));
          }
        })
        .catch(() => undefined);
    }

    return () => {
      mounted = false;
    };
  }, []);

  async function enablePush() {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      setMessage(
        "지금은 이 기기 알림을 켤 수 없어요. 앱 안의 알림 센터에서 소식을 확인해 주세요.",
      );
      return;
    }

    setPending(true);
    setMessage("");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("브라우저 알림 권한이 허용되지 않았습니다.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        applicationServerKey: decodeVapidKey(vapidKey),
        userVisibleOnly: true,
      });
      const response = await fetch("/api/v1/notifications/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!response.ok) {
        setMessage("알림 구독을 저장하지 못했습니다.");
        return;
      }

      setSubscribed(true);
      setMessage("이 기기에서 푸시 알림을 받을 수 있습니다.");
    } catch {
      setMessage("브라우저의 푸시 기능을 준비하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function disablePush() {
    setPending(true);
    setMessage("");

    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) {
        setSubscribed(false);
        setMessage("이 기기에 활성화된 푸시 구독이 없습니다.");
        return;
      }

      const response = await fetch("/api/v1/notifications/subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!response.ok) {
        setMessage("알림 구독을 해제하지 못했습니다.");
        return;
      }

      await subscription.unsubscribe();
      setSubscribed(false);
      setMessage("이 기기의 푸시 알림을 해제했습니다.");
    } catch {
      setMessage("브라우저의 푸시 설정을 변경하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="push-control">
      <div>
        <strong>이 기기 푸시 알림</strong>
        <p>이 버튼을 선택할 때만 브라우저의 알림 권한을 요청합니다.</p>
      </div>
      <button
        className="button button--secondary"
        type="button"
        onClick={subscribed ? disablePush : enablePush}
        disabled={!supported || pending}
      >
        {!supported
          ? "지원되지 않음"
          : pending
            ? "설정 중"
            : subscribed
              ? "알림 끄기"
              : "알림 켜기"}
      </button>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
