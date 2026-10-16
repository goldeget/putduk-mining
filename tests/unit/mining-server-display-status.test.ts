import { describe, expect, it } from "vitest";
import {
  emptyMiningServerDisplay,
  fundedRuntimeDisplaySchema,
  parseMiningServerDisplay,
  resolveFundedRuntimeStatus,
  type FundedRuntimeDisplay,
} from "@/lib/product/mining-server-display";

const historical = {
  schema_version: 1,
  runtime_version: 2,
  state_revision: "9007199254740993",
  condition_revision: "5",
  accepted_cursor_at: "2026-10-06T11:00:00.123456Z",
  evaluated_at: "2026-10-06T11:00:00.123457Z",
  allocation_bps: "5000",
  committed_reward_total_atomic: "12",
  reward_carry: { numerator: "73", denominator: "100", unit: "KRW" },
  conditional_maintenance: {
    numerator: "1273",
    denominator: "100",
    unit: "KRW",
    qualification: "UNCONFIRMED",
  },
} satisfies FundedRuntimeDisplay;
const active = {
  ...historical,
  schema_version: 2,
  status: "ACTIVE",
  stop_reason: null,
  speed: {
    product_multiplier_bps: "10000",
    user_multiplier_bps: "10000",
    common_multiplier: { numerator: "1", denominator: "1" },
    effective_global_multiplier: { numerator: "1", denominator: "2" },
  },
} satisfies FundedRuntimeDisplay;

const read = (funded_runtime: unknown) =>
  parseMiningServerDisplay({
    ...emptyMiningServerDisplay,
    available: true,
    speed_multiplier_bps: "10000",
    funded_runtime,
  });

describe("server-proven funded runtime status", () => {
  it("keeps schema1 receipt facts but never infers running from allocation/history", () => {
    expect(read(historical)?.funded_runtime).toEqual(historical);
    expect(resolveFundedRuntimeStatus(historical)).toBe("UNKNOWN");
    expect(resolveFundedRuntimeStatus(undefined)).toBe("UNKNOWN");
    expect(resolveFundedRuntimeStatus(null)).toBe("UNKNOWN");
  });
  it("accepts exact authoritative status without equating allocation with intrinsic speed", () => {
    const parsed = read(active);
    expect(resolveFundedRuntimeStatus(parsed?.funded_runtime)).toBe("ACTIVE");
    expect(parsed?.speed_multiplier_bps).toBe("10000");
    expect(parsed?.funded_runtime).toEqual(active);
  });
  it("preserves exact global ratio, declared factors and final cap without recomputing them", () => {
    const supplied = {
      ...active,
      speed: {
        product_multiplier_bps: "11000",
        user_multiplier_bps: "12000",
        common_multiplier: { numerator: "5", denominator: "4" },
        effective_global_multiplier: { numerator: "33", denominator: "40" },
      },
    };
    expect(read(supplied)?.funded_runtime).toEqual(supplied);
    const capped = {
      ...active,
      speed: {
        ...active.speed,
        effective_global_multiplier: { numerator: "3", denominator: "2" },
      },
    };
    expect(read(capped)?.funded_runtime).toEqual(capped);
  });
  it("zero allocation has a stopped BASE status with independent conditional maintenance", () => {
    const stopped = {
      ...active,
      status: "STOPPED",
      stop_reason: "NO_ACTIVE_ALLOCATION",
      allocation_bps: "0",
      speed: {
        ...active.speed,
        effective_global_multiplier: { numerator: "0", denominator: "1" },
      },
    };
    expect(resolveFundedRuntimeStatus(read(stopped)?.funded_runtime)).toBe(
      "STOPPED",
    );
    expect(read(stopped)?.funded_runtime?.conditional_maintenance).toEqual(
      historical.conditional_maintenance,
    );
  });
  it("capacity used is a server-issued stop even while allocation/speed stay positive", () => {
    const stopped = {
      ...active,
      status: "STOPPED",
      stop_reason: "CAPACITY_USED",
    };
    expect(resolveFundedRuntimeStatus(read(stopped)?.funded_runtime)).toBe(
      "STOPPED",
    );
  });
  it.each([
    ["unversioned status", { ...historical, status: "ACTIVE" }],
    ["missing status", { ...active, status: undefined }],
    ["missing speed proof", { ...active, speed: undefined }],
    [
      "unsupported account control status",
      { ...active, status: "STOPPED", stop_reason: "ACCOUNT_PAUSE" },
    ],
    ["running with a stop reason", { ...active, stop_reason: "CAPACITY_USED" }],
    ["stopped without a reason", { ...active, status: "STOPPED" }],
    ["running with no allocation", { ...active, allocation_bps: "0" }],
    [
      "running with zero effective speed",
      {
        ...active,
        speed: {
          ...active.speed,
          effective_global_multiplier: { numerator: "0", denominator: "1" },
        },
      },
    ],
    [
      "stop reason contradicting allocation",
      { ...active, status: "STOPPED", stop_reason: "NO_ACTIVE_ALLOCATION" },
    ],
    [
      "noninteger declared factor",
      { ...active, speed: { ...active.speed, product_multiplier_bps: "1.00" } },
    ],
    [
      "unapproved product factor",
      {
        ...active,
        speed: { ...active.speed, product_multiplier_bps: "12000" },
      },
    ],
    [
      "unapproved user factor",
      { ...active, speed: { ...active.speed, user_multiplier_bps: "12001" } },
    ],
    [
      "invalid common denominator",
      {
        ...active,
        speed: {
          ...active.speed,
          common_multiplier: { numerator: "1", denominator: "0" },
        },
      },
    ],
    [
      "nonnumeric ratio",
      {
        ...active,
        speed: {
          ...active.speed,
          effective_global_multiplier: { numerator: "NaN", denominator: "1" },
        },
      },
    ],
    [
      "effective speed above approved global cap",
      {
        ...active,
        speed: {
          ...active.speed,
          effective_global_multiplier: {
            numerator: "15001",
            denominator: "10000",
          },
        },
      },
    ],
    ["caller-shaped monetary field", { ...active, amount_atomic: "999" }],
    ["unknown schema version", { ...active, schema_version: 3 }],
  ])(
    "rejects %s as unknown rather than supplying a running claim",
    (_label, value) => {
      expect(() => fundedRuntimeDisplaySchema.safeParse(value)).not.toThrow();
      expect(read(value)).toBeNull();
    },
  );
});

describe("strict server-owned GLOBAL permission stop", () => {
  const paused = { ...active, status: "STOPPED", stop_reason: "SAFE_MODE" };

  it("accepts a versioned permission stop without changing configured speed, money or carry", () => {
    const parsed = read(paused)?.funded_runtime;
    expect(parsed).toEqual(paused);
    expect(resolveFundedRuntimeStatus(parsed)).toBe("STOPPED");
    expect(parsed?.reward_carry).toEqual(historical.reward_carry);
    expect(parsed?.conditional_maintenance).toEqual(
      historical.conditional_maintenance,
    );
    expect(parsed?.committed_reward_total_atomic).toBe("12");
    expect(parsed?.allocation_bps).toBe("5000");
  });

  it("accepts a GLOBAL stop with zero allocation and independent conditional maintenance", () => {
    const supplied = {
      ...paused,
      allocation_bps: "0",
      speed: {
        ...active.speed,
        effective_global_multiplier: { numerator: "0", denominator: "1" },
      },
    };
    expect(read(supplied)?.funded_runtime).toEqual(supplied);
    expect(resolveFundedRuntimeStatus(read(supplied)?.funded_runtime)).toBe(
      "STOPPED",
    );
  });

  it("preserves the capped configured global ratio during a permission stop", () => {
    const supplied = {
      ...paused,
      speed: {
        ...active.speed,
        effective_global_multiplier: { numerator: "3", denominator: "2" },
      },
    };
    expect(read(supplied)?.funded_runtime).toEqual(supplied);
  });

  it.each([
    ["ACTIVE contradicts GLOBAL stop", { ...paused, status: "ACTIVE" }],
    [
      "schema1 has no permission proof",
      { ...historical, status: "STOPPED", stop_reason: "SAFE_MODE" },
    ],
    ["missing configured speed proof", { ...paused, speed: undefined }],
    [
      "zero allocation with positive configured ratio",
      { ...paused, allocation_bps: "0" },
    ],
    [
      "positive allocation with zero configured ratio",
      {
        ...paused,
        speed: {
          ...active.speed,
          effective_global_multiplier: { numerator: "0", denominator: "1" },
        },
      },
    ],
    ["unknown account control", { ...paused, stop_reason: "ACCOUNT_PAUSE" }],
    [
      "unapproved product multiplier",
      {
        ...paused,
        speed: { ...active.speed, product_multiplier_bps: "12000" },
      },
    ],
    [
      "unapproved global speed",
      {
        ...paused,
        speed: {
          ...active.speed,
          effective_global_multiplier: {
            numerator: "15001",
            denominator: "10000",
          },
        },
      },
    ],
    [
      "unconfirmed value relabelled wallet",
      {
        ...paused,
        conditional_maintenance: {
          ...historical.conditional_maintenance,
          qualification: "CONFIRMED",
        },
      },
    ],
  ])(
    "rejects %s without fabricating a safe stopped/running DTO",
    (_label, supplied) => {
      expect(read(supplied)).toBeNull();
    },
  );
});
