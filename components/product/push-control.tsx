"use client";

import { useEffect, useRef, useState } from "react";

/** Browser permission/ready/subscribe cannot be aborted natively. Stop waiting,
 * and check the signal again before any subsequent server mutation. */
function waitFor<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Stopped", "AbortError"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function decodeVapidKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

// This fence survives component unmount/remount. Native browser mutations may
// finish after a UI timeout, and must settle before another control reuses them.
let browserWork: Promise<void> = Promise.resolve();
function trackBrowserWork<T>(promise: Promise<T>): Promise<T> {
  browserWork = Promise.all([
    browserWork,
    promise.then(
      () => undefined,
      () => undefined,
    ),
  ]).then(() => undefined);
  return promise;
}

export function PushControl() {
  const [supported, setSupported] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [subscriptionState, setSubscriptionState] = useState<
    "off" | "unconfirmed" | "on" | "revoke-unconfirmed"
  >("off");
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    const available =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    mounted.current = true;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 10_000);

    if (available) {
      void waitFor(
        navigator.serviceWorker.getRegistration("/"),
        controller.signal,
      )
        .then((registration) =>
          registration
            ? waitFor(
                registration.pushManager.getSubscription(),
                controller.signal,
              )
            : null,
        )
        .then((subscription) => {
          if (mounted.current && !controller.signal.aborted) {
            setSupported(true);
            // A browser subscription is not evidence of a current server/account
            // registration. Confirmation requires an explicit authenticated POST.
            setSubscriptionState(subscription ? "unconfirmed" : "off");
          }
        })
        .catch(() => {
          if (mounted.current && (!controller.signal.aborted || timedOut)) {
            setSupported(true);
            setMessage("알림 연결을 확인하지 못했어요. 다시 확인해 주세요.");
          }
        })
        .finally(() => clearTimeout(timer));
    }

    return () => {
      mounted.current = false;
      controller.abort();
      clearTimeout(timer);
      active.current?.abort();
    };
  }, []);

  function start() {
    if (active.current) return null;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setMessage("");
    return controller;
  }

  function finish(controller: AbortController) {
    if (active.current === controller) {
      active.current = null;
      if (mounted.current) setPending(false);
    }
  }

  async function enablePush() {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      setMessage(
        "지금은 이 기기 알림을 켤 수 없어요. 앱 안의 알림 센터에서 소식을 확인해 주세요.",
      );
      return;
    }

    const controller = start();
    if (!controller) return;
    const signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 10_000);
    let created: PushSubscription | null = null;

    try {
      await waitFor(browserWork, signal);
      const permission = await waitFor(
        Notification.requestPermission(),
        signal,
      );
      if (permission !== "granted") {
        setMessage("브라우저 알림 권한이 허용되지 않았습니다.");
        return;
      }

      const registration =
        (await waitFor(navigator.serviceWorker.getRegistration("/"), signal)) ??
        (await waitFor(navigator.serviceWorker.ready, signal));
      let subscription = await waitFor(
        registration.pushManager.getSubscription(),
        signal,
      );
      if (!subscription) {
        const subscribing = trackBrowserWork(
          registration.pushManager
            .subscribe({
              applicationServerKey: decodeVapidKey(vapidKey),
              userVisibleOnly: true,
            })
            .then(async (value) => {
              if (signal.aborted)
                await value.unsubscribe().catch(() => undefined);
              else created = value;
              return value;
            }),
        );
        subscription = await waitFor(subscribing, signal);
      }
      const response = await waitFor(
        fetch("/api/v1/notifications/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
          signal,
        }),
        signal,
      );

      if (!response.ok) {
        throw new Error("SAVE_FAILED");
      }
      const body: unknown = await waitFor(response.json(), signal);
      if (
        !body ||
        typeof body !== "object" ||
        !("data" in body) ||
        !body.data ||
        typeof body.data !== "object" ||
        !("subscribed" in body.data) ||
        body.data.subscribed !== true
      )
        throw new Error("SAVE_FAILED");
      setSubscriptionState("on");
      setMessage("이 기기에서 푸시 알림을 받을 수 있습니다.");
    } catch (error) {
      // Roll back only a subscription created by this attempt. An existing
      // subscription may belong to another account; never remove it on conflict.
      const cleanup = created as PushSubscription | null;
      if (cleanup)
        void trackBrowserWork(cleanup.unsubscribe()).catch(() => undefined);
      if (mounted.current)
        setMessage(
          signal.aborted
            ? "알림 설정을 마치지 못했어요. 다시 확인해 주세요."
            : error instanceof Error && error.message === "SAVE_FAILED"
              ? "알림 구독을 저장하지 못했습니다. 다시 확인해 주세요."
              : "브라우저의 푸시 기능을 준비하지 못했습니다. 다시 확인해 주세요.",
        );
    } finally {
      clearTimeout(timer);
      finish(controller);
    }
  }

  async function disablePush() {
    const controller = start();
    if (!controller) return;
    const signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 10_000);
    let revoked = false;

    try {
      await waitFor(browserWork, signal);
      const registration = await waitFor(
        navigator.serviceWorker.getRegistration("/"),
        signal,
      );
      const subscription = registration
        ? await waitFor(registration.pushManager.getSubscription(), signal)
        : null;
      if (!subscription) {
        setSubscriptionState("off");
        setMessage("이 기기에 활성화된 푸시 구독이 없습니다.");
        return;
      }

      const response = await waitFor(
        fetch("/api/v1/notifications/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
          signal,
        }),
        signal,
      );
      if (!response.ok) {
        setMessage("알림 구독을 해제하지 못했습니다.");
        return;
      }

      const body: unknown = await waitFor(response.json(), signal);
      if (
        !body ||
        typeof body !== "object" ||
        !("data" in body) ||
        !body.data ||
        typeof body.data !== "object" ||
        !("subscribed" in body.data) ||
        body.data.subscribed !== false
      )
        throw new Error("REVOKE_UNCONFIRMED");
      revoked = true;
      setSubscriptionState("off");
      const removed = await waitFor(
        trackBrowserWork(subscription.unsubscribe()),
        signal,
      );
      setMessage(
        removed
          ? "이 기기의 푸시 알림을 해제했습니다."
          : "알림 발송은 해제했어요. 브라우저 알림 설정도 확인해 주세요.",
      );
    } catch {
      if (mounted.current) {
        setSubscriptionState(revoked ? "off" : "revoke-unconfirmed");
        setMessage(
          revoked
            ? "알림 발송은 해제했어요. 브라우저 알림 설정도 확인해 주세요."
            : "알림 해제를 확인하지 못했습니다. 다시 확인해 주세요.",
        );
      }
    } finally {
      clearTimeout(timer);
      finish(controller);
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
        onClick={
          subscriptionState === "on" ||
          subscriptionState === "revoke-unconfirmed"
            ? disablePush
            : enablePush
        }
        disabled={!supported || pending}
      >
        {!supported
          ? "지원되지 않음"
          : pending
            ? "설정 중"
            : subscriptionState === "on"
              ? "알림 끄기"
              : subscriptionState === "revoke-unconfirmed"
                ? "알림 해제 다시 확인"
                : subscriptionState === "unconfirmed"
                  ? "알림 연결 확인"
                  : "알림 켜기"}
      </button>
      {pending ? (
        <button
          type="button"
          className="button button--secondary"
          onClick={() => active.current?.abort()}
        >
          취소
        </button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
