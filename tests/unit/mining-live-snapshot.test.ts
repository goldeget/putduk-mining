import { describe, expect, it } from "vitest";
import {
  acceptMiningLiveSnapshot,
  canAutomaticallyReadMiningSnapshot,
  formatLiveMicroKrw,
  interpolateServerTarget,
  liveCapacityProgress,
  miningLiveSnapshotSchema,
  readMiningLiveEnvelope,
  toMiningLiveSnapshot,
  type MiningLiveSnapshot,
} from "@/lib/product/mining-live-snapshot";
import { emptyMiningServerDisplay } from "@/lib/product/mining-server-display";

const receipt: MiningLiveSnapshot = {
  scope: "GLOBAL_CYCLE",
  cycleStartedAt: "2026-10-01T00:00:00.000000Z",
  cycleEnd: "2026-11-01T00:00:00.000000Z",
  stateRevision: "9007199254740993000",
  conditionRevision: "20",
  acceptedCursorAt: "2026-10-13T00:00:00.000001Z",
  evaluatedAt: "2026-10-13T00:00:00.000002Z",
  status: "ACTIVE",
  stopReason: null,
  pendingMicroKrw: "1000001",
  committedKrw: "12",
  capacityMicroKrw: "10000000",
  usedMicroKrw: "1000001",
  remainingMicroKrw: "8999999",
};

describe("mining server fact projection and receipt ordering", () => {
  it("never permits automatic refresh for stopped or exhausted/zero capacity snapshots", () => {
    expect(canAutomaticallyReadMiningSnapshot(receipt)).toBe(true);
    expect(
      canAutomaticallyReadMiningSnapshot({
        ...receipt,
        status: "STOPPED",
        stopReason: "SAFE_MODE",
      }),
    ).toBe(false);
    expect(
      canAutomaticallyReadMiningSnapshot({
        ...receipt,
        usedMicroKrw: "10000000",
        remainingMicroKrw: "0",
      }),
    ).toBe(false);
    expect(
      canAutomaticallyReadMiningSnapshot({
        ...receipt,
        capacityMicroKrw: "0",
        usedMicroKrw: "0",
        remainingMicroKrw: "0",
      }),
    ).toBe(false);
  });
  it("does not synthesize a funded snapshot from unavailable or legacy amounts", () => {
    expect(toMiningLiveSnapshot(emptyMiningServerDisplay)).toBeNull();
    expect(
      toMiningLiveSnapshot({
        ...emptyMiningServerDisplay,
        available: true,
        pending_micro_krw: "123",
      }),
    ).toBeNull();
  });
  it.each([
    { capacityMicroKrw: "NaN" },
    { usedMicroKrw: "10000001" },
    { remainingMicroKrw: "8999997" },
    { evaluatedAt: "not-a-date" },
    { evaluatedAt: "2026-10-13T00:00:00.000Z" },
    { evaluatedAt: "2026-10-13T00:00:00.000000Z" },
    { cycleEnd: receipt.cycleStartedAt },
    { status: "STOPPED", stopReason: null },
    { status: "ACTIVE", stopReason: "SAFE_MODE" },
  ])(
    "rejects malformed or contradictory facts without throwing: %j",
    (change) => {
      expect(() =>
        miningLiveSnapshotSchema.safeParse({ ...receipt, ...change }),
      ).not.toThrow();
      expect(
        miningLiveSnapshotSchema.safeParse({ ...receipt, ...change }).success,
      ).toBe(false);
    },
  );
  it("accepts the server's one micro truncation difference and shares the existing ratio presenter", () => {
    const next = { ...receipt, remainingMicroKrw: "8999998" };
    expect(miningLiveSnapshotSchema.safeParse(next).success).toBe(true);
    expect(liveCapacityProgress(next)).toEqual({
      usedBps: 1000,
      usedLabel: "10% 사용",
    });
  });
  it.each([
    {
      stateRevision: "9007199254740992999",
      evaluatedAt: "2026-10-13T00:00:00.000003Z",
    },
    { conditionRevision: "19", evaluatedAt: "2026-10-13T00:00:00.000003Z" },
    {
      acceptedCursorAt: "2026-10-13T00:00:00.000000Z",
      evaluatedAt: "2026-10-13T00:00:00.000003Z",
    },
    { evaluatedAt: "2026-10-13T00:00:00.000001Z" },
    { pendingMicroKrw: "999999" },
    { cycleStartedAt: "2026-10-02T00:00:00.000000Z" },
  ])(
    "rejects reverse revisions, microsecond order, contradictory equal receipts and cycle changes: %j",
    (change) => {
      expect(acceptMiningLiveSnapshot(receipt, { ...receipt, ...change })).toBe(
        false,
      );
    },
  );
  it("accepts an exact repeated receipt and a newer authoritative downward correction", () => {
    expect(acceptMiningLiveSnapshot(receipt, { ...receipt })).toBe(true);
    expect(
      acceptMiningLiveSnapshot(receipt, {
        ...receipt,
        evaluatedAt: "2026-10-13T00:00:00.000003Z",
        pendingMicroKrw: "1",
      }),
    ).toBe(true);
  });
  it("binds the strict envelope to the current owner and excludes economic inputs", () => {
    expect(
      readMiningLiveEnvelope(
        { data: { ownerId: "owner", snapshot: receipt } },
        "owner",
      ).ok,
    ).toBe(true);
    expect(
      readMiningLiveEnvelope(
        { data: { ownerId: "other", snapshot: receipt } },
        "owner",
      ).ok,
    ).toBe(false);
    expect(
      readMiningLiveEnvelope(
        { data: { ownerId: "owner", snapshot: { ...receipt, rate: "1" } } },
        "owner",
      ).ok,
    ).toBe(false);
  });
});

describe("bounded visual money formatting", () => {
  it("keeps six decimal micro amounts and large integers exact", () => {
    expect(formatLiveMicroKrw("1")).toBe("0.000001원");
    expect(formatLiveMicroKrw("9007199254740993000001")).toBe(
      "9,007,199,254,740,993.000001원",
    );
    expect(formatLiveMicroKrw("invalid")).toBe("확인할 수 없어요");
  });
  it("never exceeds a new server target or animates a downward correction", () => {
    for (const progress of [
      -1,
      0,
      1234,
      5000,
      9999,
      10000,
      10001,
      Infinity,
      NaN,
    ]) {
      const shown = BigInt(
        interpolateServerTarget(
          "9007199254740993000",
          "9007199254741993000",
          progress,
        ),
      );
      expect(
        shown >= 9007199254740993000n && shown <= 9007199254741993000n,
      ).toBe(true);
    }
    expect(interpolateServerTarget("100", "99", 0)).toBe("99");
    expect(interpolateServerTarget("0", "100", 5000)).toBe("50");
  });
});
