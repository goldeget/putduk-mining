"use client";

import { useEffect, useRef, useState } from "react";

import {
  beginPushOperation,
  assertPushOperationCurrent,
  currentPushIntentFence,
  pushIntentFenceKey,
  finishPushOperation,
  hasPendingPushDisableIntent,
  rememberPushDisableIntent,
  waitForPushWork as waitFor,
  waitForPushBrowserWork,
  trackPushBrowserWork as trackBrowserWork,
  trackPushTransportWork,
} from "@/lib/notifications/push-client-coordinator";

import {
  readPushEndpointSnapshot,
  enablePushEndpoint,
  type PushEndpointSnapshot,
} from "@/lib/notifications/push-enable-protocol";

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
  const [subscriptionState, setSubscriptionState] = useState<
    "off" | "unconfirmed" | "on" | "revoke-unconfirmed"
  >("off");
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const endpointSnapshot = useRef<PushEndpointSnapshot | null>(null);

  useEffect(() => {
    const available =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    mounted.current = true;
    const controller = new AbortController();
    const snapshotFence = currentPushIntentFence();
    const externalIntent = (event: StorageEvent) => {
      if (event.key !== pushIntentFenceKey) return;
      active.current?.abort();
      endpointSnapshot.current = null;
      setSubscriptionState(
        hasPendingPushDisableIntent() ? "revoke-unconfirmed" : "unconfirmed",
      );
      setMessage(
        "다른 화면에서 알림 설정이 변경되었어요. 현재 상태를 다시 확인해 주세요.",
      );
    };
    window.addEventListener("storage", externalIntent);
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
        .then(async (subscription) => {
          if (subscription) {
            try {
              const snapshot = await readPushEndpointSnapshot(
                subscription.endpoint,
                controller.signal,
              );
              if (
                !controller.signal.aborted &&
                snapshotFence === currentPushIntentFence()
              )
                endpointSnapshot.current = snapshot;
            } catch {
              /* Unknown stays unconfirmed. */
            }
          }
          if (mounted.current && !controller.signal.aborted) {
            setSupported(true);
            // A browser subscription is not evidence of a current server/account
            // registration. Confirmation requires an explicit authenticated POST.
            setSubscriptionState(
              hasPendingPushDisableIntent()
                ? "revoke-unconfirmed"
                : subscription
                  ? "unconfirmed"
                  : "off",
            );
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
      window.removeEventListener("storage", externalIntent);
      mounted.current = false;
      controller.abort();
      clearTimeout(timer);
      active.current?.abort();
    };
  }, []);

  function start() {
    if (active.current) return null;
    const controller = new AbortController();
    if (!beginPushOperation(controller)) return null;
    active.current = controller;
    setPending(true);
    setMessage("");
    return controller;
  }

  function finish(controller: AbortController) {
    finishPushOperation(controller);
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
    const baseline = endpointSnapshot.current; // capture before asynchronous user-intent work
    const intentId = crypto.randomUUID();
    let registrationAttempted = false;
    let knownEndpoint: string | null = null;

    try {
      await waitForPushBrowserWork(signal);
      if (hasPendingPushDisableIntent()) {
        const previous = await waitFor(
          navigator.serviceWorker.getRegistration("/"),
          signal,
        );
        const old = previous
          ? await waitFor(previous.pushManager.getSubscription(), signal)
          : null;
        if (old) {
          knownEndpoint = old.endpoint;
          const removed = await waitFor(
            trackBrowserWork(old.unsubscribe()),
            signal,
          );
          if (!removed) throw new Error("CLEANUP_REQUIRED");
        }
        rememberPushDisableIntent(false);
      }
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
      knownEndpoint = subscription.endpoint;
      const expectedEpoch =
        baseline?.endpoint === subscription.endpoint
          ? baseline.epoch
          : created
            ? 0
            : null;
      if (expectedEpoch === null) throw new Error("BASELINE_REQUIRED");
      endpointSnapshot.current = await enablePushEndpoint({
        subscription: subscription.toJSON(),
        expectedEpoch,
        intentId,
        signal,
        onRegister: () => {
          registrationAttempted = true;
          rememberPushDisableIntent(true);
        },
      });
      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      assertPushOperationCurrent(controller);
      rememberPushDisableIntent(false);
      setSubscriptionState("on");
      setMessage("이 기기에서 푸시 알림을 받을 수 있습니다.");
    } catch (error) {
      // An unknown REGISTER may already have committed. Keep the native endpoint
      // available for DELETE/reload reconciliation rather than losing its handle.
      const cleanup = created as PushSubscription | null;
      if (cleanup && !registrationAttempted)
        void trackBrowserWork(cleanup.unsubscribe()).catch(() => undefined);
      if (registrationAttempted) {
        rememberPushDisableIntent(true);
        setSubscriptionState("revoke-unconfirmed");
      }
      if (
        error instanceof Error &&
        error.message === "BASELINE_REQUIRED" &&
        knownEndpoint &&
        !signal.aborted
      ) {
        try {
          endpointSnapshot.current = await readPushEndpointSnapshot(
            knownEndpoint,
            signal,
          );
        } catch {
          /* Another explicit click is still required. */
        }
      }
      if (mounted.current)
        setMessage(
          signal.aborted
            ? "알림 설정을 마치지 못했어요. 다시 확인해 주세요."
            : error instanceof Error && error.message === "BASELINE_REQUIRED"
              ? "알림 상태를 다시 확인했어요. 알림을 켜려면 다시 선택해 주세요."
              : error instanceof Error && error.message === "CLEANUP_REQUIRED"
                ? "이전 알림 해제를 마치지 못했어요. 브라우저 알림 설정을 확인한 뒤 다시 시도해 주세요."
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
    const intentId = crypto.randomUUID();
    rememberPushDisableIntent(true);

    try {
      await waitForPushBrowserWork(signal);
      const registration = await waitFor(
        navigator.serviceWorker.getRegistration("/"),
        signal,
      );
      const subscription = registration
        ? await waitFor(registration.pushManager.getSubscription(), signal)
        : null;
      if (!subscription) {
        rememberPushDisableIntent(false);
        setSubscriptionState("off");
        setMessage("이 기기에 활성화된 푸시 구독이 없습니다.");
        return;
      }

      if (signal.aborted) throw new DOMException("Stopped", "AbortError");
      const response = await waitFor(
        trackPushTransportWork(
          fetch("/api/v1/notifications/subscriptions", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint, intentId }),
            signal,
          }),
        ),
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
      assertPushOperationCurrent(controller);
      revoked = true;
      if (
        "endpointEpoch" in body.data &&
        Number.isSafeInteger(body.data.endpointEpoch)
      )
        endpointSnapshot.current = {
          endpoint: subscription.endpoint,
          epoch: body.data.endpointEpoch as number,
        };
      else throw new Error("REVOKE_UNCONFIRMED");
      setSubscriptionState("off");
      const removed = await waitFor(
        trackBrowserWork(subscription.unsubscribe()),
        signal,
      );
      assertPushOperationCurrent(controller);
      if (removed) rememberPushDisableIntent(false);
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
