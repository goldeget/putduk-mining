import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemberAlarmCoordinator,
  type AlarmStorage,
} from "../../workers/workroom-member-alarm";
const memberId = "10000000-0000-4000-8000-000000000001";
const oldId = "10000000-0000-4000-8000-000000000002";
const newId = "10000000-0000-4000-8000-000000000003";
function storage() {
  const values = new Map<string, unknown>();
  let at: number | null = null;
  return {
    values,
    at: () => at,
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    getAlarm: async () => at,
    setAlarm: vi.fn(async (time: number) => {
      at = time;
    }),
    deleteAlarm: async () => {
      at = null;
    },
  } satisfies AlarmStorage & {
    values: Map<string, unknown>;
    at(): number | null;
  };
}
afterEach(() => vi.useRealTimers());
describe("per-member durable scheduling", () => {
  it("duplicate schedules retain the earliest alarm and ignore caller deadlines", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const store = storage();
    const job = {
      memberId,
      roundId: oldId,
      generation: oldId,
      dueAt: new Date(Date.now() + 5_000).toISOString(),
    };
    const db = {
      rpc: vi.fn(async () => ({ data: { jobs: [job] }, error: null })),
    };
    const alarm = new MemberAlarmCoordinator(store, db);
    await Promise.all([alarm.arm(memberId), alarm.arm(memberId)]);
    expect(store.setAlarm).toHaveBeenCalledTimes(1);
    expect(store.at()).toBe(Date.now() + 5_000);
  });
  it("an old wakeup re-reads the newer committed round and never settles it early", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const store = storage();
    await store.put("memberId", memberId);
    const job = {
      memberId,
      roundId: newId,
      generation: newId,
      dueAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const db = {
      rpc: vi.fn(async () => ({ data: { jobs: [job] }, error: null })),
    };
    await new MemberAlarmCoordinator(store, db).alarm();
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(store.at()).toBe(Date.now() + 60_000);
  });
  it("settles only the current due round then removes consumed alarm", async () => {
    const store = storage();
    await store.put("memberId", memberId);
    const job = {
      memberId,
      roundId: newId,
      generation: newId,
      dueAt: new Date(Date.now() - 1_000).toISOString(),
    };
    const results = [{ jobs: [job] }, { settled: 1 }, { jobs: [] }];
    const db = {
      rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
        data: results.shift(),
        error: null,
      })),
    };
    await new MemberAlarmCoordinator(store, db).alarm();
    expect(db.rpc.mock.calls[1]?.[1]).toEqual({
      p_operation: "RECOVER",
      p_input: { limit: 100, memberId, roundId: newId },
    });
    expect(store.at()).toBe(null);
  });
  it("does not erase a persisted job when the authoritative DB is unavailable", async () => {
    const store = storage();
    await store.put("memberId", memberId);
    await store.setAlarm(Date.now() + 60_000);
    const original = store.at();
    const db = { rpc: vi.fn(async () => ({ error: true })) };
    await expect(new MemberAlarmCoordinator(store, db).alarm()).rejects.toThrow(
      "WORKROOM_DUE_FAILED",
    );
    expect(store.at()).toBe(original);
    expect(store.values.get("memberId")).toBe(memberId);
  });
  it("rejects cross-member object reuse", async () => {
    const store = storage();
    await store.put("memberId", memberId);
    await expect(
      new MemberAlarmCoordinator(store, { rpc: vi.fn() }).arm(newId),
    ).rejects.toThrow("WORKROOM_ALARM_OWNER_INVALID");
  });
});
