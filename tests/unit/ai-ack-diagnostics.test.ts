import { strict as assert } from "node:assert";
import { describe, it } from "vitest";

import {
  ackFailureCategory,
  bindAckSignalReader,
  captureAckBody,
  installAckSignalObserver,
  readAckBody,
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

async function withCapturedReader(
  bytes: Uint8Array,
  inspect: (context: {
    reader: ReadableStreamDefaultReader<Uint8Array>;
    controller: ReadableStreamDefaultController<Uint8Array>;
    signal: AbortController;
    read: (override?: Record<string, unknown>) => unknown;
    fetchAgain: (id: string) => void;
    cdpResponse: Parameters<typeof captureAckBody>[0];
    stream: ReadableStream<Uint8Array>;
  }) => Promise<void>,
  responseOptions: {
    redirected?: boolean;
    url?: string;
    status?: number;
    type?: string;
  } = {},
) {
  const globals = globalThis as unknown as Record<string, unknown>;
  const priorWindow = globals.window,
    priorLocation = globals.location;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        value.enqueue(bytes);
      },
    }),
    {
      status: responseOptions.status ?? 200,
      headers: { "content-type": responseOptions.type ?? "text/event-stream" },
    },
  );
  Object.defineProperty(response, "url", {
    value: responseOptions.url ?? "http://localhost/api/v1/ai/chat",
  });
  Object.defineProperty(response, "redirected", {
    value: responseOptions.redirected ?? false,
  });
  const signal = new AbortController();
  const fakeWindow = { fetch: () => Promise.resolve(response) };
  globals.window = fakeWindow;
  globals.location = {
    origin: "http://localhost",
    href: "http://localhost/ai",
  };
  const request = {
    clientMessageId: "raw-private-id",
    requestUrl: "http://localhost/api/v1/ai/chat",
    method: "POST",
    requestBody: JSON.stringify({
      clientMessageId: "raw-private-id",
      question: "private question",
    }),
  };
  try {
    installAckSignalObserver();
    const fetchAgain = (id: string) => {
      void Reflect.apply(fakeWindow.fetch, fakeWindow, [
        "/api/v1/ai/chat",
        {
          method: "POST",
          body:
            id === request.clientMessageId
              ? request.requestBody
              : JSON.stringify({ clientMessageId: id }),
          signal: signal.signal,
        },
      ]);
    };
    fetchAgain(request.clientMessageId);
    await Promise.resolve();
    await Promise.resolve();
    const read = (override = {}) =>
      (
        fakeWindow as unknown as {
          __putdukAckBody?: (value: unknown) => unknown;
        }
      ).__putdukAckBody?.({ ...request, ...override }) ?? { ok: false };
    const cdpResponse = {
      text: () =>
        Promise.reject(
          new Error(
            "Protocol error (Network.getResponseBody): No data found for resource with given identifier",
          ),
        ),
      status: () => response.status,
      url: () => request.requestUrl,
      headers: () => ({ "content-type": "text/event-stream" }),
      fromServiceWorker: () => false,
      request: () => ({
        postData: () => request.requestBody,
        postDataJSON: () => JSON.parse(request.requestBody),
        url: () => request.requestUrl,
        method: () => "POST",
        isNavigationRequest: () => false,
      }),
    } as never;
    bindAckSignalReader(cdpResponse, {
      evaluate: async (fn: (value: unknown) => unknown, value: unknown) =>
        fn(value),
    } as never);
    await inspect({
      reader: response.body!.getReader(),
      controller,
      signal,
      read,
      fetchAgain,
      cdpResponse,
      stream: response.body!,
    });
  } finally {
    if (priorWindow === undefined) delete globals.window;
    else globals.window = priorWindow;
    if (priorLocation === undefined) delete globals.location;
    else globals.location = priorLocation;
  }
}

describe("same application reader immutable ACK bytes", () => {
  it("preserves offset views and split UTF8 chunks and accepts exactly the byte cap", async () => {
    const backing = new Uint8Array([88, 0xea, 0xb0, 0x80, 89]);
    await withCapturedReader(
      backing.subarray(1, 2),
      async ({ reader, controller, read }) => {
        await reader.read();
        controller.enqueue(backing.subarray(2, 4));
        await reader.read();
        controller.close();
        await reader.read();
        assert.deepEqual(read(), { ok: true, text: "가" });
      },
    );
    await withCapturedReader(
      new Uint8Array(65_536).fill(65),
      async ({ reader, controller, read }) => {
        await reader.read();
        controller.close();
        await reader.read();
        const captured = read() as { ok: boolean; text: string };
        assert.equal(captured.ok, true);
        assert.equal(captured.text.length, 65_536);
      },
    );
  });

  it("rejects repeated EOF, a second reader and direct stream cancellation", async () => {
    for (const boundary of [
      "extra-eof",
      "second-reader",
      "stream-cancel",
    ] as const) {
      await withCapturedReader(
        new Uint8Array([65]),
        async ({ reader, controller, read, stream }) => {
          await reader.read();
          controller.close();
          await reader.read();
          assert.deepEqual(read(), { ok: true, text: "A" });
          if (boundary === "extra-eof") await reader.read();
          else {
            reader.releaseLock();
            if (boundary === "second-reader") stream.getReader();
            else await stream.cancel();
          }
          assert.deepEqual(read(), { ok: false });
        },
      );
    }
  });
  it("recovers known CDP unavailability only from the same native application's completed raw bytes at final ACK time", async () => {
    const text =
      'data: {"type":"done","saved":true,"conversationId":"actual-stream","assistantMessageId":"actual-message"}\n\n';
    await withCapturedReader(
      new TextEncoder().encode(text),
      async ({ reader, controller, cdpResponse }) => {
        const early = await captureAckBody(cdpResponse);
        assert.equal(early.ok, false);
        await reader.read();
        controller.close();
        await reader.read();
        const final = readAckBody(cdpResponse);
        assert.equal(readAckBody(cdpResponse), final);
        assert.deepEqual(await final, { ok: true, text });
      },
    );
  });

  it("does not retry a failed final snapshot after the application's later EOF", async () => {
    await withCapturedReader(
      new Uint8Array([65]),
      async ({ reader, controller, cdpResponse }) => {
        await reader.read();
        const first = readAckBody(cdpResponse);
        assert.equal((await first).ok, false);
        controller.close();
        await reader.read();
        assert.equal(readAckBody(cdpResponse), first);
        assert.equal((await first).ok, false);
      },
    );
  });
  it("copies actual native chunks before application mutation and exposes them only after complete EOF", async () => {
    const text = 'data: {"type":"done","saved":true}\n\n';
    const bytes = new TextEncoder().encode(text);
    await withCapturedReader(bytes, async ({ reader, controller, read }) => {
      assert.deepEqual(read(), { ok: false });
      const chunk = await reader.read();
      assert.equal(chunk.value, bytes);
      bytes.fill(88);
      assert.deepEqual(read(), { ok: false });
      controller.close();
      assert.equal((await reader.read()).done, true);
      assert.deepEqual(read(), { ok: true, text });
      assert.deepEqual(read({ clientMessageId: "wrong-id" }), { ok: false });
      assert.deepEqual(read({ requestBody: "different request" }), {
        ok: false,
      });
      assert.deepEqual(
        read({ requestUrl: "http://localhost/api/v1/ai/chat?different" }),
        { ok: false },
      );
      assert.deepEqual(read({ method: "GET" }), { ok: false });
    });
  });

  it("rejects oversized and invalid UTF8 bytes rather than substituting any decoded approximation", async () => {
    for (const bytes of [
      new Uint8Array(65_537),
      new Uint8Array([0xc3, 0x28]),
    ]) {
      await withCapturedReader(bytes, async ({ reader, controller, read }) => {
        await reader.read();
        controller.close();
        await reader.read();
        assert.deepEqual(read(), { ok: false });
      });
    }
  });

  it("rejects cancelled, aborted and failed streams even if they already supplied genuine bytes", async () => {
    for (const boundary of ["cancel", "abort", "read-failure"] as const) {
      await withCapturedReader(
        new Uint8Array([65]),
        async ({ reader, controller, signal, read }) => {
          await reader.read();
          if (boundary === "cancel") await reader.cancel();
          else if (boundary === "read-failure") {
            controller.error(new Error("private"));
            await assert.rejects(reader.read());
          } else {
            controller.close();
            await reader.read();
            signal.abort();
          }
          assert.deepEqual(read(), { ok: false });
        },
      );
    }
  });

  it("rejects redirects, wrong response URL/status/type and duplicate IDs including record eviction", async () => {
    for (const responseOptions of [
      { redirected: true },
      { url: "http://other.invalid/api/v1/ai/chat" },
      { status: 201 },
      { type: "application/json" },
    ]) {
      await withCapturedReader(
        new Uint8Array([65]),
        async ({ reader, controller, read }) => {
          await reader.read();
          controller.close();
          await reader.read();
          assert.deepEqual(read(), { ok: false });
        },
        responseOptions,
      );
    }
    for (const overflow of [false, true]) {
      await withCapturedReader(
        new Uint8Array([65]),
        async ({ reader, controller, read, fetchAgain }) => {
          await reader.read();
          controller.close();
          await reader.read();
          if (overflow)
            for (let i = 0; i < 17; i += 1) fetchAgain(`other-${i}`);
          fetchAgain("raw-private-id");
          assert.deepEqual(read(), { ok: false });
        },
      );
    }
  });
});

describe("final raw ACK fallback isolation", () => {
  it("never asks the browser for successful CDP bodies or unrelated CDP/transport errors", async () => {
    for (const error of [
      null,
      new Error("Protocol error (Network.getResponseBody): unrelated"),
      new Error("net::ERR_ABORTED"),
      new Error("Target closed"),
      new Error("timeout"),
    ]) {
      let calls = 0;
      const response = {
        text: () =>
          error ? Promise.reject(error) : Promise.resolve("original CDP body"),
        request: () => {
          calls += 1;
          throw Error("must not inspect fallback metadata");
        },
      } as never;
      bindAckSignalReader(response, {
        evaluate: () => {
          calls += 1;
        },
      } as never);
      const captured = await readAckBody(response);
      assert.equal(calls, 0);
      if (error) {
        assert.equal(captured.ok, false);
        if (!captured.ok) assert.equal(captured.error, error);
      } else
        assert.deepEqual(captured, { ok: true, text: "original CDP body" });
    }
  });

  it("preserves the exact original CDP error when the browser accessor throws or times out", async () => {
    for (const timeout of [false, true]) {
      const failure = new Error(
        "No data found for resource with given identifier",
      );
      let calls = 0;
      const response = {
        text: () => Promise.reject(failure),
        status: () => 200,
        url: () => "http://localhost/api/v1/ai/chat",
        headers: () => ({ "content-type": "text/event-stream" }),
        fromServiceWorker: () => false,
        request: () => ({
          postData: () => '{"clientMessageId":"private"}',
          postDataJSON: () => ({ clientMessageId: "private" }),
          url: () => "http://localhost/api/v1/ai/chat",
          method: () => "POST",
          isNavigationRequest: () => false,
        }),
      } as never;
      bindAckSignalReader(response, {
        evaluate: () => {
          calls += 1;
          return timeout
            ? new Promise(() => {})
            : Promise.reject(new Error("private accessor failure"));
        },
      } as never);
      const captured = await readAckBody(response);
      assert.equal(calls, 1);
      assert.equal(captured.ok, false);
      if (!captured.ok) assert.equal(captured.error, failure);
    }
  });
});
