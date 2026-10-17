import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enablePushEndpoint,
  readPushEndpointSnapshot,
} from "@/lib/notifications/push-enable-protocol";
const endpoint = "https://fcm.googleapis.com/fcm/send/same-endpoint";
const intentId = "11111111-1111-4111-8111-111111111111",
  permitId = "22222222-2222-4222-8222-222222222222";
const subscription = {
  endpoint,
  expirationTime: null,
  keys: { p256dh: "fixture", auth: "fixture" },
};
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
afterEach(() => vi.unstubAllGlobals());
describe("explicit Push epoch intent client", () => {
  it("re-enables the same endpoint with a fresh epoch-bound permit", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ operation: "ISSUE", intentId, permitId, endpointEpoch: 3 }),
      )
      .mockResolvedValueOnce(
        response({ subscribed: true, intentId, permitId, endpointEpoch: 4 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const onRegister = vi.fn();
    expect(
      await enablePushEndpoint({
        subscription,
        expectedEpoch: 3,
        intentId,
        signal: new AbortController().signal,
        onRegister,
      }),
    ).toEqual({ endpoint, epoch: 4 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onRegister).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      operation: "ISSUE",
      subscription,
      expectedEpoch: 3,
      intentId,
    });
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({
      operation: "REGISTER",
      subscription,
      expectedEpoch: 3,
      intentId,
      permitId,
    });
  });
  it("never refreshes a stale snapshot inside the old enable intent", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(null, 409));
    vi.stubGlobal("fetch", fetcher);
    const onRegister = vi.fn();
    await expect(
      enablePushEndpoint({
        subscription,
        expectedEpoch: 0,
        intentId,
        signal: new AbortController().signal,
        onRegister,
      }),
    ).rejects.toThrow("BASELINE_REQUIRED");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onRegister).not.toHaveBeenCalled();
  });
  it("does not register after cancellation while permit response is in flight", async () => {
    const controller = new AbortController(),
      onRegister = vi.fn();
    const fetcher = vi.fn(async () => {
      controller.abort();
      return response({
        operation: "ISSUE",
        intentId,
        permitId,
        endpointEpoch: 0,
      });
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      enablePushEndpoint({
        subscription,
        expectedEpoch: 0,
        intentId,
        signal: controller.signal,
        onRegister,
      }),
    ).rejects.toThrow("Stopped");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onRegister).not.toHaveBeenCalled();
  });
  it("reload reconciliation only reads and cannot issue/register", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ operation: "SNAPSHOT", endpointEpoch: 9 }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await readPushEndpointSnapshot(endpoint, new AbortController().signal),
    ).toEqual({ endpoint, epoch: 9 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
      operation: "SNAPSHOT",
      endpoint,
    });
  });
  it("rejects mismatched permit before any register transport", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      response({
        operation: "ISSUE",
        intentId: "foreign",
        permitId,
        endpointEpoch: 0,
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      enablePushEndpoint({
        subscription,
        expectedEpoch: 0,
        intentId,
        signal: new AbortController().signal,
        onRegister: vi.fn(),
      }),
    ).rejects.toThrow("SAVE_FAILED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
