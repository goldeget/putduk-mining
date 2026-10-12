/** Client memory/fences provide best-effort browser sequencing, not DB ordering. */
export const pushCleanupWaitMs = 10_000;
export const pushDisableIntentKey = "putduk-push-disable-pending";
let memoryDisableIntent: boolean | undefined;
let browserWork: Promise<void> = Promise.resolve();
let transportWork: Promise<void> = Promise.resolve();
const active = new Map<
  AbortController,
  { done: Promise<void>; finish: () => void }
>();
let canceledOperations: Promise<void> = Promise.resolve();
let logoutOwner: object | null = null;

export function rememberPushDisableIntent(pending: boolean): void {
  memoryDisableIntent = pending;
  try {
    if (pending) localStorage.setItem(pushDisableIntentKey, "true");
    else localStorage.removeItem(pushDisableIntentKey);
  } catch {
    // No endpoint, keys, token, or identity is persisted. Storage is optional.
  }
}

export function hasPendingPushDisableIntent(): boolean {
  if (memoryDisableIntent !== undefined) return memoryDisableIntent;
  try {
    return localStorage.getItem(pushDisableIntentKey) === "true";
  } catch {
    return false;
  }
}

export function waitForPushWork<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
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

function settled<T>(promise: Promise<T>): Promise<void> {
  return promise.then(
    () => undefined,
    () => undefined,
  );
}
export function trackPushBrowserWork<T>(promise: Promise<T>): Promise<T> {
  browserWork = Promise.all([browserWork, settled(promise)]).then(
    () => undefined,
  );
  return promise;
}
export function trackPushTransportWork<T>(promise: Promise<T>): Promise<T> {
  transportWork = Promise.all([transportWork, settled(promise)]).then(
    () => undefined,
  );
  return promise;
}
export function waitForPushBrowserWork(signal: AbortSignal): Promise<void> {
  return waitForPushWork(browserWork, signal);
}
export function beginPushOperation(controller: AbortController): boolean {
  if (logoutOwner || active.size > 0) return false;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  active.set(controller, { done, finish });
  return true;
}
export function finishPushOperation(controller: AbortController): void {
  active.get(controller)?.finish();
  active.delete(controller);
}

/** Returns a release for UI submission lifecycle; never claims auth success. */
export function beginPushLogout(): (() => void) | null {
  if (logoutOwner) return null;
  const owner = {};
  logoutOwner = owner;
  rememberPushDisableIntent(true);
  canceledOperations = Promise.all(
    [...active.values()].map((operation) => operation.done),
  ).then(() => undefined);
  for (const controller of active.keys()) controller.abort();
  return () => {
    if (logoutOwner === owner) logoutOwner = null;
  };
}

function acknowledged(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    "data" in body &&
    !!body.data &&
    typeof body.data === "object" &&
    "subscribed" in body.data &&
    body.data.subscribed === false
  );
}

export async function cleanupCurrentDevicePush(
  signal: AbortSignal,
): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  // Let canceled operation finally blocks enqueue their rollback before reading
  // the native fence. A snapshot taken immediately on abort can miss that work.
  await waitForPushWork(canceledOperations, signal);
  await waitForPushBrowserWork(signal);
  const registration = await waitForPushWork(
    navigator.serviceWorker.getRegistration("/"),
    signal,
  );
  const subscription = registration
    ? await waitForPushWork(registration.pushManager.getSubscription(), signal)
    : null;
  if (!subscription || signal.aborted) return;
  // Capture this object/endpoint. Never look up a replacement after sign-out.
  const endpoint = subscription.endpoint;
  const local = trackPushBrowserWork(
    Promise.resolve().then(() => subscription.unsubscribe()),
  );
  const server = (async () => {
    // Browser removal can proceed while an earlier POST waits. An aborted fetch
    // rejection is not proof its server transaction rolled back.
    await waitForPushWork(transportWork, signal);
    if (signal.aborted) return;
    const response = await waitForPushWork(
      trackPushTransportWork(
        fetch("/api/v1/notifications/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
          signal,
        }),
      ),
      signal,
    );
    if (
      !response.ok ||
      !acknowledged(await waitForPushWork(response.json(), signal))
    )
      throw new Error("PUSH_REVOKE_UNCONFIRMED");
  })();
  await waitForPushWork(Promise.allSettled([local, server]), signal);
  // Keep the disable intent even on success. A future explicit enable must
  // reconcile browser removal before any endpoint POST. No cleanup-success UI.
}
