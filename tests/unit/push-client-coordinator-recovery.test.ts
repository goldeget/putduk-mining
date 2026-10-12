// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Coordinator = typeof import("@/lib/notifications/push-client-coordinator");
let coordinator: Coordinator;
let local: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn> };
let getRegistration: ReturnType<typeof vi.fn>;
let getSubscription: ReturnType<typeof vi.fn>;
let fetcher: ReturnType<typeof vi.fn>;
const tick = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  coordinator = await import("@/lib/notifications/push-client-coordinator");
  local = {
    endpoint: "https://push.example.test/old-device",
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  getSubscription = vi.fn().mockResolvedValue(local);
  getRegistration = vi
    .fn()
    .mockResolvedValue({ pushManager: { getSubscription } });
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
  fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: { subscribed: false } })),
    );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("logout browser fence and bounded cleanup contract", () => {
  it("preempts the registered operation and retains current-device intent without duplicating logout admission", () => {
    const operation = new AbortController();
    expect(coordinator.beginPushOperation(operation)).toBe(true);
    const release = coordinator.beginPushLogout();
    expect(operation.signal.aborted).toBe(true);
    expect(coordinator.hasPendingPushDisableIntent()).toBe(true);
    expect(coordinator.beginPushLogout()).toBeNull();
    expect(coordinator.beginPushOperation(new AbortController())).toBe(false);
    coordinator.finishPushOperation(operation);
    release!();
    const next = new AbortController();
    expect(coordinator.beginPushOperation(next)).toBe(true);
    coordinator.finishPushOperation(next);
  });

  it("waits for canceled-operation rollback enqueue and its delayed unsubscribe before any endpoint lookup", async () => {
    const operation = new AbortController();
    coordinator.beginPushOperation(operation);
    const release = coordinator.beginPushLogout()!;
    const cleanup = coordinator.cleanupCurrentDevicePush(
      new AbortController().signal,
    );
    await tick();
    expect(getRegistration).not.toHaveBeenCalled();
    const delayed = deferred<boolean>();
    coordinator.trackPushBrowserWork(delayed.promise);
    coordinator.finishPushOperation(operation);
    await tick();
    expect(getRegistration).not.toHaveBeenCalled();
    delayed.resolve(true);
    await cleanup;
    expect(getRegistration).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    release();
  });

  it("starts native removal while an old POST is pending and starts DELETE only after that transport settles", async () => {
    const oldPost = deferred<Response>();
    coordinator.trackPushTransportWork(oldPost.promise);
    const release = coordinator.beginPushLogout()!;
    const cleanup = coordinator.cleanupCurrentDevicePush(
      new AbortController().signal,
    );
    await tick();
    expect(local.unsubscribe).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
    oldPost.resolve(new Response("{}"));
    await cleanup;
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/v1/notifications/subscriptions",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ endpoint: local.endpoint }),
      }),
    );
    release();
  });

  it("has no late DELETE after the caller deadline even when an old POST later settles", async () => {
    const oldPost = deferred<Response>();
    coordinator.trackPushTransportWork(oldPost.promise);
    const release = coordinator.beginPushLogout()!;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      coordinator.pushCleanupWaitMs,
    );
    const cleanup = coordinator
      .cleanupCurrentDevicePush(controller.signal)
      .catch(() => undefined);
    await tick();
    expect(local.unsubscribe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    await cleanup;
    oldPost.resolve(new Response("{}"));
    await tick();
    expect(fetcher).not.toHaveBeenCalled();
    clearTimeout(timer);
    release();
  });

  it("does not resume a timed-out browser lookup into a new account's DELETE", async () => {
    const lookup = deferred<unknown>();
    getRegistration.mockReturnValue(lookup.promise);
    const release = coordinator.beginPushLogout()!;
    const controller = new AbortController();
    const cleanup = coordinator
      .cleanupCurrentDevicePush(controller.signal)
      .catch(() => undefined);
    await tick();
    controller.abort();
    await cleanup;
    release();
    lookup.resolve({ pushManager: { getSubscription } });
    await tick();
    expect(getSubscription).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("attempts DELETE independently of a synchronous native unsubscribe refusal", async () => {
    local.unsubscribe.mockImplementation(() => {
      throw new Error("browser refused");
    });
    const release = coordinator.beginPushLogout()!;
    await coordinator.cleanupCurrentDevicePush(new AbortController().signal);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(coordinator.hasPendingPushDisableIntent()).toBe(true);
    release();
  });

  it("keeps memory intent coherent when both persistent write and removal are denied", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => coordinator.rememberPushDisableIntent(true)).not.toThrow();
    expect(coordinator.hasPendingPushDisableIntent()).toBe(true);
    coordinator.rememberPushDisableIntent(false);
    expect(coordinator.hasPendingPushDisableIntent()).toBe(false);
  });

  it("does not contact the server on a browser without service workers", async () => {
    vi.stubGlobal("navigator", {});
    const release = coordinator.beginPushLogout()!;
    await coordinator.cleanupCurrentDevicePush(new AbortController().signal);
    expect(fetcher).not.toHaveBeenCalled();
    release();
  });
});
