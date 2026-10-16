import { createHash } from "node:crypto";
import type { Page, Response } from "@playwright/test";

type CapturedAckBody =
  { ok: true; text: string } | { ok: false; error: unknown };

const ackBodies = new WeakMap<Response, Promise<CapturedAckBody>>();
const ackSignalReaders = new WeakMap<Response, () => Promise<unknown>>();
const ackBrowserBodies = new WeakMap<Response, () => Promise<unknown>>();
const finalAckBodies = new WeakMap<Response, Promise<CapturedAckBody>>();

/** Test-only observation; at most 16 immutable 64KiB copies, never transcript logs. */
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
    requestUrl: string;
    requestBody: string;
    responseEligible: boolean;
    invalidBytes: boolean;
    bytes: Uint8Array | null;
    byteCount: number;
    transport: Transport;
  };
  const records: Record[] = [];
  let captureOverflow = false;
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
  Object.defineProperty(window, "__putdukAckBody", {
    value: (request: {
      clientMessageId: string;
      requestUrl: string;
      requestBody: string;
      method: string;
    }) => {
      try {
        const matches = records.filter(
          (record) => record.clientMessageId === request.clientMessageId,
        );
        const record = matches.length === 1 ? matches[0] : undefined;
        if (
          !record ||
          captureOverflow ||
          request.method !== "POST" ||
          request.requestUrl !== record.requestUrl ||
          request.requestBody !== record.requestBody ||
          !record.responseEligible ||
          record.invalidBytes ||
          !record.bytes ||
          record.abortedInitially ||
          record.abortAfterMs !== null ||
          record.transport.readerCount !== 1 ||
          record.transport.eofCount !== 1 ||
          record.transport.pendingReads !== 0 ||
          record.transport.readFailures !== 0 ||
          record.transport.readerCancelCalls !== 0 ||
          record.transport.streamCancelCalls !== 0
        )
          return { ok: false };
        return {
          ok: true,
          text: new TextDecoder("utf-8", { fatal: true }).decode(
            record.bytes.subarray(0, record.byteCount),
          ),
        };
      } catch {
        return { ok: false };
      }
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
      const signal =
        init.signal ?? (input instanceof Request ? input.signal : undefined);
      const record: Record = {
        clientMessageId: body.clientMessageId,
        startedAt: performance.now(),
        signalPresent: Boolean(signal),
        abortedInitially: signal?.aborted ?? false,
        abortAfterMs: null,
        requestUrl: url.href,
        requestBody: init.body,
        responseEligible: false,
        invalidBytes: false,
        bytes: null,
        byteCount: 0,
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
      if (records.length > 16) {
        captureOverflow = true;
        for (const saved of records) saved.bytes = null;
        records.shift();
      }
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
          const fetched = response as globalThis.Response;
          safe(() => {
            record.responseEligible =
              fetched.status === 200 &&
              fetched.url === record.requestUrl &&
              fetched.redirected === false &&
              /^text\/event-stream(?:;|$)/i.test(
                fetched.headers.get("content-type") ?? "",
              );
          });
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
                if (readerArgs.length !== 0) record.invalidBytes = true;
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
                          try {
                            record.transport.pendingReads -= 1;
                            const read = value as {
                              done?: boolean;
                              value?: { byteLength?: number };
                            };
                            if (read.done) {
                              record.transport.eofCount += 1;
                              record.transport.firstEofAfterMs ??=
                                elapsed(record);
                            } else if (
                              typeof read.value?.byteLength === "number"
                            ) {
                              record.transport.bytesRead +=
                                read.value.byteLength;
                              try {
                                const chunk = read.value;
                                if (
                                  !(chunk instanceof Uint8Array) ||
                                  record.transport.eofCount !== 0 ||
                                  record.byteCount + chunk.byteLength > 65_536
                                )
                                  throw Error("INVALID_ACK_BYTES");
                                if (!captureOverflow && !record.invalidBytes) {
                                  record.bytes ??= new Uint8Array(65_536);
                                  record.bytes.set(chunk, record.byteCount);
                                  record.byteCount += chunk.byteLength;
                                }
                              } catch {
                                record.invalidBytes = true;
                                record.bytes = null;
                              }
                            } else {
                              record.invalidBytes = true;
                              record.bytes = null;
                            }
                          } catch {
                            record.invalidBytes = true;
                            record.bytes = null;
                          }
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

/** One final same-reader snapshot, never a retry or a UI/history substitute. */
export function readAckBody(response: Response) {
  const prior = finalAckBodies.get(response);
  if (prior) return prior;
  const final = (async (): Promise<CapturedAckBody> => {
    const captured = await captureAckBody(response);
    if (
      captured.ok ||
      ![
        "cdp-resource-unavailable",
        "cdp-body-data-unavailable",
        "playwright-response-body-unavailable",
        "cdp-body-evicted",
      ].includes(ackFailureCategory(captured.error))
    )
      return captured;
    const browserReader = ackBrowserBodies.get(response);
    if (!browserReader) return captured;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = (await Promise.race([
        browserReader(),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 1_000);
        }),
      ])) as { ok?: unknown; text?: unknown } | null;
      if (
        value?.ok === true &&
        typeof value.text === "string" &&
        new TextEncoder().encode(value.text).byteLength <= 65_536
      )
        return { ok: true, text: value.text };
    } catch {
      // Accessor failure preserves the original CDP error, including its identity.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    return captured;
  })();
  finalAckBodies.set(response, final);
  return final;
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
  ackBrowserBodies.set(response, async () => {
    const request = response.request();
    const requestBody = request.postData();
    const clientMessageId = request.postDataJSON()?.clientMessageId;
    const requestUrl = request.url();
    if (
      typeof clientMessageId !== "string" ||
      typeof requestBody !== "string" ||
      request.method() !== "POST" ||
      request.isNavigationRequest() ||
      response.status() !== 200 ||
      response.url() !== requestUrl ||
      response.fromServiceWorker() ||
      new URL(requestUrl).pathname !== "/api/v1/ai/chat" ||
      !/^text\/event-stream(?:;|$)/i.test(
        response.headers()["content-type"] ?? "",
      )
    )
      return { ok: false };
    return page.evaluate(
      (expected) => {
        const read = (
          window as unknown as {
            __putdukAckBody?: (value: typeof expected) => unknown;
          }
        ).__putdukAckBody;
        return read?.(expected) ?? { ok: false };
      },
      { clientMessageId, requestUrl, requestBody, method: "POST" },
    );
  });
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
