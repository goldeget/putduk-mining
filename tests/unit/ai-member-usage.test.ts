import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readOwnAiQuota } from "@/lib/ai/member-usage";

function fixture(used: number | null, createdAt?: string, failure = false) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "gte", "lte", "order", "range"])
    query[name] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => ({
    data: createdAt ? { created_at: createdAt } : null,
    error: failure ? {} : null,
  }));
  query.then = vi.fn((resolve: (value: unknown) => unknown) =>
    resolve({ count: used, error: failure ? {} : null }),
  );
  return {
    client: { from: vi.fn(() => query) } as unknown as SupabaseClient,
    query,
  };
}
const input = {
  userId: "own-member",
  observedAtMs: Date.parse("2026-10-09T01:00:00Z"),
  windowMs: 60_000,
  limit: 5,
};

describe("own member rolling usage", () => {
  it("counts all admitted statuses exactly within the same rolling window", async () => {
    const { client, query } = fixture(3);
    expect(await readOwnAiQuota(client, input)).toEqual({
      used: 3,
      limit: 5,
      nextAvailableAt: null,
    });
    expect(query.select).toHaveBeenCalledWith("id", {
      count: "exact",
      head: true,
    });
    expect(query.eq).toHaveBeenCalledWith("user_id", "own-member");
    expect(query.gte).toHaveBeenCalledWith(
      "created_at",
      "2026-10-09T00:59:00.000Z",
    );
    expect(query.maybeSingle).not.toHaveBeenCalled();
  });
  it("shows the correct expiry when a newly lowered limit needs multiple requests to expire", async () => {
    const { client, query } = fixture(8, "2026-10-09T00:59:25Z");
    expect(await readOwnAiQuota(client, input)).toEqual({
      used: 8,
      limit: 5,
      nextAvailableAt: "2026-10-09T01:00:25.001Z",
    });
    expect(query.range).toHaveBeenCalledWith(3, 3);
  });
  it.each([null, -1, 1.5])(
    "does not replace an unknown/invalid count with zero: %s",
    async (used) => {
      await expect(readOwnAiQuota(fixture(used).client, input)).rejects.toThrow(
        "AI_USAGE_UNAVAILABLE",
      );
    },
  );
  it("fails closed when limited usage has no verified expiry or the read fails", async () => {
    await expect(readOwnAiQuota(fixture(5).client, input)).rejects.toThrow();
    await expect(
      readOwnAiQuota(fixture(0, undefined, true).client, input),
    ).rejects.toThrow();
  });
});
