import { describe, expect, it, vi } from "vitest";
import {
  recoverWorkroomJobs,
  dispatchWorkroomPush,
  readWorkroomDueJobs,
} from "../../workers/workroom-app-runtime";

const memberId = "10000000-0000-4000-8000-000000000001";
const roundId = "10000000-0000-4000-8000-000000000002";
function client(results: unknown[]) {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      void name;
      void args;
      return {
        data: results.shift(),
        error: null,
      };
    }),
    from: vi.fn(() => ({
      select: () => ({ in: async () => ({ data: [], error: null }) }),
    })),
  };
}
describe("WORKROOM production scheduler and leased push", () => {
  it("fails closed on due RPC failure before scheduling", async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: { message: "private" } })),
    };
    await expect(readWorkroomDueJobs(db)).rejects.toThrow(
      "WORKROOM_DUE_FAILED",
    );
  });
  it("requires exact authoritative generation and member in due envelopes", async () => {
    const db = client([
      {
        jobs: [
          {
            memberId,
            roundId,
            generation: memberId,
            dueAt: new Date().toISOString(),
          },
        ],
      },
    ]);
    await expect(readWorkroomDueJobs(db, memberId)).rejects.toThrow(
      "WORKROOM_DUE_INVALID",
    );
  });
  it("recovers by service RPC with bounded limits and never a browser ledger mutation", async () => {
    const db = client([{ settled: 1 }]);
    expect(await recoverWorkroomJobs(db, { memberId, roundId })).toBe(1);
    expect(db.rpc).toHaveBeenCalledWith("workroom_app_worker", {
      p_operation: "RECOVER",
      p_input: { limit: 100, memberId, roundId },
    });
  });
  it("denies revoked delivery immediately before provider dispatch", async () => {
    const db = client([
      [claim()],
      { deliveryId: memberId, allowed: false },
      { deliveryId: memberId, status: "CANCELLED" },
      [],
    ]);
    const transport = vi.fn();
    const result = await dispatchWorkroomPush(db, {
      workerId: "test",
      transport,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(1);
    expect(db.rpc.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        p_operation: "ACK_PUSH",
        p_input: expect.objectContaining({ status: "ABORTED" }),
      }),
    );
  });
  it.each([
    [410, "EXPIRED", "expired"],
    [429, "RETRY", "retried"],
    [202, "ACCEPTED", "accepted"],
  ])(
    "settles provider %s separately from device visibility",
    async (http, status, counter) => {
      const db = client([
        [claim()],
        { deliveryId: memberId, allowed: true },
        { deliveryId: memberId, status },
        [],
      ]);
      const result = await dispatchWorkroomPush(db, {
        workerId: "test",
        transport: async () => ({
          httpStatus: http as number,
          status: status as string,
        }),
      });
      expect(result[counter as keyof typeof result]).toBe(1);
      expect(result.deviceDisplayVerified).toBe(false);
    },
  );
});
function claim() {
  return {
    workerId: "test",
    deliveryId: memberId,
    notificationId: roundId,
    leaseToken: roundId,
    attempt: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      p256dh: "public",
      authSecret: "secret",
    },
    payload: {
      notificationId: roundId,
      route: "/notifications",
      title: "퍼뜩",
      body: "새 알림을 확인해 주세요.",
    },
  };
}
