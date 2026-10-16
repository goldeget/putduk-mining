import { afterEach, describe, expect, it, vi } from "vitest";
import { requestKyc } from "@/lib/kyc/client-request";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("KYC result deadline", () => {
  it("aborts waiting even when a transport ignores abort", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const result = requestKyc("/api/v1/kyc", {}, 20);
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(21);
    await rejected;
  });
  it("covers a stalled JSON body after response headers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => new Promise(() => undefined) }),
    );
    const rejected = expect(
      requestKyc("/api/v1/kyc", {}, 20),
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(21);
    await rejected;
  });
  it("does not start transport with an already canceled caller", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestKyc("/api/v1/kyc", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns actual payload and clears the deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { case: null } }),
      }),
    );
    expect((await requestKyc("/api/v1/kyc")).payload).toEqual({
      data: { case: null },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
