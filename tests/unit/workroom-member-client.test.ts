import { describe, expect, it, vi } from "vitest";
import {
  WorkroomCommandQueue,
  isValidWorkroomStake,
} from "@/components/workroom/command-client";
const state = {
  member: null,
  active: null,
  configs: [],
  history: [],
  ledger: [],
  serverNow: 1000,
};
describe("member stake bounds", () => {
  it("matches server minimum, maximum, available balance, and integer constraint", () => {
    expect(isValidWorkroomStake(999, 100000)).toBe(false);
    expect(isValidWorkroomStake(1000, 100000)).toBe(true);
    expect(isValidWorkroomStake(1000.5, 100000)).toBe(false);
    expect(isValidWorkroomStake(1001, 1000)).toBe(false);
    expect(isValidWorkroomStake(1000, 999)).toBe(false);
    expect(isValidWorkroomStake(1_000_000_000, 2_000_000_000)).toBe(true);
    expect(isValidWorkroomStake(1_000_000_001, 2_000_000_000)).toBe(false);
    expect(isValidWorkroomStake(Number.NaN, 100000)).toBe(false);
  });
});
function storage() {
  const rows = new Map<string, string>();
  return {
    getItem: (k: string) => rows.get(k) ?? null,
    setItem: (k: string, v: string) => {
      rows.set(k, v);
    },
    removeItem: (k: string) => {
      rows.delete(k);
    },
  };
}
describe("member command recovery", () => {
  it("reuses the exact idempotency key and payload after lost response and reload", async () => {
    const store = storage(),
      first = new WorkroomCommandQueue("member-a", store);
    first.prepare(
      "START",
      {
        instrument: "nvda",
        stake: 50000,
        acknowledged: true,
        expectedVersion: 7,
      },
      "request-a",
    );
    const lost = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("network lost"));
    await expect(first.send(lost)).rejects.toThrow("network lost");
    const reloaded = new WorkroomCommandQueue("member-a", store);
    const success = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: state })));
    await reloaded.send(success);
    expect(success.mock.calls[0]?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
      "Idempotency-Key": "request-a",
    });
    expect(success.mock.calls[0]?.[1]?.body).toBe(
      lost.mock.calls[0]?.[1]?.body,
    );
    expect(
      JSON.parse(String(success.mock.calls[0]?.[1]?.body)).input
        .expectedVersion,
    ).toBe(7);
    expect(new WorkroomCommandQueue("member-a", store).current()).toBeNull();
  });
  it("blocks changing the reviewed input while an outcome is unresolved", () => {
    const queue = new WorkroomCommandQueue("a");
    queue.prepare("START", { stake: 1000 }, "fixed");
    expect(() => queue.prepare("START", { stake: 2000 }, "new")).toThrow(
      "이전 요청 결과",
    );
    expect(queue.prepare("START", { stake: 1000 }, "another").key).toBe(
      "fixed",
    );
  });
  it("requires a fresh review after a stale config is rejected", async () => {
    const queue = new WorkroomCommandQueue("a");
    queue.prepare(
      "START",
      {
        instrument: "nvda",
        stake: 1000,
        acknowledged: true,
        expectedVersion: 7,
      },
      "reviewed-seven",
    );
    await expect(
      queue.send(
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                message: "조건이 변경되었습니다. 다시 확인해 주세요.",
              },
            }),
            { status: 409 },
          ),
        ),
      ),
    ).rejects.toThrow("조건이 변경");
    expect(queue.current()).toBeNull();
    expect(
      queue.prepare(
        "START",
        {
          instrument: "nvda",
          stake: 1000,
          acknowledged: true,
          expectedVersion: 8,
        },
        "reviewed-eight",
      ).key,
    ).toBe("reviewed-eight");
  });
  it("never restores another member's pending command", () => {
    const store = storage();
    new WorkroomCommandQueue("a", store).prepare(
      "FINISH",
      { id: "round-a" },
      "key-a",
    );
    expect(new WorkroomCommandQueue("b", store).current()).toBeNull();
  });
  it("retains pending requests for server failures and malformed success", async () => {
    const queue = new WorkroomCommandQueue("a");
    queue.prepare("SYNC", {}, "sync-a");
    await expect(
      queue.send(
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify({ error: { message: "busy" } }), {
            status: 503,
          }),
        ),
      ),
    ).rejects.toThrow("busy");
    expect(queue.current()?.key).toBe("sync-a");
    await expect(
      queue.send(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(JSON.stringify({ data: {} }))),
      ),
    ).rejects.toThrow("응답");
    expect(queue.current()?.key).toBe("sync-a");
  });
  it("clears a definitively rejected input so a corrected submission gets a new key", async () => {
    const queue = new WorkroomCommandQueue("a");
    queue.prepare("START", { stake: -1 }, "bad");
    await expect(
      queue.send(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ error: { message: "참여 포인트 확인" } }),
              { status: 422 },
            ),
          ),
      ),
    ).rejects.toThrow("참여 포인트 확인");
    expect(queue.current()).toBeNull();
    expect(queue.prepare("START", { stake: 1000 }, "corrected").key).toBe(
      "corrected",
    );
  });
  it("keeps retry state for rate limits", async () => {
    const queue = new WorkroomCommandQueue("a");
    queue.prepare("OPEN", {}, "open-a");
    await expect(
      queue.send(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("{}", { status: 429 })),
      ),
    ).rejects.toThrow();
    expect(queue.current()?.key).toBe("open-a");
  });
});
