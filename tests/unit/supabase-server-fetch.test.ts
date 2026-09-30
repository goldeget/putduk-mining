import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSupabaseServerFetch,
  parseE2eForceRestFailureTables,
  resolveE2eForceRestFailureTables,
} from "@/lib/supabase/server-fetch";

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

  it("returns 500 for forced REST snapshot tables only", async () => {
    const upstream = vi.fn(async () => new Response("ok", { status: 200 }));
    const serverFetch = createSupabaseServerFetch({
      fetchImpl: upstream as typeof fetch,
      forceRestFailures: ["trial_account_snapshots"],
    });

    const failed = await serverFetch(
      "http://127.0.0.1:54321/rest/v1/trial_account_snapshots?select=*",
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({
      code: "E2E_FORCE_REST_FAILURE",
    });
    expect(upstream).not.toHaveBeenCalled();

    const auth = await serverFetch("http://127.0.0.1:54321/auth/v1/user");
    expect(auth.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });
});

describe("resolveE2eForceRestFailureTables", () => {
  it("ignores the fault cookie unless APP_ENV is test", () => {
    const cookie = "trial_account_snapshots,mining_active_session_snapshots";
    expect(resolveE2eForceRestFailureTables("production", cookie)).toEqual([]);
    expect(resolveE2eForceRestFailureTables("staging", cookie)).toEqual([]);
    expect(resolveE2eForceRestFailureTables("development", cookie)).toEqual([]);
    expect(resolveE2eForceRestFailureTables(undefined, cookie)).toEqual([]);
    expect(resolveE2eForceRestFailureTables("test", cookie)).toEqual([
      "trial_account_snapshots",
      "mining_active_session_snapshots",
    ]);
    expect(resolveE2eForceRestFailureTables("test", null)).toEqual([]);
  });
});

describe("parseE2eForceRestFailureTables", () => {
  it("keeps only safe table identifiers", () => {
    expect(
      parseE2eForceRestFailureTables(
        "trial_account_snapshots, mining_active_session_snapshots,../evil",
      ),
    ).toEqual(["trial_account_snapshots", "mining_active_session_snapshots"]);
  });
});
