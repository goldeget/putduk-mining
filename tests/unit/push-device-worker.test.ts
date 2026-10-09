import { describe, expect, it, vi } from "vitest";
import {
  processPushDeliveryBatch,
  type PushTransportResult,
} from "../../workers/push-delivery.mjs";

const id = "10000000-0000-4000-8000-000000000001";
const token = "10000000-0000-4000-8000-000000000002";
function envelope() {
  return {
    deliveryId: id,
    notificationId: id,
    leaseToken: token,
    workerId: "device-worker",
    attempt: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/local-fixture",
      p256dh: "fixture-key",
      authSecret: "fixture-auth",
    },
    payload: {
      notificationId: id,
      title: "퍼뜩",
      body: "새 알림을 확인해 주세요.",
      route: "/notifications",
    },
  };
}
function fixture(
  options: {
    row?: ReturnType<typeof envelope>;
    settlementError?: boolean;
    settleStatus?: string;
  } = {},
) {
  let claimed = false;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "claim_notification_push_deliveries") {
      if (claimed) return { data: [], error: null };
      claimed = true;
      return { data: [options.row ?? envelope()], error: null };
    }
    if (name !== "settle_notification_push_delivery")
      throw new Error("UNEXPECTED_RPC");
    if (options.settlementError)
      return { data: null, error: { message: "fixture fault" } };
    const status =
      options.settleStatus ??
      { ACCEPTED: "ACCEPTED", EXPIRED: "EXPIRED", REJECTED: "FAILED" }[
        args.p_status as string
      ] ??
      "RETRY";
    return { data: { deliveryId: id, status }, error: null };
  });
  return { rpc };
}

describe("per-device worker outcome and lease boundaries (no network)", () => {
  it.each([
    [201, "ACCEPTED"],
    [202, "ACCEPTED"],
    [200, "REJECTED"],
    [302, "REJECTED"],
    [404, "EXPIRED"],
    [410, "EXPIRED"],
    [408, "RETRY"],
    [429, "RETRY"],
    [500, "RETRY"],
    [599, "RETRY"],
    [422, "REJECTED"],
  ])(
    "records observed HTTP %s regardless of a transport status label",
    async (httpStatus, status) => {
      const db = fixture();
      const transport = vi.fn(async () => ({ status: "ACCEPTED", httpStatus }));
      const result = await processPushDeliveryBatch(db, {
        workerId: "device-worker",
        transport,
      });
      expect(result.claimed).toBe(1);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(db.rpc).toHaveBeenNthCalledWith(
        2,
        "settle_notification_push_delivery",
        expect.objectContaining({
          p_status: status,
          p_http_status: httpStatus,
          p_attempt: 1,
          p_lease_token: token,
          p_worker_id: "device-worker",
        }),
      );
    },
  );
  it.each(["ABORTED", "UNKNOWN"])(
    "preserves %s with no invented HTTP or delivery evidence",
    async (status) => {
      const db = fixture();
      const result = await processPushDeliveryBatch(db, {
        workerId: "device-worker",
        transport: async () => ({ status, httpStatus: null }),
      });
      expect(result.accepted).toBe(0);
      expect(db.rpc).toHaveBeenNthCalledWith(
        2,
        "settle_notification_push_delivery",
        expect.objectContaining({ p_status: status, p_http_status: null }),
      );
    },
  );
  it("records unknown after a thrown transport outcome without leaking raw errors", async () => {
    const db = fixture();
    const result = await processPushDeliveryBatch(db, {
      workerId: "device-worker",
      transport: async () => {
        throw new Error("private endpoint or secret");
      },
    });
    expect(result.unknown).toBe(1);
    expect(db.rpc).toHaveBeenNthCalledWith(
      2,
      "settle_notification_push_delivery",
      expect.objectContaining({
        p_status: "UNKNOWN",
        p_error_code: "PUSH_OUTCOME_UNKNOWN",
      }),
    );
    expect(JSON.stringify(db.rpc.mock.calls)).not.toContain(
      "private endpoint or secret",
    );
  });
  it("never resends when settlement fails after a provider accepted the request", async () => {
    const db = fixture({ settlementError: true });
    const transport = vi.fn(async () => ({
      status: "ACCEPTED",
      httpStatus: 201,
    }));
    await expect(
      processPushDeliveryBatch(db, { workerId: "device-worker", transport }),
    ).rejects.toThrow("PUSH_SETTLEMENT_FAILED");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledTimes(2);
  });
  it.each(["foreign-owner", "expired", "personal-body", "private-extra"])(
    "blocks %s before any send",
    async (fault) => {
      const row = envelope();
      if (fault === "foreign-owner") row.workerId = "other-worker";
      if (fault === "expired") row.leaseExpiresAt = new Date(0).toISOString();
      if (fault === "personal-body")
        row.payload.body = "금액·대화가 포함된 개인 정보";
      if (fault === "private-extra")
        Object.assign(row.payload, { balance: "100000" });
      const db = fixture({ row });
      const transport = vi.fn(async (): Promise<PushTransportResult> => ({
        status: "ACCEPTED",
        httpStatus: 201,
      }));
      await expect(
        processPushDeliveryBatch(db, { workerId: "device-worker", transport }),
      ).rejects.toThrow("PUSH_CLAIM_ENVELOPE_INVALID");
      expect(transport).not.toHaveBeenCalled();
      expect(db.rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("claims the next device only after the first outcome is durably settled", async () => {
    const db = fixture();
    await processPushDeliveryBatch(db, {
      workerId: "device-worker",
      transport: async () => ({ status: "ACCEPTED", httpStatus: 201 }),
    });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_notification_push_deliveries",
      "settle_notification_push_delivery",
      "claim_notification_push_deliveries",
    ]);
    expect(
      db.rpc.mock.calls
        .filter(([name]) => name === "claim_notification_push_deliveries")
        .every(([, args]) => args.p_batch_size === 1),
    ).toBe(true);
  });
});
