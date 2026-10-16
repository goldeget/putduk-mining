import { createHash } from "node:crypto";
import type { Page, Response } from "@playwright/test";

type CapturedAckBody =
  { ok: true; text: string } | { ok: false; error: unknown };

const ackBodies = new WeakMap<Response, Promise<CapturedAckBody>>();
const ackSignalReaders = new WeakMap<Response, () => Promise<unknown>>();

export function installAckSignalObserver() {
  const records: {
    clientMessageId: string;
    startedAt: number;
    signalPresent: boolean;
    abortedInitially: boolean;
    abortAfterMs: number | null;
  }[] = [];
  Object.defineProperty(window, "__putdukAckSignal", {
    value: (id: string) => {
      const matches = records.filter((record) => record.clientMessageId === id);
      const record = matches.length === 1 ? matches[0] : undefined;
      return {
        matched: Boolean(record),
        signalPresent: record?.signalPresent ?? false,
        abortedInitially: record?.abortedInitially ?? false,
        abortAfterMs: record?.abortAfterMs ?? null,
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
      const record = {
        clientMessageId: body.clientMessageId,
        startedAt: performance.now(),
        signalPresent: Boolean(signal),
        abortedInitially: signal?.aborted ?? false,
        abortAfterMs: null as number | null,
      };
      records.push(record);
      if (records.length > 16) records.shift();
      signal?.addEventListener(
        "abort",
        () => {
          record.abortAfterMs =
            Math.round((performance.now() - record.startedAt) * 1000) / 1000;
        },
        { once: true },
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
  if (/evicted from inspector cache/i.test(message)) return "cdp-body-evicted";
  if (
    /Target.*closed|page.*closed|context.*closed|browser.*closed/i.test(message)
  )
    return "target-closed";
  if (/aborted|cancelled|canceled|ERR_ABORTED/i.test(message))
    return "transport-aborted";
  if (/timeout|timed out/i.test(message)) return "transport-timeout";
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
