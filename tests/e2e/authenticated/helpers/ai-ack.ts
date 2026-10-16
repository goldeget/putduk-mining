import { createHash } from "node:crypto";
import type { Page, Response } from "@playwright/test";

type CapturedAckBody =
  { ok: true; text: string } | { ok: false; error: unknown };

const ackBodies = new WeakMap<Response, Promise<CapturedAckBody>>();
const ackSignalReaders = new WeakMap<Response, () => Promise<unknown>>();

export function installAckSignalObserver() {
  type Transport = {
    streamObserved: boolean;
    readerCount: number;
    readCalls: number;
    pendingReads: number;
    readFailures: number;
    readErrorName: string | null;
    bytesRead: number;
    eofCount: number;
    readerCancelCalls: number;
    streamCancelCalls: number;
    firstEofAfterMs: number | null;
    firstReaderCancelAfterMs: number | null;
    firstStreamCancelAfterMs: number | null;
  };
  type Record = {
    clientMessageId: string;
    startedAt: number;
    signalPresent: boolean;
    abortedInitially: boolean;
    abortAfterMs: number | null;
    transport: Transport;
  };
  const records: Record[] = [];
  const safe = (observe: () => void) => {
    try {
      observe();
    } catch {
      /* Diagnostic only. */
    }
  };
  const elapsed = (record: Record) =>
    Math.round((performance.now() - record.startedAt) * 1000) / 1000;
  const observePromise = (
    promise: unknown,
    fulfilled: (value: unknown) => void,
    rejected: (error: unknown) => void,
  ) => {
    safe(() => {
      // Return the original promise to the caller; contain the observation chain.
      void (promise as Promise<unknown>)
        .then(
          (value) => safe(() => fulfilled(value)),
          (error) => safe(() => rejected(error)),
        )
        .catch(() => undefined);
    });
  };
  Object.defineProperty(window, "__putdukAckSignal", {
    value: (id: string) => {
      const matches = records.filter((record) => record.clientMessageId === id);
      const record = matches.length === 1 ? matches[0] : undefined;
      return {
        matched: Boolean(record),
        signalPresent: record?.signalPresent ?? false,
        abortedInitially: record?.abortedInitially ?? false,
        abortAfterMs: record?.abortAfterMs ?? null,
        snapshotAfterMs: record ? elapsed(record) : null,
        ...record?.transport,
        recordCount: records.length,
      };
    },
  });
  const nativeFetch = window.fetch;
  window.fetch = function (...args: Parameters<typeof fetch>) {
    const returned = Reflect.apply(nativeFetch, this, args);
    try {
      const [input, init] = args;
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (
        url.origin !== location.origin ||
        url.pathname !== "/api/v1/ai/chat" ||
        (
          init?.method ?? (input instanceof Request ? input.method : "GET")
        ).toUpperCase() !== "POST" ||
        typeof init?.body !== "string"
      )
        return returned;
      const body = JSON.parse(init.body) as { clientMessageId?: unknown };
      if (typeof body.clientMessageId !== "string") return returned;
      const signal = init.signal;
      const record: Record = {
        clientMessageId: body.clientMessageId,
        startedAt: performance.now(),
        signalPresent: Boolean(signal),
        abortedInitially: signal?.aborted ?? false,
        abortAfterMs: null,
        transport: {
          streamObserved: false,
          readerCount: 0,
          readCalls: 0,
          pendingReads: 0,
          readFailures: 0,
          readErrorName: null,
          bytesRead: 0,
          eofCount: 0,
          readerCancelCalls: 0,
          streamCancelCalls: 0,
          firstEofAfterMs: null,
          firstReaderCancelAfterMs: null,
          firstStreamCancelAfterMs: null,
        },
      };
      records.push(record);
      if (records.length > 16) records.shift();
      signal?.addEventListener(
        "abort",
        () =>
          safe(() => {
            record.abortAfterMs = elapsed(record);
          }),
        { once: true },
      );
      observePromise(
        returned,
        (response) => {
          const stream = (
            response as { body?: ReadableStream<Uint8Array> | null }
          ).body;
          if (!stream) return;
          const seenReaders = new WeakSet<object>();
          const nativeGetReader = stream.getReader;
          Object.defineProperty(stream, "getReader", {
            configurable: true,
            writable: true,
            value: function (
              this: ReadableStream<Uint8Array>,
              ...readerArgs: unknown[]
            ) {
              const reader = Reflect.apply(
                nativeGetReader,
                this,
                readerArgs,
              ) as ReadableStreamDefaultReader<Uint8Array>;
              if (this !== stream) return reader;
              safe(() => {
                if (seenReaders.has(reader)) return;
                seenReaders.add(reader);
                record.transport.readerCount += 1;
                const nativeRead = reader.read;
                const readFailed = (error: unknown) => {
                  record.transport.pendingReads -= 1;
                  record.transport.readFailures += 1;
                  const name = (error as { name?: unknown } | null)?.name;
                  record.transport.readErrorName =
                    name === "AbortError"
                      ? "abort-error"
                      : name === "TypeError"
                        ? "type-error"
                        : name === "Error"
                          ? "error"
                          : "other";
                };
                Object.defineProperty(reader, "read", {
                  configurable: true,
                  writable: true,
                  value: function (
                    this: ReadableStreamDefaultReader<Uint8Array>,
                    ...readArgs: unknown[]
                  ) {
                    const owned = this === reader;
                    if (owned)
                      safe(() => {
                        record.transport.readCalls += 1;
                        record.transport.pendingReads += 1;
                      });
                    let result: Promise<unknown>;
                    try {
                      result = Reflect.apply(nativeRead, this, readArgs);
                    } catch (error) {
                      if (owned) safe(() => readFailed(error));
                      throw error;
                    }
                    if (owned)
                      observePromise(
                        result,
                        (value) => {
                          record.transport.pendingReads -= 1;
                          const read = value as {
                            done?: boolean;
                            value?: { byteLength?: number };
                          };
                          if (read.done) {
                            record.transport.eofCount += 1;
                            record.transport.firstEofAfterMs ??=
                              elapsed(record);
                          } else if (typeof read.value?.byteLength === "number")
                            record.transport.bytesRead += read.value.byteLength;
                        },
                        readFailed,
                      );
                    return result;
                  },
                });
                const nativeCancel = reader.cancel;
                Object.defineProperty(reader, "cancel", {
                  configurable: true,
                  writable: true,
                  value: function (
                    this: ReadableStreamDefaultReader<Uint8Array>,
                    ...cancelArgs: unknown[]
                  ) {
                    if (this === reader)
                      safe(() => {
                        record.transport.readerCancelCalls += 1;
                        record.transport.firstReaderCancelAfterMs ??=
                          elapsed(record);
                      });
                    return Reflect.apply(nativeCancel, this, cancelArgs);
                  },
                });
              });
              return reader;
            },
          });
          record.transport.streamObserved = true;
          const nativeCancel = stream.cancel;
          if (typeof nativeCancel === "function")
            Object.defineProperty(stream, "cancel", {
              configurable: true,
              writable: true,
              value: function (
                this: ReadableStream<Uint8Array>,
                ...cancelArgs: unknown[]
              ) {
                if (this === stream)
                  safe(() => {
                    record.transport.streamCancelCalls += 1;
                    record.transport.firstStreamCancelAfterMs ??=
                      elapsed(record);
                  });
                return Reflect.apply(nativeCancel, this, cancelArgs);
              },
            });
        },
        () => undefined,
      );
    } catch {
      /* Passive diagnostics never change native fetch behavior. */
    }
    return returned;
  };
}

export async function recordAckSignalFailure(response: Response) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reader = ackSignalReaders.get(response);
    if (reader)
      console.error(
        "[ai-ack-signal-diagnostic]",
        JSON.stringify(
          await Promise.race([
            reader(),
            new Promise((resolve) => {
              timer = setTimeout(
                () => resolve({ observation: "unavailable" }),
                1_000,
              );
            }),
          ]),
        ),
      );
  } catch {
    /* Preserve the original genuine ACK failure. */
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function captureAckBody(response: Response) {
  const existing = ackBodies.get(response);
  if (existing) return existing;
  // Begin CDP collection at response observation, before waiting for rendered UI.
  // Convert rejection to data immediately; the final ACK check still fails closed.
  const captured = response.text().then(
    (text): CapturedAckBody => ({ ok: true, text }),
    (error: unknown): CapturedAckBody => ({ ok: false, error }),
  );
  ackBodies.set(response, captured);
  return captured;
}

/** Categorize transport failures without logging messages, bodies, keys or IDs. */
export function ackFailureCategory(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/No resource with given identifier found/i.test(message))
    return "cdp-resource-unavailable";
  if (/No data found for resource with given identifier/i.test(message))
    return "cdp-body-data-unavailable";
  if (/Response body is unavailable/i.test(message))
    return "playwright-response-body-unavailable";
  if (/evicted from inspector cache/i.test(message)) return "cdp-body-evicted";
  if (
    /Target.*closed|page.*closed|context.*closed|browser.*closed/i.test(message)
  )
    return "target-closed";
  if (/aborted|cancelled|canceled|ERR_ABORTED/i.test(message))
    return "transport-aborted";
  if (/timeout|timed out/i.test(message)) return "transport-timeout";
  if (/Protocol error \(Network\.getResponseBody\)/i.test(message))
    return "cdp-protocol-error";
  return "unclassified";
}

export function recordAckFailure(
  response: Response,
  reason: "body-read-failed" | "body-limit-exceeded",
  error?: unknown,
  bodyCharacters?: number,
) {
  try {
    const request = response.request();
    const message = error instanceof Error ? error.message : String(error);
    const headers = response.headers();
    console.error(
      "[ai-ack-transport-diagnostic]",
      JSON.stringify({
        reason,
        status: response.status(),
        path:
          new URL(response.url()).pathname === "/api/v1/ai/chat"
            ? "/api/v1/ai/chat"
            : "unexpected-path",
        method: request.method() === "POST" ? "POST" : "unexpected-method",
        navigation: request.isNavigationRequest(),
        fromServiceWorker: response.fromServiceWorker(),
        eventStream: /^text\/event-stream(?:;|$)/i.test(
          headers["content-type"] ?? "",
        ),
        timing: request.timing(),
        bodyCharacters: bodyCharacters ?? null,
        errorCategory: error === undefined ? null : ackFailureCategory(error),
        errorFingerprint:
          error === undefined
            ? null
            : createHash("sha256").update(message).digest("hex"),
        requestFailureCategory: request.failure()
          ? ackFailureCategory(request.failure()?.errorText)
          : null,
      }),
    );
  } catch {
    // Diagnostics must never replace the genuine ACK failure or summary.
  }
}

export function bindAckSignalReader(response: Response, page: Page) {
  ackSignalReaders.set(response, async () => {
    const id = response.request().postDataJSON()?.clientMessageId;
    if (typeof id !== "string") return { matched: false };
    return page.evaluate((clientMessageId) => {
      const reader = (
        window as unknown as { __putdukAckSignal?: (id: string) => unknown }
      ).__putdukAckSignal;
      return reader?.(clientMessageId) ?? { matched: false };
    }, id);
  });
}
