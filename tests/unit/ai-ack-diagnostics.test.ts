import { strict as assert } from "node:assert";
import { describe, it } from "vitest";

import {
  ackFailureCategory,
  bindAckSignalReader,
  captureAckBody,
  installAckSignalObserver,
  recordAckFailure,
  recordAckSignalFailure,
} from "../e2e/authenticated/helpers/ai-ack";

describe("passive AI ACK diagnostics", () => {
  it("keeps diagnostic metadata exceptions from replacing the genuine ACK failure", () => {
    assert.doesNotThrow(() =>
      recordAckFailure(
        {
          request: () => {
            throw new Error("private metadata unavailable");
          },
        } as never,
        "body-read-failed",
        new Error("net::ERR_ABORTED"),
      ),
    );
  });

  it("bounds an unavailable signal reader and clears its diagnostic timer", async () => {
    const originalSet = globalThis.setTimeout;
    const originalClear = globalThis.clearTimeout;
    const originalError = console.error;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const deadlines: number[] = [];
    const logs: unknown[][] = [];
    globalThis.setTimeout = ((callback: () => void, delay: number) => {
      deadlines.push(delay);
      const timer = originalSet(callback, delay);
      timers.add(timer);
      return timer;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
      timers.delete(timer);
      return originalClear(timer);
    }) as typeof clearTimeout;
    console.error = (...args) => logs.push(args);
    try {
      const response = {
        request: () => ({
          postDataJSON: () => ({ clientMessageId: "private" }),
        }),
      };
      bindAckSignalReader(
        response as never,
        {
          evaluate: () => new Promise(() => {}),
        } as never,
      );
      await recordAckSignalFailure(response as never);
      assert.deepEqual(deadlines, [1_000]);
      assert.equal(timers.size, 0);
      const diagnostic = logs.find(
        (entry) => entry[0] === "[ai-ack-signal-diagnostic]",
      );
      assert.deepEqual(JSON.parse(diagnostic![1] as string), {
        observation: "unavailable",
      });
    } finally {
      for (const timer of timers) originalClear(timer);
      globalThis.setTimeout = originalSet;
      globalThis.clearTimeout = originalClear;
      console.error = originalError;
    }
  });

  it("logs only safe transport metadata and the matching signal snapshot", async () => {
    const logs: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args);
    const response = {
      status: () => 200,
      url: () => "http://localhost/api/v1/ai/chat?private-query",
      headers: () => ({ "content-type": "text/event-stream" }),
      fromServiceWorker: () => false,
      request: () => ({
        method: () => "POST",
        isNavigationRequest: () => false,
        timing: () => ({ responseEnd: 50 }),
        failure: () => ({ errorText: "net::ERR_ABORTED private-error" }),
        postDataJSON: () => ({ clientMessageId: "private-id" }),
      }),
    };
    try {
      bindAckSignalReader(
        response as never,
        {
          evaluate: async (_read: unknown, id: string) => {
            assert.equal(id, "private-id");
            return { matched: true, signalPresent: true, abortAfterMs: 50 };
          },
        } as never,
      );
      recordAckFailure(
        response as never,
        "body-read-failed",
        new Error("net::ERR_ABORTED private-error"),
      );
      await recordAckSignalFailure(response as never);
      const transport = JSON.parse(logs[0]![1] as string);
      assert.equal(transport.errorCategory, "transport-aborted");
      assert.equal(transport.requestFailureCategory, "transport-aborted");
      assert.equal(logs[1]![0], "[ai-ack-signal-diagnostic]");
      assert.equal(JSON.stringify(logs).includes("private"), false);
    } finally {
      console.error = originalError;
    }
  });

  it("categorizes unavailable bodies without retaining exception text", () => {
    assert.equal(
      ackFailureCategory(new Error("net::ERR_ABORTED private")),
      "transport-aborted",
    );
    assert.equal(
      ackFailureCategory(new Error("No resource with given identifier found")),
      "cdp-resource-unavailable",
    );
    assert.equal(
      ackFailureCategory(new Error("secret unknown")),
      "unclassified",
    );
  });

  it("captures a genuine body once and keeps rejection as data", async () => {
    let reads = 0;
    const response = {
      text: () => {
        reads += 1;
        return Promise.reject(new Error("private"));
      },
    };
    const first = captureAckBody(response as never);
    assert.equal(captureAckBody(response as never), first);
    assert.equal((await first).ok, false);
    assert.equal(reads, 1);
    const genuine = new Response("data: genuine-ack\n\n");
    assert.deepEqual(await captureAckBody(genuine as never), {
      ok: true,
      text: "data: genuine-ack\n\n",
    });
  });

  it("preserves native fetch receiver, arguments and promise and observes the same signal", async () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const originalWindow = globals.window;
    const originalLocation = globals.location;
    const promise = Promise.resolve(new Response());
    const calls: unknown[][] = [];
    const fakeWindow = {
      fetch: function (this: unknown, ...args: unknown[]) {
        calls.push([this, ...args]);
        return promise;
      },
    };
    globals.window = fakeWindow;
    globals.location = {
      href: "http://localhost/ai",
      origin: "http://localhost",
    };
    try {
      installAckSignalObserver();
      const controller = new AbortController();
      const init = {
        method: "POST",
        body: JSON.stringify({ clientMessageId: "private-id" }),
        signal: controller.signal,
      };
      const returned = Reflect.apply(fakeWindow.fetch, fakeWindow, [
        "/api/v1/ai/chat",
        init,
      ]);
      assert.equal(returned, promise);
      assert.deepEqual(calls[0], [fakeWindow, "/api/v1/ai/chat", init]);
      controller.abort();
      const read = (
        fakeWindow as unknown as {
          __putdukAckSignal: (id: string) => Record<string, unknown>;
        }
      ).__putdukAckSignal;
      const snapshot = read("private-id");
      assert.equal(snapshot.matched, true);
      assert.equal(typeof snapshot.abortAfterMs, "number");
      assert.equal(JSON.stringify(snapshot).includes("private-id"), false);
      const malformed = { method: "POST", body: "not-json" };
      assert.equal(
        Reflect.apply(fakeWindow.fetch, fakeWindow, [
          "/api/v1/ai/chat",
          malformed,
        ]),
        promise,
      );
      for (let index = 0; index < 20; index += 1) {
        Reflect.apply(fakeWindow.fetch, fakeWindow, [
          "/api/v1/ai/chat",
          {
            method: "POST",
            body: JSON.stringify({ clientMessageId: `bounded-${index}` }),
          },
        ]);
      }
      assert.equal(read("private-id").matched, false);
      assert.equal(read("bounded-19").recordCount, 16);
    } finally {
      if (originalWindow === undefined) delete globals.window;
      else globals.window = originalWindow;
      if (originalLocation === undefined) delete globals.location;
      else globals.location = originalLocation;
    }
  });
});
