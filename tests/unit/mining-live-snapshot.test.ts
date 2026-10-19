import { describe, expect, it } from "vitest";
import {
  acceptMiningLiveSnapshot,
  canAutomaticallyReadMiningSnapshot,
  formatLiveMicroKrw,
  liveCapacityProgress,
  miningLiveSnapshotSchema,
  readMiningLiveEnvelope,
  toMiningLiveSnapshot,
  type MiningLiveSnapshot,
} from "@/lib/product/mining-live-snapshot";
import {
  emptyMiningServerDisplay,
  type MiningServerDisplay,
} from "@/lib/product/mining-server-display";

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
});

describe("server-derived live projection on the receipt", () => {
  const display = {
    available: true,
    eligible_principal_micro_krw: "1000000000",
    tier_code: "T1",
    tier_activated: true,
    cycle_started_at: "2026-10-01T00:00:00.000000Z",
    cycle_end: "2026-11-01T00:00:00.000000Z",
    effective_capacity_micro_krw: "10000000",
    remaining_capacity_micro_krw: "8961400",
    used_capacity_micro_krw: "1038600",
    speed_multiplier_bps: "10000",
    pending_micro_krw: "38600",
    retention_unconfirmed_micro_krw: "0",
    funded_runtime: {
      schema_version: 2,
      runtime_version: 2,
      state_revision: "10",
      condition_revision: "2",
      accepted_cursor_at: "2026-10-13T00:00:00.000000Z",
      evaluated_at: "2026-10-13T00:01:40.000000Z",
      allocation_bps: "10000",
      committed_reward_total_atomic: "12",
      reward_carry: { numerator: "0", denominator: "1", unit: "KRW" },
      conditional_maintenance: {
        numerator: "0",
        denominator: "1",
        unit: "KRW",
        qualification: "UNCONFIRMED",
      },
      status: "ACTIVE",
      stop_reason: null,
      speed: {
        product_multiplier_bps: "10000",
        user_multiplier_bps: "10000",
        common_multiplier: { numerator: "1", denominator: "1" },
        effective_global_multiplier: { numerator: "1", denominator: "1" },
      },
    },
  } as MiningServerDisplay;
  it("derives opaque bounds from the receipt's own facts, never a rate or policy", () => {
    const snapshot = toMiningLiveSnapshot(display);
    expect(snapshot?.projection).toEqual({
      accruedMicroKrw: "38599",
      windowMicros: "100000000",
      ceilingMicroKrw: "9000000",
      horizonMicros: "120000000",
    });
    expect(Object.keys(snapshot ?? {})).not.toContain("rate");
    expect(JSON.stringify(snapshot)).not.toMatch(/allocation|bps|multiplier/i);
  });
  it("stays flat when the server reports a stopped state", () => {
    const stopped = {
      ...display,
      funded_runtime: {
        ...display.funded_runtime,
        status: "STOPPED",
        stop_reason: "SAFE_MODE",
      },
    } as MiningServerDisplay;
    expect(toMiningLiveSnapshot(stopped)?.projection).toBeNull();
  });
  it("validates the projection strictly on the wire", () => {
    const projection = {
      accruedMicroKrw: "38599",
      windowMicros: "100000000",
      ceilingMicroKrw: "9000000",
      horizonMicros: "120000000",
    };
    const parse = (value: unknown) =>
      miningLiveSnapshotSchema.safeParse({ ...receipt, projection: value })
        .success;
    expect(parse(projection)).toBe(true);
    expect(parse(null)).toBe(true);
    expect(parse({ ...projection, rate: "1" })).toBe(false);
    expect(parse({ ...projection, windowMicros: "0" })).toBe(false);
    expect(parse({ ...projection, accruedMicroKrw: "1.5" })).toBe(false);
  });
});
