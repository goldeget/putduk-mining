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

async function withObservedAiResponse(
  response: unknown,
  inspect: (snapshot: () => Record<string, unknown>) => Promise<void>,
) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const priorWindow = globals.window;
  const priorLocation = globals.location;
  const returned = Promise.resolve(response);
  const fakeWindow = { fetch: () => returned };
  globals.window = fakeWindow;
  globals.location = {
    origin: "http://localhost",
    href: "http://localhost/ai",
  };
  try {
    installAckSignalObserver();
    assert.equal(
      Reflect.apply(fakeWindow.fetch, fakeWindow, [
        "/api/v1/ai/chat",
        {
          method: "POST",
          body: JSON.stringify({ clientMessageId: "private-observed-id" }),
        },
      ]),
      returned,
    );
    await returned;
    await Promise.resolve();
    const read = (
      fakeWindow as unknown as {
        __putdukAckSignal: (id: string) => Record<string, unknown>;
      }
    ).__putdukAckSignal;
    await inspect(() => read("private-observed-id"));
  } finally {
    if (priorWindow === undefined) delete globals.window;
    else globals.window = priorWindow;
    if (priorLocation === undefined) delete globals.location;
    else globals.location = priorLocation;
  }
}

describe("same-response native stream boundary diagnostics", () => {
  it("observes genuine reads and EOF without reading, cloning or cancelling the body itself", async () => {
    let cancelled = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
        cancel() {
          cancelled += 1;
        },
      }),
    );
    await withObservedAiResponse(response, async (snapshot) => {
      assert.equal(snapshot().readCalls, 0);
      const reader = response.body!.getReader();
      assert.equal((await reader.read()).value?.byteLength, 3);
      assert.equal((await reader.read()).done, true);
      await Promise.resolve();
      const observed = snapshot();
      assert.equal(observed.readCalls, 2);
      assert.equal(observed.pendingReads, 0);
      assert.equal(observed.eofCount, 1);
      assert.equal(observed.bytesRead, 3);
      assert.equal(observed.readerCancelCalls, 0);
      assert.equal(observed.streamCancelCalls, 0);
      assert.equal(typeof observed.snapshotAfterMs, "number");
      assert.equal(JSON.stringify(observed).includes("private"), false);
      reader.releaseLock();
    });
    assert.equal(cancelled, 0);
  });

  it("preserves read/cancel native receiver, args, promise and synchronous thrown error identity", async () => {
    const readPromise = Promise.resolve({
      done: false,
      value: new Uint8Array([4]),
    });
    const cancelPromise = Promise.reject(new Error("private cancel rejection"));
    void cancelPromise.catch(() => undefined);
    const thrown = new Error("private synchronous reader error");
    const calls: unknown[][] = [];
    let shouldThrow = false;
    const reader = {
      read(this: unknown, ...args: unknown[]) {
        calls.push(["read", this, ...args]);
        if (shouldThrow) throw thrown;
        return readPromise;
      },
      cancel(this: unknown, ...args: unknown[]) {
        calls.push(["cancel", this, ...args]);
        return cancelPromise;
      },
    };
    const stream = {
      getReader(this: unknown, ...args: unknown[]) {
        calls.push(["getReader", this, ...args]);
        return reader;
      },
    };
    await withObservedAiResponse({ body: stream }, async (snapshot) => {
      const options = { mode: "private-option" };
      assert.equal(Reflect.apply(stream.getReader, stream, [options]), reader);
      assert.equal(Reflect.apply(reader.read, reader, [options]), readPromise);
      assert.equal(snapshot().pendingReads, 1);
      await readPromise;
      await Promise.resolve();
      assert.equal(snapshot().pendingReads, 0);
      assert.equal(
        Reflect.apply(reader.cancel, reader, ["private-reason"]),
        cancelPromise,
      );
      await assert.rejects(cancelPromise);
      shouldThrow = true;
      assert.throws(
        () => reader.read(),
        (error) => error === thrown,
      );
      assert.deepEqual(calls.slice(0, 3), [
        ["getReader", stream, options],
        ["read", reader, options],
        ["cancel", reader, "private-reason"],
      ]);
      assert.equal(snapshot().readerCancelCalls, 1);
      assert.equal(snapshot().readFailures, 1);
      assert.equal(snapshot().readErrorName, "error");
      assert.equal(JSON.stringify(snapshot()).includes("private"), false);
    });
  });

  it("observes rejected reads and direct stream cancel without touching unrelated response methods", async () => {
    const failure = new TypeError("private transport failure");
    const rejected = Promise.reject(failure);
    void rejected.catch(() => undefined);
    const reader = { read: () => rejected, cancel: () => Promise.resolve() };
    const stream = { getReader: () => reader, cancel: () => Promise.resolve() };
    const unrelated = new Response("unrelated private response");
    const unrelatedReader = unrelated.body!.getReader;
    await withObservedAiResponse({ body: stream }, async (snapshot) => {
      stream.getReader();
      assert.equal(reader.read(), rejected);
      await assert.rejects(rejected, (error) => error === failure);
      await Promise.resolve();
      assert.equal(snapshot().readFailures, 1);
      assert.equal(snapshot().readErrorName, "type-error");
      await stream.cancel();
      assert.equal(snapshot().streamCancelCalls, 1);
      assert.equal(typeof snapshot().firstStreamCancelAfterMs, "number");
      assert.equal(unrelated.body!.getReader, unrelatedReader);
      assert.equal(JSON.stringify(snapshot()).includes("private"), false);
    });
  });

  it("classifies missing CDP data and detached Playwright response without raw exception text", () => {
    assert.equal(
      ackFailureCategory(
        new Error(
          "Protocol error (Network.getResponseBody): No data found for resource with given identifier private",
        ),
      ),
      "cdp-body-data-unavailable",
    );
    assert.equal(
      ackFailureCategory(
        new Error("response.text: Response body is unavailable private"),
      ),
      "playwright-response-body-unavailable",
    );
    assert.equal(
      ackFailureCategory(
        new Error("Protocol error (Network.getResponseBody): private unknown"),
      ),
      "cdp-protocol-error",
    );
  });
});

describe("diagnostic isolation", () => {
  it("contains observation exceptions without adding unhandled rejections or replacing native promise/error", async () => {
    const unhandled: unknown[] = [];
    const listen = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", listen);
    const nativeResult = Promise.resolve({
      get done(): boolean {
        throw new Error("private diagnostic getter");
      },
    });
    const nativeError = new Error("private original rejection");
    const rejected = Promise.reject(nativeError);
    void rejected.catch(() => undefined);
    let fail = false;
    const reader = {
      read: () => (fail ? rejected : nativeResult),
      cancel: () => Promise.resolve(),
    };
    try {
      const stream = { getReader: () => reader };
      await withObservedAiResponse({ body: stream }, async (snapshot) => {
        stream.getReader();
        assert.equal(reader.read(), nativeResult);
        await nativeResult;
        await Promise.resolve();
        fail = true;
        assert.equal(reader.read(), rejected);
        await assert.rejects(rejected, (error) => error === nativeError);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(snapshot().readFailures, 1);
        assert.equal(unhandled.length, 0);
      });
    } finally {
      process.off("unhandledRejection", listen);
    }
  });

  it("leaves uninstrumentable frozen bodies and all native stream prototypes untouched", async () => {
    const originalRead = ReadableStreamDefaultReader.prototype.read;
    const originalCancel = ReadableStreamDefaultReader.prototype.cancel;
    const originalGetReader = ReadableStream.prototype.getReader;
    const result = Promise.resolve({ done: true });
    const reader = { read: () => result };
    const stream = Object.freeze({ getReader: () => reader });
    await withObservedAiResponse({ body: stream }, async (snapshot) => {
      assert.equal(stream.getReader(), reader);
      assert.equal(reader.read(), result);
      assert.equal(snapshot().streamObserved, false);
      assert.equal(snapshot().readCalls, 0);
    });
    assert.equal(ReadableStreamDefaultReader.prototype.read, originalRead);
    assert.equal(ReadableStreamDefaultReader.prototype.cancel, originalCancel);
    assert.equal(ReadableStream.prototype.getReader, originalGetReader);
  });
});
