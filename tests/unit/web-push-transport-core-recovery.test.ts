import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  envelope: vi.fn(),
  mode: "error" as "error" | "accepted",
}));
vi.mock("node:dns/promises", () => ({ lookup: state.lookup }));
vi.mock("node:https", () => ({ request: state.request }));
vi.mock("@/lib/notifications/web-push-crypto.mjs", () => ({
  createWebPushEnvelope: state.envelope,
}));
import { sendWebPush } from "@/lib/notifications/web-push-transport.mjs";
const input = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test-token",
  p256dh: "test",
  authSecret: "test",
  notificationId: "10000000-0000-4000-8000-000000000001",
  deepLink: "/notifications",
};
const config = { publicKey: "test", privateKey: "test", subject: "test" };
beforeEach(() => {
  vi.clearAllMocks();
  state.mode = "error";
  state.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  state.envelope.mockReturnValue({
    body: Buffer.from("encrypted"),
    headers: {},
  });
  state.request.mockImplementation((_url, _options, callback) => {
    const req = new EventEmitter() as EventEmitter & {
      end: (body: Buffer) => void;
      destroy: (error: Error) => void;
    };
    req.destroy = (error) => {
      req.emit("error", error);
    };
    req.end = () => {
      if (state.mode === "error") req.emit("error", new Error("lost response"));
      else callback({ statusCode: 201, resume: vi.fn() });
    };
    return req;
  });
});
describe("standalone Node push transport core", () => {
  it("preserves a lost response after dispatch as UNKNOWN instead of a definite retry or acceptance", async () => {
    expect(await sendWebPush(input, config)).toEqual({
      status: "UNKNOWN",
      httpStatus: null,
      errorCode: "PUSH_TRANSPORT_FAILED",
    });
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it("refuses private DNS before any HTTPS dispatch and records ABORTED", async () => {
    state.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    expect(await sendWebPush(input, config)).toEqual({
      status: "ABORTED",
      httpStatus: null,
      errorCode: "PUSH_DNS_REJECTED",
    });
    expect(state.request).not.toHaveBeenCalled();
  });
  it("does not dispatch when cancellation races with successful DNS resolution", async () => {
    const controller = new AbortController();
    state.lookup.mockImplementation(() => {
      controller.abort();
      return Promise.resolve([{ address: "8.8.8.8", family: 4 }]);
    });
    expect(await sendWebPush(input, config, controller.signal)).toEqual({
      status: "ABORTED",
      httpStatus: null,
      errorCode: "PUSH_ABORTED",
    });
    expect(state.lookup).toHaveBeenCalledTimes(1);
    expect(state.request).not.toHaveBeenCalled();
  });
  it("does not dispatch while DNS is pending when the caller cancels", async () => {
    const controller = new AbortController();
    state.lookup.mockReturnValue(new Promise(() => {}));
    const pending = sendWebPush(input, config, controller.signal);
    controller.abort();
    expect(await pending).toEqual({
      status: "ABORTED",
      httpStatus: null,
      errorCode: "PUSH_ABORTED",
    });
    expect(state.request).not.toHaveBeenCalled();
  });
  it("retains an observed acceptance if cancellation happens after dispatch", async () => {
    const controller = new AbortController();
    state.request.mockImplementation((_url, _options, callback) => {
      const req = new EventEmitter() as EventEmitter & { end: () => void };
      req.end = () => {
        controller.abort();
        callback({ statusCode: 201, resume: vi.fn() });
      };
      return req;
    });
    expect(await sendWebPush(input, config, controller.signal)).toEqual({
      status: "ACCEPTED",
      httpStatus: 201,
      errorCode: null,
    });
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it("preserves actual provider HTTP acceptance without calling it device delivery", async () => {
    state.mode = "accepted";
    expect(await sendWebPush(input, config)).toEqual({
      status: "ACCEPTED",
      httpStatus: 201,
      errorCode: null,
    });
    expect(state.request).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "POST",
        servername: "fcm.googleapis.com",
      }),
      expect.any(Function),
    );
  });
});
