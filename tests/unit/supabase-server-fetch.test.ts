import { afterEach, describe, expect, it, vi } from "vitest";

import { createSupabaseServerFetch } from "@/lib/supabase/server-fetch";

function createAbortAwarePendingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("Expected a request signal."));
        return;
      }

      const rejectOnAbort = () => reject(signal.reason);
      if (signal.aborted) {
        rejectOnAbort();
        return;
      }

      signal.addEventListener("abort", rejectOnAbort, { once: true });
    })) as typeof fetch;
}

describe("createSupabaseServerFetch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts an unresponsive upstream at the configured deadline", async () => {
    vi.useFakeTimers();
    const serverFetch = createSupabaseServerFetch({
      fetchImpl: createAbortAwarePendingFetch(),
      timeoutMs: 100,
    });

    const rejection = expect(
      serverFetch("http://127.0.0.1:58421/auth/v1/user"),
    ).rejects.toMatchObject({ name: "AbortError" });

    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });

  it("preserves cancellation from the caller", async () => {
    const requestController = new AbortController();
    const serverFetch = createSupabaseServerFetch({
      fetchImpl: createAbortAwarePendingFetch(),
      timeoutMs: 1_000,
    });

    const rejection = expect(
      serverFetch("http://127.0.0.1:58421/auth/v1/user", {
        signal: requestController.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    requestController.abort();
    await rejection;
  });

  it("rejects invalid timeout configuration", () => {
    expect(() => createSupabaseServerFetch({ timeoutMs: 0 })).toThrow(
      "Supabase server fetch timeout must be positive.",
    );
  });
});
