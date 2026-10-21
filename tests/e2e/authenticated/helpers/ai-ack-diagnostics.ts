export type AiTransportFailureCategory =
  | "ABORTED"
  | "CONNECTION_RESET"
  | "TARGET_CLOSED"
  | "PROTOCOL_ERROR"
  | "TIMEOUT"
  | "OTHER";

/** Never return an arbitrary browser error, which can embed URLs or credentials. */
export function classifyAiTransportFailure(
  failure: unknown,
): AiTransportFailureCategory {
  const message =
    typeof failure === "string"
      ? failure
      : failure instanceof Error
        ? failure.message
        : "";
  const name = failure instanceof Error ? failure.name : "";
  if (name === "AbortError" || message.includes("net::ERR_ABORTED"))
    return "ABORTED";
  if (message.includes("net::ERR_CONNECTION_RESET")) return "CONNECTION_RESET";
  if (/Target (?:page|context|browser).*closed/i.test(message))
    return "TARGET_CLOSED";
  if (message.includes("Protocol error")) return "PROTOCOL_ERROR";
  if (name === "TimeoutError" || message.includes("net::ERR_TIMED_OUT"))
    return "TIMEOUT";
  return "OTHER";
}

/** Preserve the existing ACK contract and bound; raw body/error never escapes. */
export async function readAiAnswerAck(
  status: number,
  readBody: () => Promise<string>,
) {
  const ack = {
    status,
    bodyAvailable: false,
    doneCount: 0,
    doneSaved: false,
    conversationIdPresent: false,
    assistantMessageIdPresent: false,
  };
  let text: string;
  try {
    text = await readBody();
  } catch (failure) {
    return {
      ack,
      body: {
        outcome: "READ_ERROR" as const,
        failureCategory: classifyAiTransportFailure(failure),
      },
    };
  }
  if (text.length > 65_536)
    return {
      ack,
      body: { outcome: "OVERSIZE" as const, failureCategory: null },
    };
  ack.bodyAvailable = true;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let value: unknown;
    try {
      value = JSON.parse(line.slice(5));
    } catch {
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const event = value as Record<string, unknown>;
    if (event.type !== "done") continue;
    ack.doneCount += 1;
    ack.doneSaved = event.saved === true;
    ack.conversationIdPresent = typeof event.conversationId === "string";
    ack.assistantMessageIdPresent =
      typeof event.assistantMessageId === "string";
  }
  return {
    ack,
    body: { outcome: "READ" as const, failureCategory: null },
  };
}
import type { Page, Response } from "@playwright/test";

type Ack = Awaited<ReturnType<typeof readAiAnswerAck>>["ack"];
type WireOutcome =
  | "READ"
  | "READ_ERROR"
  | "OVERSIZE"
  | "TIMEOUT"
  | "COUNT_LIMIT"
  | "AMBIGUOUS"
  | "UNAVAILABLE";
export type AiWireAckResult = {
  ack: Ack;
  body: {
    outcome: WireOutcome;
    failureCategory: AiTransportFailureCategory | null;
  };
};

const WIRE_ACK_KEY = "__putdukTestAiWireAck";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function unavailableAck(
  status: number,
  outcome: WireOutcome = "UNAVAILABLE",
): AiWireAckResult {
  return {
    ack: {
      status,
      bodyAvailable: false,
      doneCount: 0,
      doneSaved: false,
      conversationIdPresent: false,
      assistantMessageIdPresent: false,
    },
    body: { outcome, failureCategory: null },
  };
}

type WireEntry = {
  promise: Promise<AiWireAckResult>;
  finish: (result: AiWireAckResult) => void;
  ambiguous: boolean;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
};
type WireRegistry = {
  id: string;
  disposed: boolean;
  full: boolean;
  entries: Map<string, WireEntry>;
  restore: () => void;
};

/**
 * A test-only second consumer of the actual Response, never a mocked ACK.
 * Native clone/tee changes buffering and can outlive original-reader-only cancel.
 * Limits bound our accumulation/work, not browser-native tee queue allocations.
 */
export async function observeAiWireAck(
  page: Page,
  options: { timeoutMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5_000)
    throw new Error("AI_ACK_INVALID_BOUND");
  const target = new URL(page.url());
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(target.hostname)
  )
    throw new Error("AI_ACK_LOCAL_TARGET_REQUIRED");
  const id = crypto.randomUUID();
  let disposed = false;
  const installed = await page.evaluate(
    ({ key, id, timeoutMs }) => {
      const root = window as unknown as Record<
        string,
        WireRegistry | undefined
      >;
      if (root[key]) return false;
      const originalFetch = window.fetch;
      const registry: WireRegistry = {
        id,
        disposed: false,
        full: false,
        entries: new Map(),
        restore: () => undefined,
      };
      const empty = (
        status: number,
        outcome: WireOutcome,
      ): AiWireAckResult => ({
        ack: {
          status,
          bodyAvailable: false,
          doneCount: 0,
          doneSaved: false,
          conversationIdPresent: false,
          assistantMessageIdPresent: false,
        },
        body: { outcome, failureCategory: null },
      });
      const uuid =
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
      const cancel = (entry: WireEntry) => {
        try {
          void entry.reader?.cancel().catch(() => undefined);
        } catch {
          /* Only our clone branch. */
        }
      };
      const observe = async (
        response: globalThis.Response,
        entry: WireEntry,
      ) => {
        const status = response.status;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let eof = false;
        try {
          if (
            !(response instanceof globalThis.Response) ||
            response.redirected ||
            new URL(response.url).origin !== location.origin ||
            new URL(response.url).pathname !== "/api/v1/ai/chat" ||
            new URL(response.url).search
          )
            return entry.finish(empty(status, "UNAVAILABLE"));
          const reader = response.clone().body?.getReader();
          if (!reader) return entry.finish(empty(status, "READ_ERROR"));
          entry.reader = reader;
          const decoder = new TextDecoder();
          let text = "";
          let bytes = 0;
          let overflow: WireOutcome | null = null;
          const reading = (async () => {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) {
                eof = true;
                text += decoder.decode();
                break;
              }
              bytes += chunk.value.byteLength;
              if (bytes > 65_536) {
                overflow = "OVERSIZE";
                return;
              }
              text += decoder.decode(chunk.value, { stream: true });
              if (text.length > 65_536) {
                overflow = "OVERSIZE";
                return;
              }
            }
          })();
          const timed = new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              overflow = "TIMEOUT";
              resolve();
            }, timeoutMs);
          });
          await Promise.race([reading, timed]);
          if (overflow) return entry.finish(empty(status, overflow));
          if (!eof) return entry.finish(empty(status, "READ_ERROR"));
          const result = empty(status, "READ");
          let events = 0;
          for (const line of text.split("\n")) {
            if (!line.startsWith("data:")) continue;
            events += 1;
            if (events > 512) return entry.finish(empty(status, "COUNT_LIMIT"));
            let value: unknown;
            try {
              value = JSON.parse(line.slice(5));
            } catch {
              continue;
            }
            if (!value || typeof value !== "object" || Array.isArray(value))
              continue;
            const event = value as Record<string, unknown>;
            if (event.type !== "done") continue;
            result.ack.doneCount += 1;
            result.ack.doneSaved = event.saved === true;
            result.ack.conversationIdPresent =
              typeof event.conversationId === "string";
            result.ack.assistantMessageIdPresent =
              typeof event.assistantMessageId === "string";
          }
          result.ack.bodyAvailable = true;
          entry.finish(result);
        } catch {
          entry.finish(empty(status, "READ_ERROR"));
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          if (!eof) cancel(entry);
          try {
            entry.reader?.releaseLock();
          } catch {
            /* A pending owned read can still settle. */
          }
        }
      };
      const wrapped: typeof fetch = function (this: Window, input, init) {
        let token: string | null = null;
        try {
          const request = input instanceof Request ? input : null;
          const url = new URL(
            request ? request.url : String(input),
            location.href,
          );
          const method = (
            init?.method ??
            request?.method ??
            "GET"
          ).toUpperCase();
          if (
            method === "POST" &&
            url.origin === location.origin &&
            url.pathname === "/api/v1/ai/chat" &&
            !url.search &&
            typeof init?.body === "string" &&
            init.body.length <= 8_192
          ) {
            const body = JSON.parse(init.body) as Record<string, unknown>;
            if (
              typeof body?.clientMessageId === "string" &&
              uuid.test(body.clientMessageId)
            )
              token = body.clientMessageId;
          }
        } catch {
          /* Metadata must never replace the original fetch result/error. */
        }
        // Preserve the original Promise and synchronous errors as well as Response.
        const pending = originalFetch.call(this, input, init);
        if (!registry.disposed && token) {
          try {
            const existing = registry.entries.get(token);
            if (existing) {
              existing.ambiguous = true;
              existing.finish(empty(0, "AMBIGUOUS"));
              cancel(existing);
            } else if (registry.entries.size >= 16) registry.full = true;
            else {
              let resolve!: (result: AiWireAckResult) => void;
              const promise = new Promise<AiWireAckResult>((done) => {
                resolve = done;
              });
              const entry: WireEntry = {
                promise,
                finish: resolve,
                ambiguous: false,
              };
              registry.entries.set(token, entry);
              void pending
                .then(
                  (response) => {
                    if (registry.disposed || entry.ambiguous)
                      return entry.finish(
                        empty(response.status, "UNAVAILABLE"),
                      );
                    return observe(response, entry);
                  },
                  () => {
                    entry.finish(empty(0, "READ_ERROR"));
                  },
                )
                .catch(() => {
                  entry.finish(empty(0, "READ_ERROR"));
                });
            }
          } catch {
            /* Observer bookkeeping never changes the original fetch. */
          }
        }
        return pending;
      };
      registry.restore = () => {
        registry.disposed = true;
        if (window.fetch === wrapped) window.fetch = originalFetch;
        for (const entry of registry.entries.values()) {
          entry.finish(empty(0, "UNAVAILABLE"));
          cancel(entry);
        }
        registry.entries.clear();
      };
      root[key] = registry;
      window.fetch = wrapped;
      return true;
    },
    { key: WIRE_ACK_KEY, id, timeoutMs },
  );
  if (!installed) throw new Error("AI_ACK_OBSERVER_ALREADY_INSTALLED");
  return {
    async read(response: Response): Promise<AiWireAckResult> {
      const status = response.status();
      if (disposed) return unavailableAck(status);
      let token: string;
      try {
        const url = new URL(response.url());
        const request = response.request();
        const origin = new URL(page.url()).origin;
        if (
          request.method() !== "POST" ||
          request.redirectedFrom() !== null ||
          url.origin !== origin ||
          url.pathname !== "/api/v1/ai/chat" ||
          url.search ||
          request.frame() !== page.mainFrame()
        )
          return unavailableAck(status);
        const body = request.postDataJSON() as Record<string, unknown>;
        if (
          typeof body?.clientMessageId !== "string" ||
          !UUID.test(body.clientMessageId)
        )
          return unavailableAck(status);
        token = body.clientMessageId;
      } catch {
        return unavailableAck(status);
      }
      try {
        const result = await page.evaluate(
          async ({ key, id, token, status }) => {
            const root = window as unknown as Record<
              string,
              WireRegistry | undefined
            >;
            const registry = root[key];
            if (!registry || registry.id !== id || registry.disposed)
              return null;
            if (registry.full) return { outcome: "COUNT_LIMIT" as const };
            const entry = registry.entries.get(token);
            if (!entry) return null;
            const result = await entry.promise;
            if (registry.full) return { outcome: "COUNT_LIMIT" as const };
            if (entry.ambiguous) return { outcome: "AMBIGUOUS" as const };
            if (registry.disposed || result.ack.status !== status) return null;
            return { result };
          },
          { key: WIRE_ACK_KEY, id, token, status },
        );
        if (result && "result" in result && result.result) return result.result;
        return unavailableAck(status, result?.outcome ?? "UNAVAILABLE");
      } catch {
        return unavailableAck(status);
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await page
        .evaluate(
          ({ key, id }) => {
            const root = window as unknown as Record<
              string,
              WireRegistry | undefined
            >;
            const registry = root[key];
            if (!registry || registry.id !== id) return;
            registry.restore();
            delete root[key];
          },
          { key: WIRE_ACK_KEY, id },
        )
        .catch(() => undefined);
    },
  };
}
